// Run with `pnpm test`. In-memory SQLite stands in for D1; tickers, themes and events are made up.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { cleanExposurePrefs, emptyExposurePrefs, hasExposurePrefs, largestExposureGroup, mergeExposurePrefs, planExposureSync } from '@/lib/exposure-prefs';
import { exposurePrefsKey, parseStoredExposurePrefs, readExposurePrefs, writeExposurePrefs } from '@/lib/server/exposure-prefs-store';

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => sqlite.prepare(sql).run(...args),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
  });
  return { sqlite, db: { prepare: (sql) => statement(sql) } };
}

const event = { id: 'e1', date: '2026-12-01', ticker: 'AAA', label: '產品發表' };

describe('持倉風險 settings record', () => {
  test('keeps only sound themes, events and cash-like tickers', () => {
    const clean = cleanExposurePrefs({
      themes: { aaa: ' AI ', 'bad ticker!': 'x', BBB: 42, CCC: '類現金' },
      events: [event, { date: 'not a date', ticker: 'AAA', label: 'x' }, { date: '2026-12-02', ticker: 'AAA', label: '' }],
      cashLike: ['sgov', 'SGOV', 'no!good', 7],
      shares: 100,
    });
    assert.deepEqual(clean, { themes: { AAA: 'AI' }, events: [event], cashLike: ['SGOV'] });
    assert.deepEqual(cleanExposurePrefs(null), emptyExposurePrefs);
    assert.deepEqual(cleanExposurePrefs({ cashLike: [] }).cashLike, [], 'an empty list is "none", not the built-in list');
    // A past event stays in the record; readers apply their own day.
    assert.equal(cleanExposurePrefs({ events: [{ ...event, date: '2020-01-02' }] }).events.length, 1);
  });

  test('a patch replaces only the parts it names', () => {
    const current = { themes: { AAA: 'AI' }, events: [event], cashLike: ['SGOV'] };
    assert.deepEqual(mergeExposurePrefs(current, { themes: { BBB: '能源' } }), { themes: { BBB: '能源' }, events: [event], cashLike: ['SGOV'] });
    assert.deepEqual(mergeExposurePrefs(current, { events: [] }), { themes: { AAA: 'AI' }, events: [], cashLike: ['SGOV'] });
    assert.deepEqual(mergeExposurePrefs(current, { cashLike: null }), { themes: { AAA: 'AI' }, events: [event], cashLike: null });
    assert.deepEqual(mergeExposurePrefs(current, 'nonsense'), current);
  });

  test('a browser takes the database copy, or fills an empty database from its own', () => {
    const local = { themes: { AAA: 'AI' }, events: [], cashLike: null };
    assert.equal(planExposureSync(null, local), 'seed');
    assert.equal(planExposureSync(null, emptyExposurePrefs), 'none');
    assert.equal(planExposureSync({ themes: { BBB: '能源' }, events: [], cashLike: null }, local), 'adopt');
    // Another device cleared everything: the empty record still wins over this browser's.
    assert.equal(planExposureSync(emptyExposurePrefs, local), 'adopt');
    assert.equal(hasExposurePrefs(emptyExposurePrefs), false);
    assert.equal(hasExposurePrefs({ ...emptyExposurePrefs, cashLike: [] }), true);
  });
});

describe('持倉風險 settings in app_meta', () => {
  test('nothing saved reads as null; writes merge and stamp the time', async () => {
    const { db } = fakeD1();
    assert.equal(await readExposurePrefs(db), null);
    await writeExposurePrefs(db, { themes: { AAA: 'AI' } }, new Date('2026-11-13T01:00:00Z'));
    const second = await writeExposurePrefs(db, { events: [event] }, new Date('2026-11-13T02:00:00Z'));
    assert.deepEqual(second, { themes: { AAA: 'AI' }, events: [event], cashLike: null, updatedAt: '2026-11-13T02:00:00.000Z' });
    assert.deepEqual(await readExposurePrefs(db), second);
  });

  test('a restored backup row reads the same; a broken one reads as nothing saved', async () => {
    const { db, sqlite } = fakeD1();
    const stored = await writeExposurePrefs(db, { themes: { AAA: 'AI' }, cashLike: ['SGOV', 'BIL'] });
    const row = sqlite.prepare('SELECT key, value FROM app_meta').get();
    const restored = fakeD1();
    restored.sqlite.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(row.key, row.value);
    assert.equal(row.key, exposurePrefsKey);
    assert.deepEqual(await readExposurePrefs(restored.db), stored);
    assert.equal(parseStoredExposurePrefs('{broken'), null);
    assert.equal(parseStoredExposurePrefs(''), null);
  });
});

describe('largest group, as the panel groups', () => {
  const holdings = [
    { ticker: 'AAA', symbol: 'AAA', value: 400, cash: false },
    { ticker: 'BBB', symbol: 'BBB', value: 300, cash: false },
    { ticker: 'CCC', symbol: 'CCC', value: 300, cash: false },
    { ticker: 'SGOV', symbol: 'SGOV', value: 600, cash: false },
    { ticker: 'USD', symbol: '', value: 400, cash: true },
  ];
  const sectors = { AAA: '科技', BBB: '金融', CCC: '金融', SGOV: 'ETF' };

  test('by sector when nothing has a theme; cash and cash-like count in the total but are never the largest', () => {
    assert.deepEqual(largestExposureGroup(holdings, null, sectors), { group: '金融', share: 0.3, mode: 'sector' });
  });

  test('by theme once any holding has one; untagged holdings keep their sector', () => {
    assert.deepEqual(largestExposureGroup(holdings, { themes: { AAA: 'AI', BBB: 'AI' }, cashLike: null }, sectors), { group: 'AI', share: 0.35, mode: 'theme' });
    // A theme on a ticker that is not held does not switch the mode.
    assert.equal(largestExposureGroup(holdings, { themes: { ZZZ: 'AI' }, cashLike: null }, sectors).mode, 'sector');
  });

  test('the owner\'s cash-like list replaces the built-in one', () => {
    // SGOV is no longer cash-like, so it is a group of its own (ETF) and the largest.
    assert.deepEqual(largestExposureGroup(holdings, { themes: {}, cashLike: [] }, sectors), { group: 'ETF', share: 0.3, mode: 'sector' });
    assert.deepEqual(largestExposureGroup(holdings, { themes: {}, cashLike: ['BBB', 'CCC', 'SGOV'] }, sectors), { group: '科技', share: 0.2, mode: 'sector' });
  });

  test('lots of one ticker add up; no sector is 未分類; nothing but cash is null', () => {
    assert.deepEqual(largestExposureGroup([{ ticker: 'aaa', symbol: 'AAA', value: 100, cash: false }, { ticker: 'AAA', symbol: 'AAA', value: 100, cash: false }, { ticker: 'BBB', symbol: 'BBB', value: 150, cash: false }], null, {}), { group: '未分類', share: 1, mode: 'sector' });
    assert.equal(largestExposureGroup([{ ticker: 'USD', symbol: '', value: 400, cash: true }], null, {}), null);
  });
});
