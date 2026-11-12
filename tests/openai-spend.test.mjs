// Run with `pnpm test`. Made-up cost figures in the Costs API's shape; no real account data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanBalance, costBuckets, costsStart, estimateBalance, summarizeSpend } from '@/lib/openai-spend';
import { parseSavedBalance } from '@/lib/server/openai-spend-store';

const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const page = (buckets) => ({ data: buckets.map(([date, results]) => ({ start_time: day(date), results: results.map(([lineItem, value, currency = 'usd']) => ({ amount: { value, currency }, line_item: lineItem })) })) });

describe('costs', () => {
  const pages = [
    page([['2026-10-30', [['web search tool calls', 0.03], ['gpt-6-sol, input', 0.2]]], ['2026-11-11', [['web search tool calls', 0.02]]]]),
    page([['2026-11-12', [['Web Search tool calls', 0.04], ['gpt-5.4, output', '1e-4'], ['something', 5, 'eur'], ['gpt-5.4, input', 0]]]]),
  ];

  test('splits web-search calls from the rest, per UTC day, across pages', () => {
    assert.deepEqual(costBuckets(pages), [
      { day: '2026-10-30', search: 0.03, other: 0.2 },
      { day: '2026-11-11', search: 0.02, other: 0 },
      { day: '2026-11-12', search: 0.04, other: 0.0001 },
    ]);
  });

  test('sums today, the month, and what was billed since the balance day', () => {
    const summary = summarizeSpend(costBuckets(pages), Date.parse('2026-11-12T03:00:00Z'), '2026-11-11T09:00:00Z');
    assert.deepEqual(summary.today, { search: 0.04, other: 0.0001, total: 0.0401 });
    assert.equal(summary.month, 0.0601);
    assert.equal(summary.sinceBalance, 0.0601);
    assert.equal(summarizeSpend([], Date.now(), null).sinceBalance, null);
  });

  test('asks the API from the month start, or the balance day when earlier, at most 90 days back', () => {
    const now = Date.parse('2026-11-12T03:00:00Z');
    assert.equal(costsStart(now, null), day('2026-11-01'));
    assert.equal(costsStart(now, '2026-10-20T05:00:00Z'), day('2026-10-20'));
    assert.equal(costsStart(now, '2026-11-05T05:00:00Z'), day('2026-11-01'));
    assert.equal(costsStart(now, '2025-01-01T00:00:00Z'), Math.floor((now - 90 * 86_400_000) / 1000));
  });
});

describe('balance', () => {
  test('remaining balance and searches left (1.5¢ each), with the low warning under $1', () => {
    assert.deepEqual(estimateBalance({ amount: 4.9, at: '2026-11-11T09:00:00Z' }, 0.35), { amount: 4.9, at: '2026-11-11T09:00:00Z', spent: 0.35, remaining: 4.55, searchesLeft: 303, low: false });
    assert.equal(estimateBalance({ amount: 1, at: '2026-11-11T09:00:00Z' }, 0.2).low, true);
    assert.equal(estimateBalance({ amount: 1, at: '2026-11-11T09:00:00Z' }, 3).remaining, 0);
    assert.equal(estimateBalance(null, 0.2), null);
    assert.equal(estimateBalance({ amount: 1, at: '2026-11-11T09:00:00Z' }, null), null);
  });

  test('accepts an amount in dollars, refuses anything else', () => {
    assert.equal(cleanBalance('$4.90', new Date('2026-11-12T00:00:00Z')).amount, 4.9);
    assert.equal(cleanBalance(12.345).amount, 12.35);
    assert.equal(typeof cleanBalance('abc'), 'string');
    assert.equal(typeof cleanBalance(-1), 'string');
    assert.equal(typeof cleanBalance(20_000), 'string');
  });

  test('a stored balance is read back only when it is complete', () => {
    assert.deepEqual(parseSavedBalance('{"amount":4.9,"at":"2026-11-11T09:00:00Z"}'), { amount: 4.9, at: '2026-11-11T09:00:00Z' });
    assert.equal(parseSavedBalance('{"amount":"x","at":"2026-11-11"}'), null);
    assert.equal(parseSavedBalance('{"amount":4.9}'), null);
    assert.equal(parseSavedBalance('nope'), null);
  });
});
