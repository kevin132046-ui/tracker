import type { TradeRow } from '@/lib/server/database';

/** Validation shared by /api/trades and /api/trades/batch: one rule set for every write. */
export type TradeInput = Omit<TradeRow, 'id' | 'createdAt' | 'updatedAt' | 'sourceRow'> & { sourceRow?: number | null };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
/** A number from the form or an import ("1,000" included); anything else is refused, never stored as NaN. */
function amount(value: unknown, field: string, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number.`);
  return Math.max(0, parsed);
}
const optionalDate = (value: unknown, field: string) => {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  if (!datePattern.test(text)) throw new Error(`${field} must be a YYYY-MM-DD date.`);
  return text;
};

export function cleanTradeInput(input: Partial<TradeInput>): TradeInput {
  const requestedType = String(input.type ?? 'Sell').trim().slice(0, 12);
  const cash = requestedType.toUpperCase() === 'CASH';
  const requestedTicker = String(input.ticker ?? '').trim().toUpperCase().slice(0, 12);
  const ticker = cash ? (requestedTicker === 'JPY' ? 'JPY' : 'USD') : requestedTicker || null;
  const event = cash ? 'CASH' : String(input.event ?? 'PUT').trim().toUpperCase().slice(0, 24);
  const type = cash ? 'CASH' : requestedType;
  const openDate = String(input.openDate ?? '').slice(0, 10);
  if (openDate && !datePattern.test(openDate)) throw new Error('Open date must be a YYYY-MM-DD date.');
  const closeDate = optionalDate(input.closeDate, 'Close date');
  const status = closeDate ? 'closed' : 'open';
  const rawCurrent = input.currentPrice as unknown;
  if (!openDate) throw new Error('Open date is required.');
  if (input.status === 'closed' && !closeDate) throw new Error('Close date is required for a closed trade.');
  if (closeDate && closeDate < openDate) throw new Error('Close date cannot be earlier than open date.');
  if (!event) throw new Error('Strategy is required.');
  return {
    type,
    openDate,
    expiryDate: cash ? null : optionalDate(input.expiryDate, 'Expiry date'),
    closeDate,
    ticker,
    event,
    strike: cash ? null : input.strike ? String(input.strike).trim().slice(0, 30) : null,
    quantity: amount(input.quantity, 'Quantity'),
    entryPrice: cash ? 1 : amount(input.entryPrice, 'Entry price'),
    currentPrice: cash ? 1 : rawCurrent === null || rawCurrent === undefined || rawCurrent === '' ? null : amount(rawCurrent, 'Current price'),
    fees: cash ? 0 : amount(input.fees, 'Fees'),
    collateral: cash ? amount(input.quantity, 'Quantity') : amount(input.collateral, 'Collateral'),
    notes: String(input.notes ?? '').trim().slice(0, 1000),
    status,
    quoteMode: input.quoteMode === 'auto' && type === 'SDI' ? 'auto' : 'manual',
    sourceRow: input.sourceRow ? Number(input.sourceRow) : null,
  };
}

