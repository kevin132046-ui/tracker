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
    for (let offset = 29; offset >= 0; offset -= 1) {
      const key = fromDayNumber(today - offset);
      buckets.push({ key, label: shortDateLabel(today - offset), start: key });
    }
  } else if (mode === 'week') {
    const monday = toDayNumber(mondayOf(todayKey));
    for (let offset = 11; offset >= 0; offset -= 1) {
      const key = fromDayNumber(monday - offset * 7);
      buckets.push({ key, label: shortDateLabel(monday - offset * 7), start: key });
    }
  } else if (mode === 'month') {
    const now = new Date(today * dayMs);
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const key = date.toISOString().slice(0, 7);
      buckets.push({ key, label: monthLabelFormatter.format(date), start: `${key}-01` });
    }
  } else {
    const year = new Date(today * dayMs).getUTCFullYear();
    for (let offset = 4; offset >= 0; offset -= 1) {
      const key = String(year - offset);
      buckets.push({ key, label: key, start: `${key}-01-01` });
    }
  }
  return buckets;
}

/* ------------------------------------------------------------------ */
/* Time-weighted portfolio returns                                    */
/* ------------------------------------------------------------------ */

/** [local exchange date, close, adjusted close] as returned by /api/price-history. */
export type PriceBar = [date: string, close: number, adjClose: number];
export type PriceHistorySeries = Record<string, PriceBar[]>;

export type DailyReturn = { date: string; pnl: number; capital: number; value: number };
export type TimeWeightedDaily = {
  days: DailyReturn[];
  /** Stock tickers that had no price history and were linearly interpolated. */
  estimatedTickers: string[];
  /** Each trade's P&L summed over the window (USD), keyed by trade id. */
  tradePnl: Record<number, number>;
};
export type TimeWeightedOptions = {
  startDate: string;
  endDate: string;
  usdJpyRate: number;
  prices?: PriceHistorySeries | null;
};

type ParsedBar = { day: number; close: number; adj: number };
type BarHistory = { bars: ParsedBar[]; index: Int32Array };
type PositionModel = {
  id: number;
  openDay: number;
  lastDay: number;
  direction: number;
  multiplier: number;
  quantity: number;
  entry: number;
  exit: number;
  fees: number;
  baseNative: number;
  yen: boolean;
  history: BarHistory | null;
};

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

/** For each day in [firstDay, firstDay + length), the index of the last bar dated on or before it (or -1). */
function lastBarIndexByDay(bars: ParsedBar[], firstDay: number, length: number) {
  const indexes = new Int32Array(length);
  let cursor = -1;
  for (let offset = 0; offset < length; offset += 1) {
    const day = firstDay + offset;
    while (cursor + 1 < bars.length && bars[cursor + 1].day <= day) cursor += 1;
    indexes[offset] = cursor;
  }
  return indexes;
}

/**
 * Daily time-weighted returns over every calendar day in [startDate, endDate].
 *
 * Positions (non-cash, non-derived trades) contribute their capital base on the open day
 * and are valued V(t) = base − fees + s × multiplier × qty × (price(t) − entry), so the sum
 * of a trade's daily P&L over its life equals its realized/unrealized P&L. Stocks use the
 * forward-filled daily close (bars dated ≥ openDate, entry price before the first bar) and add
 * the dividend implied by the adjusted close; options, and stocks without history, move linearly
 * from entry to exit/current price. The final day uses the exit (closed) or live price (open).
 * r_t = Σ P&L_t ÷ Σ base_t, where base_t is V(t − 1) or the open-day contribution.
 */
export function dailyTimeWeightedReturns(trades: ReadonlyArray<PerformanceTrade>, options: TimeWeightedOptions): TimeWeightedDaily {
  const empty: TimeWeightedDaily = { days: [], estimatedTickers: [], tradePnl: {} };
  if (!isDateKey(options.startDate) || !isDateKey(options.endDate)) return empty;
  const startDay = toDayNumber(options.startDate);
  const endDay = toDayNumber(options.endDate);
  if (endDay < startDay) return empty;
  const prices = options.prices ?? null;
  const usdJpyRate = options.usdJpyRate;

  const candidates: Array<{ trade: PerformanceTrade; openDay: number; lastDay: number }> = [];
  for (const trade of trades) {
    if (trade.derived || isCashTrade(trade) || !isDateKey(trade.openDate)) continue;
    const lastDate = trade.closeDate ?? options.endDate;
    if (!isDateKey(lastDate)) continue;
    const openDay = toDayNumber(trade.openDate);
    const lastDay = Math.max(openDay, toDayNumber(lastDate));
    if (lastDay < startDay || openDay > endDay) continue;
    candidates.push({ trade, openDay, lastDay });
  }

  const firstDay = candidates.reduce((earliest, candidate) => Math.min(earliest, candidate.openDay), startDay - 1);
  const length = endDay - firstDay + 1;
  const historyCache = new Map<string, BarHistory | null>();
  const historyFor = (symbol: string) => {
    if (!prices) return null;
    if (!historyCache.has(symbol)) {
      const bars = parseBars(prices[symbol]);
      historyCache.set(symbol, bars.length ? { bars, index: lastBarIndexByDay(bars, firstDay, length) } : null);
    }
    return historyCache.get(symbol) ?? null;
  };
  const fxHistory = historyFor(usdJpySymbol);
  const fxAt = (offset: number) => {
    const index = fxHistory ? fxHistory.index[offset] : -1;
    return fxHistory && index >= 0 ? fxHistory.bars[index].close : usdJpyRate;
  };

  const estimated = new Set<string>();
  const models: PositionModel[] = [];
  for (const { trade, openDay, lastDay } of candidates) {
    const stock = isStockTrade(trade);
    const symbol = priceSymbolFor(trade);
    const history = stock ? historyFor(symbol) : null;
    const entry = Number(trade.entryPrice);
    const quantity = Number(trade.quantity);
    const fees = Number(trade.fees) || 0;
    if (!Number.isFinite(entry) || !Number.isFinite(quantity)) continue;
    let exit = typeof trade.currentPrice === 'number' && Number.isFinite(trade.currentPrice) ? trade.currentPrice : null;
    if (exit === null && history) {
      const index = history.index[Math.min(lastDay, endDay) - firstDay];
      if (index >= 0 && history.bars[index].day >= openDay) exit = history.bars[index].close;
    }
    if (exit === null) continue;
    if (stock && !history) estimated.add(symbol || trade.ticker || '—');
    models.push({
      id: trade.id,
      openDay,
      lastDay,
      direction: isShortTrade(trade) ? -1 : 1,
      multiplier: stock ? 1 : 100,
      quantity,
      entry,
      exit,
      fees,
      baseNative: capitalBase(trade).amount,
      yen: isYenTrade(trade) && usdJpyRate > 0,
      history,
    });
  }

  const priceAt = (model: PositionModel, offset: number) => {
    const day = firstDay + offset;
    if (day >= model.lastDay) return model.exit;
    if (model.history) {
      const index = model.history.index[offset];
      return index >= 0 && model.history.bars[index].day >= model.openDay ? model.history.bars[index].close : model.entry;
    }
    const span = model.lastDay - model.openDay;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (day - model.openDay) / span)) : 1;
    return model.entry + (model.exit - model.entry) * fraction;
  };
  const nativeValue = (model: PositionModel, offset: number) => model.baseNative
    + model.direction * model.multiplier * model.quantity * (priceAt(model, offset) - model.entry)
    - model.fees;
  const toUsd = (model: PositionModel, native: number, offset: number) => model.yen ? native / fxAt(offset) : native;
  // Dividend implied by the adjusted close between the bar held yesterday and a new bar today.
  const dividendNative = (model: PositionModel, offset: number) => {
    if (!model.history || offset < 1) return 0;
    const current = model.history.index[offset];
    const previous = model.history.index[offset - 1];
    if (current < 0 || previous < 0 || current === previous) return 0;
    const bar = model.history.bars[current];
    const prior = model.history.bars[previous];
    if (prior.day < model.openDay) return 0;
    return model.direction * model.multiplier * model.quantity * prior.close * (bar.adj / prior.adj - bar.close / prior.close);
  };

  const days: DailyReturn[] = [];
  const tradePnl: Record<number, number> = {};
  for (let day = startDay; day <= endDay; day += 1) {
    const offset = day - firstDay;
    let pnl = 0;
    let capital = 0;
    for (const model of models) {
      if (day < model.openDay || day > model.lastDay) continue;
      const value = toUsd(model, nativeValue(model, offset), offset);
      const base = day === model.openDay
        ? toUsd(model, model.baseNative, offset)
        : toUsd(model, nativeValue(model, offset - 1), offset - 1);
      const dividend = day === model.openDay ? 0 : toUsd(model, dividendNative(model, offset), offset);
      const dayPnl = value - base + dividend;
      capital += base;
      pnl += dayPnl;
      tradePnl[model.id] = (tradePnl[model.id] ?? 0) + dayPnl;
    }
    days.push({ date: fromDayNumber(day), pnl, capital, value: capital > 0 ? pnl / capital : 0 });
  }
  return { days, estimatedTickers: [...estimated].sort(), tradePnl };
}

export type ReturnBucket = { key: string; label: string; pnl: number; capital: number; value: number };

/**
 * Chain daily returns into buckets: value = Π(1 + r_t) − 1, pnl = Σ P&L_t,
 * capital = average capital deployed on days with capital at work.
 */
export function aggregateBuckets(days: ReadonlyArray<DailyReturn>, buckets: ReadonlyArray<RangeBucket>, mode: RangeMode): ReturnBucket[] {
  const totals = new Map(buckets.map((bucket) => [bucket.key, { growth: 1, pnl: 0, capital: 0, deployedDays: 0 }]));
  for (const day of days) {
    const total = totals.get(bucketKeyForDate(day.date, mode));
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
    return { key: bucket.key, label: bucket.label, pnl: total.pnl, capital: total.deployedDays ? total.capital / total.deployedDays : 0, value: total.growth - 1 };
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
  options: { todayKey: string; usdJpyRate: number; prices?: PriceHistorySeries | null },
): TimeWeightedSeries {
  const buckets = rangeBuckets(mode, options.todayKey);
  const daily = dailyTimeWeightedReturns(trades, {
    startDate: buckets[0]?.start ?? options.todayKey,
    endDate: options.todayKey,
    usdJpyRate: options.usdJpyRate,
    prices: options.prices,
  });
  return {
    series: aggregateBuckets(daily.days, buckets, mode),
    cumulative: daily.days.reduce((growth, day) => growth * (1 + day.value), 1) - 1,
    estimatedTickers: daily.estimatedTickers,
  };
}

/**
 * Symbols (stock tickers, plus USD/JPY when a yen trade exists) and the first-of-month start date
 * the time-weighted model needs from /api/price-history; null when nothing needs prices.
 */
export function priceHistoryRequest(trades: ReadonlyArray<PerformanceTrade>): { symbols: string[]; from: string } | null {
  const stockSymbols = new Set<string>();
  let yen = false;
  let from = '';
  for (const trade of trades) {
    if (trade.derived || isCashTrade(trade) || !isStockTrade(trade) || !isDateKey(trade.openDate)) continue;
    const symbol = priceSymbolFor(trade);
    if (!priceSymbolPattern.test(symbol)) continue;
    stockSymbols.add(symbol);
    yen ||= isYenTrade(trade);
    if (!from || trade.openDate < from) from = trade.openDate;
  }
  if (!stockSymbols.size || !from) return null;
  const symbols = [...(yen ? [usdJpySymbol] : []), ...[...stockSymbols].sort()].slice(0, maxPriceHistorySymbols);
  return { symbols, from: `${from.slice(0, 7)}-01` };
}
