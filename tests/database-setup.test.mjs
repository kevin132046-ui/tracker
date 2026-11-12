import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
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

/**
 * D1 over an in-memory SQLite database. Every call gives way to other pending work first, the way a
 * round trip to D1 does, so two setups started together really do interleave. A batch is one
 * transaction, as in D1.
 */
function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  const calls = [];
  const pause = () => new Promise((resolve) => setImmediate(resolve));
  const statement = (sql, args = []) => ({
    execute: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    bind: (...values) => statement(sql, values),
    async run() { await pause(); calls.push('run'); return this.execute(); },
    async first() { await pause(); calls.push('first'); return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { await pause(); calls.push('all'); return { results: sqlite.prepare(sql).all(...args) }; },
  });
  const db = {
    prepare: (sql) => statement(sql),
    async batch(list) {
      await pause();
      calls.push('batch');
      sqlite.exec('BEGIN');
      try {
        const results = list.map((item) => item.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return { db, calls, sqlite, count };
}

/** A separate copy of the module, with its own "set up already" state: one per isolate. */
const isolate = async (name) => (await import(`../lib/server/database.ts?isolate=${name}`)).ensureDatabase;

const sampleTrades = 15;

test('requests arriving together in one isolate share a single setup', async () => {
  const { db, calls, count } = sqliteD1();
  env.DB = db;
  const ensure = await isolate('shared');
  await Promise.all([ensure(), ensure(), ensure(), ensure()]);
  assert.equal(calls.filter((call) => call === 'batch').length, 2, 'the tables once, the sample trades once');
  assert.equal(count('trades'), sampleTrades);
  assert.equal(count('app_meta'), 1);
  delete env.DB;
});

test('two isolates seeding a new database at the same moment: no error, no duplicate sample trades', async () => {
  const { db, sqlite, count } = sqliteD1();
  env.DB = db;
  const [first, second] = await Promise.all([isolate('one'), isolate('two')]);
  // Both read "no marker, no trades" before either writes.
  await Promise.all([first(), second()]);
  assert.equal(count('trades'), sampleTrades);
  assert.equal(sqlite.prepare("SELECT value FROM app_meta WHERE key = 'seed_trades_v1'").get()?.value, 'complete');
  delete env.DB;
});

test('a database that already has trades gets the marker and no sample trades', async () => {
  const { db, sqlite, count } = sqliteD1();
  env.DB = db;
  const ensure = await isolate('existing');
  sqlite.exec(`CREATE TABLE trades (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, open_date TEXT NOT NULL, expiry_date TEXT,
    close_date TEXT, ticker TEXT, event TEXT NOT NULL, strike TEXT, quantity REAL NOT NULL DEFAULT 1, entry_price REAL NOT NULL DEFAULT 0,
    current_price REAL, fees REAL NOT NULL DEFAULT 0, collateral REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open', quote_mode TEXT NOT NULL DEFAULT 'manual', source_row INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  sqlite.exec("INSERT INTO trades (type, open_date, event, created_at, updated_at) VALUES ('SDI', '2026-01-05', 'STOCK', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z')");
  await ensure();
  assert.equal(count('trades'), 1);
  assert.equal(count('app_meta'), 1);
  delete env.DB;
});

test('a setup that failed is tried again by the next request', async () => {
  const { db, count } = sqliteD1();
  const batch = db.batch;
  let failures = 1;
  db.batch = async (list) => {
    if (failures > 0) { failures -= 1; throw new Error('D1 is unavailable'); }
    return batch(list);
  };
  env.DB = db;
  const ensure = await isolate('retry');
  await assert.rejects(Promise.all([ensure(), ensure()]), /unavailable/);
  await ensure();
  assert.equal(count('trades'), sampleTrades);
  delete env.DB;
});
