/**
 * 存提款紀錄: money moved into and out of the account, kept apart from trades so returns can be
 * measured against what was put in. Shared by /api/cash-flows, the ledger and the importer.
 */

export type CashFlowKind = 'deposit' | 'withdrawal';
export type CashFlowCurrency = 'USD' | 'JPY';
export type CashFlowInput = { date: string; kind: CashFlowKind; amount: number; currency: CashFlowCurrency; note: string };
export type CashFlow = CashFlowInput & { id: number; createdAt: string; updatedAt: string };

export const cashFlowKindLabels: Record<CashFlowKind, string> = { deposit: '存入', withdrawal: '提領' };

/** Writes per /api/cash-flows request (D1 allows 50 queries per invocation). */
export const maxCashFlowBatch = 35;
/** The phrase a request must carry to delete every deposit and withdrawal. */
export const clearCashFlowsPhrase = 'DELETE ALL CASH FLOWS';

/**
 * A note without bank reference numbers: wire / ACH descriptions carry IDs (FedRef …, Fed#…, SEN(…),
 * IMAD / OMAD, trace numbers) that identify the transfer and are not kept. "Wire Funds Received
 * FedRef 2507… SEN(2025…)" → "Wire Funds Received".
 */
export function cleanCashFlowNote(note: string) {
  return note
    .replace(/\b(?:fed\s*ref|fedref|imad|omad|trace|ref(?:erence)?|conf(?:irmation)?|trn|tran(?:saction)?\s*id)\b\s*[#:]?\s*(?:null|[A-Z0-9-]+)/gi, ' ')
    .replace(/\bfed\s*#\s*[A-Z0-9-]+/gi, ' ')
    .replace(/\b[A-Z]{2,5}\s*\(\s*[A-Z0-9-]{6,}\s*\)/gi, ' ')
    .replace(/#\s*[A-Z0-9-]{6,}/gi, ' ')
    // Any remaining long code containing digits (account, trace or confirmation numbers).
    .replace(/\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{8,}\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500);
}

export const signedCashFlow = (flow: Pick<CashFlowInput, 'kind' | 'amount'>) => flow.kind === 'deposit' ? flow.amount : -flow.amount;
const cents = (value: number) => Math.round(value * 100) / 100;

/** Same day, direction, currency and amount: the same deposit or withdrawal. */
export const cashFlowKey = (flow: Pick<CashFlowInput, 'date' | 'kind' | 'currency' | 'amount'>) => [flow.date, flow.kind, flow.currency, cents(flow.amount)].join('|');

/** Totals in US dollars (yen at the given USD/JPY rate), and counts. */
export function summarizeCashFlows(flows: readonly CashFlowInput[], usdJpyRate: number) {
  const usd = (flow: CashFlowInput) => flow.currency === 'JPY' ? flow.amount / (usdJpyRate > 0 ? usdJpyRate : 150) : flow.amount;
  const deposits = flows.filter((flow) => flow.kind === 'deposit');
  const withdrawals = flows.filter((flow) => flow.kind === 'withdrawal');
  const deposited = deposits.reduce((sum, flow) => sum + usd(flow), 0);
  const withdrawn = withdrawals.reduce((sum, flow) => sum + usd(flow), 0);
  return { deposited, withdrawn, net: deposited - withdrawn, depositCount: deposits.length, withdrawalCount: withdrawals.length, hasYen: flows.some((flow) => flow.currency === 'JPY') };
}

const csvField = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",;\t\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** UTF-8 CSV (with BOM) of the ledger: date, kind, amount, currency, note. */
export function cashFlowsToCsv(flows: readonly CashFlowInput[]) {
  const rows = flows.map((flow) => [flow.date, flow.kind, flow.amount, flow.currency, flow.note].map(csvField).join(','));
  return `﻿${['date', 'kind', 'amount', 'currency', 'note'].join(',')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`;
}

// Words in a type / action / description cell that make an imported row a deposit or a withdrawal.
const depositWords = ['deposit', 'deposits', 'achdeposit', 'wiredeposit', 'achin', 'wirein', 'fundsreceived', 'transferin', 'incomingwire', '入金', '存入', '存款', '入帳', '振込入金', '入金額'];
const withdrawalWords = ['withdrawal', 'withdrawals', 'withdraw', 'achwithdrawal', 'wirewithdrawal', 'achout', 'wireout', 'transferout', 'fundsdisbursed', 'outgoingwire', '出金', '提領', '提款', '出金額', '出款'];
// Transfers whose direction comes from the amount's sign.
const transferWords = ['ach', 'wire', 'transfer', 'moneylink', 'moneylinktransfer', 'fundstransfer', 'journal', '電匯', '匯款', '轉帳', '振込', '振替'];
const compact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_\-./()]/g, '');

/**
 * Deposit or withdrawal from an imported row's type or action cell (exact words), or from its
 * description when the row names no security; 'signed' when only the amount's sign says which.
 */
export function cashFlowIntent(cells: { type: string; side: string; notes: string }, namesSecurity: boolean): CashFlowKind | 'signed' | null {
  for (const cell of [cells.type, cells.side]) {
    const word = compact(cell);
    if (!word) continue;
    if (depositWords.includes(word)) return 'deposit';
    if (withdrawalWords.includes(word)) return 'withdrawal';
    if (transferWords.includes(word)) return 'signed';
  }
  if (namesSecurity) return null;
  const text = cells.notes.normalize('NFKC');
  if (/\bwithdraw(?:al)?s?\b|\b(?:ach|wire)\s+(?:out|withdrawal)\b|\bfunds\s+disbursed\b|出金|提領|提款/i.test(text)) return 'withdrawal';
  if (/\bdeposits?\b|\b(?:ach|wire)\s+(?:in|deposit)\b|\bfunds\s+received\b|入金|存入/i.test(text)) return 'deposit';
  return null;
}
