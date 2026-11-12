// Run with `pnpm test`. Made-up index levels and a made-up report sentence set only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyRegime, eventRatio, frontSpread, gaugePosition, isIntraday, mergeRatioHistory, parseCboeHistoryTail, parseCboeQuote, parseSettlementCsv, ratioZone, weekdaysBack } from '@/lib/market-regime';
import { hasInsight, parseEarningsInsight, reportDate } from '@/lib/earnings-insight';

/** A ratio history from [vix, vix3m] pairs on consecutive weekdays (oldest first). */
const series = (pairs, start = '2026-01-05') => {
  const dates = weekdaysBack('2026-12-31', 400).reverse().filter((date) => date >= start);
  return pairs.map(([vix, vix3m], index) => ({ date: dates[index], vix, vix3m, ratio: Number((vix / vix3m).toFixed(4)) }));
};
const repeat = (pair, count) => Array.from({ length: count }, () => pair);

describe('Cboe files', () => {
  test('reads a delayed quote', () => {
    const quote = parseCboeQuote('VIX', { data: { symbol: '^VIX', current_price: 18.5, prev_day_close: 19.25, last_trade_time: '2026-03-02T14:05:00' } });
    assert.deepEqual(quote, { symbol: 'VIX', price: 18.5, prevClose: 19.25, time: '2026-03-02T14:05:00' });
    assert.equal(parseCboeQuote('VIX', { data: { current_price: 0 } }), null);
  });

  test('after the close: the official close, not the overnight (GTH) value', () => {
    // 2026-11-11 22:40 ET: GTH hasn't moved yet, prev_day_close already rolled to the close.
    assert.deepEqual(parseCboeQuote('VIX', { data: { current_price: 17.49, close: 17.49, prev_day_close: 17.49, price_change: -1.97, last_trade_time: '2026-11-11T16:15:01' } }),
      { symbol: 'VIX', price: 17.49, prevClose: 19.46, time: '2026-11-11T16:15:01' });
    // A weekend with GTH moving: the 11/6 close (25.64) stands; the close before it isn't known from this file.
    assert.deepEqual(parseCboeQuote('VIX', { data: { current_price: 24.71, close: 25.64, prev_day_close: 25.64, price_change: -0.93, last_trade_time: '2026-11-06T16:15:01' } }),
      { symbol: 'VIX', price: 25.64, prevClose: null, time: '2026-11-06T16:15:01' });
    // Between 16:15 and the start of GTH, prev_day_close is still the session before.
    assert.deepEqual(parseCboeQuote('VIX', { data: { current_price: 24.7, close: 25.64, prev_day_close: 28.18, last_trade_time: '2026-11-06T16:15:01' } }),
      { symbol: 'VIX', price: 25.64, prevClose: 28.18, time: '2026-11-06T16:15:01' });
    // During the session the live value is used, whatever close holds.
    assert.equal(parseCboeQuote('VIX', { data: { current_price: 18.1, close: 17.49, prev_day_close: 17.49, last_trade_time: '2026-11-12T11:02:00' } }).price, 18.1);
    assert.equal(parseCboeQuote('VIX', null), null);
  });

  test('reads only the tail of the history file, in date order', () => {
    const rows = Array.from({ length: 400 }, (_, index) => `{"date": "${weekdaysBack('2026-06-30', 400)[399 - index]}", "volume": "0.0", "open": "1", "high": "1", "low": "1", "close": "${(15 + index / 100).toFixed(6)}"}`);
    const text = `{"timestamp": "x", "data": [${rows.join(', ')}], "symbol": "_VIX"}`;
    const tail = parseCboeHistoryTail(text, 120);
    assert.equal(tail.length, 120);
    assert.equal(tail.at(-1).date, '2026-06-30');
    assert.equal(tail.at(-1).close, 18.99);
    assert.ok(tail.every((row, index) => index === 0 || row.date > tail[index - 1].date));
  });

  test('keeps monthly VX futures only, by expiry', () => {
    const csv = ['Product,Symbol,Expiration Date,Price', 'VX,VX44/X6,2026-11-04,20.1', 'VX,VX/Z6,2026-12-16,19.8', 'VX,VX/X6,2026-11-18,20.4', 'VXM,VXM/X6,2026-11-18,20.4', 'VX,VX/F7,2027-01-20,20.9', ''].join('\n');
    assert.deepEqual(parseSettlementCsv(csv).map((point) => point.symbol), ['VX/X6', 'VX/Z6', 'VX/F7']);
    assert.equal(frontSpread({ date: '2026-11-02', points: parseSettlementCsv(csv) }), Number((19.8 / 20.4 - 1).toFixed(4)));
    assert.deepEqual(parseSettlementCsv('Product,Symbol,Expiration Date,Price\n'), []);
  });

  test('joins closes by date and puts the latest quote last', () => {
    const vix = [{ date: '2026-03-02', close: 18 }, { date: '2026-03-03', close: 20 }];
    const vix3m = [{ date: '2026-03-02', close: 20 }, { date: '2026-03-03', close: 20 }];
    const merged = mergeRatioHistory(vix, vix3m, { date: '2026-03-04', vix: 21, vix3m: 20 });
    assert.deepEqual(merged.map((point) => point.ratio), [0.9, 1, 1.05]);
    assert.equal(mergeRatioHistory(vix, vix3m, { date: '2026-03-03', vix: 19, vix3m: 20 }).at(-1).ratio, 0.95);
  });

  test('intraday until the 16:15 close', () => {
    assert.equal(isIntraday('2026-03-02T14:05:00'), true);
    assert.equal(isIntraday('2026-03-02T16:15:00'), false);
    assert.equal(isIntraday(null), false);
  });
});

describe('the five rules', () => {
  test('① calm: VIX below 16 and ratio below 0.90', () => {
    const reading = classifyRegime(series(repeat([14, 17], 40)));
    assert.equal(reading.id, 1);
  });

  test('② normal-tense, and the other ratio-below-1 mixes', () => {
    assert.equal(classifyRegime(series(repeat([19, 20], 40))).id, 2);
    assert.equal(classifyRegime(series(repeat([15, 16], 40))).id, 2); // VIX calm, ratio not
    const high = classifyRegime(series(repeat([24, 25], 40)));
    assert.equal(high.id, 2);
    assert.equal(high.elevated, true);
  });

  test('③ the ratio just crossed 1.0 while VIX broke 25 from below 20', () => {
    const reading = classifyRegime(series([...repeat([16, 19], 30), [18, 19], [19, 19.5], [21, 21], [23, 22.5], [27, 25]]));
    assert.equal(reading.crossed, true);
    assert.equal(reading.vix5ago, 16);
    assert.equal(reading.id, 3);
  });

  test('crossing without a fast VIX spike is only 倒掛觀察', () => {
    const reading = classifyRegime(series([...repeat([20, 21], 30), [22, 21.5]]));
    assert.equal(reading.id, 0);
    assert.equal(reading.streak, 1);
  });

  test('④ above 1.0 for 15 trading days in a row', () => {
    assert.equal(classifyRegime(series([...repeat([20, 21], 20), ...repeat([26, 25], 15)])).id, 4);
    assert.equal(classifyRegime(series([...repeat([20, 21], 20), ...repeat([26, 25], 14)])).id, 0);
  });

  test('⑤ back below 1.0 after reaching 1.10 within 30 days', () => {
    const reading = classifyRegime(series([...repeat([20, 21], 20), ...repeat([33, 29], 5), ...repeat([24, 24.5], 3)]));
    assert.equal(reading.max30 >= 1.1, true);
    assert.equal(reading.id, 5);
    // The peak has left the 30-day window: an ordinary reading again.
    assert.equal(classifyRegime(series([...repeat([33, 29], 5), ...repeat([19, 20], 30)])).id, 2);
  });

  test('a single point still classifies, flagged as short history', () => {
    const reading = classifyRegime(series([[21.15, 21.6]]));
    assert.equal(reading.id, 2);
    assert.equal(reading.shortHistory, true);
    assert.equal(classifyRegime([]), null);
  });

  test('gauge and zones', () => {
    assert.equal(gaugePosition(0.8), 0);
    assert.equal(gaugePosition(1.0), 0.5);
    assert.equal(gaugePosition(1.4), 1);
    assert.deepEqual([0.85, 0.95, 1.05, 1.15].map(ratioZone), [0, 1, 2, 3]);
    assert.equal(eventRatio([{ symbol: 'VIX9D', price: 22, prevClose: null, time: null }, { symbol: 'VIX', price: 20, prevClose: null, time: null }]), 1.1);
  });
});

describe('Earnings Insight text', () => {
  // Sentences shaped like the weekly report's, with invented figures.
  const text = `Key Metrics
    • Earnings Scorecard: For Q2 2031 (with 45% of S&P 500 companies reporting actual results), 71% of S&P 500
      companies have reported a positive EPS surprise and 60% of S&P 500 companies have reported a positive revenue surprise.
    • Earnings Growth: For Q2 2031, the blended (year-over-year) earnings growth rate for the S&P 500 is 7.5%.
    • Earnings Guidance: For Q3 2031, 31 S&P 500 companies have issued negative EPS guidance and 22 S&P 500
      companies have issued positive EPS guidance.
    • Valuation: The forward 12-month P/E ratio for the S&P 500 is 21.4. This P/E ratio is above the 5-year average
      (20.1) and above the 10-year average (18.9).
    The blended (year-over-year) revenue growth rate for Q2 2031 is 4.2%, which is below the 5-year average.
    For CY 2031, analysts are projecting earnings growth of 9.8% and revenue growth of 5.0%.
    For CY 2032, analysts are projecting earnings growth of -1.5% and revenue growth of 3.1%.`;

  test('picks the weekly figures', () => {
    const insight = parseEarningsInsight('EarningsInsight_071831.pdf', text);
    assert.equal(insight.date, '2031-07-18');
    assert.deepEqual([insight.forwardPe, insight.pe5y, insight.pe10y], [21.4, 20.1, 18.9]);
    assert.deepEqual(insight.calendarGrowth, [{ year: 2031, growth: 9.8 }, { year: 2032, growth: -1.5 }]);
    assert.deepEqual([insight.quarter, insight.reportedPct, insight.beatPct, insight.epsGrowth, insight.revenueGrowth, insight.growthKind], ['Q2 2031', 45, 71, 7.5, 4.2, 'blended']);
    assert.deepEqual([insight.guidanceQuarter, insight.guidanceNegative, insight.guidancePositive], ['Q3 2031', 31, 22]);
    assert.equal(hasInsight(insight), true);
  });

  test('a line break inside year-over-year still matches', () => {
    const insight = parseEarningsInsight('EarningsInsight_071831.pdf', 'For Q2 2031, the estimated (year-\nover-year) earnings growth rate for the S&P 500 is 3.0%.');
    assert.equal(insight.epsGrowth, 3);
    assert.equal(insight.growthKind, 'estimated');
  });

  test('nothing found stays empty', () => {
    const insight = parseEarningsInsight('notes.pdf', 'Nothing to see.');
    assert.equal(insight.date, null);
    assert.equal(hasInsight(insight), false);
    assert.equal(reportDate('EarningsInsight_133026.pdf'), null);
    // FactSet sometimes adds a revision letter.
    assert.equal(reportDate('EarningsInsight_110626A.pdf'), '2026-11-06');
    assert.equal(reportDate('EarningsInsight_110626AB.pdf'), null);
  });
});
