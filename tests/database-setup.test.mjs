import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/lib/server/database';

/** A D1 stand-in that counts round trips (batch, run, first, all) and answers the setup's reads. */
function countingDatabase() {
  const calls = [];
  const statement = (sql) => ({
    sql,
    bind() { return this; },
    async run() { calls.push(`run ${sql.slice(0, 20)}`); return { meta: {} }; },
    async first() { calls.push(`first ${sql.slice(0, 20)}`); return sql.includes('app_meta') ? { value: 'complete' } : null; },
    async all() { calls.push(`all ${sql.slice(0, 20)}`); return { results: [] }; },
  });
  return { calls, prepare: statement, async batch(list) { calls.push(`batch ${list.length}`); return list.map(() => ({ meta: {} })); } };
}

test('the tables are set up once per isolate, not on every request', async () => {
  const db = countingDatabase();
  env.DB = db;
  await ensureDatabase();
  const firstRequest = db.calls.length;
  assert.ok(firstRequest >= 2, `setup ran (${db.calls.join(', ')})`);
  await ensureDatabase();
  await ensureDatabase();
  assert.equal(db.calls.length, firstRequest, 'later requests make no setup round trips');
  delete env.DB;
});
