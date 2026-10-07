import type { CsvTrade } from '@/lib/trade-csv';

/**
 * Field-by-field comparison of two versions of a trade, for the import and cleanup previews
 * ("平倉日 — → 2026-04-21"). Values are formatted for display; only fields that differ are listed.
 */
export type FieldDiff = { field: string; label: string; before: string; after: string };

const typeLabels: Record<string, string> = { SELL: '賣方', BUY: '買方', SDI: '股票', CASH: '現金', ASS: '指派' };
const number = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? '—' : String(Number(value.toFixed(6)));

const fields: ReadonlyArray<[keyof CsvTrade, string, (trade: CsvTrade) => string]> = [
  ['type', '類型', (trade) => typeLabels[trade.type.toUpperCase()] ?? trade.type],
  ['event', '策略', (trade) => trade.event],
  ['strike', '履約價', (trade) => trade.strike ?? '—'],
  ['expiryDate', '到期日', (trade) => trade.expiryDate ?? '—'],
  ['quantity', '數量', (trade) => number(trade.quantity)],
  ['entryPrice', '成交價', (trade) => number(trade.entryPrice)],
  ['openDate', '開倉日', (trade) => trade.openDate || '—'],
  ['status', '狀態', (trade) => trade.status === 'closed' ? '已平倉' : '未平倉'],
  ['closeDate', '平倉日', (trade) => trade.closeDate ?? '—'],
  ['currentPrice', '平倉／目前價', (trade) => number(trade.currentPrice)],
  ['fees', '手續費', (trade) => number(trade.fees)],
  ['collateral', '擔保金', (trade) => number(trade.collateral)],
];

export function diffTrades(before: CsvTrade | null, after: CsvTrade | null): FieldDiff[] {
  if (!before && !after) return [];
  return fields.flatMap(([field, label, format]) => {
    const was = before ? format(before) : '—';
    const now = after ? format(after) : '—';
    return was === now ? [] : [{ field: String(field), label, before: was, after: now }];
  });
}

/** "PG 賣方 PUT 135 · 到期 2026-07-17" (or without the side) or "BOXX 股票". */
export function contractLabel(trade: Pick<CsvTrade, 'ticker' | 'type' | 'event' | 'strike' | 'expiryDate'>, withSide = true) {
  const type = trade.type.toUpperCase();
  if (type === 'CASH') return `${trade.ticker ?? 'USD'} 現金`;
  if (type === 'SDI' || trade.event.toUpperCase() === 'STOCK') return `${trade.ticker ?? '—'} 股票`;
  return `${trade.ticker ?? '—'} ${withSide ? `${typeLabels[type] ?? trade.type} ` : ''}${trade.event}${trade.strike ? ` ${trade.strike}` : ''}${trade.expiryDate ? ` · 到期 ${trade.expiryDate}` : ''}`;
}
