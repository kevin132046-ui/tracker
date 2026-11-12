// Run with `pnpm test`. Made-up sentences; no real trades.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseTradeText } from '@/lib/trade-text';
import { tradeParseRequest } from '@/lib/server/trade-parse';

const today = '2026-11-12';
const row = (fields) => ({ action: 'open', date: today, ticker: null, kind: 'stock', side: null, right: null, strike: null, expiry: null, quantity: null, price: null, fees: null, note: '', ...fields });
const one = (text, day = today, known = []) => {
  const parsed = parseTradeText(text, day, known);
  assert.deepEqual(parsed.gaps, [], `${text} → ${JSON.stringify(parsed.gaps)}`);
  assert.equal(parsed.rows.length, 1);
  return parsed.rows[0];
};
const gap = (text) => {
  const parsed = parseTradeText(text, today);
  assert.equal(parsed.rows.length, 0, `${text} should not be read`);
  return parsed.gaps[0].missing;
};

describe('reads a trade sentence locally', () => {
  test('the three examples in the entry box', () => {
    assert.deepEqual(one('今天以 2.30 賣出 KO 11/20 到期 75 PUT 一口'), row({ ticker: 'KO', kind: 'option', side: 'sell', right: 'PUT', strike: 75, expiry: '2026-11-20', quantity: 1, price: 2.3 }));
    assert.deepEqual(one('昨天 0.05 買回 KO 75P 平倉，手續費 0.65'), row({ action: 'close', date: '2026-11-11', ticker: 'KO', kind: 'option', side: 'buy', right: 'PUT', strike: 75, price: 0.05, fees: 0.65 }));
    assert.deepEqual(one('9/15 買入 AAPL 10 股，成交價 228.5'), row({ date: '2026-09-15', ticker: 'AAPL', side: 'buy', quantity: 10, price: 228.5 }));
  });

  test('English, with the quantity as a bare number', () => {
    assert.deepEqual(one('Sold 2 KO Nov 20 75 puts @ 1.15'), row({ ticker: 'KO', kind: 'option', side: 'sell', right: 'PUT', strike: 75, expiry: '2026-11-20', quantity: 2, price: 1.15 }));
    assert.deepEqual(one('Bought 100 shares of AAPL at $228.50 on 9/15'), row({ date: '2026-09-15', ticker: 'AAPL', side: 'buy', quantity: 100, price: 228.5 }));
    assert.deepEqual(one('BTC 1 KO 75P 0.10'), row({ action: 'close', ticker: 'KO', kind: 'option', side: 'buy', right: 'PUT', strike: 75, quantity: 1, price: 0.1 }));
  });

  test('Japanese', () => {
    assert.deepEqual(one('今日 KO 11/20 75P を 1.20 で 1枚 売建'), row({ ticker: 'KO', kind: 'option', side: 'sell', right: 'PUT', strike: 75, expiry: '2026-11-20', quantity: 1, price: 1.2 }));
    assert.deepEqual(one('7203 を 100 株 2,850 円で買い'), row({ ticker: '7203.T', side: 'buy', quantity: 100, price: 2850 }));
  });

  test('an OCC symbol and full-width text', () => {
    assert.deepEqual(one('STO KO261120P00075000 x1 @2.30'), row({ ticker: 'KO', kind: 'option', side: 'sell', right: 'PUT', strike: 75, expiry: '2026-11-20', quantity: 1, price: 2.3 }));
    assert.deepEqual(one('今天以２．３０賣出ＫＯ　１１／２０到期　７５ＰＵＴ　１口'), row({ ticker: 'KO', kind: 'option', side: 'sell', right: 'PUT', strike: 75, expiry: '2026-11-20', quantity: 1, price: 2.3 }));
  });

  test('dates without a year', () => {
    // The trade date is the last one on or before today; the expiry the next one on or after the trade.
    assert.equal(one('12/20 買入 AAPL 1 股 200').date, '2025-12-20');
    assert.equal(one('STO KO 1/16 75P 1.00 1口', '2026-12-20').expiry, '2027-01-16');
    // A date after the strike is the expiry (「KO 75P 11/20」), and so is one still ahead.
    assert.equal(one('sold 1 ko 75p 11/20 @1.15', today, ['KO']).expiry, '2026-11-20');
    assert.deepEqual(one('11/3 賣出 KO 75 PUT 2.00 一口 11/20 到期'), row({ date: '2026-11-03', ticker: 'KO', kind: 'option', side: 'sell', right: 'PUT', strike: 75, expiry: '2026-11-20', quantity: 1, price: 2 }));
  });

  test('selling shares closes; one line per fill', () => {
    assert.deepEqual(one('賣出 AAPL 10 股 230'), row({ action: 'close', ticker: 'AAPL', side: 'sell', quantity: 10, price: 230 }));
    const parsed = parseTradeText('9/15 買入 AAPL 10 股 228.5\n今天以 2.30 賣出 KO 11/20 到期 75 PUT 一口', today);
    assert.deepEqual(parsed.rows.map((fill) => fill.ticker), ['AAPL', 'KO']);
  });
});

describe('says what it could not read', () => {
  test('a missing price or expiry', () => {
    assert.deepEqual(gap('買回 KO 75P'), ['價格']);
    assert.deepEqual(gap('賣出 KO 75P 2.30 一口'), ['到期日']);
    assert.deepEqual(gap('買入 AAPL 228.5'), ['股數']);
  });

  test('words it does not know', () => {
    const missing = gap('上週買了一些蘋果');
    assert.ok(missing.includes('代號'));
    assert.ok(missing.some((item) => item.startsWith('看不懂') && item.includes('蘋果')));
    assert.ok(gap('賣出 KO 75P 11/20 2.30 一口 一半').some((item) => item.includes('一半')));
  });

  test('keeps the readable lines when another one is not', () => {
    const parsed = parseTradeText('9/15 買入 AAPL 10 股 228.5\n上週買了一些蘋果', today);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.gaps[0].sentence, '上週買了一些蘋果');
  });
});

describe('what the AI is sent', () => {
  test('only the note: no positions and no trade ids', () => {
    const request = tradeParseRequest('上週買了五股微軟，四百塊', null, today);
    assert.ok(request.prompt.includes('上週買了五股微軟，四百塊'));
    assert.doesNotMatch(request.prompt, /Open positions|closesTradeId/);
    assert.equal(tradeParseRequest.length, 3);
  });
});
