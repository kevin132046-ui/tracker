/**
 * 六項指標: the six figures of the account review — 平均獲利, 平均虧損, 兩平勝率, 大賺比例, 淨值 and
 * 回撤水位 — worked out from the trades and the daily book (lib/performance.ts buildDailyBook).
 *
 * Pure: no React and no server imports, so it runs in the browser, during SSR or in a test.
 */
import type { DailyBook, PerformanceTrade, PriceBar } from '@/lib/performance';
import { isCashLikeTicker, isCashTrade, isShortTrade, isStockTrade, normalizedUsdAmount } from '@/lib/performance';

/** A trade row as the statistics read it: the performance fields plus its status. */
export type StatTrade = PerformanceTrade & { status?: string };

/** 大賺: a stock lot that returned at least 20%, an option trade that made at least $100. */
export const bigStockReturn = 0.2;
export const bigOptionProfit = 100;
/** 打平: a stock lot within ±0.5%, an option trade within ±$2. */
export const scratchStockReturn = 0.005;
export const scratchOptionProfit = 2;
/** The % drawdown starts once capital at work first reaches this share of its peak (a tiny early book would blow the percentages up). */
export const twrStartShare = 0.1;

export type TradeKind = 'stock' | 'option';

/** One closed trade: P&L in USD, return on cost (stocks with a cost only) and days held. */
export type ClosedTrade = { id: number; pnl: number; ret: number | null; days: number; closeDate: string };

export type TradeStats = {
  count: number;
  wins: number;
  losses: number;
  /** Winning trades ÷ all trades (trades that broke exactly even count in neither). */
  winRate: number | null;
  /** Mean P&L of winning and of losing trades (USD; the loss is negative). */
  avgWin: number | null;
  avgLoss: number | null;
  /** Mean return of winning and of losing stock lots (lots without a cost, such as spin-off shares, are left out). */
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** avgWin ÷ |avgLoss|. */
  payoff: number | null;
  /** The win rate at which the average win and the average loss cancel: |avgLoss| ÷ (avgWin + |avgLoss|). */
  breakEven: number | null;
  /** winRate − breakEven. */
  margin: number | null;
  /** Mean P&L per trade. */
  expectancy: number | null;
  /** Gross profit ÷ |gross loss|. */
  profitFactor: number | null;
  total: number;
  grossWin: number;
  grossLoss: number;
  /** 大賺: count, share of trades and share of gross profit. */
  big: number;
  bigShare: number | null;
  bigProfitShare: number | null;
  scratch: number;
  largestWin: number | null;
  largestLoss: number | null;
  /** Median days held by winning and by losing trades. */
  medianDaysWin: number | null;
  medianDaysLoss: number | null;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: unknown): value is string => typeof value === 'string' && datePattern.test(value);
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const isClosed = (trade: StatTrade) => (trade.status ? trade.status === 'closed' : Boolean(trade.closeDate)) && isDate(trade.closeDate);

/**
 * Closed trades of one kind, closed within [from, to] when given.
 * - stock: every closed stock lot (one row per FIFO lot), cash-like ETFs such as BOXX left out;
 *   P&L = (exit − entry) × shares − fees, return = P&L ÷ (entry × shares + fees).
 * - option: every closed option trade (open and close in one row, short or long);
 *   P&L = (exit − entry) × 100 × contracts − fees, sign flipped for written options.
 */
export function closedTrades(trades: ReadonlyArray<StatTrade>, kind: TradeKind, usdJpyRate: number, from?: string | null, to?: string | null): ClosedTrade[] {
  const rows: ClosedTrade[] = [];
  for (const trade of trades) {
    if (trade.derived || isCashTrade(trade) || !isClosed(trade) || !isDate(trade.openDate)) continue;
    const stock = isStockTrade(trade);
    if (kind === 'stock' ? !stock || isCashLikeTicker(trade.ticker) : stock) continue;
    const closeDate = trade.closeDate as string;
    if ((from && closeDate < from) || (to && closeDate > to)) continue;
    const exit = trade.currentPrice;
    const quantity = Math.abs(Number(trade.quantity));
    const entry = Number(trade.entryPrice);
    const fees = Number(trade.fees) || 0;
    if (typeof exit !== 'number' || !Number.isFinite(exit) || !Number.isFinite(quantity) || !Number.isFinite(entry)) continue;
    const size = quantity * (stock ? 1 : 100);
    const direction = isShortTrade(trade) ? -1 : 1;
    const pnl = normalizedUsdAmount(trade, direction * size * (exit - entry) - fees, usdJpyRate);
    const cost = normalizedUsdAmount(trade, size * entry + fees, usdJpyRate);
    rows.push({
      id: trade.id,
      pnl,
      ret: stock && cost > 0 ? pnl / cost : null,
      days: Math.max(0, dayNumber(closeDate) - dayNumber(trade.openDate)),
      closeDate,
    });
  }
  return rows;
}

/** The six-metric statistics of a set of closed trades. */
export function tradeStats(rows: ReadonlyArray<ClosedTrade>, kind: TradeKind): TradeStats {
  const wins = rows.filter((row) => row.pnl > 0);
  const losses = rows.filter((row) => row.pnl < 0);
  const grossWin = wins.reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = losses.reduce((sum, row) => sum + row.pnl, 0);
  const avgWin = mean(wins.map((row) => row.pnl));
  const avgLoss = mean(losses.map((row) => row.pnl));
  const returns = (items: ClosedTrade[]) => items.flatMap((row) => row.ret === null ? [] : [row.ret]);
  const isBig = (row: ClosedTrade) => kind === 'stock' ? row.ret !== null && row.ret >= bigStockReturn : row.pnl >= bigOptionProfit;
  const isScratch = (row: ClosedTrade) => kind === 'stock' ? row.ret !== null && Math.abs(row.ret) < scratchStockReturn : Math.abs(row.pnl) <= scratchOptionProfit;
  const big = rows.filter(isBig);
  const count = rows.length;
  const winRate = count ? wins.length / count : null;
  // No losing trade: any win rate breaks even. No winning trade: none does.
  const breakEven = avgWin !== null && avgLoss !== null ? -avgLoss / (avgWin - avgLoss) : count && avgLoss === null ? 0 : count ? 1 : null;
  return {
    count,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    avgWinPct: kind === 'stock' ? mean(returns(wins)) : null,
    avgLossPct: kind === 'stock' ? mean(returns(losses)) : null,
    payoff: avgWin !== null && avgLoss !== null ? avgWin / -avgLoss : null,
    breakEven,
    margin: winRate !== null && breakEven !== null ? winRate - breakEven : null,
    expectancy: mean(rows.map((row) => row.pnl)),
    profitFactor: grossLoss < 0 ? grossWin / -grossLoss : null,
    total: grossWin + grossLoss,
    grossWin,
    grossLoss,
    big: big.length,
    bigShare: count ? big.length / count : null,
    bigProfitShare: grossWin > 0 ? big.reduce((sum, row) => sum + row.pnl, 0) / grossWin : null,
    scratch: rows.filter(isScratch).length,
    largestWin: count ? Math.max(...rows.map((row) => row.pnl)) : null,
    largestLoss: count ? Math.min(...rows.map((row) => row.pnl)) : null,
    medianDaysWin: median(wins.map((row) => row.days)),
    medianDaysLoss: median(losses.map((row) => row.days)),
  };
}

/* ------------------------------------------------------------------ */
/* 淨值 and 回撤水位                                                     */
/* ------------------------------------------------------------------ */

export type CurveWindow = 'all' | 'year' | 'ytd';

/** First date of a window ending today: everything, the last 12 months, or this calendar year. */
export function windowStart(window: CurveWindow, todayKey: string): string | null {
  if (window === 'all' || !isDate(todayKey)) return null;
  if (window === 'ytd') return `${todayKey.slice(0, 4)}-01-01`;
  const year = Number(todayKey.slice(0, 4)) - 1;
  const date = `${year}${todayKey.slice(4)}`;
  // 29 Feb a year ago does not exist: use 1 Mar.
  return isDate(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? date : `${year}-03-01`;
}

export type CurvePoint = {
  date: string;
  /** The day's P&L and the running total from the window's start (USD). */
  pnl: number;
  cum: number;
  /** cum − its highest value so far (≤ 0). */
  ddUsd: number;
  /** Time-weighted growth of $1 from twrStart, and its drawdown from the running peak; null before twrStart. */
  nav: number | null;
  dd: number | null;
  /** SPY (total return) on the same basis. */
  spy: number | null;
  spyDd: number | null;
  capital: number;
};

export type Drawdown = {
  /** Depth: a fraction for growth series, USD for the P&L series (negative). */
  depth: number;
  peak: string;
  trough: string;
  /** First date back at the peak, null while still below it. */
  recovered: string | null;
};

export type EquityCurve = {
  points: CurvePoint[];
  /** The baseline date (the last close before the window) and the dates the % series covers from. */
  start: string;
  twrStart: string | null;
  /** When capital at work first reached twrStartShare of its peak. */
  autoStart: string | null;
  usd: { max: Drawdown | null; current: number; total: number; high: number };
  nav: { max: Drawdown | null; current: number; total: number } | null;
  spy: { max: Drawdown | null; current: number; total: number } | null;
};

/** The first day capital at work reached `share` of its peak: where the % series start (null without capital). */
export function capitalStartDate(book: DailyBook, share = twrStartShare): string | null {
  const peak = book.days.reduce((high, day) => Math.max(high, day.capital), 0);
  if (!(peak > 0)) return null;
  return book.days.find((day) => day.capital >= peak * share)?.date ?? null;
}

/** The deepest fall of `values` below a running peak: ratio (value ÷ peak − 1) or difference (value − peak). */
export function maxDrawdown(dates: ReadonlyArray<string>, values: ReadonlyArray<number>, mode: 'ratio' | 'difference'): Drawdown | null {
  let peakIndex = 0;
  let worst = 0;
  let worstPeak = -1;
  let worstTrough = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > values[peakIndex]) peakIndex = index;
    const depth = mode === 'ratio' ? (values[peakIndex] > 0 ? values[index] / values[peakIndex] - 1 : 0) : values[index] - values[peakIndex];
    if (depth < worst) { worst = depth; worstPeak = peakIndex; worstTrough = index; }
  }
  if (worstTrough < 0) return null;
  let recovered: string | null = null;
  for (let index = worstTrough + 1; index < values.length; index += 1) {
    if (values[index] >= values[worstPeak]) { recovered = dates[index]; break; }
  }
  return { depth: worst, peak: dates[worstPeak], trough: dates[worstTrough], recovered };
}

/**
 * The 淨值 curve (cumulative P&L) and the 回撤 curve over a window:
 * - $: cumulative P&L from the window's start; drawdown = cum − running high.
 * - %: time-weighted growth Π(1 + r_t) from the later of the window's start and the day capital first
 *   reached twrStartShare of its peak, so a tiny early book does not blow the percentages up;
 *   drawdown = growth ÷ running peak − 1. SPY (adjusted close, dividends reinvested) on the same dates.
 */
export function equityCurve(book: DailyBook, spyBars: ReadonlyArray<PriceBar> | null | undefined, window: CurveWindow, todayKey: string, startShare = twrStartShare): EquityCurve | null {
  const days = book.days;
  if (!days.length) return null;
  const from = windowStart(window, todayKey);
  // Baseline: the last day before the window (or the book's own zero baseline).
  let base = 0;
  if (from) {
    for (let index = 0; index < days.length; index += 1) {
      if (days[index].date < from) base = index;
      else break;
    }
  }
  const autoDate = capitalStartDate(book, startShare);
  const autoIndex = autoDate ? days.findIndex((day) => day.date === autoDate) : -1;
  const twrBase = autoIndex < 0 ? -1 : Math.max(base, autoIndex - 1);

  // SPY's adjusted close on each book day (carried forward over days it did not trade).
  const spyClose: Array<number | null> = days.map(() => null);
  if (spyBars?.length) {
    const bars = [...spyBars].filter((bar) => Array.isArray(bar) && isDate(bar[0]) && Number(bar[2] || bar[1]) > 0).sort((a, b) => a[0].localeCompare(b[0]));
    let cursor = -1;
    days.forEach((day, index) => {
      while (cursor + 1 < bars.length && bars[cursor + 1][0] <= day.date) cursor += 1;
      if (cursor >= 0) spyClose[index] = Number(bars[cursor][2] || bars[cursor][1]);
    });
  }
  // SPY grows from its first close on or after the % series' start (a book whose first day is also the
  // first day of the price data has no close before it).
  let spyBaseIndex = -1;
  if (twrBase >= 0) for (let index = twrBase; index < days.length; index += 1) if (spyClose[index]) { spyBaseIndex = index; break; }
  const spyBase = spyBaseIndex >= 0 ? spyClose[spyBaseIndex] : null;

  const points: CurvePoint[] = [];
  let cum = 0;
  let high = 0;
  let nav = 1;
  let navPeak = 1;
  let spyPeak = 1;
  for (let index = base; index < days.length; index += 1) {
    const day = days[index];
    const pnl = index === base ? 0 : day.pnl;
    cum += pnl;
    high = Math.max(high, cum);
    let navValue: number | null = null;
    let dd: number | null = null;
    let spy: number | null = null;
    let spyDd: number | null = null;
    if (twrBase >= 0 && index >= twrBase) {
      if (index > twrBase) nav *= 1 + day.value;
      navPeak = Math.max(navPeak, nav);
      navValue = nav;
      dd = nav / navPeak - 1;
      const close = spyClose[index];
      if (spyBase && close && index >= spyBaseIndex) {
        spy = close / spyBase;
        spyPeak = Math.max(spyPeak, spy);
        spyDd = spy / spyPeak - 1;
      }
    }
    points.push({ date: day.date, pnl, cum, ddUsd: cum - high, nav: navValue, dd, spy, spyDd, capital: day.capital });
  }

  const dates = points.map((point) => point.date);
  const growth = points.flatMap((point) => point.nav === null ? [] : [point]);
  const spyPoints = growth.filter((point) => point.spy !== null);
  const lastPoint = points[points.length - 1];
  return {
    points,
    start: points[0].date,
    twrStart: twrBase >= 0 ? days[twrBase].date : null,
    autoStart: autoIndex >= 0 ? days[autoIndex].date : null,
    usd: { max: maxDrawdown(dates, points.map((point) => point.cum), 'difference'), current: lastPoint.ddUsd, total: lastPoint.cum, high },
    nav: growth.length ? {
      max: maxDrawdown(growth.map((point) => point.date), growth.map((point) => point.nav as number), 'ratio'),
      current: growth[growth.length - 1].dd ?? 0,
      total: (growth[growth.length - 1].nav as number) - 1,
    } : null,
    spy: spyPoints.length > 1 ? {
      max: maxDrawdown(spyPoints.map((point) => point.date), spyPoints.map((point) => point.spy as number), 'ratio'),
      current: spyPoints[spyPoints.length - 1].spyDd ?? 0,
      total: (spyPoints[spyPoints.length - 1].spy as number) - 1,
    } : null,
  };
}

export type NetEquity = {
  /** Open stock lots at their current price: stocks, and cash-like ETFs such as BOXX. */
  marketValue: number;
  stockValue: number;
  cashLikeValue: number;
  /** Open options at their current price: long positive, written negative. */
  optionValue: number;
  /** P&L since the first trade (the daily book's total), and the dividends within it. */
  cumulativePnl: number;
  dividends: number;
  /** From 存提款紀錄: deposits − withdrawals, and that plus the cumulative P&L; null without records. */
  netDeposits: number | null;
  estimatedEquity: number | null;
};

/** 淨值: what is held now, what has been made, and — with 存提款紀錄 — an estimate of the account's equity. */
export function netEquity(
  trades: ReadonlyArray<StatTrade>,
  book: DailyBook | null,
  flows: ReadonlyArray<{ kind: 'deposit' | 'withdrawal'; amount: number; currency: 'USD' | 'JPY' }> | null,
  usdJpyRate: number,
): NetEquity {
  let stockValue = 0;
  let cashLikeValue = 0;
  let optionValue = 0;
  for (const trade of trades) {
    if (trade.derived || isCashTrade(trade) || (trade.status ? trade.status !== 'open' : Boolean(trade.closeDate))) continue;
    const price = trade.currentPrice;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    const quantity = Number(trade.quantity) || 0;
    const direction = isShortTrade(trade) ? -1 : 1;
    if (isStockTrade(trade)) {
      const value = normalizedUsdAmount(trade, direction * quantity * price, usdJpyRate);
      if (isCashLikeTicker(trade.ticker)) cashLikeValue += value;
      else stockValue += value;
    } else {
      optionValue += normalizedUsdAmount(trade, direction * Math.abs(quantity) * 100 * price, usdJpyRate);
    }
  }
  const cumulativePnl = book ? book.days.reduce((sum, day) => sum + day.pnl, 0) : 0;
  const dividends = book ? book.days.reduce((sum, day) => sum + day.dividends, 0) : 0;
  const rate = usdJpyRate > 0 ? usdJpyRate : 150;
  const netDeposits = flows && flows.length
    ? flows.reduce((sum, flow) => sum + (flow.kind === 'deposit' ? 1 : -1) * (flow.currency === 'JPY' ? flow.amount / rate : flow.amount), 0)
    : null;
  return {
    marketValue: stockValue + cashLikeValue,
    stockValue,
    cashLikeValue,
    optionValue,
    cumulativePnl,
    dividends,
    netDeposits,
    estimatedEquity: netDeposits === null ? null : netDeposits + cumulativePnl,
  };
}
