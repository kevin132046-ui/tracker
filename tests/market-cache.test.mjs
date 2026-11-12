// Run with `pnpm test`. In-memory SQLite stands in for D1; tickers and dates are made up.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { marketCacheTable } from '@/lib/server/database';
import { dividendHistory, historyKey, nasdaqKey, nasdaqPayDates, tickerOfKey } from '@/lib/server/dividend-pay-sources';
import { MarketCache, skipLookup } from '@/lib/server/market-cache';

/** Just enough of D1 over node:sqlite: prepare, bind, all, run, and a batch that is one transaction. */
function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(marketCacheTable);
  const statement = (sql, args = []) => ({
    execute: () => sqlite.prepare(sql).run(...args),
    bind: (...values) => statement(sql, values),
    run: async () => sqlite.prepare(sql).run(...args),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
  });
  const db = {
    writes: 0,
    prepare: (sql) => statement(sql),
    async batch(list) {
      db.writes += 1;
      sqlite.exec('BEGIN');
      try { list.forEach((item) => item.execute()); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      return [];
    },
  };
  const keys = () => sqlite.prepare('SELECT key FROM market_cache ORDER BY key').all().map((row) => row.key);
  return { db, sqlite, keys };
}

/** A copy of the cache module with empty memory: what a new isolate starts with. */
const newIsolate = async (name) => (await import(`../lib/server/market-cache.ts?isolate=${name}`)).MarketCache;

const hour = 60 * 60_000;
const options = { freshMs: 6 * hour, retryMs: 15 * 60_000 };
const counter = (value) => {
  const fetcher = async () => { fetcher.calls += 1; return typeof value === 'function' ? value() : value; };
  fetcher.calls = 0;
  return fetcher;
};

describe('market cache', () => {
  test('a value fetched by one isolate is read from D1 by the next, without asking the source', async () => {
    const { db } = fakeD1();
    const first = await MarketCache.open(db, 'dividend:');
    const fetcher = counter({ rows: 3 });
    assert.deepEqual(await first.load('dividend:a:ONE', fetcher, options), { rows: 3 });
    assert.deepEqual(await first.load('dividend:a:ONE', fetcher, options), { rows: 3 });
    assert.equal(fetcher.calls, 1, 'the second read is from memory');
    await first.save();

    const Other = await newIsolate('reads-d1');
    const second = await Other.open(db, 'dividend:');
    assert.deepEqual(await second.load('dividend:a:ONE', fetcher, options), { rows: 3 });
    assert.equal(fetcher.calls, 1);
    assert.deepEqual(second.stats, { hit: 1, fetched: 0, failed: 0 });
    await second.save();
    assert.equal(db.writes, 1, 'nothing fetched, nothing written');
  });

  test('requests arriving together share one fetch', async () => {
    const { db } = fakeD1();
    const Cache = await newIsolate('together');
    const [a, b] = await Promise.all([Cache.open(db, 'dividend:'), Cache.open(db, 'dividend:')]);
    const fetcher = counter(() => new Promise((resolve) => setTimeout(() => resolve('value'), 10)));
    assert.deepEqual(await Promise.all([a.load('dividend:a:TWO', fetcher, options), b.load('dividend:a:TWO', fetcher, options)]), ['value', 'value']);
    assert.equal(fetcher.calls, 1);
  });

  test('a stale value is fetched again; when the source fails the last value stands until the retry time', async () => {
    const { db } = fakeD1();
    let now = Date.parse('2026-03-02T12:00:00Z');
    const clock = () => now;
    const Cache = await newIsolate('stale');
    const first = await Cache.open(db, 'dividend:', clock);
    await first.load('dividend:a:SIX', counter('old'), options);
    await first.save();

    now += 7 * hour;
    const failing = counter(() => { throw new Error('source is down'); });
    const second = await (await newIsolate('stale-2')).open(db, 'dividend:', clock);
    assert.equal(await second.load('dividend:a:SIX', failing, options), 'old');
    assert.equal(failing.calls, 1);
    await second.save();

    // Another isolate five minutes later does not wait on the failing source again.
    now += 5 * 60_000;
    const third = await (await newIsolate('stale-3')).open(db, 'dividend:', clock);
    assert.equal(await third.load('dividend:a:SIX', failing, options), 'old');
    assert.equal(failing.calls, 1);

    now += 15 * 60_000;
    const fourth = await (await newIsolate('stale-4')).open(db, 'dividend:', clock);
    assert.equal(await fourth.load('dividend:a:SIX', counter('new'), options), 'new');
  });

  test('nothing stored and the source fails: the fallback stands for the retry time, or the error is thrown', async () => {
    const { db, keys } = fakeD1();
    const Cache = await newIsolate('fallback');
    const cache = await Cache.open(db, 'dividend:');
    const failing = counter(() => { throw new Error('source is down'); });
    assert.deepEqual(await cache.load('dividend:a:FOUR', failing, { ...options, fallback: [] }), []);
    assert.deepEqual(await cache.load('dividend:a:FOUR', failing, { ...options, fallback: [] }), []);
    assert.equal(failing.calls, 1);
    await assert.rejects(cache.load('dividend:b:FOUR', failing, options), /source is down/);
    await cache.save();
    assert.deepEqual(keys(), ['dividend:a:FOUR']);
  });

  test('a value that already holds what is looked for is kept past its freshness, up to the limit', async () => {
    const { db } = fakeD1();
    let now = Date.parse('2026-03-02T12:00:00Z');
    const Cache = await newIsolate('keep');
    const cache = await Cache.open(db, 'dividend:', () => now);
    const fetcher = counter(['2026-02-20']);
    const covering = { ...options, keep: (value) => value.includes('2026-02-20'), keepMs: 14 * 24 * hour };
    await cache.load('dividend:a:FIVE', fetcher, covering);
    now += 3 * 24 * hour;
    await cache.load('dividend:a:FIVE', fetcher, covering);
    assert.equal(fetcher.calls, 1, 'still covers the date: not asked again');
    await cache.load('dividend:a:FIVE', fetcher, { ...covering, keep: (value) => value.includes('2026-05-20') });
    assert.equal(fetcher.calls, 2, 'a newer date it does not hold: asked again');
    now += 15 * 24 * hour;
    await cache.load('dividend:a:FIVE', fetcher, covering);
    assert.equal(fetcher.calls, 3, 'past the limit: asked again');
  });

  test('a stored value that cannot answer the request is fetched again; a skipped lookup stores nothing', async () => {
    const { db, keys } = fakeD1();
    const Cache = await newIsolate('usable');
    const cache = await Cache.open(db, 'dividend:');
    await cache.load('dividend:a:SEVEN', counter({ from: '2026-01-01' }), options);
    const wider = counter({ from: '2025-01-01' });
    assert.deepEqual(await cache.load('dividend:a:SEVEN', wider, { ...options, usable: (value) => value.from <= '2025-01-01' }), { from: '2025-01-01' });
    assert.equal(wider.calls, 1);
    assert.deepEqual(await cache.load('dividend:a:EIGHT', async () => skipLookup, { ...options, fallback: [] }), []);
    await cache.save();
    assert.deepEqual(keys(), ['dividend:a:SEVEN']);
  });

  test('saving drops rows for tickers no longer wanted, and leaves other data alone', async () => {
    const { db, sqlite, keys } = fakeD1();
    sqlite.exec("INSERT INTO market_cache VALUES ('other:thing', '1', 0, 0), ('dividend:history:GONE', '{}', 0, 0), ('dividend:nasdaq:GONE', '[]', 0, 0), ('dividend:history:HELD', '{}', 0, 0)");
    const cache = await (await newIsolate('prune')).open(db, 'dividend:');
    await cache.load('dividend:history:NEW', counter({}), options);
    await cache.save((key) => ['HELD', 'NEW'].includes(tickerOfKey(key)));
    assert.deepEqual(keys(), ['dividend:history:HELD', 'dividend:history:NEW', 'other:thing']);
  });
});

describe('dividend sources through the cache', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

  test('the dividend history is stored from 1 January of the opening year, not from the opening day', async () => {
    const { db, sqlite } = fakeD1();
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return json({ chart: { result: [{ events: { dividends: { a: { amount: 0.5, date: Date.parse('2026-02-11T14:30:00Z') / 1000 } } } }] } });
    };
    const cache = await MarketCache.open(db, 'dividend:');
    assert.deepEqual(await dividendHistory('ZZTA', '2026-03-17', '2026-06-01', cache), [{ date: '2026-02-11', amount: 0.5 }]);
    // A later lot of the same ticker is inside the stored range: no second request.
    assert.equal((await dividendHistory('ZZTA', '2026-05-04', '2026-06-01', cache)).length, 1);
    assert.equal(urls.length, 1);
    assert.match(urls[0], new RegExp(`period1=${Date.parse('2026-01-01T00:00:00Z') / 1000}&`));
    await cache.save();
    const stored = sqlite.prepare('SELECT value FROM market_cache WHERE key = ?').get(historyKey('ZZTA')).value;
    assert.equal(JSON.parse(stored).from, '2026-01-01');
    assert.ok(!stored.includes('2026-03-17'));
    // An earlier year is outside it: asked again.
    await dividendHistory('ZZTA', '2025-11-03', '2026-06-01', cache);
    assert.equal(urls.length, 2);
  });

  test('Nasdaq pay dates are kept while they cover the latest dividend, and asked again when a newer one appears', async () => {
    const { db } = fakeD1();
    let now = Date.parse('2026-03-02T12:00:00Z');
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return json({ data: { dividends: { rows: [{ exOrEffDate: '02/11/2026', paymentDate: '03/05/2026', type: 'Cash' }] } } });
    };
    const budget = { remaining: 5 };
    const cache = await (await newIsolate('nasdaq')).open(db, 'dividend:', () => now);
    assert.deepEqual(await nasdaqPayDates('ZZTB', '2026-02-11', budget, cache), [{ exDate: '2026-02-11', payDate: '2026-03-05' }]);
    await cache.save();

    now += 2 * 24 * hour;
    const later = await (await newIsolate('nasdaq-2')).open(db, 'dividend:', () => now);
    await nasdaqPayDates('ZZTB', '2026-02-11', budget, later);
    assert.equal(requests, 1, 'two days on, the stored dates still cover the latest dividend');
    await nasdaqPayDates('ZZTB', '2026-05-13', budget, later);
    assert.equal(requests, 2, 'a newer dividend is not covered');
    assert.equal(budget.remaining, 3);

    // Out of budget: the stored dates are returned and nothing is asked.
    const spent = await (await newIsolate('nasdaq-3')).open(db, 'dividend:', () => now + 30 * 24 * hour);
    assert.equal((await nasdaqPayDates('ZZTB', '2026-08-12', { remaining: 0 }, spent)).length, 1);
    assert.equal(requests, 2);
    assert.equal(tickerOfKey(nasdaqKey('ZZTB')), 'ZZTB');
  });
});
