/**
 * Pure portfolio-performance helpers shared by the dashboard.
 *
 * No React and no server imports: everything here is deterministic given its
 * inputs so it can run in the browser, during SSR, or in a quick script.
 */

export type RangeMode = 'day' | 'week' | 'month' | 'year';
export type CapitalBasis = 'collateral' | 'strike' | 'cost' | 'premium';

/** The subset of a trade row the performance maths needs. */
export type PerformanceTrade = {
  id: number;
  type: string;
  openDate: string;
  closeDate: string | null;
  /** Options only: YYYY-MM-DD. */
  expiryDate?: string | null;
  ticker: string | null;
  event: string;
  strike: string | null;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  fees: number;
  collateral: number;
  market?: 'US' | 'JP';
  derived?: boolean;
};

type TradeKind = Pick<PerformanceTrade, 'type' | 'event'>;
type TradeCurrency = Pick<PerformanceTrade, 'market' | 'ticker'>;

const dayMs = 86_400_000;
const priceSymbolPattern = /^[A-Z0-9.=^-]{1,15}$/;
export const usdJpySymbol = 'JPY=X';
/** Most symbols /api/price-history accepts in one request. */
export const maxPriceHistorySymbols = 40;

export const isJapaneseTicker = (ticker: string | null | undefined) => Boolean(ticker?.toUpperCase().endsWith('.T'));
export const isYenTicker = (ticker: string | null | undefined) => ticker?.toUpperCase() === 'JPY' || isJapaneseTicker(ticker);
export const isCashTrade = (trade: TradeKind) => trade.type === 'CASH' || trade.event === 'CASH' || trade.event === 'DIVIDEND';
export const isStockTrade = (trade: TradeKind) => trade.type === 'SDI' || trade.event === 'STOCK';
export const isShortTrade = (trade: Pick<PerformanceTrade, 'type'>) => trade.type.toLowerCase() === 'sell';
export const isYenTrade = (trade: TradeCurrency) => trade.market === 'JP' || isYenTicker(trade.ticker);
export const normalizeTickerForMarket = (ticker: string | null | undefined, market: 'US' | 'JP') => {
  const normalized = String(ticker ?? '').trim().toUpperCase();
  return market === 'JP' && /^\d{4}$/.test(normalized) ? `${normalized}.T` : normalized;
};
export const priceSymbolFor = (trade: TradeCurrency) => normalizeTickerForMarket(trade.ticker, trade.market ?? (isJapaneseTicker(trade.ticker) ? 'JP' : 'US'));
export const normalizedUsdAmount = (trade: TradeCurrency, value: number, usdJpyRate: number) => isYenTrade(trade) && usdJpyRate > 0 ? value / usdJpyRate : value;

/**
 * Native-currency capital a trade ties up.
 * - stock: entry cost + fees
 * - long option: premium × 100 × qty + fees
 * - short option: collateral; when missing, strike × 100 × qty (strike notional); else the premium cost
 * - cash: the balance
 */
export function capitalBase(trade: PerformanceTrade): { amount: number; basis: CapitalBasis } {
  if (isCashTrade(trade)) return { amount: Math.abs(trade.quantity), basis: 'cost' };
  const stock = isStockTrade(trade);
  const entryCost = Math.abs(trade.entryPrice * trade.quantity * (stock ? 1 : 100)) + Math.max(0, trade.fees);
  if (stock) return { amount: entryCost, basis: 'cost' };
  if (!isShortTrade(trade)) return { amount: entryCost, basis: 'premium' };
  if (trade.collateral > 0) return { amount: trade.collateral, basis: 'collateral' };
  const strikeNotional = Math.abs(Number(trade.strike) * trade.quantity * 100);
  if (Number.isFinite(strikeNotional) && strikeNotional > 0) return { amount: strikeNotional, basis: 'strike' };
  return { amount: entryCost, basis: 'premium' };
}

export const investedCapitalUsd = (trade: PerformanceTrade, usdJpyRate: number) => normalizedUsdAmount(trade, capitalBase(trade).amount, usdJpyRate);

export function strategyLabel(trade: Pick<PerformanceTrade, 'type' | 'event' | 'strike'>) {
  if (isStockTrade(trade)) return trade.type === 'SDI' ? 'STOCK' : `${trade.type} ${trade.event}`;
  const strike = trade.strike?.trim();
  return [trade.type, trade.event, strike].filter(Boolean).join(' ');
}

export type AnnualRocRow = {
  id: number;
  ticker: string;
  strategy: string;
  openDate: string;
  closeDate: string;
  days: number;
  capital: number;
  basis: CapitalBasis;
  pnl: number;
  roc: number | null;
  simpleAnnualized: number | null;
  compoundAnnualized: number | null;
  capitalYears: number;
};

export type AnnualRocSummary = {
  year: number;
  count: number;
  /** Σ realized P&L ÷ Σ(capital × days ÷ 365); null when no capital-years. */
  value: number | null;
  realizedPnl: number;
  capitalYears: number;
  totalCapital: number;
  rows: AnnualRocRow[];
};

export const compoundAnnualized = (roc: number, days: number) => 1 + roc <= 0 ? -1 : Math.pow(1 + roc, 365 / days) - 1;

/** Capital-weighted annualized ROC for trades closed in `year`, with the per-trade rows behind it. */
export function buildAnnualRocSummary(
  items: ReadonlyArray<{ trade: PerformanceTrade; pnl: number; days: number }>,
  year: number,
  usdJpyRate: number,
): AnnualRocSummary {
  const prefix = `${year}-`;
  const rows = items.flatMap<AnnualRocRow>(({ trade, pnl, days }) => {
    if (isCashTrade(trade) || !trade.closeDate?.startsWith(prefix) || !Number.isFinite(pnl) || !(days > 0)) return [];
    const { amount, basis } = capitalBase(trade);
    const capital = normalizedUsdAmount(trade, amount, usdJpyRate);
    const roc = capital > 0 ? pnl / capital : null;
    return [{
      id: trade.id,
      ticker: trade.ticker || '—',
      strategy: strategyLabel(trade),
      openDate: trade.openDate,
      closeDate: trade.closeDate,
      days,
      capital,
      basis,
      pnl,
      roc,
      simpleAnnualized: roc === null ? null : roc * 365 / days,
      compoundAnnualized: roc === null ? null : compoundAnnualized(roc, days),
      capitalYears: capital * days / 365,
    }];
  }).sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.openDate.localeCompare(b.openDate) || a.id - b.id);
  const realizedPnl = rows.reduce((sum, row) => sum + row.pnl, 0);
  const capitalYears = rows.reduce((sum, row) => sum + row.capitalYears, 0);
  return {
    year,
    count: rows.length,
    value: capitalYears > 0 ? realizedPnl / capitalYears : null,
    realizedPnl,
    capitalYears,
    totalCapital: rows.reduce((sum, row) => sum + row.capital, 0),
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* Range buckets (return chart and macro timeline)                     */
/* ------------------------------------------------------------------ */

export type RangeBucket = { key: string; label: string; start: string };

const monthLabelFormatter = new Intl.DateTimeFormat('zh-TW', { month: 'short', timeZone: 'UTC' });
const isDateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const toDayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);
const fromDayNumber = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);
const shortDateLabel = (day: number) => {
  const date = new Date(day * dayMs);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
};

/** Monday (UTC calendar) of the week containing `date`. */
export function mondayOf(date: string) {
  const day = toDayNumber(date);
  return fromDayNumber(day - (new Date(day * dayMs).getUTCDay() || 7) + 1);
}

export function bucketKeyForDate(date: string, mode: RangeMode) {
  if (mode === 'day') return date;
  if (mode === 'week') return mondayOf(date);
  if (mode === 'month') return date.slice(0, 7);
  return date.slice(0, 4);
}

/**
 * Chart buckets ending at `todayKey` (a local YYYY-MM-DD):
 * day = last 30 calendar days, week = 12 Mondays, month = 12 months, year = 5 years.
 */
export function rangeBuckets(mode: RangeMode, todayKey: string): RangeBucket[] {
  const today = toDayNumber(todayKey);
  const buckets: RangeBucket[] = [];
  if (mode === 'day') {
    // The last 60 weekdays (weekends carry no prices).
    for (let day = today; buckets.length < 60; day -= 1) {
      const weekdayOf = new Date(day * dayMs).getUTCDay();
      if (weekdayOf === 0 || weekdayOf === 6) continue;
      const key = fromDayNumber(day);
      buckets.unshift({ key, label: shortDateLabel(day), start: key });
    }
  } else if (mode === 'week') {
    const monday = toDayNumber(mondayOf(todayKey));
    for (let offset = 51; offset >= 0; offset -= 1) {
      const key = fromDayNumber(monday - offset * 7);
      buckets.push({ key, label: shortDateLabel(monday - offset * 7), start: key });
    }
  } else if (mode === 'month') {
    const now = new Date(today * dayMs);
    for (let offset = 35; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const key = date.toISOString().slice(0, 7);
      buckets.push({ key, label: monthLabelFormatter.format(date), start: `${key}-01` });
    }
  } else {
    const year = new Date(today * dayMs).getUTCFullYear();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const key = String(year - offset);
      buckets.push({ key, label: key, start: `${key}-01-01` });
    }
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/* Daily book: every position valued at each trading day's close      */
/* ------------------------------------------------------------------ */

/** [local exchange date, close, adjusted close] as returned by /api/price-history. */
export type PriceBar = [date: string, close: number, adjClose: number];
export type PriceHistorySeries = Record<string, PriceBar[]>;
/** A Yahoo split event: [first date at the new basis, numerator ÷ denominator]. Yahoo also books spin-offs this way. */
export type PriceSplitEvent = [date: string, ratio: number];
export type PriceSplits = Record<string, PriceSplitEvent[]>;

/**
 * T-bill ETFs held as cash. Their value is the reserve that secures short puts, so capital counts the
 * larger of the two instead of both.
 */
export const cashLikeTickers: ReadonlySet<string> = new Set(['BOXX', 'SGOV', 'BIL', 'SHV', 'USFR', 'TFLO']);
export const isCashLikeTicker = (ticker: string | null | undefined) => cashLikeTickers.has(String(ticker ?? '').trim().toUpperCase());

export type BookDay = {
  date: string;
  /** The day's profit and loss in USD, dividends included. */
  pnl: number;
  /** Capital at work: stocks at the prior close + purchases + long options + max(cash-like ETFs, put collateral). */
  capital: number;
  /** Time-weighted return of the day: pnl ÷ capital (0 without capital). */
  value: number;
  /** The part of pnl paid as dividends (from the adjusted close). */
  dividends: number;
  /** At the day's close, in USD: stocks (cash-like ETFs excluded), cash-like ETFs, and collateral of short puts and uncovered calls. */
  stockValue: number;
  cashValue: number;
  collateral: number;
};
export type DailyBook = {
  /** Trading days from the last close before the first trade (a zero baseline) to the end date. */
  days: BookDay[];
  /** Tickers valued without price history (moved in a straight line from entry to exit). */
  estimatedTickers: string[];
  /** Each trade's P&L (USD) over `pnlWindow`, keyed by trade id. */
  tradePnl: Record<number, number>;
};
export type DailyBookOptions = {
  endDate: string;
  usdJpyRate: number;
  prices?: PriceHistorySeries | null;
  splits?: PriceSplits | null;
  /** Dates (inclusive) whose P&L counts towards tradePnl; every day when omitted. */
  pnlWindow?: { start: string; end: string };
};

type ParsedBar = { day: number; close: number; adj: number };
type Track = { close: Float64Array; adj: Float64Array; barDay: Float64Array; barIndex: Int32Array };
type SplitStep = { day: number; ratio: number };

function parseBars(raw: unknown): ParsedBar[] {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map<number, ParsedBar>();
  for (const bar of raw) {
    if (!Array.isArray(bar) || !isDateKey(bar[0])) continue;
    const close = Number(bar[1]);
    const adj = Number(bar[2]);
    if (!(close > 0) || !Number.isFinite(close)) continue;
    const day = toDayNumber(bar[0]);
    byDay.set(day, { day, close, adj: adj > 0 && Number.isFinite(adj) ? adj : close });
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

function parseSplits(raw: unknown): SplitStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((event) => {
    if (!Array.isArray(event) || !isDateKey(event[0])) return [];
    const ratio = Number(event[1]);
    return ratio > 0 && Number.isFinite(ratio) && ratio !== 1 ? [{ day: toDayNumber(event[0]), ratio }] : [];
  }).sort((a, b) => a.day - b.day);
}

/** Product of the ratios of the splits dated after `day`: turns Yahoo's split-adjusted price on `day` into that day's traded price. */
const splitFactorAfter = (steps: SplitStep[], day: number) => steps.reduce((factor, step) => step.day > day ? factor * step.ratio : factor, 1);
/** A share split has a simple ratio (2:1, 3:2, 1:10 …); Yahoo books a spin-off as an odd one such as 1057:1000. */
const isShareSplit = (ratio: number) => {
  for (let denominator = 1; denominator <= 10; denominator += 1) {
    for (const value of [ratio * denominator, denominator / ratio]) {
      const whole = Math.round(value);
      if (whole >= 1 && whole <= 100 && Math.abs(value - whole) < 1e-6) return true;
    }
  }
  return false;
};

const optionRightOf = (event: string): 'call' | 'put' | null => {
  const text = String(event ?? '').trim().toUpperCase();
  if (text === 'P') return 'put';
  if (text === 'C') return 'call';
  const put = /\bPUTS?\b/.test(text);
  const call = /\bCALLS?\b/.test(text);
  return put === call ? null : put ? 'put' : 'call';
};
const strikeOf = (text: string | null) => {
  const value = Number(String(text ?? '').trim().replace(/^[$¥]\s*/, '').replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
};
/** The width of a spread written as "185/180" (0 for a single strike). */
const spreadWidth = (text: string | null) => {
  const match = /^\s*[$¥]?\s*(\d+(?:\.\d+)?)\s*\/\s*[$¥]?\s*(\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ''));
  return match ? Math.abs(Number(match[1]) - Number(match[2])) : 0;
};
const finiteOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
// Symbols that are not exchange-traded securities (USD/JPY, indexes) do not decide which days are trading days.
const isGridSymbol = (symbol: string) => !/[=^]/.test(symbol);

/**
 * Every position valued at each trading day's close, the method of the 六項指標 review:
 *
 * - Stocks: the daily close. Yahoo's split and spin-off scaling is undone so the price matches the
 *   lot's entry (a lot whose record follows a split keeps the adjusted basis). Dividends come from the
 *   adjusted close. The last day uses the exit (closed) or the live price (open); a lot bought and sold
 *   on one day books its P&L on that day.
 * - Options: intrinsic value from the underlying's close plus the time value paid at entry, decaying
 *   with √(days left ÷ days at entry); the last day uses the actual closing price (0 when it expired or
 *   was assigned). Without the underlying's history, expiry or strike they move in a straight line.
 * - Capital: stocks at the prior close + purchases + long options + max(cash-like ETFs + their purchases,
 *   collateral of short puts and uncovered calls). Covered calls add nothing: the shares are the cover.
 * - Days are the dates with a close in any price series (weekdays when there are none), from the last
 *   close before the first trade, so every series starts from a zero baseline.
 *
 * Amounts are USD; yen positions convert at each day's USD/JPY close (else `usdJpyRate`).
 */
export function buildDailyBook(trades: ReadonlyArray<PerformanceTrade>, options: DailyBookOptions): DailyBook {
  const empty: DailyBook = { days: [], estimatedTickers: [], tradePnl: {} };
  if (!isDateKey(options.endDate)) return empty;
  const endDay = toDayNumber(options.endDate);
  const positions = trades.filter((trade) => !trade.derived && !isCashTrade(trade) && isDateKey(trade.openDate)
    && toDayNumber(trade.openDate) <= endDay && (!trade.closeDate || isDateKey(trade.closeDate)));
  if (!positions.length) return empty;
  const prices = options.prices ?? null;
  const usdJpyRate = options.usdJpyRate;

  const barsCache = new Map<string, ParsedBar[]>();
  const barsFor = (symbol: string) => {
    if (!prices) return [];
    let bars = barsCache.get(symbol);
    if (!bars) { bars = parseBars(prices[symbol]); barsCache.set(symbol, bars); }
    return bars;
  };
  const splitCache = new Map<string, SplitStep[]>();
  const splitsFor = (symbol: string) => {
    let steps = splitCache.get(symbol);
    if (!steps) { steps = parseSplits(options.splits?.[symbol]); splitCache.set(symbol, steps); }
    return steps;
  };

  // Trading days, with the last close before the first trade as the baseline.
  const firstOpen = positions.reduce((earliest, trade) => Math.min(earliest, toDayNumber(trade.openDate)), Infinity);
  const tradingDays = new Set<number>();
  let baseline = -Infinity;
  if (prices) {
    for (const symbol of Object.keys(prices)) {
      if (!isGridSymbol(symbol)) continue;
      for (const bar of barsFor(symbol)) {
        if (bar.day > endDay) continue;
        if (bar.day >= firstOpen) tradingDays.add(bar.day);
        else if (bar.day > baseline) baseline = bar.day;
      }
    }
  }
  const isWeekday = (day: number) => { const weekday = new Date(day * dayMs).getUTCDay(); return weekday !== 0 && weekday !== 6; };
  if (!tradingDays.size) for (let day = firstOpen; day <= endDay; day += 1) if (isWeekday(day)) tradingDays.add(day);
  if (!tradingDays.size) tradingDays.add(firstOpen);
  if (!Number.isFinite(baseline)) { baseline = firstOpen - 1; while (!isWeekday(baseline)) baseline -= 1; }
  const days = [baseline, ...[...tradingDays].sort((a, b) => a - b)];
  const count = days.length;
  const last = count - 1;
  /** The first trading day on or after `day` (never the baseline); the last day when `day` is later. */
  const snap = (day: number) => {
    if (day >= days[last]) return last;
    let low = 1;
    let high = last;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (days[middle] >= day) high = middle;
      else low = middle + 1;
    }
    return low;
  };

  const trackCache = new Map<string, Track | null>();
  const trackFor = (symbol: string): Track | null => {
    if (trackCache.has(symbol)) return trackCache.get(symbol) ?? null;
    const bars = barsFor(symbol);
    let track: Track | null = null;
    if (bars.length) {
      track = { close: new Float64Array(count).fill(NaN), adj: new Float64Array(count).fill(NaN), barDay: new Float64Array(count).fill(NaN), barIndex: new Int32Array(count).fill(-1) };
      let cursor = -1;
      for (let index = 0; index < count; index += 1) {
        while (cursor + 1 < bars.length && bars[cursor + 1].day <= days[index]) cursor += 1;
        if (cursor < 0) continue;
        track.close[index] = bars[cursor].close;
        track.adj[index] = bars[cursor].adj;
        track.barDay[index] = bars[cursor].day;
        track.barIndex[index] = cursor;
      }
    }
    trackCache.set(symbol, track);
    return track;
  };
  const fxTrack = trackFor(usdJpySymbol);
  const fxAt = (index: number) => {
    const rate = fxTrack ? fxTrack.close[index] : NaN;
    return rate > 0 ? rate : usdJpyRate;
  };

  const pnl = new Float64Array(count);
  const dividends = new Float64Array(count);
  const stockValue = new Float64Array(count);
  const stockBuys = new Float64Array(count);
  const cashValue = new Float64Array(count);
  const cashBuys = new Float64Array(count);
  const optionValue = new Float64Array(count);
  const optionBuys = new Float64Array(count);
  const collateral = new Float64Array(count);
  const shares = new Map<string, Float64Array>();
  const shortCalls: Array<{ symbol: string; first: number; final: number; contracts: number; notional: number; usd: (native: number, index: number) => number }> = [];
  const estimated = new Set<string>();
  const tradePnl: Record<number, number> = {};
  const windowStart = options.pnlWindow && isDateKey(options.pnlWindow.start) ? toDayNumber(options.pnlWindow.start) : -Infinity;
  const windowEnd = options.pnlWindow && isDateKey(options.pnlWindow.end) ? toDayNumber(options.pnlWindow.end) : Infinity;
  const book = (id: number, index: number, amount: number) => {
    if (!Number.isFinite(amount)) return;
    pnl[index] += amount;
    if (days[index] >= windowStart && days[index] <= windowEnd) tradePnl[id] = (tradePnl[id] ?? 0) + amount;
  };

  type Life = { trade: PerformanceTrade; symbol: string; openDay: number; lastDay: number; first: number; final: number; closed: boolean };
  const lifeOf = (trade: PerformanceTrade): Life => {
    const openDay = toDayNumber(trade.openDate);
    const closed = Boolean(trade.closeDate);
    const lastDay = closed ? Math.max(openDay, toDayNumber(trade.closeDate as string)) : endDay;
    const first = snap(openDay);
    return { trade, symbol: priceSymbolFor(trade), openDay, lastDay, first, final: closed ? Math.max(first, snap(lastDay)) : last, closed };
  };
  const stocks = positions.filter((trade) => isStockTrade(trade)).map(lifeOf);
  const optionLives = positions.filter((trade) => !isStockTrade(trade)).map(lifeOf);

  for (const { trade, symbol, openDay, lastDay, first, final, closed } of stocks) {
    const quantity = Number(trade.quantity);
    const entry = Number(trade.entryPrice);
    const fees = Number(trade.fees) || 0;
    if (!Number.isFinite(quantity) || !Number.isFinite(entry)) continue;
    const yen = isYenTrade(trade) && usdJpyRate > 0;
    const usd = (native: number, index: number) => yen ? native / fxAt(index) : native;
    const track = trackFor(symbol);
    const steps = splitsFor(symbol);
    // Prices in the record's basis. Events after the lot are always undone. A spin-off inside the holding
    // leaves the share count alone, so the record is in traded prices around it. A share split inside it
    // may or may not have been carried into the record: whichever reading is nearer the entry price.
    const after = splitFactorAfter(steps, lastDay);
    const inside = steps.filter((step) => step.day > openDay && step.day <= lastDay);
    const spinOffs = inside.filter((step) => !isShareSplit(step.ratio));
    const shareSplits = inside.filter((step) => isShareSplit(step.ratio));
    let tradedSplits = false;
    if (track && shareSplits.length && entry > 0) {
      const close = track.close[first];
      const base = close * after * splitFactorAfter(spinOffs, days[first]);
      if (close > 0) tradedSplits = Math.abs(Math.log(entry / (base * splitFactorAfter(shareSplits, days[first])))) < Math.abs(Math.log(entry / base));
    }
    const factorAt = (index: number) => after * splitFactorAfter(spinOffs, days[index]) * (tradedSplits ? splitFactorAfter(shareSplits, days[index]) : 1);
    const marketAt = (index: number) => {
      if (!track) return null;
      const close = track.close[index];
      return close > 0 && track.barDay[index] >= openDay ? close * factorAt(index) : null;
    };
    let mark = finiteOrNull(trade.currentPrice);
    if (mark === null && !closed) mark = marketAt(last);
    if (mark === null) continue;
    if (!track) estimated.add(symbol || trade.ticker || '—');
    const exit = mark;
    const priceAt = (index: number) => {
      if (index >= final) return exit;
      if (!track) return final > first ? entry + (exit - entry) * (index - first) / (final - first) : exit;
      return marketAt(index) ?? entry;
    };
    const units = (isShortTrade(trade) ? -1 : 1) * quantity;
    const cashLike = isCashLikeTicker(trade.ticker);
    book(trade.id, first, usd(units * (priceAt(first) - entry), first) - usd(fees, first));
    for (let index = first + 1; index <= final; index += 1) {
      book(trade.id, index, usd(units * priceAt(index), index) - usd(units * priceAt(index - 1), index - 1));
      // Dividend implied by the adjusted close when a new bar arrives while the lot was held.
      if (!track) continue;
      const current = track.barIndex[index];
      const previous = track.barIndex[index - 1];
      if (current < 0 || previous < 0 || current === previous || track.barDay[index - 1] < openDay) continue;
      const priorClose = track.close[index - 1];
      const dividend = units * priorClose * (track.adj[index] / track.adj[index - 1] - track.close[index] / priorClose) * factorAt(index);
      if (Math.abs(dividend) > 1e-9) {
        const amount = usd(dividend, index);
        book(trade.id, index, amount);
        dividends[index] += amount;
      }
    }
    const values = cashLike ? cashValue : stockValue;
    (cashLike ? cashBuys : stockBuys)[first] += usd(Math.abs(quantity) * entry, first);
    const heldThrough = closed ? final - 1 : last;
    for (let index = first; index <= heldThrough; index += 1) values[index] += usd(Math.abs(quantity) * priceAt(index), index);
    // Shares on hand at some point of each day (a lot sold today still covered a call written today).
    let held = shares.get(symbol);
    if (!held) { held = new Float64Array(count); shares.set(symbol, held); }
    for (let index = first; index <= final; index += 1) held[index] += units;
  }

  for (const { trade, symbol, openDay, lastDay, first, final, closed } of optionLives) {
    const quantity = Math.abs(Number(trade.quantity));
    const entry = Number(trade.entryPrice);
    const fees = Number(trade.fees) || 0;
    if (!Number.isFinite(quantity) || !Number.isFinite(entry)) continue;
    const yen = isYenTrade(trade) && usdJpyRate > 0;
    const usd = (native: number, index: number) => yen ? native / fxAt(index) : native;
    const right = optionRightOf(trade.event);
    const strike = strikeOf(trade.strike);
    const expiryDay = isDateKey(trade.expiryDate) ? toDayNumber(trade.expiryDate) : NaN;
    const track = trackFor(symbol);
    const steps = splitsFor(symbol);
    const factor = splitFactorAfter(steps, lastDay);
    const modelled = Boolean(right && strike && Number.isFinite(expiryDay) && track && track.close[first] > 0
      && !steps.some((step) => step.day > openDay && step.day <= lastDay));
    const underlying = (index: number) => (track as Track).close[index] * factor;
    const intrinsic = (index: number) => right === 'call' ? Math.max(underlying(index) - (strike as number), 0) : Math.max((strike as number) - underlying(index), 0);
    const daysAtEntry = Math.max(expiryDay - days[first], 1);
    const timeValue = modelled ? Math.max(entry - intrinsic(first), 0) : 0;
    const modelAt = (index: number) => intrinsic(index) + timeValue * Math.sqrt(Math.max(expiryDay - days[index], 0) / daysAtEntry);
    let exit = finiteOrNull(trade.currentPrice);
    if (exit === null && !closed && modelled) exit = modelAt(last);
    if (exit === null) continue;
    if (!modelled && final > first) estimated.add(symbol || trade.ticker || '—');
    const close = exit;
    // An open option's price is typed in by hand and can be days old: rather than jump from the model to
    // it on the last day, the gap is spread over the holding, so the total still matches its P&L.
    const gap = !closed && modelled && final > first ? close - modelAt(final) : 0;
    const valueAt = (index: number) => {
      if (index >= final) return close;
      if (modelled) return modelAt(index) + gap * (index - first) / (final - first);
      return entry + (close - entry) * (index - first) / (final - first);
    };
    const direction = isShortTrade(trade) ? -1 : 1;
    const units = direction * quantity * 100;
    let previous = usd(units * entry, first);
    book(trade.id, first, -usd(fees, first));
    for (let index = first; index <= final; index += 1) {
      const current = usd(units * valueAt(index), index);
      book(trade.id, index, current - previous);
      previous = current;
    }
    if (direction < 0) {
      // Collateral: as entered; else a spread's width or the strike, × 100 × contracts; else the premium.
      const width = spreadWidth(trade.strike);
      const notional = trade.collateral > 0 ? trade.collateral : width > 0 ? width * quantity * 100 : strike ? strike * quantity * 100 : Math.abs(entry) * quantity * 100;
      // A single-strike call is first covered by shares on hand (shared out below); anything else needs collateral.
      if (right === 'call' && !width && !(trade.collateral > 0)) shortCalls.push({ symbol, first, final, contracts: quantity, notional, usd });
      else if (notional > 0) for (let index = first; index <= final; index += 1) collateral[index] += usd(notional, index);
    } else {
      optionBuys[first] += usd(quantity * 100 * entry, first);
      const heldThrough = closed ? final - 1 : last;
      for (let index = first; index <= heldThrough; index += 1) optionValue[index] += usd(quantity * 100 * valueAt(index), index);
    }
  }

  // Written calls are covered by the shares held that day, oldest call first; the uncovered part needs collateral.
  shortCalls.sort((a, b) => a.first - b.first);
  for (const symbol of new Set(shortCalls.map((call) => call.symbol))) {
    const calls = shortCalls.filter((call) => call.symbol === symbol);
    const held = shares.get(symbol);
    const from = Math.min(...calls.map((call) => call.first));
    const to = Math.max(...calls.map((call) => call.final));
    for (let index = from; index <= to; index += 1) {
      let available = Math.max(0, held?.[index] ?? 0);
      for (const call of calls) {
        if (index < call.first || index > call.final) continue;
        const covered = Math.min(call.contracts, available / 100);
        available -= covered * 100;
        const uncovered = call.contracts > 0 ? (call.contracts - covered) / call.contracts : 0;
        if (uncovered > 1e-9) collateral[index] += call.usd(call.notional * uncovered, index);
      }
    }
  }

  const bookDays: BookDay[] = days.map((day, index) => {
    const prior = index - 1;
    const capital = (prior >= 0 ? stockValue[prior] + optionValue[prior] : 0) + stockBuys[index] + optionBuys[index]
      + Math.max((prior >= 0 ? cashValue[prior] : 0) + cashBuys[index], collateral[index]);
    return {
      date: fromDayNumber(day),
      pnl: pnl[index],
      capital,
      value: capital > 0 ? pnl[index] / capital : 0,
      dividends: dividends[index],
      stockValue: stockValue[index],
      cashValue: cashValue[index],
      collateral: collateral[index],
    };
  });
  return { days: bookDays, estimatedTickers: [...estimated].sort(), tradePnl };
}

/* ------------------------------------------------------------------ */
/* Time-weighted portfolio returns                                    */
/* ------------------------------------------------------------------ */

export type DailyReturn = { date: string; pnl: number; capital: number; value: number };
export type TimeWeightedDaily = {
  days: DailyReturn[];
  /** Tickers that had no price history and were linearly interpolated. */
  estimatedTickers: string[];
  /** Each trade's P&L (USD), keyed by trade id: over the window, or over the whole book when one is passed in. */
  tradePnl: Record<number, number>;
};
export type TimeWeightedOptions = {
  startDate: string;
  endDate: string;
  usdJpyRate: number;
  prices?: PriceHistorySeries | null;
  splits?: PriceSplits | null;
  /** A book already built for these trades (saves building it again). */
  book?: DailyBook | null;
};

/**
 * Daily time-weighted returns for the trading days in [startDate, endDate], read from the daily book
 * (see buildDailyBook): r_t = the day's P&L ÷ the capital at work that day.
 */
export function dailyTimeWeightedReturns(trades: ReadonlyArray<PerformanceTrade>, options: TimeWeightedOptions): TimeWeightedDaily {
  const empty: TimeWeightedDaily = { days: [], estimatedTickers: [], tradePnl: {} };
  if (!isDateKey(options.startDate) || !isDateKey(options.endDate) || options.endDate < options.startDate) return empty;
  const book = options.book ?? buildDailyBook(trades, {
    endDate: options.endDate,
    usdJpyRate: options.usdJpyRate,
    prices: options.prices,
    splits: options.splits,
    pnlWindow: { start: options.startDate, end: options.endDate },
  });
  const days = book.days
    .filter((day) => day.date >= options.startDate && day.date <= options.endDate)
    .map(({ date, pnl, capital, value }) => ({ date, pnl, capital, value }));
  return { days, estimatedTickers: book.estimatedTickers, tradePnl: book.tradePnl };
}

export type ReturnBucket = { key: string; label: string; start: string; pnl: number; capital: number; value: number };

/**
 * Chain daily returns into buckets: value = Π(1 + r_t) − 1, pnl = Σ P&L_t,
 * capital = average capital deployed on days with capital at work.
 */
export function aggregateBuckets(days: ReadonlyArray<DailyReturn>, buckets: ReadonlyArray<RangeBucket>, mode: RangeMode): ReturnBucket[] {
  const totals = new Map(buckets.map((bucket) => [bucket.key, { growth: 1, pnl: 0, capital: 0, deployedDays: 0 }]));
  // Day buckets are weekdays only: a weekend day's P&L joins the next weekday's bucket.
  const dayKeys = mode === 'day' ? buckets.map((bucket) => bucket.key).sort() : [];
  const keyFor = (date: string) => {
    const key = bucketKeyForDate(date, mode);
    if (mode !== 'day' || totals.has(key)) return key;
    return dayKeys.find((candidate) => candidate > key) ?? key;
  };
  for (const day of days) {
    const total = totals.get(keyFor(day.date));
    if (!total) continue;
    total.growth *= 1 + day.value;
    total.pnl += day.pnl;
    if (day.capital > 0) {
      total.capital += day.capital;
      total.deployedDays += 1;
    }
  }
  return buckets.map((bucket) => {
    const total = totals.get(bucket.key) ?? { growth: 1, pnl: 0, capital: 0, deployedDays: 0 };
    return { key: bucket.key, label: bucket.label, start: bucket.start, pnl: total.pnl, capital: total.deployedDays ? total.capital / total.deployedDays : 0, value: total.growth - 1 };
  });
}

export type TimeWeightedSeries = {
  series: ReturnBucket[];
  /** Π(1 + r_t) − 1 over the whole window. */
  cumulative: number;
  estimatedTickers: string[];
};

export function timeWeightedReturnSeries(
  trades: ReadonlyArray<PerformanceTrade>,
  mode: RangeMode,
  options: {
    todayKey: string;
    usdJpyRate: number;
    prices?: PriceHistorySeries | null;
    splits?: PriceSplits | null;
    book?: DailyBook | null;
    /** Leave out days before this date (a tiny early book), even inside the first bucket. */
    from?: string | null;
  },
): TimeWeightedSeries {
  const buckets = rangeBuckets(mode, options.todayKey);
  const windowStart = buckets[0]?.start ?? options.todayKey;
  const daily = dailyTimeWeightedReturns(trades, {
    startDate: options.from && isDateKey(options.from) && options.from > windowStart ? options.from : windowStart,
    endDate: options.todayKey,
    usdJpyRate: options.usdJpyRate,
    prices: options.prices,
    splits: options.splits,
    book: options.book,
  });
  return {
    series: aggregateBuckets(daily.days, buckets, mode),
    cumulative: daily.days.reduce((growth, day) => growth * (1 + day.value), 1) - 1,
    estimatedTickers: daily.estimatedTickers,
  };
}

/** The benchmark the 六項指標 drawdown is compared with (total return, from the adjusted close). */
export const benchmarkSymbol = 'SPY';
/** Symbols per /api/price-history request: well inside the route's limit and its Yahoo request budget. */
export const priceHistoryBatchSize = 20;

/**
 * Symbols the daily book needs from /api/price-history — stock tickers, the underlyings of options,
 * USD/JPY when a yen trade exists, and SPY — with the first-of-month start date; null when nothing
 * needs prices. Fetch them in batches of priceHistoryBatchSize.
 */
export function priceHistoryRequest(trades: ReadonlyArray<PerformanceTrade>): { symbols: string[]; from: string } | null {
  const symbols = new Set<string>();
  let yen = false;
  let from = '';
  for (const trade of trades) {
    if (trade.derived || isCashTrade(trade) || !isDateKey(trade.openDate)) continue;
    // A week before the first trade, so the book's baseline day has a close.
    const lead = fromDayNumber(toDayNumber(trade.openDate) - 7);
    if (!from || lead < from) from = lead;
    // Any yen position (options too) is converted through the USD/JPY history.
    yen ||= isYenTrade(trade);
    const symbol = priceSymbolFor(trade);
    if (priceSymbolPattern.test(symbol)) symbols.add(symbol);
  }
  if (!from || (!symbols.size && !yen)) return null;
  symbols.delete(usdJpySymbol);
  symbols.delete(benchmarkSymbol);
  return { symbols: [...(yen ? [usdJpySymbol] : []), ...[...symbols].sort(), benchmarkSymbol], from: `${from.slice(0, 7)}-01` };
}
