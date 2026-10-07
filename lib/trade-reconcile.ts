/**
 * Option and stock lots, reconciled: pairs closing fills with the positions they close and closes
 * options whose expiry has passed. Used by the CSV importer (rows of a file) and by 整理選擇權紀錄
 * (the trades already stored). Pure: no React, no network.
 *
 * Broker data records each transaction separately ("… OPEN CONTRACT", "… CLOSING CONTRACT"); stored
 * one per row they all look like open positions. Here:
 * - A closing fill uses up open lots of the same contract oldest first (several lots if needed; a lot
 *   closed only in part is split, the rest staying open).
 * - A closing fill whose position was already recorded as closed (the same round trip entered by
 *   hand) updates that record with the broker's close date and price instead.
 * - A closing fill with no open lot at all (opened before the data starts) becomes a closed record
 *   with no gain or loss, noted so the real cost can be added.
 * - An option still open after its expiry closes at 0: on the expiry date, or on the date of an
 *   "ASSIGNED" stock purchase at the strike.
 *
 * Every input carries the type of the POSITION it belongs to (Sell = written, Buy = bought, SDI =
 * stock): a closing buy of a written put has type Sell. Callers convert transaction sides.
 */
import type { CsvTrade } from '@/lib/trade-csv';

export type ReconReason = 'paired' | 'folded' | 'matched' | 'orphan' | 'expired' | 'assigned' | 'remainder';

/** yes: a closing fill; no: an opening one; maybe: a plain Buy/Sell that closes if the opposite position is open. */
export type ReconItem = { ref: number; trade: CsvTrade; closing: 'yes' | 'no' | 'maybe' };

export type ReconChange = {
  ref: number;
  reason: ReconReason;
  /** The record after reconciling; null when it is folded into the position it closed. */
  trade: CsvTrade | null;
  detail: string;
  related: number[];
};
export type ReconAdded = { fromRef: number; reason: ReconReason; trade: CsvTrade; detail: string; related: number[] };
export type ReconResult = { changes: ReconChange[]; added: ReconAdded[] };

// Phrases brokers put in option descriptions; free text such as "準備平倉" is deliberately not read.
const closeWords = /\bclos(?:e|ing)\s+contract\b|\b(?:buy|sell)?\s*to\s+close\b|\b(?:btc|stc)\b/i;
const openWords = /\bopen(?:ing)?\s+contract\b|\b(?:buy|sell)?\s*to\s+open\b|\b(?:bto|sto)\b/i;
const assignWords = /\bassign(?:ed|ment)?\b|\bexercis(?:e|ed)\b|被指派|割当/i;

/** Opening or closing, from a broker description ("… OPEN CONTRACT", "… CLOSING CONTRACT", BTC / STC). */
export function contractIntent(notes: string | null | undefined): 'open' | 'close' | null {
  const text = String(notes ?? '');
  if (closeWords.test(text)) return 'close';
  if (openWords.test(text)) return 'open';
  return null;
}

export const isOptionRecord = (trade: Pick<CsvTrade, 'type' | 'event'>) => {
  const type = trade.type.toUpperCase();
  const event = trade.event.toUpperCase();
  return type !== 'SDI' && type !== 'CASH' && event !== 'STOCK' && event !== 'CASH' && event !== 'DIVIDEND';
};
export const oppositeSide = (type: string) => type.toLowerCase() === 'sell' ? 'Buy' : 'Sell';

const eps = 1e-9;
const strikeKey = (strike: string | null | undefined) => {
  const text = String(strike ?? '').trim().toUpperCase();
  return /^\d+(\.\d+)?$/.test(text) ? String(Number(Number(text).toFixed(4))) : text;
};
const contractOf = (trade: CsvTrade) => isOptionRecord(trade)
  ? [trade.ticker ?? '', trade.event.toUpperCase(), strikeKey(trade.strike), trade.expiryDate ?? ''].join('|')
  : [trade.ticker ?? '', 'STOCK'].join('|');
const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const appendNote = (notes: string, note: string) => (notes ? `${notes} · ${note}` : note).slice(0, 1000);
const price = (value: number | null) => value === null ? '—' : String(round(value, 4));

type Portion = { quantity: number; closeDate: string; price: number; fees: number; reason: ReconReason; note: string; related: number[] };
type Lot = { item: ReconItem; left: number; portions: Portion[] };

export function reconcileTrades(items: readonly ReconItem[], options: { today: string; label: (ref: number) => string }): ReconResult {
  const { today, label } = options;
  const usable = items.filter((item) => item.trade.quantity > eps && item.trade.type.toUpperCase() !== 'CASH' && item.trade.ticker);
  const closedRecords = usable.filter((item) => item.trade.closeDate);
  const lots = new Map<number, Lot>();
  const matched = new Map<number, { ref: number; date: string; price: number; fees: number }>();
  const closings: Array<{ item: ReconItem; feeUnit: number; used: Array<{ ref: number; quantity: number }>; orphan: number; type: string }> = [];

  // Openings of a day come before its closings, so a same-day round trip pairs whatever the row order.
  const pending = usable.filter((item) => !item.trade.closeDate)
    .sort((a, b) => a.trade.openDate.localeCompare(b.trade.openDate) || Number(a.closing === 'yes') - Number(b.closing === 'yes') || a.ref - b.ref);
  for (const item of pending) {
    const trade = item.trade;
    const contract = contractOf(trade);
    const openLots = (type: string) => [...lots.values()].filter((lot) => lot.left > eps && lot.item.trade.type === type && contractOf(lot.item.trade) === contract);
    let positionType = trade.type;
    let closing = item.closing === 'yes';
    if (item.closing === 'maybe' && isOptionRecord(trade) && openLots(oppositeSide(trade.type)).length) {
      closing = true;
      positionType = oppositeSide(trade.type);
    }
    if (!closing) {
      lots.set(item.ref, { item, left: trade.quantity, portions: [] });
      continue;
    }
    const feeUnit = trade.fees / trade.quantity;
    let need = trade.quantity;
    const used: Array<{ ref: number; quantity: number }> = [];
    for (const lot of openLots(positionType)) {
      if (need <= eps) break;
      const take = Math.min(need, lot.left);
      lot.left -= take;
      need -= take;
      lot.portions.push({ quantity: take, closeDate: trade.openDate, price: trade.entryPrice, fees: feeUnit * take, reason: 'paired', note: `平倉成交見 ${label(item.ref)}`, related: [item.ref] });
      used.push({ ref: lot.item.ref, quantity: take });
    }
    if (need > eps) {
      // The same round trip already recorded as closed (entered by hand): the broker's fill wins.
      const done = closedRecords
        .filter((record) => !matched.has(record.ref) && record.trade.type === positionType && contractOf(record.trade) === contract
          && record.trade.openDate <= trade.openDate && Math.abs(record.trade.quantity - need) < eps)
        .sort((a, b) => a.trade.openDate.localeCompare(b.trade.openDate) || a.ref - b.ref)[0];
      if (done) {
        matched.set(done.ref, { ref: item.ref, date: trade.openDate, price: trade.entryPrice, fees: feeUnit * need });
        used.push({ ref: done.ref, quantity: need });
        need = 0;
      }
    }
    closings.push({ item, feeUnit, used, orphan: need > eps ? need : 0, type: positionType });
  }

  // Options past expiry: assigned (an ASSIGNED stock purchase at the strike) or expired worthless.
  const assignments = usable.filter((item) => !isOptionRecord(item.trade) && assignWords.test(item.trade.notes));
  for (const lot of lots.values()) {
    const trade = lot.item.trade;
    if (lot.left <= eps || !isOptionRecord(trade) || !trade.expiryDate || trade.expiryDate >= today) continue;
    const strike = Number(trade.strike);
    const assigned = Number.isFinite(strike) && strike > 0
      ? assignments.filter((stock) => stock.trade.ticker === trade.ticker && Math.abs(stock.trade.entryPrice - strike) <= Math.max(0.01, strike * 0.002)
        && stock.trade.openDate >= trade.openDate && stock.trade.openDate <= addDays(trade.expiryDate!, 3))
        .sort((a, b) => a.trade.openDate.localeCompare(b.trade.openDate))[0]
      : undefined;
    const closeDate = assigned ? (assigned.trade.openDate < trade.expiryDate ? assigned.trade.openDate : trade.expiryDate) : trade.expiryDate;
    lot.portions.push({
      quantity: lot.left, closeDate, price: 0, fees: 0, reason: assigned ? 'assigned' : 'expired',
      note: assigned ? `被指派（股票見 ${label(assigned.ref)}）` : '已過到期日，視為到期歸零', related: assigned ? [assigned.ref] : [],
    });
    lot.left = 0;
  }

  const changes: ReconChange[] = [];
  const added: ReconAdded[] = [];
  const describe = (portion: Portion) => portion.reason === 'paired'
    ? `${portion.closeDate} 以 ${price(portion.price)} 平倉（${portion.note.replace('平倉成交見 ', '')}）`
    : portion.reason === 'assigned' ? `${portion.closeDate} ${portion.note}，以 0 平倉` : `${portion.closeDate} 到期，以 0 平倉`;
  for (const lot of lots.values()) {
    if (!lot.portions.length) continue;
    const trade = lot.item.trade;
    const feeUnit = trade.fees / trade.quantity;
    const collateralUnit = trade.collateral / trade.quantity;
    const piece = (portion: Portion): CsvTrade => ({
      ...trade,
      quantity: round(portion.quantity),
      closeDate: portion.closeDate < trade.openDate ? trade.openDate : portion.closeDate,
      currentPrice: portion.price,
      fees: round(feeUnit * portion.quantity + portion.fees),
      collateral: round(collateralUnit * portion.quantity, 2),
      status: 'closed',
      quoteMode: 'manual',
      notes: appendNote(trade.notes, portion.note),
    });
    const split = lot.portions.length > 1 || lot.left > eps;
    const [first, ...rest] = lot.portions;
    changes.push({ ref: lot.item.ref, reason: first.reason, trade: piece(first), detail: `${split ? `拆出 ${round(first.quantity)} 口／股，` : ''}${describe(first)}`, related: first.related });
    for (const portion of rest) added.push({ fromRef: lot.item.ref, reason: portion.reason, trade: piece(portion), detail: `由 ${label(lot.item.ref)} 拆出 ${round(portion.quantity)}，${describe(portion)}`, related: portion.related });
    if (lot.left > eps) {
      added.push({
        fromRef: lot.item.ref, reason: 'remainder', detail: `由 ${label(lot.item.ref)} 拆出，剩 ${round(lot.left)} 仍未平倉`, related: [],
        trade: { ...trade, quantity: round(lot.left), fees: round(feeUnit * lot.left), collateral: round(collateralUnit * lot.left, 2) },
      });
    }
  }
  for (const [ref, fill] of matched) {
    const record = closedRecords.find((item) => item.ref === ref)!.trade;
    changes.push({
      ref, reason: 'matched', related: [fill.ref],
      detail: `與 ${label(fill.ref)} 的平倉成交是同一筆：平倉日 ${record.closeDate} → ${fill.date}，平倉價 ${price(record.currentPrice)} → ${price(fill.price)}`,
      trade: { ...record, closeDate: fill.date < record.openDate ? record.openDate : fill.date, currentPrice: fill.price, fees: round(record.fees + fill.fees), status: 'closed', quoteMode: 'manual' },
    });
  }
  for (const closing of closings) {
    const trade = closing.item.trade;
    const into = closing.used.map((use) => label(use.ref)).join('、');
    if (closing.orphan <= eps) {
      changes.push({ ref: closing.item.ref, reason: 'folded', trade: null, detail: `平倉成交，併入 ${into}`, related: closing.used.map((use) => use.ref) });
      continue;
    }
    changes.push({
      ref: closing.item.ref, reason: 'orphan', related: closing.used.map((use) => use.ref),
      detail: `${closing.used.length ? `部分併入 ${into}；其餘 ` : ''}找不到開倉紀錄（可能在資料起點之前開倉），轉為已平倉、損益以 0 計`,
      trade: {
        ...trade,
        type: closing.type,
        quantity: round(closing.orphan),
        currentPrice: trade.entryPrice,
        closeDate: trade.openDate,
        fees: round(closing.feeUnit * closing.orphan),
        collateral: 0,
        status: 'closed',
        quoteMode: 'manual',
        notes: appendNote(trade.notes, '開倉紀錄不在資料中，損益以 0 計（可編輯補上開倉價）'),
      },
    });
  }
  return { changes, added };
}

/** Stored trades as reconcile inputs: option rows closing by their description, or by an opposite open position. */
export function reconItemsFromTrades(trades: readonly CsvTrade[]): ReconItem[] {
  return trades.filter((trade) => !trade.derived).map((trade) => {
    if (!isOptionRecord(trade) || trade.status === 'closed') return { ref: trade.id, trade, closing: 'no' as const };
    const intent = contractIntent(trade.notes);
    if (intent === 'close') return { ref: trade.id, trade: { ...trade, type: oppositeSide(trade.type) }, closing: 'yes' as const };
    return { ref: trade.id, trade, closing: intent === 'open' ? 'no' as const : 'maybe' as const };
  });
}
