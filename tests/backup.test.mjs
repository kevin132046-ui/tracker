import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip, crc32 } from '@/lib/zip';
import { backupFileRule, chunkRows, isBackupPref, validBackupTables, backupTableNames } from '@/lib/backup';

const bytes = (text) => new TextEncoder().encode(text);
const text = (data) => new TextDecoder().decode(data);

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
});

test('a backup ZIP reads back exactly, compressed or stored, with UTF-8 names', async () => {
  const json = JSON.stringify({ trades: Array.from({ length: 200 }, (_, id) => ({ id, ticker: 'KHC', notes: '桔梗' })) });
  const picture = new Uint8Array(4096).map((_, i) => (i * 37) % 256);
  const zip = await createZip([
    { name: 'database.json', data: bytes(json), compress: true },
    { name: 'files/wafu/bg-kikyo/1729000000000-abcd1234', data: picture },
    { name: '說明.txt', data: bytes('和風') , compress: true },
  ]);
  assert.ok(zip.size < json.length + picture.length, 'JSON is deflated');
  const entries = await readZip(zip);
  assert.deepEqual([...entries.keys()], ['database.json', 'files/wafu/bg-kikyo/1729000000000-abcd1234', '說明.txt']);
  assert.equal(text(await entries.get('database.json').read()), json);
  assert.deepEqual(await entries.get('files/wafu/bg-kikyo/1729000000000-abcd1234').read(), picture);
  assert.equal(text(await entries.get('說明.txt').read()), '和風');
});

test('a damaged backup is reported instead of restored', async () => {
  const zip = new Uint8Array(await (await createZip([{ name: 'prefs.json', data: bytes('{"optionflow-wafu-tone":"nasa"}') }])).arrayBuffer());
  zip[40] ^= 0xff; // a byte inside the stored file
  const entries = await readZip(new Blob([zip]));
  await assert.rejects(entries.get('prefs.json').read(), /損毀/);
  await assert.rejects(readZip(new Blob([bytes('not a zip at all')])), /不是 OptionFlow 的備份檔/);
});

test('a file that inflates past its stated size is refused before it fills memory', async () => {
  const zip = new Uint8Array(await (await createZip([{ name: 'database.json', data: new Uint8Array(4_000_000), compress: true }])).arrayBuffer());
  // Claim 1 KB uncompressed in the central directory (offset 24 in its record).
  const view = new DataView(zip.buffer);
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 1024, true); break; }
  }
  const entries = await readZip(new Blob([zip]));
  await assert.rejects(entries.get('database.json').read(), /損毀/);
});

test('only the background and 和風 art keys can be backed up or written back', () => {
  assert.deepEqual(backupFileRule('portfolio/backgrounds/1729000000000-0f8c4a1e-2b3c-4d5e-8f90-123456789abc.jpg'), { kind: 'background' });
  assert.deepEqual(backupFileRule('wafu/bgm-shigure-3/1729000000000-abcd1234'), { kind: 'bgm' });
  assert.deepEqual(backupFileRule('wafu/sil-kikyo/1729000000000-abcd1234'), { kind: 'sil' });
  for (const key of ['wafu/../secrets/1729000000000-abcd1234', 'wafu/bg-kikyo/../../x', 'wafu/bg-unknown/1729000000000-abcd1234', 'portfolio/backgrounds/x.jpg', 'other/file', '', null, 'wafu/bg-kikyo/1729000000000-abcd1234/extra']) {
    assert.equal(backupFileRule(key), null, String(key));
  }
});

test('restored rows keep only known columns and plain values', () => {
  const tables = Object.fromEntries(backupTableNames.map((name) => [name, []]));
  tables.trades = [{ id: 1, ticker: 'KHC', status: 'open', extra: 'dropped', fees: 0 }];
  tables.broker_hub_state = [{ id: 1, enabled: true, revision: 2, data: '{}', updated_at: '2026-10-24T00:00:00Z' }];
  const clean = validBackupTables(tables);
  assert.equal(clean.trades[0].extra, undefined);
  assert.equal(clean.trades[0].ticker, 'KHC');
  assert.equal(clean.trades[0].expiry_date, null);
  assert.equal(clean.broker_hub_state[0].enabled, 1);
  assert.throws(() => validBackupTables({ ...tables, cash_flows: undefined }), /cash_flows/);
  assert.throws(() => validBackupTables({ ...tables, trades: [{ notes: { nested: true } }] }), /notes/);
  assert.throws(() => validBackupTables({ ...tables, trades: ['row'] }), /格式不正確/);
});

test('rows are split so each restore statement stays under the size limit', () => {
  const rows = Array.from({ length: 50 }, (_, id) => ({ id, notes: 'x'.repeat(1000) }));
  const chunks = chunkRows(rows, 10_000);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), rows);
  for (const chunk of chunks) assert.ok(new TextEncoder().encode(JSON.stringify(chunk)).length <= 10_000);
});

test('API keys and the assistant chat never travel in a backup', () => {
  assert.equal(isBackupPref('optionflow-wafu-tone'), true);
  assert.equal(isBackupPref('optionflow-trade-columns-v1'), true);
  assert.equal(isBackupPref('optionflow-ai-keys'), false);
  assert.equal(isBackupPref('optionflow-assistant-chat'), false);
  assert.equal(isBackupPref('some-other-site'), false);
});
