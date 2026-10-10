// Run with `pnpm test`. Fictional trades and prices only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDailyBook, dailyTimeWeightedReturns, priceHistoryRequest } from '@/lib/performance';
import { capitalStartDate, closedTrades, equityCurve, maxDrawdown, netEquity, tradeStats, windowStart } from '@/lib/six-metrics';

let nextId = 1;
const trade = (fields) => ({
  id: nextId++, type: 'SDI', event: 'STOCK', ticker: 'AAA', market: 'US', strike: null, quantity: 1, entryPrice: 10, currentPrice: 10,
  fees: 0, collateral: 0, openDate: '2026-01-05', expiryDate: null, closeDate: null, status: 'open', ...fields,
});
const closed = (fields) => trade({ status: 'closed', closeDate: '2026-01-09', ...fields });
/** Bars for consecutive weekdays from `start`: [date, close, adjusted close]. */
const bars = (start, closes, adjusted = closes) => {
  const out = [];
  let day = new Date(`${start}T00:00:00Z`);
  for (let index = 0; index < closes.length; index += 1) {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day = new Date(day.getTime() + 86_400_000);
    out.push([day.toISOString().slice(0, 10), closes[index], adjusted[index]]);
    day = new Date(day.getTime() + 86_400_000);
  }
  return out;
};
const close = (actual, expected, digits = 6) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≠ ${expected}`);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const dayOf = (book, date) => book.days.find((day) => day.date === date);

describe('trade statistics', () => {
  const trades = [
    closed({ entryPrice: 100, currentPrice: 130, quantity: 1 }), // +30 (+30%, big)
    closed({ entryPrice: 100, currentPrice: 110, quantity: 2 }), // +20 (+10%)
    closed({ entryPrice: 50, currentPrice: 45, quantity: 2 }), // −10 (−10%)
    closed({ entryPrice: 10, currentPrice: 10.04, quantity: 10 }), // +0.40 (+0.4%, scratch)
    closed({ ticker: 'BOXX', entryPrice: 110, currentPrice: 111, quantity: 5 }), // cash-like: left out
    trade({ entryPrice: 10, currentPrice: 20 }), // still open: left out
    closed({ type: 'Sell', event: 'PUT', strike: '50', entryPrice: 1.5, currentPrice: 0, quantity: 1 }), // +150 (big)
    closed({ type: 'Sell', event: 'CALL', strike: '60', entryPrice: 0.5, currentPrice: 0.6, quantity: 2 }), // −20
    closed({ type: 'Buy', event: 'CALL', strike: '70', entryPrice: 2, currentPrice: 2.01, quantity: 1 }), // +1 (scratch)
  ];

  test('stock lots: averages, break-even win rate, big winners', () => {
    const stats = tradeStats(closedTrades(trades, 'stock', 150), 'stock');
    assert.equal(stats.count, 4);
    assert.equal(stats.wins, 3);
    assert.equal(stats.losses, 1);
    close(stats.winRate, 0.75);
    close(stats.avgWin, (30 + 20 + 0.4) / 3);
    close(stats.avgLoss, -10);
    close(stats.breakEven, 10 / ((30 + 20 + 0.4) / 3 + 10));
    close(stats.margin, 0.75 - stats.breakEven);
    close(stats.avgWinPct, (0.3 + 0.1 + 0.004) / 3);
    close(stats.avgLossPct, -0.1);
    assert.equal(stats.big, 1);
    close(stats.bigShare, 0.25);
    close(stats.bigProfitShare, 30 / 50.4);
    assert.equal(stats.scratch, 1);
    close(stats.profitFactor, 50.4 / 10);
  });

  test('options: written and bought, $100 for a big winner', () => {
    const stats = tradeStats(closedTrades(trades, 'option', 150), 'option');
    assert.equal(stats.count, 3);
    close(stats.avgWin, (150 + 1) / 2);
    close(stats.avgLoss, -20);
    assert.equal(stats.big, 1);
    close(stats.bigProfitShare, 150 / 151);
    assert.equal(stats.scratch, 1);
    assert.equal(stats.avgWinPct, null);
  });

  test('window by close date, and no losing trade means a 0% break-even', () => {
    const rows = closedTrades([closed({ closeDate: '2025-12-30', currentPrice: 12 }), closed({ closeDate: '2026-02-02', currentPrice: 11 })], 'stock', 150, '2026-01-01');
    assert.equal(rows.length, 1);
    const stats = tradeStats(rows, 'stock');
    assert.equal(stats.breakEven, 0);
    assert.equal(stats.avgLoss, null);
    assert.equal(windowStart('ytd', '2026-10-09'), '2026-01-01');
    assert.equal(windowStart('year', '2028-02-29'), '2027-03-01');
  });
});

describe('daily book', () => {
  test('a stock lot: daily P&L adds up to its gain, capital is the prior close', () => {
    const lot = trade({ quantity: 10, entryPrice: 10, currentPrice: 13, openDate: '2026-01-05' });
    const prices = { AAA: bars('2026-01-02', [9.5, 10, 11, 12, 12.5, 12.8]) };
    const book = buildDailyBook([lot], { endDate: '2026-01-09', usdJpyRate: 150, prices });
    assert.equal(book.days[0].date, '2026-01-02'); // baseline: the last close before the first trade
    assert.equal(book.days[0].pnl, 0);
    close(sum(book.days.map((day) => day.pnl)), 30); // (13 − 10) × 10, the last day at the live price
    close(dayOf(book, '2026-01-05').pnl, 0);
    close(dayOf(book, '2026-01-06').pnl, 10);
    close(dayOf(book, '2026-01-05').capital, 100); // the purchase
    close(dayOf(book, '2026-01-06').capital, 100); // 10 × the prior close of 10
    close(dayOf(book, '2026-01-07').capital, 110);
    close(dayOf(book, '2026-01-07').value, 10 / 110);
  });

  test('bought and sold on one day: the P&L lands that day and nothing is held', () => {
    const lot = closed({ quantity: 5, entryPrice: 20, currentPrice: 21, openDate: '2026-01-06', closeDate: '2026-01-06' });
    const book = buildDailyBook([lot], { endDate: '2026-01-08', usdJpyRate: 150, prices: { AAA: bars('2026-01-05', [19, 25, 30, 31]) } });
    close(dayOf(book, '2026-01-06').pnl, 5);
    close(dayOf(book, '2026-01-06').capital, 100);
    close(dayOf(book, '2026-01-06').stockValue, 0);
    close(dayOf(book, '2026-01-07').pnl, 0);
  });

  test('a spin-off booked as a split: traded prices restored, no fake loss on the purchase day', () => {
    // Yahoo scaled closes before 2026-01-07 by 1 ÷ 1.05; the lot was bought at the traded 105.
    const lot = trade({ ticker: 'SPN', quantity: 1, entryPrice: 105, currentPrice: 99, openDate: '2026-01-05' });
    const prices = { SPN: bars('2026-01-02', [100, 100, 100, 99, 99]) };
    const book = buildDailyBook([lot], { endDate: '2026-01-08', usdJpyRate: 150, prices, splits: { SPN: [['2026-01-07', 1.05]] } });
    close(dayOf(book, '2026-01-05').pnl, 0);
    close(dayOf(book, '2026-01-07').pnl, 99 - 105); // the value handed out with the spin-off leaves on its date
    close(sum(book.days.map((day) => day.pnl)), -6);
  });

  test('a small spin-off ratio is still read as a spin-off (traded prices), whatever the entry', () => {
    // Bought at 101 when the traded close was 103 (Yahoo shows 100 before the 1.03 adjustment on 2026-01-07).
    const lot = trade({ ticker: 'SPS', quantity: 1, entryPrice: 101, currentPrice: 100, openDate: '2026-01-05' });
    const prices = { SPS: bars('2026-01-02', [100, 100, 100, 100, 100]) };
    const book = buildDailyBook([lot], { endDate: '2026-01-08', usdJpyRate: 150, prices, splits: { SPS: [['2026-01-07', 1.03]] } });
    close(dayOf(book, '2026-01-05').pnl, 2);
    close(dayOf(book, '2026-01-07').pnl, -3);
    close(sum(book.days.map((day) => day.pnl)), -1);
  });

  test('a lot recorded after a 10:1 split keeps the adjusted prices', () => {
    const lot = trade({ ticker: 'SPL', quantity: 10, entryPrice: 50, currentPrice: 55, openDate: '2026-01-05' });
    const prices = { SPL: bars('2026-01-02', [49, 50, 52, 53, 55]) };
    const book = buildDailyBook([lot], { endDate: '2026-01-08', usdJpyRate: 150, prices, splits: { SPL: [['2026-01-07', 10]] } });
    close(dayOf(book, '2026-01-06').pnl, 20);
    close(dayOf(book, '2026-01-07').pnl, 10);
    close(sum(book.days.map((day) => day.pnl)), 50);
  });

  test('a written put: intrinsic plus time value decaying with the square root of days left', () => {
    // Put 100, sold for 2 with 4 days to expiry; the underlying falls to 98, then ends at 101.
    const put = closed({ type: 'Sell', event: 'PUT', ticker: 'UND', strike: '100', entryPrice: 2, currentPrice: 0, quantity: 1, collateral: 10_000, openDate: '2026-01-05', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const prices = { UND: bars('2026-01-02', [103, 102, 98, 99, 100, 101]) };
    const book = buildDailyBook([put], { endDate: '2026-01-09', usdJpyRate: 150, prices });
    const value = (intrinsic, daysLeft) => intrinsic + 2 * Math.sqrt(daysLeft / 4);
    close(dayOf(book, '2026-01-05').pnl, 0); // sold above intrinsic: nothing gained or lost on the day
    close(dayOf(book, '2026-01-06').pnl, -100 * (value(2, 3) - 2));
    close(dayOf(book, '2026-01-07').pnl, -100 * (value(1, 2) - value(2, 3)));
    close(sum(book.days.map((day) => day.pnl)), 200); // expired worthless: the premium
    close(dayOf(book, '2026-01-06').capital, 10_000);
    close(dayOf(book, '2026-01-09').capital, 10_000);
  });

  test('a covered call adds no capital; BOXX and put collateral are not counted twice', () => {
    const shares = trade({ ticker: 'CVR', quantity: 100, entryPrice: 50, currentPrice: 50, openDate: '2026-01-05' });
    const call = closed({ type: 'Sell', event: 'CALL', ticker: 'CVR', strike: '55', entryPrice: 1, currentPrice: 0, quantity: 1, openDate: '2026-01-06', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const boxx = trade({ ticker: 'BOXX', quantity: 10, entryPrice: 100, currentPrice: 100, openDate: '2026-01-05' });
    const put = closed({ type: 'Sell', event: 'PUT', ticker: 'PUTX', strike: '30', entryPrice: 0.5, currentPrice: 0, quantity: 1, collateral: 3000, openDate: '2026-01-06', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const prices = { CVR: bars('2026-01-02', [50, 50, 50, 50, 50, 50]), BOXX: bars('2026-01-02', [100, 100, 100, 100, 100, 100]), PUTX: bars('2026-01-02', [35, 35, 35, 35, 35, 35]) };
    const book = buildDailyBook([shares, call, boxx, put], { endDate: '2026-01-09', usdJpyRate: 150, prices });
    close(dayOf(book, '2026-01-07').capital, 5000 + Math.max(1000, 3000));
    const naked = closed({ type: 'Sell', event: 'CALL', ticker: 'NKD', strike: '20', entryPrice: 1, currentPrice: 0, quantity: 1, openDate: '2026-01-06', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const nakedBook = buildDailyBook([naked], { endDate: '2026-01-09', usdJpyRate: 150, prices: { NKD: bars('2026-01-02', [15, 15, 15, 15, 15, 15]) } });
    close(dayOf(nakedBook, '2026-01-07').capital, 2000);
  });

  test('written calls share the shares on hand day by day; a spread needs its width as collateral', () => {
    const shares = closed({ ticker: 'TWO', quantity: 100, entryPrice: 50, currentPrice: 50, openDate: '2026-01-05', closeDate: '2026-01-08' });
    const first = closed({ type: 'Sell', event: 'CALL', ticker: 'TWO', strike: '55', entryPrice: 1, currentPrice: 0, quantity: 1, openDate: '2026-01-05', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const second = closed({ type: 'Sell', event: 'CALL', ticker: 'TWO', strike: '60', entryPrice: 1, currentPrice: 0, quantity: 1, openDate: '2026-01-06', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const prices = { TWO: bars('2026-01-02', [50, 50, 50, 50, 50, 50]) };
    const book = buildDailyBook([shares, first, second], { endDate: '2026-01-09', usdJpyRate: 150, prices });
    close(dayOf(book, '2026-01-05').collateral, 0); // 100 shares cover the first call
    close(dayOf(book, '2026-01-07').collateral, 6000); // the second call is uncovered
    close(dayOf(book, '2026-01-09').collateral, 5500 + 6000); // the shares were sold on the 8th
    const spread = closed({ type: 'Sell', event: 'PUT', ticker: 'SPR', strike: '100/95', entryPrice: 1, currentPrice: 0, quantity: 2, openDate: '2026-01-05', expiryDate: '2026-01-09', closeDate: '2026-01-09' });
    const spreadBook = buildDailyBook([spread], { endDate: '2026-01-09', usdJpyRate: 150, prices: { SPR: bars('2026-01-02', [100, 100, 100, 100, 100, 100]) } });
    close(dayOf(spreadBook, '2026-01-06').capital, 1000);
  });

  test('an open option at a stale typed price: no one-day jump, the total still matches', () => {
    // Put 90 sold at 2.00 with 30 days left; the underlying sits at 100 and the price was never updated.
    const put = trade({ type: 'Sell', event: 'PUT', ticker: 'STL', strike: '90', entryPrice: 2, currentPrice: 2, quantity: 2, openDate: '2026-01-05', expiryDate: '2026-02-04' });
    const prices = { STL: bars('2026-01-02', Array(15).fill(100)) };
    const book = buildDailyBook([put], { endDate: '2026-01-22', usdJpyRate: 150, prices });
    close(sum(book.days.map((day) => day.pnl)), 0);
    // Jumping to the typed price on the last day would move 200 × (2 − 2√(13/30)) ≈ $137 at once.
    const moves = book.days.map((day) => Math.abs(day.pnl));
    assert.ok(Math.max(...moves) < 30, `largest daily move ${Math.max(...moves)}`);
  });

  test('dividends come from the adjusted close', () => {
    // A $1 dividend on 2026-01-07: the close drops 50 → 49, the adjusted close stays flat.
    const lot = trade({ ticker: 'DIV', quantity: 10, entryPrice: 50, currentPrice: 49, openDate: '2026-01-05' });
    const prices = { DIV: bars('2026-01-02', [50, 50, 50, 49, 49], [49, 49, 49, 49, 49]) };
    const book = buildDailyBook([lot], { endDate: '2026-01-08', usdJpyRate: 150, prices });
    close(dayOf(book, '2026-01-07').dividends, 10 * 50 * (49 / 49 - 49 / 50));
    close(dayOf(book, '2026-01-07').pnl, -10 + 10);
  });

  test('without price history: weekdays and straight lines, reported as estimates', () => {
    const lot = closed({ ticker: 'EST', quantity: 1, entryPrice: 10, currentPrice: 14, openDate: '2026-01-05', closeDate: '2026-01-09' });
    const book = buildDailyBook([lot], { endDate: '2026-01-09', usdJpyRate: 150, prices: null });
    assert.deepEqual(book.estimatedTickers, ['EST']);
    assert.deepEqual(book.days.map((day) => day.date), ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);
    close(dayOf(book, '2026-01-06').pnl, 1);
    close(sum(book.days.map((day) => day.pnl)), 4);
  });

  test('dailyTimeWeightedReturns reads the window out of the book', () => {
    const lot = trade({ quantity: 10, entryPrice: 10, currentPrice: 13, openDate: '2026-01-05' });
    const prices = { AAA: bars('2026-01-02', [9.5, 10, 11, 12, 12.5, 12.8]) };
    const daily = dailyTimeWeightedReturns([lot], { startDate: '2026-01-06', endDate: '2026-01-08', usdJpyRate: 150, prices });
    assert.deepEqual(daily.days.map((day) => day.date), ['2026-01-06', '2026-01-07', '2026-01-08']);
    close(daily.days[0].value, 0.1);
    close(daily.tradePnl[lot.id], 30); // the window's last day uses the live price (13)
  });
});

describe('淨值 and 回撤', () => {
  test('maxDrawdown finds the peak, the trough and the recovery', () => {
    const dates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    assert.deepEqual(maxDrawdown(dates, [1, 1.2, 0.9, 1.1, 1.25, 1.2], 'ratio'), { depth: 0.9 / 1.2 - 1, peak: 'd2', trough: 'd3', recovered: 'd5' });
    assert.deepEqual(maxDrawdown(dates, [0, 50, -10, 20, 40, 45], 'difference'), { depth: -60, peak: 'd2', trough: 'd3', recovered: null });
    assert.equal(maxDrawdown(dates, [1, 2, 3, 4, 5, 6], 'ratio'), null);
  });

  test('the % series waits for capital to reach 10% of its peak; SPY on the same dates', () => {
    const small = closed({ ticker: 'AAA', quantity: 1, entryPrice: 10, currentPrice: 5, openDate: '2026-01-05', closeDate: '2026-01-07' });
    const large = trade({ ticker: 'BBB', quantity: 100, entryPrice: 10, currentPrice: 9, openDate: '2026-01-08' });
    const prices = {
      AAA: bars('2026-01-02', [10, 10, 7, 5, 5, 5, 5]),
      BBB: bars('2026-01-02', [10, 10, 10, 10, 10, 11, 9]),
      SPY: bars('2026-01-02', [100, 100, 100, 100, 100, 102, 99], [100, 100, 100, 100, 100, 102, 99]),
    };
    const book = buildDailyBook([small, large], { endDate: '2026-01-12', usdJpyRate: 150, prices });
    const curve = equityCurve(book, prices.SPY, 'all', '2026-01-12');
    assert.equal(capitalStartDate(book), '2026-01-08');
    assert.equal(curve.autoStart, '2026-01-08');
    assert.equal(curve.twrStart, '2026-01-07');
    assert.equal(curve.points.find((point) => point.date === '2026-01-06').dd, null); // the −30% day of the tiny book is not in the % series
    close(curve.nav.max.depth, 9 / 11 - 1);
    assert.equal(curve.nav.max.peak, '2026-01-09');
    close(curve.spy.max.depth, 99 / 102 - 1);
    close(curve.usd.total, -5 - 100);
    close(curve.usd.max.depth, -105 - 95); // from the +$95 high on 2026-01-09
    assert.equal(curve.usd.max.peak, '2026-01-09');
  });

  test('SPY starts from its first close when the book begins on the first day of the data', () => {
    const lot = trade({ ticker: 'AAA', quantity: 10, entryPrice: 10, currentPrice: 11, openDate: '2026-03-02' });
    const prices = { AAA: bars('2026-03-02', [10, 10.5, 11]), SPY: bars('2026-03-02', [100, 101, 99]) };
    const book = buildDailyBook([lot], { endDate: '2026-03-04', usdJpyRate: 150, prices });
    assert.equal(book.days[0].date, '2026-02-27'); // a baseline without prices
    const curve = equityCurve(book, prices.SPY, 'all', '2026-03-04');
    assert.ok(curve.spy, 'SPY comparison present');
    close(curve.spy.max.depth, 99 / 101 - 1);
  });

  test('淨值: open positions at their price, the book total, and 存提款紀錄 when there are records', () => {
    const trades = [
      trade({ ticker: 'AAA', quantity: 10, currentPrice: 12 }),
      trade({ ticker: 'BOXX', quantity: 5, currentPrice: 110 }),
      trade({ type: 'Sell', event: 'PUT', ticker: 'AAA', strike: '10', quantity: 1, currentPrice: 0.3 }),
      closed({ ticker: 'AAA', quantity: 10, currentPrice: 99 }),
    ];
    const book = { days: [{ date: '2026-01-02', pnl: 0, capital: 0, value: 0, dividends: 0, stockValue: 0, cashValue: 0, collateral: 0 }, { date: '2026-01-05', pnl: 40, capital: 100, value: 0.4, dividends: 2, stockValue: 0, cashValue: 0, collateral: 0 }], estimatedTickers: [], tradePnl: {} };
    const equity = netEquity(trades, book, [{ kind: 'deposit', amount: 1000, currency: 'USD' }, { kind: 'withdrawal', amount: 15000, currency: 'JPY' }], 150);
    close(equity.stockValue, 120);
    close(equity.cashLikeValue, 550);
    close(equity.marketValue, 670);
    close(equity.optionValue, -30);
    close(equity.cumulativePnl, 40);
    close(equity.netDeposits, 1000 - 100);
    close(equity.estimatedEquity, 940);
    assert.equal(netEquity(trades, book, [], 150).netDeposits, null);
  });
});

test('price history: stocks, option underlyings and SPY, in one list without a cap', () => {
  const trades = [
    ...Array.from({ length: 45 }, (_, index) => trade({ ticker: `T${index}`, openDate: '2026-03-15' })),
    trade({ type: 'Sell', event: 'PUT', ticker: 'OPT', strike: '10', openDate: '2026-02-20' }),
  ];
  const request = priceHistoryRequest(trades);
  assert.equal(request.from, '2026-02-01');
  assert.equal(request.symbols.length, 47);
  assert.ok(request.symbols.includes('OPT'));
  assert.equal(request.symbols.at(-1), 'SPY');
});
