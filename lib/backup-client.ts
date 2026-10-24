import {
  backupFormat, backupTableNames, backupVersion, isBackupPref, validBackupTables,
  type BackupFile, type BackupManifest, type BackupSnapshot, type BackupTable, type BackupTables,
} from '@/lib/backup';
import { createZip, readZip, type ZipInput } from '@/lib/zip';

/** Progress while a backup is made or restored: what is happening, and how far along (0–1). */
export type BackupProgress = { label: string; ratio: number };
type Report = (progress: BackupProgress) => void;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const json = (value: unknown) => encoder.encode(JSON.stringify(value, null, 1));

async function failure(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error || `${fallback}（HTTP ${response.status}）`);
}

/** This browser's settings that travel with a backup (lib/backup isBackupPref). */
export function readPrefs(): Record<string, string> {
  const prefs: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && isBackupPref(key)) prefs[key] = window.localStorage.getItem(key) ?? '';
    }
  } catch { /* storage unavailable: the backup goes without them */ }
  return prefs;
}

const filePath = (key: string) => `files/${key}`;

/** Collects everything into one ZIP: manifest.json, database.json, prefs.json and files/…. */
export async function makeBackup(report: Report = () => undefined): Promise<{ blob: Blob; manifest: BackupManifest }> {
  report({ label: '讀取資料表…', ratio: 0 });
  const response = await fetch('/api/backup', { cache: 'no-store' });
  if (!response.ok) throw await failure(response, '備份資料無法讀取');
  const snapshot = await response.json() as BackupSnapshot;
  const prefs = readPrefs();
  const total = snapshot.files.reduce((sum, file) => sum + file.size, 0) || 1;
  let done = 0;
  const entries: ZipInput[] = [];
  for (const file of snapshot.files) {
    report({ label: `下載素材 ${file.name || file.key.split('/')[1] || file.key}…`, ratio: 0.05 + 0.85 * (done / total) });
    const fileResponse = await fetch(`/api/backup?file=${encodeURIComponent(file.key)}`, { cache: 'no-store' });
    if (!fileResponse.ok) throw await failure(fileResponse, `素材 ${file.key} 無法下載`);
    entries.push({ name: filePath(file.key), data: new Uint8Array(await fileResponse.arrayBuffer()) });
    done += file.size;
  }
  const manifest: BackupManifest = {
    format: backupFormat,
    version: backupVersion,
    createdAt: snapshot.createdAt,
    app: 'OptionFlow',
    counts: Object.fromEntries(backupTableNames.map((name) => [name, snapshot.tables[name].length])) as Record<BackupTable, number>,
    files: snapshot.files.map((file) => ({ ...file, path: filePath(file.key) })),
    prefs: Object.keys(prefs).length,
  };
  report({ label: '壓縮成 ZIP…', ratio: 0.92 });
  const blob = await createZip([
    { name: 'manifest.json', data: json(manifest), compress: true },
    { name: 'database.json', data: json({ tables: snapshot.tables }), compress: true },
    { name: 'prefs.json', data: json(prefs), compress: true },
    ...entries,
  ]);
  report({ label: '完成', ratio: 1 });
  return { blob, manifest };
}

/** A backup file opened for restoring: what it holds, checked, but nothing written yet. */
export type OpenedBackup = {
  manifest: BackupManifest;
  tables: BackupTables;
  prefs: Record<string, string>;
  files: Array<BackupFile & { read: () => Promise<Uint8Array> }>;
};

export async function openBackup(file: Blob): Promise<OpenedBackup> {
  const entries = await readZip(file);
  const readJson = async (name: string) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`備份檔缺少 ${name}，可能不是 OptionFlow 的完整備份。`);
    try { return JSON.parse(decoder.decode(await entry.read())) as unknown; } catch (error) {
      throw error instanceof SyntaxError ? new Error(`備份檔裡的 ${name} 已損毀。`) : error;
    }
  };
  const manifest = await readJson('manifest.json') as BackupManifest;
  if (manifest?.format !== backupFormat) throw new Error('這不是 OptionFlow 的完整備份檔。');
  if (typeof manifest.version !== 'number' || manifest.version > backupVersion) throw new Error('這份備份來自較新版本的 OptionFlow，請先更新再還原。');
  const tables = validBackupTables((await readJson('database.json') as { tables?: unknown })?.tables);
  const rawPrefs = await readJson('prefs.json');
  const prefs: Record<string, string> = {};
  if (rawPrefs && typeof rawPrefs === 'object') {
    for (const [key, value] of Object.entries(rawPrefs)) if (isBackupPref(key) && typeof value === 'string') prefs[key] = value;
  }
  const files = (Array.isArray(manifest.files) ? manifest.files : []).map((listed) => {
    const entry = entries.get(listed.path);
    if (!entry || listed.path !== filePath(listed.key)) throw new Error(`備份檔缺少素材 ${listed.key}。`);
    return { key: listed.key, size: entry.size, type: listed.type, name: listed.name ?? '', updatedAt: listed.updatedAt ?? '', read: entry.read };
  });
  return { manifest, tables, prefs, files };
}

/**
 * Puts a backup back: the files first, then every table in one transaction (all or nothing), and last
 * this browser's settings. Stored art the backup does not have is removed. The page should reload after.
 */
export async function restoreBackup(backup: OpenedBackup, report: Report = () => undefined) {
  const total = backup.files.reduce((sum, file) => sum + file.size, 0) || 1;
  let done = 0;
  for (const file of backup.files) {
    report({ label: `上傳素材 ${file.name || file.key.split('/')[1] || file.key}…`, ratio: 0.85 * (done / total) });
    const bytes = await file.read();
    const response = await fetch(`/api/backup?file=${encodeURIComponent(file.key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Updated-At': file.updatedAt },
      body: bytes as BodyInit,
    });
    if (!response.ok) throw await failure(response, `素材 ${file.key} 無法上傳`);
    done += file.size;
  }
  report({ label: '寫入資料表…', ratio: 0.9 });
  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: backupFormat, version: backup.manifest.version, tables: backup.tables, keepFiles: backup.files.map((file) => file.key) }),
  });
  if (!response.ok) throw await failure(response, '資料無法還原');
  try {
    const current = readPrefs();
    for (const key of Object.keys(current)) if (!(key in backup.prefs)) window.localStorage.removeItem(key);
    for (const [key, value] of Object.entries(backup.prefs)) window.localStorage.setItem(key, value);
  } catch { /* storage unavailable: the data is restored, the display settings stay as they were */ }
  report({ label: '完成', ratio: 1 });
}
