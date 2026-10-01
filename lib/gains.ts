import type { PerformanceTrade } from '@/lib/performance';
import { isCashTrade, isStockTrade, normalizedUsdAmount, strategyLabel } from '@/lib/performance';

/**
 * 益損: realized and unrealized gains laid out the way a broker's gain/loss report reads, worked out
 * from the trades on the site. Every trade row is one lot.
 *
 * - Bought (stock, long options): proceeds = exit × quantity (× 100 for options);
 *   cost = entry × quantity + fees.
 * - Opened by selling (written options, short sales): proceeds = what the sale brought in less fees;
 *   cost = what closing it cost (0 when an option expired). Always short-term, as US rules treat
 *   written options.
 * - Held more than one year (sold after the first anniversary) → long-term, else short-term.
 * - 益損 = proceeds − cost + wash sale disallowed; 益損% = 益損 ÷ cost. Wash sales are not
 *   estimated here (the column stays 0; the broker's statement is the reference).
 * - Amounts in USD; yen trades at the current USD/JPY rate.
 * Open positions (未實現) use the market value instead of proceeds; a written option's value and
 * cost are negative (a liability and a credit), as brokers show them.
 */
export type GainTrade = PerformanceTrade & { status: 'open' | 'closed' };
export type GainTerm = 'short' | 'long';
export type GainLot = {
  id: number;
  ticker: string;
  label: string;
  quantity: number;
  opened: string;
  closed: string | null;
  term: GainTerm;
  /** Opened by selling (a written option or a short sale). */
  written: boolean;
  proceeds: number;
  cost: number;
  wash: number;
  gain: number;
};
export type GainTotals = { proceeds: number; cost: number; wash: number; gain: number; pct: number | null; count: number };
export type GainTicker = GainTotals & { ticker: string; lots: GainLot[] };
export type GainCategory = GainTotals & { term: GainTerm; tickers: GainTicker[] };
export type GainReport = { kind: 'realized' | 'unrealized'; short: GainCategory; long: GainCategory; total: GainTotals; skipped: number };

const dateKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Held more than one year: sold after the first anniversary of the purchase (29 Feb → 28 Feb). */
export function isLongTerm(opened: string, closed: string) {
  const [year, month, day] = opened.split('-');
  const anniversary = `${Number(year) + 1}-${month}-${month === '02' && day === '29' ? '28' : day}`;
  return closed > anniversary;
}

const multiplierOf = (trade: GainTrade) => isStockTrade(trade) ? 1 : 100;
// Opened by selling, as the site's P&L reads it (direction −1): written options, or a short sale.
const writtenOf = (trade: GainTrade) => trade.type.toLowerCase() === 'sell';
// Positions only: cash, dividends and the rows the site derives from them are not gains.
const positionOf = (trade: GainTrade) => !trade.derived && !isCashTrade(trade);

function lot(trade: GainTrade, value: number, cost: number, term: GainTerm, closed: string | null): GainLot {
  return {
    id: trade.id,
    ticker: (trade.ticker || 'OTHER').toUpperCase(),
    label: strategyLabel(trade),
    quantity: Math.abs(trade.quantity),
    opened: trade.openDate,
    closed,
    term,
    written: writtenOf(trade),
    proceeds: value,
    cost,
    wash: 0,
    gain: value - cost,
  };
}

/** Lots closed in the given calendar year. */
export function realizedLots(trades: GainTrade[], year: number, usdJpyRate: number) {
  const lots: GainLot[] = [];
  let skipped = 0;
  for (const trade of trades) {
    if (trade.status !== 'closed' || !positionOf(trade)) continue;
    // A closed trade without a close date or price cannot be placed or valued.
    if (!dateKey(trade.closeDate) || !dateKey(trade.openDate)) { skipped += 1; continue; }
    if (!trade.closeDate.startsWith(`${year}-`)) continue;
    if (trade.currentPrice === null || !Number.isFinite(trade.currentPrice)) { skipped += 1; continue; }
    const usd = (value: number) => normalizedUsdAmount(trade, value, usdJpyRate);
    const size = Math.abs(trade.quantity) * multiplierOf(trade);
    const written = writtenOf(trade);
    const proceeds = usd(written ? trade.entryPrice * size - trade.fees : trade.currentPrice * size);
    const cost = usd(written ? trade.currentPrice * size : trade.entryPrice * size + trade.fees);
    const term: GainTerm = written ? 'short' : isLongTerm(trade.openDate, trade.closeDate) ? 'long' : 'short';
    lots.push(lot(trade, proceeds, cost, term, trade.closeDate));
  }
  return { lots, skipped };
}

/** Open positions valued at their current price. */
export function unrealizedLots(trades: GainTrade[], today: string, usdJpyRate: number) {
  const lots: GainLot[] = [];
  let skipped = 0;
  for (const trade of trades) {
    if (trade.status !== 'open' || !positionOf(trade)) continue;
    if (!dateKey(trade.openDate) || trade.currentPrice === null || !Number.isFinite(trade.currentPrice)) { skipped += 1; continue; }
    const usd = (value: number) => normalizedUsdAmount(trade, value, usdJpyRate);
    const size = Math.abs(trade.quantity) * multiplierOf(trade);
    const written = writtenOf(trade);
    const value = usd(written ? -trade.currentPrice * size : trade.currentPrice * size);
    const cost = usd(written ? -(trade.entryPrice * size - trade.fees) : trade.entryPrice * size + trade.fees);
    const term: GainTerm = written ? 'short' : isLongTerm(trade.openDate, today) ? 'long' : 'short';
    lots.push(lot(trade, value, cost, term, null));
  }
  return { lots, skipped };
}

const sum = (lots: GainLot[], pick: (lot: GainLot) => number) => lots.reduce((total, item) => total + pick(item), 0);
/** Totals of a set of lots; 益損% over the size of the costs (open written options carry negative costs). */
export function totalsOf(lots: GainLot[]): GainTotals {
  const gain = sum(lots, (item) => item.gain);
  const base = sum(lots, (item) => Math.abs(item.cost));
  return { proceeds: sum(lots, (item) => item.proceeds), cost: sum(lots, (item) => item.cost), wash: sum(lots, (item) => item.wash), gain, pct: base > 0 ? gain / base : null, count: lots.length };
}

function categoryOf(term: GainTerm, lots: GainLot[]): GainCategory {
  const byTicker = new Map<string, GainLot[]>();
  for (const item of lots) byTicker.set(item.ticker, [...(byTicker.get(item.ticker) ?? []), item]);
  const tickers = [...byTicker.entries()]
    .map(([ticker, items]) => ({ ticker, ...totalsOf(items), lots: items.sort((a, b) => (a.closed ?? a.opened).localeCompare(b.closed ?? b.opened) || a.id - b.id) }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { term, ...totalsOf(lots), tickers };
}

export function gainReport(kind: GainReport['kind'], lots: GainLot[], skipped: number): GainReport {
  return {
    kind,
    short: categoryOf('short', lots.filter((item) => item.term === 'short')),
    long: categoryOf('long', lots.filter((item) => item.term === 'long')),
    total: totalsOf(lots),
    skipped,
  };
}

const csvCell = (value: string | number) => {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const pctCell = (value: number | null) => value === null ? '' : `${(value * 100).toFixed(2)}%`;

/** The report as CSV (one row per lot, then the subtotals), with a BOM so Excel reads the Chinese. */
export function gainCsv(report: GainReport) {
  const open = report.kind === 'unrealized';
  const rows: Array<Array<string | number>> = [[
    '類別', '代號', '內容', '數量', '開倉日', open ? '狀態' : '平倉日', open ? '市值' : '銷售所得', open ? '成本' : '調整成本', 'WS 損失不允', '益損', '益損%',
  ]];
  for (const category of [report.short, report.long]) {
    const name = category.term === 'short' ? '短期' : '長期';
    for (const ticker of category.tickers) {
      for (const item of ticker.lots) rows.push([name, item.ticker, item.label, String(item.quantity), item.opened, item.closed ?? '持有中', item.proceeds, item.cost, item.wash, item.gain, pctCell(Math.abs(item.cost) > 0 ? item.gain / Math.abs(item.cost) : null)]);
    }
    rows.push([`${name}${open ? '未實現' : '已實現'}益損總值`, '', '', '', '', '', category.proceeds, category.cost, category.wash, category.gain, pctCell(category.pct)]);
  }
  rows.push(['總計', '', '', '', '', '', report.total.proceeds, report.total.cost, report.total.wash, report.total.gain, pctCell(report.total.pct)]);
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
