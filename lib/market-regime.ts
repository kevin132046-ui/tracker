/**
 * 市場定調: the VIX term structure read with five rules for setting risk and position size (never a
 * buy or sell trigger on its own). The ratio is VIX ÷ VIX3M.
 *
 * ① 平靜: VIX < 16 and ratio < 0.90.
 * ② 正常偏緊張: VIX 16–22 and ratio 0.90–1.00; also every other ratio-below-1 mix that isn't ①
 *    (flagged 偏高 when VIX is above 22).
 * ③ 近端恐慌開始: the ratio just crossed 1.0 (above 1.0 today, at or below 1.0 on one of the five
 *    trading days before) and VIX broke 25 quickly (25 or more today, below 20 five trading days ago).
 * ④ 持續倒掛: the ratio above 1.0 for 15 trading days in a row (about three weeks).
 * ⑤ 恐慌消退: the ratio back below 1.0 after reaching 1.10 within the last 30 trading days.
 * 0 倒掛觀察: the ratio at or above 1.0 without ③ or ④.
 *
 * Everything here is pure: the route fetches Cboe's files and these turn them into numbers.
 */

export type IndexSymbol = 'VIX9D' | 'VIX' | 'VIX3M' | 'VIX6M' | 'VIX1Y';
export const indexSymbols: readonly IndexSymbol[] = ['VIX9D', 'VIX', 'VIX3M', 'VIX6M', 'VIX1Y'];

export type DailyClose = { date: string; close: number };
export type IndexQuote = { symbol: IndexSymbol; price: number; prevClose: number | null; time: string | null };
export type RatioPoint = { date: string; vix: number; vix3m: number; ratio: number };
export type FuturesPoint = { symbol: string; expiry: string; price: number };
export type FuturesCurve = { date: string; points: FuturesPoint[] };

/** What /api/market-regime returns. */
export type MarketRegimePayload = {
  /** Date of the latest reading (US Eastern), and whether it is an intraday (delayed) value. */
  asOf: string | null;
  intraday: boolean;
  quotes: IndexQuote[];
  /** About six months of daily VIX and VIX3M closes, the latest reading last. */
  ratioHistory: RatioPoint[];
  futures: FuturesCurve | null;
  futuresPrev: FuturesCurve | null;
  updatedAt: string;
  errors: string[];
};

export type RegimeId = 0 | 1 | 2 | 3 | 4 | 5;

export type RegimeReading = {
  id: RegimeId;
  vix: number;
  ratio: number;
  /** Trading days in a row, ending at the latest reading, with the ratio above 1.0. */
  streak: number;
  /** Highest ratio over the last 30 trading days, the latest included. */
  max30: number;
  /** VIX five trading days before the latest reading, when the history reaches that far. */
  vix5ago: number | null;
  /** The ratio was at or below 1.0 on one of the five trading days before the latest. */
  crossed: boolean;
  /** ② with VIX above 22. */
  elevated: boolean;
  /** Fewer than 30 trading days of history: ④ and ⑤ can't be judged fully. */
  shortHistory: boolean;
  conditions: {
    vixCalm: boolean; ratioCalm: boolean;
    vixNormal: boolean; ratioNormal: boolean;
    crossed: boolean; vixSpike: boolean;
    longInversion: boolean;
    hadPanic: boolean; backBelow: boolean;
  };
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

/**
 * One of Cboe's delayed-quote files (`{ data: { current_price, close, prev_day_close, price_change, last_trade_time } }`).
 * During the regular session the latest value is `current_price`. After 16:15 ET, overnight and at
 * weekends `last_trade_time` stays at the session's 16:15 while `current_price` follows the global
 * trading hours (GTH) value, and `prev_day_close` rolls over to that session's close: the session's
 * official close is `close`, and the one before it is `close − price_change`.
 */
export function parseCboeQuote(symbol: IndexSymbol, payload: unknown): IndexQuote | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  const current = data.current_price;
  if (!finite(current) || current <= 0) return null;
  const time = typeof data.last_trade_time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data.last_trade_time) ? data.last_trade_time : null;
  const prev = finite(data.prev_day_close) && data.prev_day_close > 0 ? data.prev_day_close : null;
  const close = finite(data.close) && data.close > 0 ? data.close : null;
  if (isIntraday(time) || close === null) return { symbol, price: current, prevClose: prev, time };
  // After the close. The session's change still holds while no GTH value has moved the price; otherwise
  // the earlier close is only known when prev_day_close hasn't rolled over yet.
  const change = finite(data.price_change) ? data.price_change : null;
  const before = change !== null && current === close ? round(close - change, 2) : prev !== null && prev !== close ? prev : null;
  return { symbol, price: close, prevClose: before !== null && before > 0 ? before : null, time };
}

const historyRow = /"date":\s*"(\d{4}-\d{2}-\d{2})"[^}]*?"close":\s*"?(\d+(?:\.\d+)?)"?/g;

/**
 * The last `limit` daily closes from Cboe's historical chart file. The file runs back to 1990 (over a
 * megabyte), so only its tail is read, row by row, instead of parsing the whole document.
 */
export function parseCboeHistoryTail(text: string, limit = 150): DailyClose[] {
  const tail = text.length > limit * 160 ? text.slice(-limit * 160) : text;
  const rows = new Map<string, number>();
  for (const match of tail.matchAll(historyRow)) {
    const close = Number(match[2]);
    if (close > 0) rows.set(match[1], close);
  }
  return [...rows].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
}

const monthlySymbol = /^VX\/[FGHJKMNQUVXZ]\d$/;

/** VX monthly futures from Cboe's daily settlement CSV (weeklies such as VX44/X6 are skipped). */
export function parseSettlementCsv(text: string, limit = 9): FuturesPoint[] {
  const points: FuturesPoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [product, symbol, expiry, price] = line.split(',').map((cell) => cell.trim());
    if (product !== 'VX' || !monthlySymbol.test(symbol ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(expiry ?? '')) continue;
    const value = Number(price);
    if (Number.isFinite(value) && value > 0) points.push({ symbol, expiry, price: value });
  }
  return points.sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, limit);
}

/**
 * VIX and VIX3M closes joined by date into ratios, with the latest quotes as the final point when
 * they are newer than the last close (or replace it on the same date).
 */
export function mergeRatioHistory(vix: readonly DailyClose[], vix3m: readonly DailyClose[], latest?: { date: string; vix: number; vix3m: number } | null, limit = 130): RatioPoint[] {
  const longer = new Map(vix3m.map((row) => [row.date, row.close]));
  const points: RatioPoint[] = [];
  for (const row of vix) {
    const other = longer.get(row.date);
    if (other && other > 0) points.push({ date: row.date, vix: row.close, vix3m: other, ratio: round(row.close / other) });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  if (latest && latest.vix > 0 && latest.vix3m > 0) {
    const point = { date: latest.date, vix: latest.vix, vix3m: latest.vix3m, ratio: round(latest.vix / latest.vix3m) };
    const last = points.at(-1);
    if (!last || last.date < point.date) points.push(point);
    else if (last.date === point.date) points[points.length - 1] = point;
  }
  return points.slice(-limit);
}

/** The reading for the latest point of a ratio history (oldest first). Null without any point. */
export function classifyRegime(history: readonly RatioPoint[]): RegimeReading | null {
  const today = history.at(-1);
  if (!today) return null;
  const { vix, ratio } = today;
  let streak = 0;
  for (let index = history.length - 1; index >= 0 && history[index].ratio > 1; index -= 1) streak += 1;
  const window30 = history.slice(-30);
  const max30 = Math.max(...window30.map((point) => point.ratio));
  const before = history.slice(-6, -1);
  const vix5ago = history.length >= 6 ? history[history.length - 6].vix : null;
  const crossed = ratio > 1 && before.some((point) => point.ratio <= 1);
  const conditions = {
    vixCalm: vix < 16,
    ratioCalm: ratio < 0.9,
    vixNormal: vix >= 16 && vix <= 22,
    ratioNormal: ratio >= 0.9 && ratio < 1,
    crossed,
    vixSpike: vix >= 25 && vix5ago !== null && vix5ago < 20,
    longInversion: streak >= 15,
    hadPanic: max30 >= 1.1,
    backBelow: ratio < 1,
  };
  let id: RegimeId;
  if (ratio >= 1) id = conditions.longInversion ? 4 : conditions.crossed && conditions.vixSpike ? 3 : 0;
  else if (conditions.hadPanic) id = 5;
  else if (conditions.vixCalm && conditions.ratioCalm) id = 1;
  else id = 2;
  return { id, vix, ratio, streak, max30, vix5ago, crossed, elevated: id === 2 && vix > 22, shortHistory: history.length < 30, conditions };
}

/** Where a ratio sits on the four-zone gauge (0.80 … 1.20, each zone 0.10 wide), from 0 to 1. */
export function gaugePosition(ratio: number) {
  return round(Math.min(1, Math.max(0, (ratio - 0.8) / 0.4)));
}

/** The gauge zone of a ratio: 0 平靜, 1 偏緊, 2 倒掛, 3 恐慌. */
export function ratioZone(ratio: number): 0 | 1 | 2 | 3 {
  return ratio < 0.9 ? 0 : ratio < 1 ? 1 : ratio < 1.1 ? 2 : 3;
}

/** VIX9D ÷ VIX: above 1 means near-term (event) stress. */
export function eventRatio(quotes: readonly IndexQuote[]) {
  const nine = quotes.find((quote) => quote.symbol === 'VIX9D')?.price;
  const vix = quotes.find((quote) => quote.symbol === 'VIX')?.price;
  return nine && vix ? round(nine / vix) : null;
}

/** Second month ÷ front month − 1 of the VX futures curve; below 0 the front is inverted. */
export function frontSpread(curve: FuturesCurve | null) {
  const [first, second] = curve?.points ?? [];
  return first && second ? round(second.price / first.price - 1) : null;
}

/** Calendar date (YYYY-MM-DD) in New York for a moment. */
export function easternDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The weekday dates from `date` going back, newest first (Cboe publishes no settlements at weekends). */
export function weekdaysBack(date: string, count: number) {
  const days: string[] = [];
  const day = new Date(`${date}T12:00:00Z`);
  while (days.length < count) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) days.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return days;
}

/** A Cboe quote's time (New York) is intraday until the 16:15 close of the VIX calculation. */
export function isIntraday(time: string | null) {
  return Boolean(time && time.slice(11, 16) < '16:15');
}
