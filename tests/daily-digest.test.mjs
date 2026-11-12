// Run with `pnpm test`. Made-up trades, prices and costs; no real account data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanDigestSettings, cleanNews, customDigestEvents, digestDayFor, expiringSoon, freeTierCheck, lineItemModel, sortDigestEvents, topMovers, trackedValue, upcomingEvents } from '@/lib/daily-digest';

const trade = (fields) => ({ id: 1, type: 'SDI', ticker: 'AAA', event: 'STOCK', strike: null, expiryDate: null, quantity: 10, currentPrice: 90, collateral: 0, ...fields });
const quotes = { AAA: { price: 100, changePercent: 0.02 }, BBB: { price: 48, changePercent: -0.051 }, CCC: { price: 10, changePercent: 0.001 }, '7203.T': { price: 3000, changePercent: 0.01 } };

describe('the day a digest covers', () => {
  test('today after 16:30 ET on a trading day, else the session before', () => {
    assert.equal(digestDayFor(Date.parse('2026-11-12T21:30:00Z')), '2026-11-12'); // 16:30 EST, Thursday
    assert.equal(digestDayFor(Date.parse('2026-11-12T21:00:00Z')), '2026-11-11'); // 16:00 EST
    assert.equal(digestDayFor(Date.parse('2026-11-14T21:30:00Z')), '2026-11-13'); // Saturday → Friday
    assert.equal(digestDayFor(Date.parse('2026-11-26T21:30:00Z')), '2026-11-25'); // Thanksgiving
  });
});

describe('positions', () => {
  const trades = [
    trade({}),
    trade({ id: 2, type: 'Sell', ticker: 'BBB', event: 'PUT', strike: '50', expiryDate: '2026-11-20', quantity: 1, currentPrice: 2.1, collateral: 5000 }),
    trade({ id: 3, type: 'Buy', ticker: 'CCC', event: 'CALL', strike: '10', expiryDate: '2026-12-18', quantity: 2, currentPrice: 0.5 }),
    trade({ id: 4, type: 'CASH', ticker: 'USD', event: 'CASH', quantity: 1000, currentPrice: null }),
    trade({ id: 5, ticker: '7203', quantity: 100, currentPrice: 2900 }),
  ];

  test('market value: fresh share prices, stored option prices, collateral, cash and yen', () => {
    // 100×10 + max(5000, 210) + 0.5×2×100 + 1000 + 3000×100/150
    assert.equal(trackedValue(trades, quotes, 150), 1000 + 5000 + 100 + 1000 + 2000);
  });

  test('the largest moves among the symbols held', () => {
    assert.deepEqual(topMovers(trades, quotes, 2), [{ ticker: 'BBB', changePercent: -0.051 }, { ticker: 'AAA', changePercent: 0.02 }]);
  });

  test('options within 7 days, with the underlying against the strike', () => {
    assert.deepEqual(expiringSoon(trades, '2026-11-13', quotes), [{ ticker: 'BBB', right: 'PUT', strike: '50', expiry: '2026-11-20', days: 7, moneyness: 'ITM' }]);
    assert.deepEqual(expiringSoon(trades, '2026-11-21', quotes), []);
  });
});

test('earnings within 30 days, in date order', () => {
  const earnings = { AAA: { date: '2026-12-01', endDate: null, estimate: false, timing: 'post' }, BBB: { date: '2026-11-20', endDate: null, estimate: true, timing: null }, CCC: { date: '2027-02-01', endDate: null, estimate: false, timing: null } };
  assert.deepEqual(upcomingEvents(earnings, '2026-11-13').map((event) => event.ticker), ['BBB', 'AAA']);
});

test('custom events for tickers held join the earnings dates, soonest first', () => {
  const earnings = { AAA: { date: '2026-12-01', endDate: null, estimate: false, timing: 'post' } };
  const custom = [
    { id: '1', date: '2026-11-25', ticker: 'AAA', label: '產品發表' },
    { id: '2', date: '2026-11-13', ticker: 'AAA', label: '今天的不算' },
    { id: '3', date: '2026-12-20', ticker: 'AAA', label: '超過 30 天' },
    { id: '4', date: '2026-11-20', ticker: 'ZZZ', label: '沒有持有' },
  ];
  const events = sortDigestEvents([...upcomingEvents(earnings, '2026-11-13'), ...customDigestEvents(custom, new Set(['AAA']), '2026-11-13')]);
  assert.deepEqual(events, [
    { ticker: 'AAA', date: '2026-11-25', timing: null, estimate: false, kind: 'custom', label: '產品發表' },
    { ticker: 'AAA', date: '2026-12-01', timing: 'post', estimate: false },
  ]);
});

describe('free tier check', () => {
  const groups = [{ id: 'a', label: '25 萬組', highLimit: 1_000_000, lowLimit: 237_500, models: ['gpt-5.4'] }, { id: 'b', label: '250 萬組', highLimit: 10_000_000, lowLimit: 2_375_000, models: ['gpt-5.4-mini'] }];

  test('reads models out of line items', () => {
    assert.equal(lineItemModel('gpt-5.4-mini-2026-03-17, input'), 'gpt-5.4-mini-2026-03-17');
    assert.equal(lineItemModel('Web Search tool calls'), 'search');
  });

  test('a charge on a free model inside its allowance is flagged; search and overage are not', () => {
    const ok = freeTierCheck([{ lineItem: 'web search tool calls', cost: 0.03 }, { lineItem: 'gpt-5.4-mini, input', cost: 0 }], { 'gpt-5.4-mini': 20_000 }, groups, 'low', '2026-11-12');
    assert.deepEqual(ok, { day: '2026-11-12', ok: true, billed: [], searchCost: 0.03, note: null });
    const billed = freeTierCheck([{ lineItem: 'gpt-5.4-mini-2026-03-17, output', cost: 0.012 }], { 'gpt-5.4-mini-2026-03-17': 20_000 }, groups, 'low', '2026-11-12');
    assert.equal(billed.ok, false);
    assert.deepEqual(billed.billed, [{ model: 'gpt-5.4-mini-2026-03-17', cost: 0.012 }]);
    assert.equal(freeTierCheck([{ lineItem: 'gpt-5.4, output', cost: 0.5 }], { 'gpt-5.4': 400_000 }, groups, 'low', '2026-11-12').ok, true);
    // A model that isn't on the list is billed as it should be.
    assert.equal(freeTierCheck([{ lineItem: 'gpt-6, output', cost: 0.5 }], {}, groups, 'low', '2026-11-12').ok, true);
  });
});

test('news: one line per held ticker, https only', () => {
  const news = cleanNews({ news: [
    { ticker: 'aaa', text: 'Reported results.', url: 'https://example.com/a' },
    { ticker: 'AAA', text: 'Second item.', url: 'https://example.com/b' },
    { ticker: 'ZZZ', text: 'Not held.', url: 'https://example.com/z' },
    { ticker: 'BBB', text: 'Plain http.', url: 'http://example.com/b' },
  ] }, ['AAA', 'BBB']);
  assert.deepEqual(news, [{ ticker: 'AAA', text: 'Reported results.', url: 'https://example.com/a' }]);
});

test('settings default to on', () => {
  assert.deepEqual(cleanDigestSettings(null), { enabled: true, search: true });
  assert.deepEqual(cleanDigestSettings({ enabled: false, search: 'x' }), { enabled: false, search: true });
});
