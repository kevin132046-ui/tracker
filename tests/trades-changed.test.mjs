// Run with `pnpm test`. In-memory SQLite stands in for D1; no real data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { changeFrom, readTradesChanged, tradesChangedStatement } from '@/lib/server/trades-changed';
import { latestRecordDate, newChangeTag, parseTradesChanged } from '@/lib/trades-changed';

/** Just enough of D1's API over node:sqlite for these helpers. */
function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE trades (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)');
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => sqlite.prepare(sql).run(...args),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
  });
  return { sqlite, db: { prepare: (sql) => statement(sql) } };
}

describe('最後更改', () => {
  test('records each write and keeps the latest', async () => {
    const { db } = fakeD1();
    await tradesChangedStatement(db, 'add', 1).run();
    await tradesChangedStatement(db, 'delete', 1).run();
    const changed = await readTradesChanged(db);
    assert.equal(changed.action, 'delete');
    assert.equal(changed.count, 1);
    assert.ok(!Number.isNaN(Date.parse(changed.at)));
  });

  test('requests of one operation add up; a new operation starts again', async () => {
    const { db } = fakeD1();
    const first = newChangeTag('import');
    for (const size of [35, 35, 12]) await tradesChangedStatement(db, 'import', size, first.op).run();
    assert.equal((await readTradesChanged(db)).count, 82);
    const second = newChangeTag('import');
    await tradesChangedStatement(db, 'import', 5, second.op).run();
    assert.equal((await readTradesChanged(db)).count, 5);
    // Writes without an operation id never merge.
    await tradesChangedStatement(db, 'edit', 1).run();
    await tradesChangedStatement(db, 'edit', 1).run();
    assert.equal((await readTradesChanged(db)).count, 1);
  });

  test('before anything was recorded, the newest trade stands in', async () => {
    const { db, sqlite } = fakeD1();
    assert.equal(await readTradesChanged(db), null);
    sqlite.exec("INSERT INTO trades (created_at) VALUES ('2026-03-02T01:00:00.000Z'), ('2026-03-05T09:30:00.000Z')");
    assert.deepEqual(await readTradesChanged(db), { at: '2026-03-05T09:30:00.000Z', action: null, count: null });
  });

  test('a client tag can only name import or tidy-up, with a well-formed id', () => {
    assert.deepEqual(changeFrom({ reason: 'import', op: 'abc12345-def' }, 'batch'), { action: 'import', op: 'abc12345-def' });
    assert.deepEqual(changeFrom({ reason: 'restore', op: "x'; DROP" }, 'batch'), { action: 'batch', op: null });
    assert.deepEqual(changeFrom(undefined, 'add'), { action: 'add', op: null });
  });

  test('parses only sound records', () => {
    assert.deepEqual(parseTradesChanged('{"at":"2026-03-05T09:30:00.000Z","action":"import","count":12,"op":"x"}'), { at: '2026-03-05T09:30:00.000Z', action: 'import', count: 12 });
    assert.equal(parseTradesChanged('{"action":"import"}'), null);
    assert.equal(parseTradesChanged('not json'), null);
    assert.equal(parseTradesChanged({ at: '2026-03-05', action: 'other', count: -1 }).action, null);
  });
});

describe('記錄截止', () => {
  test('the latest open or close date, ignoring derived rows', () => {
    const trades = [
      { openDate: '2026-02-03', closeDate: '2026-03-10' },
      { openDate: '2026-03-04', closeDate: null },
      { openDate: '2026-04-01', closeDate: null, derived: true },
    ];
    assert.equal(latestRecordDate(trades), '2026-03-10');
    assert.equal(latestRecordDate([]), null);
  });
});
