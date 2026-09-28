/**
 * CSV export of trades: the app's own columns, UTF-8 with BOM. Pure: no React, no network.
 */

import { isYenTicker } from '@/lib/performance';

export type CsvTrade = {
  id: number;
  type: string;
  openDate: string;
  expiryDate: string | null;
  closeDate: string | null;
  ticker: string | null;
  event: string;
  strike: string | null;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  fees: number;
  collateral: number;
  notes: string;
  status: 'open' | 'closed';
  quoteMode: 'auto' | 'manual';
  market?: 'US' | 'JP';
  derived?: boolean;
};

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export const tradeCsvColumns = ['id', 'type', 'event', 'ticker', 'market', 'strike', 'quantity', 'entryPrice', 'currentPrice', 'fees', 'collateral', 'openDate', 'expiryDate', 'closeDate', 'status', 'quoteMode', 'notes'] as const;

const marketOf = (trade: Pick<CsvTrade, 'market' | 'ticker'>): 'US' | 'JP' => trade.market ?? (isYenTicker(trade.ticker) ? 'JP' : 'US');

const csvField = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",;\t\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** UTF-8 CSV (with BOM, CRLF line endings) of every non-derived trade. */
export function tradesToCsv(trades: readonly CsvTrade[]) {
  const rows = trades.filter((trade) => !trade.derived).map((trade) => tradeCsvColumns.map((column) => csvField(column === 'market' ? marketOf(trade) : trade[column])).join(','));
  return `﻿${[tradeCsvColumns.join(','), ...rows].join('\r\n')}\r\n`;
}
