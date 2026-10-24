import { assetVersionPattern, isWafuAssetSlot, maxAssetBytes, assetKind, type WafuAssetKind } from '@/lib/wafu/asset-slots';

/**
 * The full backup (設定 → 資料 → 完整備份): every table, the uploaded background and 和風 art and music,
 * and this browser's display settings, in one ZIP. Shared by /api/backup and the browser side
 * (lib/backup-client), so both agree on what a backup may hold.
 */
export const backupFormat = 'optionflow-backup';
export const backupVersion = 1;

/** The tables a backup holds, and the columns restored from it (anything else in a row is ignored). */
export const backupTables = {
  trades: ['id', 'type', 'open_date', 'expiry_date', 'close_date', 'ticker', 'event', 'strike', 'quantity', 'entry_price', 'current_price', 'fees', 'collateral', 'notes', 'status', 'quote_mode', 'source_row', 'created_at', 'updated_at'],
  cash_flows: ['id', 'date', 'kind', 'amount', 'currency', 'note', 'created_at', 'updated_at'],
  dcf_scenarios: ['id', 'name', 'ticker', 'currency', 'data', 'created_at', 'updated_at'],
  broker_hub_state: ['id', 'enabled', 'revision', 'data', 'updated_at'],
  app_meta: ['key', 'value'],
} as const;
export type BackupTable = keyof typeof backupTables;
export const backupTableNames = Object.keys(backupTables) as BackupTable[];
export type BackupRow = Record<string, string | number | null>;
export type BackupTables = Record<BackupTable, BackupRow[]>;

/** Largest number of rows restored in one go (all tables together). */
export const maxBackupRows = 200_000;

/** The site background: portfolio/backgrounds/<version>.jpg (see /api/background). */
export const backgroundPrefix = 'portfolio/backgrounds/';
export const backgroundVersionPattern = /^\d{10,16}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const maxBackgroundBytes = 4 * 1024 * 1024;
/** 和風 art and music: wafu/<slot>/<version> (see /api/wafu-assets). */
export const wafuPrefix = 'wafu/';
/** The storage prefixes a backup covers; a restore leaves nothing else in them. */
export const backupFilePrefixes = [backgroundPrefix, wafuPrefix] as const;

export type BackupFileRule = { kind: 'background' } | { kind: WafuAssetKind };

/** What a stored file is, from its key; null for any key a backup may not hold. */
export function backupFileRule(key: unknown): BackupFileRule | null {
  if (typeof key !== 'string' || key.length > 200) return null;
  if (key.startsWith(backgroundPrefix)) {
    const match = /^portfolio\/backgrounds\/([^/]+)\.jpg$/.exec(key);
    return match && backgroundVersionPattern.test(match[1]) ? { kind: 'background' } : null;
  }
  const match = /^wafu\/([a-z0-9-]+)\/([^/]+)$/.exec(key);
  if (!match || !isWafuAssetSlot(match[1]) || !assetVersionPattern.test(match[2])) return null;
  return { kind: assetKind(match[1]) };
}

export const backupFileLimit = (rule: BackupFileRule) => rule.kind === 'background' ? maxBackgroundBytes : maxAssetBytes[rule.kind];

/** A stored file in the backup listing. */
export type BackupFile = { key: string; size: number; type: string; name: string; updatedAt: string };

/** What GET /api/backup returns. */
export type BackupSnapshot = {
  format: typeof backupFormat;
  version: typeof backupVersion;
  createdAt: string;
  tables: BackupTables;
  files: BackupFile[];
};

/** manifest.json at the top of the ZIP. */
export type BackupManifest = {
  format: typeof backupFormat;
  version: number;
  createdAt: string;
  app: 'OptionFlow';
  counts: Record<BackupTable, number>;
  files: Array<BackupFile & { path: string }>;
  prefs: number;
};

/**
 * This browser's settings that travel with a backup: every optionflow-* entry except API keys, the
 * assistant's chat, caches and what the device works out for itself (performance probe, photo pick).
 */
const prefsLeftOut = new Set([
  'optionflow-ai-keys',
  'optionflow-assistant-chat',
  'optionflow-assistant-session',
  'optionflow-ai-models',
  'optionflow-op-photo',
  'optionflow-custom-background',
  'optionflow-pending-background',
  'optionflow-pending-background-mode',
  'optionflow-perf-probed',
  'optionflow-wafu-intro-lite-auto',
]);
export const isBackupPref = (key: string) => /^optionflow-[a-z0-9-]+$/.test(key) && !prefsLeftOut.has(key);

/** Splits rows into groups whose JSON stays under maxBytes (one bound parameter each when restoring). */
export function chunkRows(rows: BackupRow[], maxBytes = 900_000): BackupRow[][] {
  const chunks: BackupRow[][] = [];
  let current: BackupRow[] = [];
  let size = 2;
  for (const row of rows) {
    const rowSize = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (rowSize + 2 > maxBytes) throw new Error('備份裡有一筆資料太大，無法還原。');
    if (current.length && size + rowSize > maxBytes) {
      chunks.push(current);
      current = [];
      size = 2;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Checks the tables of a backup: every table present, each row an object of plain values. */
export function validBackupTables(value: unknown): BackupTables {
  if (!value || typeof value !== 'object') throw new Error('備份檔缺少資料表。');
  const source = value as Record<string, unknown>;
  const tables = {} as BackupTables;
  let total = 0;
  for (const name of backupTableNames) {
    const rows = source[name];
    if (!Array.isArray(rows)) throw new Error(`備份檔缺少資料表「${name}」。`);
    total += rows.length;
    if (total > maxBackupRows) throw new Error('備份裡的資料超過可還原的上限。');
    tables[name] = rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`資料表「${name}」裡有格式不正確的資料。`);
      const clean: BackupRow = {};
      for (const column of backupTables[name]) {
        const cell = (row as Record<string, unknown>)[column];
        if (cell === undefined || cell === null) clean[column] = null;
        else if (typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))) clean[column] = cell;
        else if (typeof cell === 'boolean') clean[column] = cell ? 1 : 0;
        else throw new Error(`資料表「${name}」的「${column}」欄位格式不正確。`);
      }
      return clean;
    });
  }
  return tables;
}
