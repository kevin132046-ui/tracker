/**
 * Trades typed as a sentence ("今天以 2.30 賣出 KO 11/20 到期 75 PUT 一口") or read from a broker
 * screenshot by Claude / ChatGPT. The server asks the model for JSON and cleans it with
 * cleanAiTradeParse; the import dialog turns the result into the same preview as a CSV file
 * (planAiImport). Closing fills that match an open trade become updates to that trade. Pure.
 */
import { normalizeTickerForMarket } from '@/lib/performance';
import type { CsvTable, CsvTrade, ImportField } from '@/lib/trade-csv';
import { parseDate } from '@/lib/trade-csv';

export type AiTradeKind = 'stock' | 'option' | 'cash';
export type AiTradeRow = {
  /** open: a new position; close: buys back / sells an existing one. */
  action: 'open' | 'close';
  date: string | null;
  ticker: string | null;
  kind: AiTradeKind;
  side: 'buy' | 'sell' | null;
  right: 'PUT' | 'CALL' | null;
  strike: number | null;
  expiry: string | null;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  note: string;
  /** The open trade the model thinks this fill closes (one of the ids it was given). */
  closesTradeId: number | null;
};
export type AiTradeParse = { rows: AiTradeRow[]; questions: string[] };

export const maxAiRows = 50;
export const maxEntryLength = 2_000;
export const maxOpenTradeHints = 200;
export const maxEntryImageBytes = 4 * 1024 * 1024;
export const entryImageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Open positions sent with the request so a closing fill can name the trade it closes. */
export type OpenTradeHint = { id: number; ticker: string; kind: 'stock' | 'option'; side: 'buy' | 'sell'; right: 'PUT' | 'CALL' | null; strike: string | null; expiry: string | null; quantity: number; openDate: string };

const kindOf = (trade: Pick<CsvTrade, 'type'>): AiTradeKind => trade.type === 'CASH' ? 'cash' : trade.type === 'SDI' ? 'stock' : 'option';
const rightOf = (value: unknown): 'PUT' | 'CALL' | null => {
  const text = String(value ?? '').trim().toUpperCase();
  return text === 'PUT' || text === 'P' ? 'PUT' : text === 'CALL' || text === 'C' ? 'CALL' : null;
};

export function openTradeHints(trades: readonly CsvTrade[]): OpenTradeHint[] {
  return trades.flatMap((trade) => {
    const kind = kindOf(trade);
    if (trade.derived || trade.status !== 'open' || kind === 'cash' || !trade.ticker) return [];
    return [{ id: trade.id, ticker: trade.ticker, kind, side: trade.type === 'Sell' ? 'sell' : 'buy', right: kind === 'option' ? rightOf(trade.event) : null, strike: kind === 'option' ? trade.strike : null, expiry: trade.expiryDate, quantity: trade.quantity, openDate: trade.openDate } satisfies OpenTradeHint];
  }).slice(0, maxOpenTradeHints);
}

/** The JSON object (or array) in a model reply, tolerating code fences and prose around it. */
export function extractJson(text: string): unknown {
  const body = text.replace(/```(?:json)?/gi, '');
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const finite = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/[$,¥\s]/g, '')) : Number.NaN;
  return Number.isFinite(number) ? number : null;
};
// A short position may come back as -1; the side says which way it went.
const positive = (value: unknown) => { const number = finite(value); return number !== null && number !== 0 ? Math.abs(number) : null; };
const nonNegative = (value: unknown) => { const number = finite(value); return number !== null ? Math.abs(number) : null; };
const dateOf = (value: unknown) => typeof value === 'string' ? parseDate(value) : null;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Only the fields and values this app understands; everything else is dropped. */
export function cleanAiTradeParse(raw: unknown): AiTradeParse {
  const source = Array.isArray(raw) ? { rows: raw } : raw && typeof raw === 'object' ? raw as { rows?: unknown; questions?: unknown } : {};
  const rows = (Array.isArray(source.rows) ? source.rows : []).slice(0, maxAiRows).flatMap((item): AiTradeRow[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const right = rightOf(row.right ?? row.optionType);
    const kindRaw = String(row.kind ?? '').toLowerCase();
    const kind: AiTradeKind = kindRaw === 'cash' ? 'cash' : kindRaw === 'option' || right ? 'option' : 'stock';
    const tickerRaw = text(row.ticker, 15).toUpperCase().replace(/\s+/g, '');
    const side = String(row.side ?? '').toLowerCase();
    const id = finite(row.closesTradeId);
    return [{
      action: row.action === 'close' ? 'close' : 'open',
      date: dateOf(row.date),
      ticker: /^[A-Z0-9.-]{1,15}$/.test(tickerRaw) ? tickerRaw : null,
      kind,
      side: side === 'buy' || side === 'sell' ? side : null,
      right: kind === 'option' ? right : null,
      strike: kind === 'option' ? positive(row.strike) : null,
      expiry: kind === 'option' ? dateOf(row.expiry) : null,
      quantity: positive(row.quantity),
      price: kind === 'cash' ? null : nonNegative(row.price),
      fees: nonNegative(row.fees),
      note: text(row.note, 200),
      closesTradeId: id !== null && Number.isInteger(id) && id > 0 ? id : null,
    }];
  });
  const questions = (Array.isArray(source.questions) ? source.questions : []).flatMap((question) => typeof question === 'string' && question.trim() ? [question.trim().slice(0, 200)] : []).slice(0, 5);
  return { rows, questions };
}

/* ------------------------------------------------------------------ */
/* Parse result → import preview                                       */
/* ------------------------------------------------------------------ */

/** A closing fill applied to an existing open trade. */
export type AiCloseUpdate = { index: number; row: AiTradeRow; target: CsvTrade; next: CsvTrade | null; error: string | null };

export const aiImportFields: ImportField[] = ['openDate', 'ticker', 'type', 'side', 'right', 'strike', 'expiryDate', 'quantity', 'price', 'fees', 'notes'];

const strikeKey = (value: string | number | null | undefined) => {
  const raw = String(value ?? '').trim();
  return /^\d+(\.\d+)?$/.test(raw) ? String(Number(Number(raw).toFixed(4))) : raw.toUpperCase();
};
const sameTicker = (trade: CsvTrade, ticker: string) => {
  const market = trade.market ?? (/^\d{4}(\.T)?$/.test(trade.ticker ?? '') ? 'JP' : 'US');
  return normalizeTickerForMarket(trade.ticker, market) === normalizeTickerForMarket(ticker, market);
};

/** Open trades a closing fill could close: same contract, opened on the opposite side. */
function closeCandidates(row: AiTradeRow, existing: readonly CsvTrade[]) {
  if (!row.ticker || row.kind === 'cash') return [];
  return existing.filter((trade) => {
    if (trade.derived || trade.status !== 'open' || !sameTicker(trade, row.ticker!)) return false;
    if (row.kind === 'stock') return trade.type === 'SDI';
    if (trade.type !== 'Sell' && trade.type !== 'Buy') return false;
    // Buying back closes a short option; selling closes a long one.
    if (row.side && (row.side === 'buy') !== (trade.type === 'Sell')) return false;
    if (row.right && trade.event.toUpperCase() !== row.right) return false;
    if (row.strike !== null && strikeKey(trade.strike) !== strikeKey(row.strike)) return false;
    if (row.expiry && trade.expiryDate !== row.expiry) return false;
    return true;
  }).sort((a, b) => a.openDate.localeCompare(b.openDate) || a.id - b.id);
}

function closedTrade(row: AiTradeRow, target: CsvTrade): { next: CsvTrade | null; error: string | null } {
  if (!row.date) return { next: null, error: '缺少平倉日' };
  if (row.date < target.openDate) return { next: null, error: `平倉日早於開倉日（${target.openDate}）` };
  if (row.price === null) return { next: null, error: '缺少平倉價' };
  const note = row.note && !target.notes.includes(row.note) ? [target.notes, row.note].filter(Boolean).join(' · ').slice(0, 1000) : target.notes;
  return {
    next: { ...target, closeDate: row.date, currentPrice: row.price, fees: Number((target.fees + (row.fees ?? 0)).toFixed(6)), status: 'closed', quoteMode: 'manual', notes: note },
    error: null,
  };
}

/**
 * New trades as a table for mapImportRows (closing fills without a matching open trade stay in it,
 * so they can pair with an opening row of the same reply), and closing fills that update a trade.
 */
export function planAiImport(parse: AiTradeParse, existing: readonly CsvTrade[]): { table: CsvTable; mapping: ImportField[]; closes: AiCloseUpdate[] } {
  const closes: AiCloseUpdate[] = [];
  const claimed = new Set<number>();
  const tableRows: string[][] = [];
  parse.rows.forEach((row, index) => {
    if (row.action === 'close') {
      const candidates = closeCandidates(row, existing).filter((trade) => !claimed.has(trade.id));
      const hinted = candidates.find((trade) => trade.id === row.closesTradeId);
      const target = hinted ?? candidates.find((trade) => row.quantity === null || trade.quantity === row.quantity) ?? candidates[0];
      if (target) {
        claimed.add(target.id);
        if (row.quantity !== null && target.quantity !== row.quantity) {
          closes.push({ index, row, target, next: null, error: `數量 ${row.quantity} 與持倉 #${target.id} 的 ${target.quantity} 不同；部分平倉請在交易明細手動拆分` });
        } else {
          closes.push({ index, row, target, ...closedTrade(row, target) });
        }
        return;
      }
    }
    // Option opens say so (BTO / STO): a plain Buy / Sell could close the opposite position.
    const side = row.action === 'close'
      ? row.kind === 'stock' ? 'sell' : row.side === 'buy' ? 'btc' : row.side === 'sell' ? 'stc' : ''
      : row.kind === 'option' && row.side ? (row.side === 'buy' ? 'bto' : 'sto') : row.side ?? '';
    tableRows.push([
      row.date ?? '',
      row.kind === 'cash' ? row.ticker === 'JPY' ? 'JPY' : 'USD' : row.ticker ?? '',
      row.kind,
      side,
      row.right ?? '',
      row.strike === null ? '' : String(row.strike),
      row.expiry ?? '',
      row.quantity === null ? '' : String(row.quantity),
      row.price === null ? '' : String(row.price),
      row.fees === null ? '' : String(row.fees),
      row.note,
    ]);
  });
  return { table: { delimiter: ',', header: [...aiImportFields], rows: tableRows }, mapping: [...aiImportFields], closes };
}
