import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import {
  backupFileLimit, backupFilePrefixes, backupFileRule, backupFormat, backupTableNames, backupTables, backupVersion,
  chunkRows, validBackupTables, type BackupFile, type BackupRow, type BackupSnapshot, type BackupTables,
} from '@/lib/backup';
import { brokerHubStateTable, cashFlowsSetup, ensureDatabase } from '@/lib/server/database';
import { guarded } from '@/lib/server/data-gate';
import { sniffAsset } from '@/lib/wafu/asset-slots';

export const dynamic = 'force-dynamic';

/**
 * The full backup (設定 → 資料 → 完整備份). The browser assembles and reads the ZIP (lib/backup-client);
 * this route only hands out and takes in the pieces, so no request has to hold every file at once.
 *   GET                 every table and the list of stored files
 *   GET  ?file=<key>    one stored file
 *   PUT  ?file=<key>    put one file back (checked like an upload)
 *   POST                replace every table in one transaction, then remove stored files the backup does not have
 */
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });
const noBucket = () => env.BACKGROUND_IMAGES ? null : fail('這個網址沒有連到 R2 儲存空間（BACKGROUND_IMAGES 未綁定），無法備份素材。', 503);

async function readyDatabase() {
  const db = await ensureDatabase();
  await db.batch([...cashFlowsSetup, brokerHubStateTable].map((sql) => db.prepare(sql)));
  return db;
}

async function storedFiles() {
  const objects: R2Object[] = [];
  for (const prefix of backupFilePrefixes) {
    let cursor: string | undefined;
    do {
      // `include` is part of the R2 API (compatibility date 2022-08-04 on); these typings predate it.
      const page = await env.BACKGROUND_IMAGES.list({ prefix, cursor, include: ['httpMetadata', 'customMetadata'] } as R2ListOptions);
      objects.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return objects;
}

async function handleGET(request: Request) {
  const missing = noBucket();
  if (missing) return missing;
  try {
    const key = new URL(request.url).searchParams.get('file');
    if (key !== null) {
      if (!backupFileRule(key)) return fail('檔案名稱不正確', 400);
      const object = await env.BACKGROUND_IMAGES.get(key);
      if (!object) return fail('找不到這個檔案', 404);
      return new Response(object.body, {
        headers: { ...noStore, 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'Content-Length': String(object.size) },
      });
    }

    const db = await readyDatabase();
    const results = await db.batch(backupTableNames.map((name) => db.prepare(`SELECT ${backupTables[name].join(', ')} FROM ${name}`)));
    const tables = Object.fromEntries(backupTableNames.map((name, index) => [name, (results[index].results ?? []) as BackupRow[]])) as BackupTables;
    const files: BackupFile[] = (await storedFiles())
      .filter((object) => backupFileRule(object.key))
      .map((object) => ({
        key: object.key,
        size: object.size,
        type: object.httpMetadata?.contentType ?? 'application/octet-stream',
        name: object.customMetadata?.name ?? '',
        updatedAt: object.customMetadata?.updatedAt ?? object.uploaded.toISOString(),
      }));
    const snapshot: BackupSnapshot = { format: backupFormat, version: backupVersion, createdAt: new Date().toISOString(), tables, files };
    return NextResponse.json(snapshot, { headers: noStore });
  } catch (error) {
    return fail(error instanceof Error ? error.message : '備份資料無法讀取', 500);
  }
}

async function handlePUT(request: Request) {
  const missing = noBucket();
  if (missing) return missing;
  const key = new URL(request.url).searchParams.get('file');
  const rule = backupFileRule(key);
  if (!key || !rule) return fail('檔案名稱不正確', 400);
  const limit = backupFileLimit(rule);
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > limit) return fail(`檔案不可超過 ${limit / 1024 / 1024} MB`, 413);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) return fail('檔案內容是空的', 400);
    if (bytes.byteLength > limit) return fail(`檔案不可超過 ${limit / 1024 / 1024} MB`, 413);
    const type = sniffAsset(rule.kind === 'background' ? 'bg' : rule.kind, bytes);
    if (!type) return fail('檔案內容和它的種類不符', 415);

    let name = '';
    try { name = decodeURIComponent(request.headers.get('x-file-name') ?? ''); } catch { /* keep it blank */ }
    name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    const stamp = request.headers.get('x-updated-at') ?? '';
    const updatedAt = !Number.isNaN(Date.parse(stamp)) && stamp.length <= 40 ? stamp : new Date().toISOString();
    const customMetadata: Record<string, string> = rule.kind === 'background'
      ? { updatedAt, version: key.slice(key.lastIndexOf('/') + 1, -'.jpg'.length) }
      : { name, updatedAt };
    await env.BACKGROUND_IMAGES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata });
    return NextResponse.json({ saved: true, key }, { headers: noStore });
  } catch (error) {
    return fail(error instanceof Error ? error.message : '檔案無法保存', 500);
  }
}

async function handlePOST(request: Request) {
  const missing = noBucket();
  if (missing) return missing;
  let body: { format?: unknown; version?: unknown; tables?: unknown; keepFiles?: unknown };
  try { body = await request.json(); } catch { return fail('還原資料不是有效的 JSON', 400); }
  if (body.format !== backupFormat) return fail('這不是 OptionFlow 的備份檔', 400);
  if (typeof body.version !== 'number' || body.version > backupVersion) return fail('這份備份來自較新版本的 OptionFlow，請先更新再還原。', 400);
  let tables: BackupTables;
  try { tables = validBackupTables(body.tables); } catch (error) { return fail(error instanceof Error ? error.message : '備份資料格式不正確', 400); }
  const keepFiles = Array.isArray(body.keepFiles) ? body.keepFiles.filter((key): key is string => Boolean(backupFileRule(key))) : [];

  try {
    const db = await readyDatabase();
    // One batch is one transaction: if any row is refused, nothing changes.
    const statements = backupTableNames.flatMap((name) => {
      const columns = backupTables[name];
      const picks = columns.map((column) => `json_extract(value, '$.${column}')`).join(', ');
      return [
        db.prepare(`DELETE FROM ${name}`),
        ...chunkRows(tables[name]).map((rows) => db.prepare(`INSERT INTO ${name} (${columns.join(', ')}) SELECT ${picks} FROM json_each(?)`).bind(JSON.stringify(rows))),
      ];
    });
    // The sample trades are written only into a new database; a restored one is never new.
    statements.push(db.prepare(`INSERT INTO app_meta (key, value) VALUES ('seed_trades_v1', 'complete')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`));
    await db.batch(statements);
  } catch (error) {
    return fail(`資料無法還原，原本的資料沒有變動。（${error instanceof Error ? error.message : '未知錯誤'}）`, 500);
  }

  // Stored files the backup does not have (art uploaded after it was made) go; a leftover is only ignored.
  let removed = 0;
  try {
    const keep = new Set(keepFiles);
    const extra = (await storedFiles()).filter((object) => !keep.has(object.key));
    await Promise.all(extra.map((object) => env.BACKGROUND_IMAGES.delete(object.key)));
    removed = extra.length;
  } catch { /* best effort */ }

  const counts = Object.fromEntries(backupTableNames.map((name) => [name, tables[name].length]));
  return NextResponse.json({ restored: true, counts, removedFiles: removed }, { headers: noStore });
}

// Owner data: only behind Cloudflare Access once it is configured (lib/server/data-gate).
export const GET = guarded(handleGET);
export const PUT = guarded(handlePUT);
export const POST = guarded(handlePOST);
