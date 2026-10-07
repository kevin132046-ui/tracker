/**
 * CSV export and import of trades.
 *
 * Export writes the app's own columns (UTF-8 with BOM). Import reads the app's export or a
 * broker/spreadsheet file: comma, tab or semicolon delimiters, quoted fields, English / 中文 /
 * 日本語 headers, and maps each row to the Trade shape that POST /api/trades accepts, with
 * per-row errors, warnings and duplicate detection. Pure: no React, no network.
 */

import { isYenTicker, normalizeTickerForMarket } from '@/lib/performance';
import { diffTrades, type FieldDiff } from '@/lib/trade-diff';
import { contractIntent, isOptionRecord, oppositeSide, reconcileTrades, type ReconItem, type ReconReason } from '@/lib/trade-reconcile';
import { cashFlowIntent, cashFlowKey, cashFlowKindLabels, type CashFlowInput } from '@/lib/cash-flows';

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

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export type CsvEncoding = 'auto' | 'utf-8' | 'shift_jis' | 'big5';

/** Text of the file; 'auto' is strict UTF-8 and falls back to Shift_JIS when that fails. */
export function decodeCsv(bytes: ArrayBuffer, encoding: CsvEncoding): { text: string; encoding: Exclude<CsvEncoding, 'auto'>; utf8Failed: boolean } {
  if (encoding !== 'auto') return { text: new TextDecoder(encoding).decode(bytes), encoding, utf8Failed: false };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', utf8Failed: false };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis', utf8Failed: true };
  }
}

export type CsvDelimiter = ',' | '\t' | ';';

const countOutsideQuotes = (line: string, delimiter: string) => {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) count += 1;
  }
  return count;
};

/** Comma, tab or semicolon: the one splitting the first lines most consistently. */
export function detectDelimiter(text: string): CsvDelimiter {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((line) => line.trim()).slice(0, 12);
  let best: { delimiter: CsvDelimiter; consistency: number; width: number } = { delimiter: ',', consistency: 0, width: 0 };
  for (const delimiter of [',', '\t', ';'] as const) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const width = counts[0] ?? 0;
    if (!width) continue;
    const consistency = counts.filter((count) => count === width).length;
    if (consistency > best.consistency || (consistency === best.consistency && width > best.width)) best = { delimiter, consistency, width };
  }
  return best.delimiter;
}

/** RFC 4180 fields: quotes with "" escapes, delimiters and line breaks inside quotes; blank rows dropped. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = false;
      continue;
    }
    if (char === '"' && !wasQuoted && field.trim() === '') { quoted = true; wasQuoted = true; field = ''; continue; }
    if (char === delimiter) { row.push(field); field = ''; wasQuoted = false; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      wasQuoted = false;
      continue;
    }
    if (!(wasQuoted && /\s/.test(char))) field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export type CsvTable = { delimiter: CsvDelimiter; header: string[]; rows: string[][] };

export function parseCsvTable(text: string): CsvTable {
  const delimiter = detectDelimiter(text);
  const [header = [], ...rows] = parseDelimited(text, delimiter);
  return { delimiter, header: header.map((cell) => cell.trim()), rows };
}

/* ------------------------------------------------------------------ */
/* Header mapping                                                      */
/* ------------------------------------------------------------------ */

export type ImportField =
  | 'id' | 'type' | 'side' | 'event' | 'right' | 'ticker' | 'market' | 'strike' | 'quantity' | 'price'
  | 'currentPrice' | 'exitPrice' | 'fees' | 'collateral' | 'openDate' | 'expiryDate' | 'closeDate'
  | 'status' | 'quoteMode' | 'notes' | 'amount';

export const importFields: ReadonlyArray<{ id: ImportField; label: string; synonyms: readonly string[] }> = [
  { id: 'openDate', label: '開倉日／成交日', synonyms: ['date', 'opendate', 'tradedate', 'transactiondate', 'executiondate', 'filldate', 'entrydate', 'opened', '日期', '成交日', '成交日期', '交易日', '交易日期', '開倉日', '开仓日', '買入日期', '约定日', '約定日', '取引日', '建玉日', '約定日付'] },
  { id: 'ticker', label: '代號／標的', synonyms: ['ticker', 'symbol', 'code', 'stockcode', 'underlying', 'underlyingsymbol', 'root', 'instrument', '代號', '代码', '代碼', '股票代號', '股票代碼', '證券代號', '标的', '標的', '銘柄', '銘柄コード', 'コード', '証券コード', '銘柄名'] },
  { id: 'type', label: '類型（股票／選擇權／現金）', synonyms: ['type', 'assettype', 'securitytype', 'instrumenttype', 'producttype', 'assetclass', 'category', '類型', '类型', '種類', '种类', '商品', '商品類型', '資產類別', '商品区分', '銘柄種別'] },
  { id: 'side', label: '買賣方向', synonyms: ['side', 'action', 'buysell', 'bs', 'transaction', 'transactiontype', 'direction', 'tradeaction', 'openclose', '買賣', '买卖', '買賣別', '買賣方向', '交易別', '交易類別', '売買', '売買区分', '売買種別', '動作'] },
  { id: 'right', label: 'PUT／CALL', synonyms: ['putcall', 'callput', 'right', 'optiontype', 'cp', 'pc', 'putorcall', 'callorput', '權利', '權利類型', '買賣權', '买卖权', 'オプション種別', 'プットコール', 'コールプット'] },
  { id: 'event', label: '策略／事件', synonyms: ['event', 'strategy', '策略', '策略事件', '事件', '戦略'] },
  { id: 'strike', label: '履約價', synonyms: ['strike', 'strikeprice', 'exerciseprice', '履約價', '履约价', '履約價組合', '行使價', '行使价', '行使価格', '権利行使価格'] },
  { id: 'expiryDate', label: '到期日', synonyms: ['expiry', 'expiration', 'expirationdate', 'expirydate', 'exp', 'expdate', 'maturity', '到期日', '到期', '到期日期', '満期日', '満期', '限月', '権利行使期限', '最終取引日'] },
  { id: 'quantity', label: '數量／口數', synonyms: ['qty', 'quantity', 'shares', 'contracts', 'units', 'size', 'position', '數量', '数量', '股數', '股数', '口數', '口数', '張數', '株数', '枚数', '約定数量'] },
  { id: 'price', label: '成交價／權利金', synonyms: ['price', 'entryprice', 'openprice', 'tradeprice', 'fillprice', 'avgprice', 'averageprice', 'executionprice', 'premium', 'tprice', '價格', '价格', '成交價', '成交价', '成交價格', '買入價', '買入成交價', '成本成交價', '權利金', '权利金', '單價', '单价', '約定単価', '約定価格', '単価', '取得単価', '平均取得価格', 'プレミアム'] },
  { id: 'currentPrice', label: '目前價格', synonyms: ['currentprice', 'current', 'mark', 'markprice', 'lastprice', 'last', 'marketprice', '目前價格', '目前价格', '現價', '现价', '市價', '現在値', '時価', '現在価格', '持倉平倉價'] },
  { id: 'exitPrice', label: '平倉價', synonyms: ['exitprice', 'closeprice', 'closingprice', 'sellprice', 'exit', '平倉價', '平仓价', '平倉價格', '賣出價', '決済価格', '決済単価', '売却価格'] },
  { id: 'closeDate', label: '平倉日', synonyms: ['closedate', 'exitdate', 'closingdate', 'closeddate', 'solddate', '平倉日', '平仓日', '平倉日期', '賣出日', '賣出日期', '決済日', '返済日'] },
  { id: 'fees', label: '手續費', synonyms: ['fees', 'fee', 'commission', 'commissions', 'comm', 'commfee', 'charges', '手續費', '手续费', '費用', '佣金', '手数料', '諸費用'] },
  { id: 'collateral', label: '擔保金', synonyms: ['collateral', 'margin', 'capital', 'requirement', '擔保', '担保', '擔保金', '保證金', '保证金', '証拠金', '投入資本', '擔保投入資本'] },
  { id: 'market', label: '市場', synonyms: ['market', 'exchange', '市場', '市场', '交易所', '市場区分'] },
  { id: 'status', label: '狀態', synonyms: ['status', 'state', '狀態', '状态', '状態'] },
  { id: 'quoteMode', label: '報價方式', synonyms: ['quotemode', '報價方式'] },
  { id: 'amount', label: '金額（存提款）', synonyms: ['amount', 'netamount', 'totalamount', 'cashamount', '金額', '金额', '淨額', '净额', '入出金額', '受渡金額', '入金額', '出金額'] },
  { id: 'notes', label: '備註', synonyms: ['notes', 'note', 'memo', 'comment', 'comments', 'remark', 'remarks', 'description', 'desc', '備註', '备注', '說明', 'メモ', '備考', 'コメント'] },
  { id: 'id', label: '原編號 id（不匯入）', synonyms: ['id', 'tradeid', '編號', '编号', '交易編號'] },
];

const normalizeHeader = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_\-.()[\]{}【】「」/\\:#'"]/g, '');

// Loose matches for headers such as "Trade Date/Time" or "Commission ($)" once exact synonyms fail.
const headerHints: ReadonlyArray<[RegExp, ImportField]> = [
  [/expir|満期|到期/, 'expiryDate'], [/strike|履約|行使/, 'strike'], [/symbol|ticker|代號|代码|銘柄/, 'ticker'],
  [/commission|fee|手續|手数料/, 'fees'], [/qty|quantity|數量|数量|口數/, 'quantity'], [/close.*date|平倉日|決済日/, 'closeDate'],
  [/date|日期|約定日/, 'openDate'], [/price|價|価格|単価/, 'price'], [/note|memo|備註|メモ/, 'notes'],
];

/** Field for each header: exact synonyms first, then loose hints; each field is used once. */
export function autoMapHeaders(header: readonly string[]): Array<ImportField | ''> {
  const used = new Set<ImportField>();
  const normalized = header.map(normalizeHeader);
  const mapping: Array<ImportField | ''> = normalized.map((name) => {
    const field = importFields.find((candidate) => candidate.synonyms.includes(name))?.id;
    if (!field || used.has(field)) return '';
    used.add(field);
    return field;
  });
  normalized.forEach((name, index) => {
    if (mapping[index] || !name) return;
    const hint = headerHints.find(([pattern, field]) => pattern.test(name) && !used.has(field));
    if (hint) { mapping[index] = hint[1]; used.add(hint[1]); }
  });
  return mapping;
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

const plain = (value: string) => value.normalize('NFKC').trim();
const token = (value: string) => plain(value).toLowerCase().replace(/[\s_\-./]/g, '');

/** Number from "1,234.50", "$0.62", "(1.25)", "¥1,500円" or, with semicolons, "1.234,5"; null when not numeric. */
export function parseNumber(raw: string, delimiter: CsvDelimiter = ','): number | null {
  let text = plain(raw);
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  text = text.replace(/^(us\$|nt\$|hk\$|usd|jpy|\$|¥)\s*/i, '').replace(/\s*(円|usd|jpy)$/i, '').replace(/\s+/g, '');
  if (delimiter === ';' && /^[+-]?\d{1,3}(\.\d{3})*,\d+$|^[+-]?\d+,\d+$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const validDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1990 && year <= 2100 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : null;
};
const fullYear = (value: number) => value < 100 ? 2000 + value : value;

/**
 * YYYY-MM-DD from 2026-05-06, 2026/5/6, 2026年5月6日, 20260506, 05/06/2026 (US; 18/06/2026 when
 * the first part exceeds 12), 115/05/06 (Taiwan ROC year), 6-May-2026, May 6, 2026, a trailing time,
 * or an Excel serial day; null otherwise.
 */
export function parseDate(raw: string): string | null {
  const text = plain(raw);
  if (!text) return null;
  let match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T].*)?$/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (match && Number(match[1]) >= 100) return validDate(Number(match[1]) + 1911, Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,].*)?$/.exec(text);
  if (match) {
    const [first, second, year] = [Number(match[1]), Number(match[2]), fullYear(Number(match[3]))];
    return first > 12 ? validDate(year, second, first) : validDate(year, first, second);
  }
  match = /^(\d{1,2})[-\s]([a-z]{3})[a-z]*\.?[-\s,]+(\d{2}|\d{4})$/i.exec(text);
  if (match && monthNames.includes(match[2].toLowerCase())) return validDate(fullYear(Number(match[3])), monthNames.indexOf(match[2].toLowerCase()) + 1, Number(match[1]));
  match = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (match && monthNames.includes(match[1].toLowerCase())) return validDate(Number(match[3]), monthNames.indexOf(match[1].toLowerCase()) + 1, Number(match[2]));
  if (/^\d{5}$/.test(text) && Number(text) > 30_000 && Number(text) < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + Number(text) * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

type Side = 'buy' | 'sell' | 'buyToClose' | 'sellToClose';
const sideWords: ReadonlyArray<[Side, readonly string[]]> = [
  ['buyToClose', ['btc', 'buytoclose', 'buyclose', 'closeshort', '買回', '买回', '買い戻し', '買戻', '返済買']],
  ['sellToClose', ['stc', 'selltoclose', 'sellclose', 'closelong', '賣出平倉', '売り決済', '売決済', '返済売']],
  ['buy', ['buy', 'b', 'bot', 'bought', 'long', 'bto', 'buytoopen', 'buyopen', '買', '買入', '买入', '買進', '买进', '買い', '買付', '買建', '新規買', '現物買']],
  ['sell', ['sell', 's', 'sld', 'sold', 'short', 'sto', 'selltoopen', 'sellopen', '賣', '賣出', '卖出', '売', '売り', '売付', '売建', '新規売', '現物売']],
];
// Side words that say the fill opens a position (a plain Buy / Sell might close one).
const openSideWords = ['bto', 'buytoopen', 'buyopen', 'sto', 'selltoopen', 'sellopen', '新規買', '新規売', '買建', '売建'];
const sideOf = (raw: string): Side | null => {
  const value = token(raw);
  return value ? sideWords.find(([, words]) => words.includes(value))?.[0] ?? null : null;
};
const rightOf = (raw: string): 'PUT' | 'CALL' | null => {
  const value = token(raw);
  if (['put', 'puts', 'p', '賣權', '卖权', 'プット'].includes(value)) return 'PUT';
  if (['call', 'calls', 'c', '買權', '买权', 'コール'].includes(value)) return 'CALL';
  return null;
};
const appTypes: Record<string, string> = { sell: 'Sell', buy: 'Buy', ass: 'Ass', sdi: 'SDI', cash: 'CASH' };
const stockWords = ['stock', 'stocks', 'equity', 'equities', 'share', 'shares', 'etf', '股票', '現股', '现股', '股', '株', '株式', '現物'];
const optionWords = ['option', 'options', 'opt', 'equityoption', '選擇權', '选择权', '期權', '期权', 'オプション'];
const cashWords = ['cash', '現金', '现金'];

/** OCC option symbol such as "KO   260618P00070000" → root, expiry, right and strike. */
export function parseOccSymbol(raw: string): { ticker: string; expiryDate: string; right: 'PUT' | 'CALL'; strike: number } | null {
  const match = /^([A-Z][A-Z0-9.]{0,5})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(plain(raw).toUpperCase());
  if (!match) return null;
  const expiryDate = validDate(2000 + Number(match[2]), Number(match[3]), Number(match[4]));
  const strike = Number(match[6]) / 1000;
  return expiryDate && strike > 0 ? { ticker: match[1], expiryDate, right: match[5] === 'P' ? 'PUT' : 'CALL', strike } : null;
}

const strikeText = (value: number) => String(Number(value.toFixed(4)));

/** Canonical strike for comparisons: "70.00" and "70" match; spreads compare as text. */
const strikeKey = (strike: string | null | undefined) => {
  const text = String(strike ?? '').trim().toUpperCase();
  return /^\d+(\.\d+)?$/.test(text) ? strikeText(Number(text)) : text;
};
const amountKey = (value: number) => String(Math.round(Number(value) * 1e6) / 1e6);

/** Trades that match on ticker, type, event, strike, open date, quantity and entry price are duplicates. */
export function tradeDuplicateKey(trade: Pick<CsvTrade, 'ticker' | 'type' | 'event' | 'strike' | 'openDate' | 'quantity' | 'entryPrice' | 'market'>) {
  const ticker = normalizeTickerForMarket(trade.ticker, marketOf(trade));
  return [ticker, trade.type.trim().toUpperCase(), trade.event.trim().toUpperCase(), strikeKey(trade.strike), trade.openDate, amountKey(trade.quantity), amountKey(trade.entryPrice)].join('|');
}

/* ------------------------------------------------------------------ */
/* Rows → trades                                                       */
/* ------------------------------------------------------------------ */

/** One change importing a row makes: a new trade, an update of a stored trade, or deleting a stored duplicate. */
export type ImportOp =
  | { kind: 'create'; trade: CsvTrade; note: string }
  | { kind: 'update'; id: number; before: CsvTrade; trade: CsvTrade; diffs: FieldDiff[]; note: string }
  | { kind: 'delete'; id: number; before: CsvTrade; note: string }
  | { kind: 'flow'; flow: CashFlowInput; note: string };

export type ImportRow = {
  /** Line in the file (the header is line 1). */
  line: number;
  /** The row as it will be stored; for a closing fill folded into a position, the fill itself (fill). Null with errors. */
  trade: CsvTrade | null;
  /** trade is a closing fill shown as read: its position closes elsewhere (mergedInto, or a stored trade). */
  fill: boolean;
  /** A deposit or withdrawal: goes to 存提款紀錄, not to the trades (trade is null). */
  flow: CashFlowInput | null;
  errors: string[];
  warnings: string[];
  /** Already stored as this trade with nothing to change (checking the row imports a copy). */
  duplicateOf: number | null;
  /** Earlier line in the file with the same key. */
  duplicateLine: number | null;
  /** A closing fill (BTC / STC / CLOSING CONTRACT / stock sale) folded into the opening row on this line. */
  mergedInto: number | null;
  /** The stored trade this row was compared with, and the fields that differ (stored → file). */
  existing: CsvTrade | null;
  diffs: FieldDiff[];
  /** What importing the row does. */
  ops: ImportOp[];
  /** Rows imported together because their opens and closes depend on each other share a group: its first line. */
  group: number;
  /** Updates fields other than the close (status, dates, exit price, quantity): not checked by default. */
  minor: boolean;
};

type Leg = {
  line: number;
  kind: 'stock' | 'option' | 'cash' | 'flow';
  /** kind 'flow': the deposit or withdrawal. */
  flow?: CashFlowInput;
  /** yes: a closing fill; maybe: a plain Buy/Sell that closes an opposite open position if there is one. */
  closing: 'yes' | 'no' | 'maybe';
  /** The transaction's own side (a closing buy of a written put is Buy; its position, the trade's type, Sell). */
  sideType: string;
  trade: CsvTrade;
  exitPrice: number | null;
  /** No current price in the file: the entry price stands in while the trade is open. */
  priceGuessed: boolean;
  errors: string[];
  warnings: string[];
};

export type MapOptions = {
  existing: readonly CsvTrade[];
  delimiter?: CsvDelimiter;
  /** Today at the exchange (YYYY-MM-DD): options expiring before it close at 0. */
  today?: string;
  /**
   * Compare with the stored trades: changed ones become updates (with the fields that differ), stored
   * copies of folded closing fills are deleted, and closing fills close stored open positions.
   * Without it a row matching a stored trade is only flagged as a duplicate.
   */
  updateExisting?: boolean;
  /** A closing fill with no opening anywhere: a closed record at P&L 0 (default), or an error. */
  orphans?: 'convert' | 'error';
  /** How messages name a row (default 第 N 列). */
  lineLabel?: (line: number) => string;
  /** Stored deposits and withdrawals: a file row repeating one is not added again. */
  existingFlows?: readonly CashFlowInput[];
};

// A live price on an open trade is not a difference worth an update.
const comparedFields = new Set(['type', 'event', 'strike', 'expiryDate', 'quantity', 'entryPrice', 'openDate', 'status', 'closeDate', 'fees', 'collateral']);
const meaningfulDiffs = (existing: CsvTrade, next: CsvTrade) => diffTrades(existing, next)
  .filter((diff) => comparedFields.has(diff.field) || (diff.field === 'currentPrice' && (existing.status === 'closed' || next.status === 'closed')));
// Changes that close, split or convert a trade, as opposed to corrections of other fields.
const closeFields = new Set(['type', 'quantity', 'status', 'closeDate', 'currentPrice']);
const round6 = (value: number) => Number(value.toFixed(6));

/** Same trade with a corrected quantity or price: contract and day (cash: currency and day). */
const looseKey = (trade: CsvTrade) => {
  const ticker = normalizeTickerForMarket(trade.ticker, marketOf(trade));
  return trade.type.toUpperCase() === 'CASH'
    ? [ticker, 'CASH', trade.openDate].join('|')
    : [ticker, trade.type.trim().toUpperCase(), trade.event.trim().toUpperCase(), strikeKey(trade.strike), trade.expiryDate ?? '', trade.openDate].join('|');
};

/**
 * Each data row as a Trade for /api/trades. Rows are validated, closing fills are paired with the
 * opens in the file (lib/trade-reconcile: several lots, partial closes, assignments) and options past
 * expiry close at 0. With updateExisting each result is then compared with the stored trades — new,
 * an update (with the fields that differ) or unchanged — and closing fills whose opening is not in the
 * file close the stored open position instead.
 */
export function mapImportRows(table: CsvTable, mapping: ReadonlyArray<ImportField | ''>, options: MapOptions): ImportRow[] {
  const delimiter = options.delimiter ?? table.delimiter;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const compare = options.updateExisting === true;
  const lineLabel = options.lineLabel ?? ((line: number) => `第 ${line} 列`);
  const legs = table.rows.map((cells, index) => buildLeg(cells, index + 2, mapping, delimiter));
  const rows = new Map<number, ImportRow>(legs.map((leg) => [leg.line, {
    line: leg.line, trade: null, fill: false, flow: null, errors: leg.errors, warnings: leg.warnings, duplicateOf: null, duplicateLine: null, mergedInto: null,
    existing: null, diffs: [], ops: [], group: leg.line, minor: false,
  }]));
  // Deposits and withdrawals go to the ledger, each once: a row repeating a stored record is not added again.
  const flowPool = new Map<string, number>();
  for (const flow of options.existingFlows ?? []) flowPool.set(cashFlowKey(flow), (flowPool.get(cashFlowKey(flow)) ?? 0) + 1);
  for (const leg of legs) {
    if (leg.kind !== 'flow' || leg.errors.length || !leg.flow) continue;
    const row = rows.get(leg.line)!;
    const key = cashFlowKey(leg.flow);
    row.flow = leg.flow;
    if (flowPool.get(key)) {
      flowPool.set(key, flowPool.get(key)! - 1);
      row.warnings.push('與現有的存提款紀錄相同');
    } else {
      row.ops.push({ kind: 'flow', flow: leg.flow, note: `存提款紀錄：${cashFlowKindLabels[leg.flow.kind]}` });
      row.warnings.push('加入存提款紀錄（不影響交易與現金餘額）');
    }
  }
  for (const leg of legs) if (!leg.errors.length && leg.kind !== 'flow') finalizeLeg(leg);
  const valid = legs.filter((leg) => !leg.errors.length && leg.kind !== 'flow');
  const legByLine = new Map(valid.map((leg) => [leg.line, leg]));
  // Each row as read: what an earlier import stored, and how a closing fill shows in the preview.
  const original = new Map(valid.map((leg) => [leg.line, { ...leg.trade }]));
  const asFill = (line: number): CsvTrade => ({ ...original.get(line)!, type: legByLine.get(line)!.sideType });
  const label = (ref: number) => ref < 0 ? `#${-ref}` : lineLabel(ref);
  const noteLabel = (ref: number) => ref < 0 ? `#${-ref}` : `匯入紀錄（${legByLine.get(ref)?.trade.openDate ?? ''}）`;

  // Rows that must be imported together: a closing fill and the positions it closes.
  const parent = new Map<number, number>();
  const find = (line: number): number => { const up = parent.get(line) ?? line; if (up === line) return line; const top = find(up); parent.set(line, top); return top; };
  const join = (a: number, b: number) => { if (a <= 0 || b <= 0) return; const [x, y] = [find(a), find(b)]; if (x !== y) parent.set(Math.max(x, y), Math.min(x, y)); };

  // Pass 1: the file on its own.
  const finalTrade = new Map<number, CsvTrade | null>(valid.map((leg) => [leg.line, leg.trade]));
  const reasons = new Map<number, ReconReason>();
  const details = new Map<number, string[]>();
  const extras = new Map<number, Array<{ trade: CsvTrade; detail: string; reason: ReconReason }>>();
  const note = (line: number, detail: string) => details.set(line, [...(details.get(line) ?? []), detail]);
  const pass1 = reconcileTrades(valid.map((leg) => ({ ref: leg.line, trade: leg.trade, closing: leg.closing })), { today, label, noteLabel });
  for (const change of pass1.changes) {
    const row = rows.get(change.ref)!;
    if (change.reason !== 'assigned') for (const ref of change.related) join(change.ref, ref);
    if (change.reason === 'orphan' && options.orphans === 'error') {
      row.errors.push('找不到對應的開倉紀錄（平倉成交需與開倉成交一起匯入）');
      finalTrade.set(change.ref, null);
      continue;
    }
    reasons.set(change.ref, change.reason);
    if (change.reason === 'folded') row.mergedInto = change.related[0] ?? null;
    finalTrade.set(change.ref, change.trade);
    note(change.ref, change.detail);
  }
  for (const item of pass1.added) {
    if (item.reason !== 'assigned') for (const ref of item.related) join(item.fromRef, ref);
    extras.set(item.fromRef, [...(extras.get(item.fromRef) ?? []), { trade: item.trade, detail: item.detail, reason: item.reason }]);
  }

  // Stored trades, each answering at most one result: ten identical one-lot rows meet ten stored trades.
  const exactPool = new Map<string, CsvTrade[]>();
  const loosePool = new Map<string, CsvTrade[]>();
  for (const trade of options.existing) {
    if (trade.derived) continue;
    exactPool.set(tradeDuplicateKey(trade), [...(exactPool.get(tradeDuplicateKey(trade)) ?? []), trade]);
    loosePool.set(looseKey(trade), [...(loosePool.get(looseKey(trade)) ?? []), trade]);
  }
  const used = new Set<number>();
  const take = (pool: Map<string, CsvTrade[]>, keys: readonly string[], target: CsvTrade) => {
    for (const key of new Set(keys)) {
      const candidates = (pool.get(key) ?? []).filter((trade) => !used.has(trade.id));
      if (!candidates.length) continue;
      const score = (trade: CsvTrade) => meaningfulDiffs(trade, target).length;
      const best = candidates.reduce((a, b) => score(b) < score(a) || (score(b) === score(a) && b.id < a.id) ? b : a);
      used.add(best.id);
      return best;
    }
    return null;
  };
  // An earlier import stored rows as read (a closing fill on its own side); a reconcile, as paired here.
  const keysOf = (line: number): string[] => {
    const before = tradeDuplicateKey(original.get(line)!);
    const after = finalTrade.get(line);
    if (!compare) return after ? [tradeDuplicateKey(after)] : [];
    const reason = reasons.get(line);
    if (reason === 'folded') return [tradeDuplicateKey(asFill(line)), before];
    if (reason === 'orphan') return [tradeDuplicateKey(asFill(line)), tradeDuplicateKey(after!), before];
    return after ? [before, tradeDuplicateKey(after)] : [];
  };
  const lines = valid.map((leg) => leg.line).filter((line) => !rows.get(line)!.errors.length);
  const stored = new Map<number, CsvTrade>();
  for (const round of [0, 1]) for (const line of lines) {
    if (stored.has(line)) continue;
    const keys = keysOf(line);
    const found = take(exactPool, round === 0 ? keys.slice(0, 1) : keys.slice(1), finalTrade.get(line) ?? asFill(line));
    if (found) stored.set(line, found);
  }
  const extraStored = new Map<CsvTrade, CsvTrade>();
  for (const line of lines) for (const extra of extras.get(line) ?? []) {
    const found = take(exactPool, [tradeDuplicateKey(extra.trade)], extra.trade);
    if (found) extraStored.set(extra.trade, found);
  }
  if (compare) for (const line of lines) {
    const trade = finalTrade.get(line);
    if (stored.has(line) || !trade) continue;
    const found = take(loosePool, [looseKey(trade)], trade);
    if (found) stored.set(line, found);
  }

  // Pass 2: closing fills whose opening is not in the file close stored open positions.
  const storedOps = new Map<number, ImportOp[]>();
  if (compare) {
    const fills: ReconItem[] = [];
    for (const line of lines) {
      const reason = reasons.get(line);
      const before = original.get(line)!;
      const after = finalTrade.get(line);
      if (reason === 'orphan' && after) {
        const share = after.quantity / before.quantity;
        fills.push({ ref: line, trade: { ...before, type: after.type, quantity: after.quantity, fees: round6(before.fees * share), collateral: 0 }, closing: 'yes' });
      } else if (legByLine.get(line)!.closing === 'maybe' && (!reason || reason === 'expired' || reason === 'assigned') && isOptionRecord(before)) {
        fills.push({ ref: line, trade: before, closing: 'maybe' });
      }
    }
    if (fills.length) {
      const byId = new Map(options.existing.map((trade) => [trade.id, trade]));
      const positions: ReconItem[] = options.existing
        .filter((trade) => !trade.derived && !used.has(trade.id) && trade.type.toUpperCase() !== 'CASH' && (trade.status === 'closed' || contractIntent(trade.notes) !== 'close'))
        .map((trade) => ({ ref: -trade.id, trade: { ...trade, closeDate: trade.status === 'closed' ? trade.closeDate : null }, closing: 'no' }));
      const pass2 = reconcileTrades([...positions, ...fills], { today, label, noteLabel });
      const owner = new Map<number, number>();
      for (const change of pass2.changes) {
        if (change.ref > 0) {
          if (change.reason !== 'folded' && change.reason !== 'orphan') continue;
          // Replaces what pass 1 made of the row.
          reasons.set(change.ref, change.reason);
          finalTrade.set(change.ref, change.trade);
          details.set(change.ref, [change.detail]);
          continue;
        }
        const fileRefs = change.related.filter((ref) => ref > 0);
        if (!fileRefs.length || !change.trade || change.reason === 'expired') continue;
        const before = byId.get(-change.ref)!;
        owner.set(change.ref, fileRefs[0]);
        for (const ref of fileRefs) join(fileRefs[0], ref);
        const diffs = meaningfulDiffs(before, change.trade);
        if (diffs.length) storedOps.set(fileRefs[0], [...(storedOps.get(fileRefs[0]) ?? []), { kind: 'update', id: before.id, before, trade: change.trade, diffs, note: change.detail }]);
      }
      for (const item of pass2.added) {
        const line = owner.get(item.fromRef);
        if (line === undefined) continue;
        for (const ref of item.related) join(line, ref);
        storedOps.set(line, [...(storedOps.get(line) ?? []), { kind: 'create', trade: item.trade, note: item.detail }]);
      }
    }
  }

  // Each row's changes.
  const createdKeys = new Map<string, number>();
  const inferred = (reason: ReconReason | undefined) => reason === 'expired' || reason === 'assigned';
  for (const line of lines) {
    const row = rows.get(line)!;
    const trade = finalTrade.get(line) ?? null;
    const match = stored.get(line) ?? null;
    const reason = reasons.get(line);
    row.existing = match;
    if (!trade) {
      // A closing fill folded into a position: shown as read; a stored copy of it goes.
      row.trade = asFill(line);
      row.fill = true;
      if (match) row.ops.push({ kind: 'delete', id: match.id, before: match, note: `現有交易 #${match.id} 是這筆平倉成交的重複紀錄，刪除` });
    } else {
      row.trade = trade;
      if (!match) {
        row.ops.push({ kind: 'create', trade, note: '' });
        const key = tradeDuplicateKey(trade);
        if (createdKeys.has(key)) {
          row.duplicateLine = createdKeys.get(key)!;
          row.warnings.push(`與${lineLabel(row.duplicateLine)}相同，請確認不是重複成交`);
        } else createdKeys.set(key, line);
      } else {
        row.diffs = meaningfulDiffs(match, trade);
        if (!compare || !row.diffs.length) {
          row.duplicateOf = match.id;
          row.warnings.push(compare ? `與現有交易 #${match.id} 相同` : `與現有交易 #${match.id} 相同，預設不匯入`);
        } else if (match.status === 'closed' && (trade.status === 'open' || inferred(reason))) {
          // A close the user recorded stays; the file only knows the expiry (or nothing).
          row.duplicateOf = match.id;
          row.warnings.push(`現有交易 #${match.id} 已平倉，保留現有的平倉資料`);
        } else {
          row.ops.push({ kind: 'update', id: match.id, before: match, trade, diffs: row.diffs, note: '' });
        }
      }
    }
    for (const extra of extras.get(line) ?? []) {
      const twin = extraStored.get(extra.trade);
      const diffs = twin ? meaningfulDiffs(twin, extra.trade) : [];
      if (!twin) row.ops.push({ kind: 'create', trade: extra.trade, note: extra.detail });
      else if (compare && diffs.length && !(twin.status === 'closed' && (extra.trade.status === 'open' || inferred(extra.reason)))) {
        row.ops.push({ kind: 'update', id: twin.id, before: twin, trade: extra.trade, diffs, note: extra.detail });
      }
    }
    row.ops.push(...(storedOps.get(line) ?? []));
    row.warnings.push(...(details.get(line) ?? []));
    const leg = legByLine.get(line)!;
    if (leg.priceGuessed && trade?.status === 'open' && leg.kind === 'option' && !match) row.warnings.push('未填目前價格，暫以成交價計算');
    row.minor = row.ops.length > 0 && row.ops.every((op) => op.kind === 'update' && op.diffs.every((diff) => !closeFields.has(diff.field)));
    if (row.minor) row.warnings.push(`與現有交易 #${row.existing?.id} 有差異；預設不更新，勾選即以檔案內容覆寫`);
  }
  for (const row of rows.values()) row.group = find(row.line);
  return legs.map((leg) => rows.get(leg.line)!);
}

/** Groups checked by default: new rows, closes and splits; not unchanged rows or other field differences. */
export function defaultImportSelection(rows: readonly ImportRow[]) {
  return new Set(rows.filter((row) => !row.errors.length && row.ops.length && !row.minor).map((row) => row.group));
}

/** Stored-trade changes for a set of rows (each stored trade changed once). */
export function importOpsOf(row: ImportRow): ImportOp[] {
  if (row.ops.length) return row.ops;
  // An unchanged row checked by hand: a second, identical trade.
  return row.trade && row.duplicateOf !== null && row.group === row.line && row.mergedInto === null ? [{ kind: 'create', trade: row.trade, note: '' }] : [];
}

function buildLeg(cells: readonly string[], line: number, mapping: ReadonlyArray<ImportField | ''>, delimiter: CsvDelimiter): Leg {
  const get = (field: ImportField) => {
    const index = mapping.indexOf(field);
    return index >= 0 ? plain(cells[index] ?? '') : '';
  };
  const number = (field: ImportField) => parseNumber(get(field), delimiter);
  const errors: string[] = [];
  const warnings: string[] = [];

  const occ = parseOccSymbol(get('ticker'));
  const typeRaw = token(get('type'));
  const appType = appTypes[typeRaw] ?? null;

  // Deposits and withdrawals (ACH, wire, 入金 / 出金): records for 存提款紀錄, not trades.
  const tickerCell = plain(get('ticker')).toUpperCase();
  const namesSecurity = Boolean(occ || get('strike') || get('expiryDate') || (tickerCell && !['USD', 'JPY', '$', '¥'].includes(tickerCell)));
  const flowIntent = appType ? null : cashFlowIntent({ type: get('type'), side: get('side'), notes: get('notes') }, namesSecurity);
  if (flowIntent) {
    const date = parseDate(get('openDate'));
    const value = number('amount') ?? number('quantity') ?? number('price');
    if (!date) errors.push(get('openDate') ? `日期「${get('openDate')}」無法辨識` : '缺少日期');
    if (value === null || value === 0) errors.push('缺少存提款金額');
    const kind = flowIntent === 'signed' ? ((value ?? 0) < 0 ? 'withdrawal' : 'deposit') : flowIntent;
    const currency = tickerCell === 'JPY' || tickerCell === '¥' || ['jp', 'jpy', 'japan', '日本'].includes(token(get('market'))) ? 'JPY' : 'USD';
    const flow: CashFlowInput = { date: date ?? '', kind, amount: Math.round(Math.abs(value ?? 0) * 100) / 100, currency, note: plain(get('notes')).slice(0, 500) };
    const placeholder: CsvTrade = { id: 0, type: 'CASH', event: 'CASH', ticker: currency, market: currency === 'JPY' ? 'JP' : 'US', strike: null, quantity: flow.amount, entryPrice: 1, currentPrice: 1, fees: 0, collateral: 0, openDate: flow.date, expiryDate: null, closeDate: null, notes: flow.note, status: 'open', quoteMode: 'manual' };
    return { line, kind: 'flow', flow, closing: 'no', sideType: 'CASH', trade: placeholder, exitPrice: null, priceGuessed: false, errors, warnings };
  }
  const eventRaw = plain(get('event')).toUpperCase();
  const side = sideOf(get('side'));
  const quantityValue = number('quantity');
  let right = rightOf(get('right')) ?? rightOf(get('type')) ?? occ?.right ?? (eventRaw === 'PUT' || eventRaw === 'CALL' ? eventRaw : null);

  let kind: Leg['kind'];
  if (appType) kind = appType === 'CASH' ? 'cash' : appType === 'SDI' || eventRaw === 'STOCK' ? 'stock' : 'option';
  else if (optionWords.includes(typeRaw) || rightOf(get('type'))) kind = 'option';
  else if (stockWords.includes(typeRaw)) kind = 'stock';
  else if (cashWords.includes(typeRaw)) kind = 'cash';
  else if (occ || right || (get('strike') && get('expiryDate'))) kind = 'option';
  else if (['USD', 'JPY'].includes(plain(get('ticker')).toUpperCase())) kind = 'cash';
  else kind = 'stock';

  const marketRaw = token(get('market'));
  const tickerRaw = (occ?.ticker ?? plain(get('ticker'))).toUpperCase().replace(/\s+/g, '');
  const japanCode = /^(\d{4})(\.T|\.JP|JT|JP)?$/.exec(tickerRaw);
  const market: 'US' | 'JP' = japanCode || tickerRaw.endsWith('.T') || ['jp', 'jpn', 'japan', '日本', '日股', '東証', 'tse', 'tyo', 'jpy'].includes(marketRaw) || (kind === 'cash' && tickerRaw === 'JPY') ? 'JP' : 'US';
  const ticker = kind === 'cash' ? (market === 'JP' ? 'JPY' : 'USD') : normalizeTickerForMarket(japanCode ? japanCode[1] : tickerRaw, market);

  const openDate = parseDate(get('openDate'));
  const closeDateRaw = get('closeDate');
  const closeDate = closeDateRaw ? parseDate(closeDateRaw) : null;
  const expiryRaw = get('expiryDate');
  const expiryDate = occ?.expiryDate ?? (expiryRaw ? parseDate(expiryRaw) : null);
  const strikeRaw = get('strike');
  const strikeNumber = occ?.strike ?? parseNumber(strikeRaw, delimiter);
  const strike = occ ? strikeText(occ.strike) : strikeRaw ? (strikeNumber !== null && strikeNumber > 0 ? strikeText(strikeNumber) : strikeRaw.toUpperCase()) : null;
  const price = number('price');
  const fees = number('fees');
  const collateral = number('collateral');
  const currentPrice = number('currentPrice');
  const exitPrice = number('exitPrice');

  if (!openDate) errors.push(get('openDate') ? `開倉日「${get('openDate')}」無法辨識` : '缺少開倉日');
  if (closeDateRaw && !closeDate) errors.push(`平倉日「${closeDateRaw}」無法辨識`);
  if (expiryRaw && !expiryDate) errors.push(`到期日「${expiryRaw}」無法辨識`);
  if (closeDate && openDate && closeDate < openDate) errors.push('平倉日早於開倉日');
  if (quantityValue === null || quantityValue === 0) errors.push(get('quantity') ? `數量「${get('quantity')}」無效` : '缺少數量');
  if (kind !== 'cash' && !ticker) errors.push('缺少代號');
  if (ticker.length > 12) errors.push(`代號「${ticker}」過長`);
  if (fees !== null && fees < 0) warnings.push('手續費為負數，已改用絕對值');

  let type = appType ?? '';
  let event = eventRaw;
  let closing: Leg['closing'] = 'no';
  let sideType = appType ?? '';
  // Broker descriptions ("… OPEN CONTRACT", "… CLOSING CONTRACT") say which fills open and which close.
  const intent = contractIntent(get('notes'));
  if (kind === 'cash') {
    type = 'CASH';
    event = 'CASH';
  } else if (kind === 'stock') {
    if (!appType) type = 'SDI';
    if (!event || event === 'PUT' || event === 'CALL') event = 'STOCK';
    sideType = 'SDI';
    if (!appType) {
      if (side === 'sell' || side === 'sellToClose') closing = 'yes';
      else if (side === 'buyToClose') errors.push('不支援股票放空回補；股票部位只記錄買入');
      else if (!side && quantityValue !== null && quantityValue < 0) closing = 'yes';
    }
  } else {
    if (market === 'JP') errors.push('日股只支援現股，無法匯入選擇權');
    if (!appType) {
      const plainDirection = side ?? (quantityValue !== null && quantityValue < 0 ? 'sell' : null);
      // A plain buy / sell is a close when the description says so (CLOSING CONTRACT).
      const direction = intent === 'close' && plainDirection === 'buy' ? 'buyToClose' : intent === 'close' && plainDirection === 'sell' ? 'sellToClose' : plainDirection;
      if (!direction) errors.push('缺少買賣方向（Buy／Sell、BTO／STO…）');
      type = direction === 'sell' || direction === 'buyToClose' ? 'Sell' : 'Buy';
      sideType = direction === 'sell' || direction === 'sellToClose' ? 'Sell' : 'Buy';
      // Explicit closes close; explicit opens open; a bare Buy / Sell closes an opposite open position if one exists.
      closing = direction === 'buyToClose' || direction === 'sellToClose' ? 'yes'
        : intent === 'open' || openSideWords.includes(token(get('side'))) || (side !== 'buy' && side !== 'sell') ? 'no' : 'maybe';
    } else if (intent === 'close' && !closeDate) {
      // The app's own export of a broker import: the row's type is the fill's side, its position the opposite.
      closing = 'yes';
      type = oppositeSide(appType);
    }
    if (!right && (event === 'PUT' || event === 'CALL')) right = event;
    if (!appType || !event) event = right ?? event;
    if (!event) errors.push('缺少 PUT／CALL');
    if (!expiryDate) warnings.push('缺少到期日');
    if (!strike) warnings.push('缺少履約價');
  }
  if (kind !== 'cash' && (price === null || price < 0)) errors.push(get('price') ? `成交價「${get('price')}」無效` : '缺少成交價');

  const statusRaw = token(get('status'));
  if (!closeDate && ['closed', '已平倉', '平倉', '決済済み', '決済'].includes(statusRaw)) errors.push('狀態為已平倉但缺少平倉日');
  const quoteModeRaw = token(get('quoteMode'));

  const quantity = Math.abs(quantityValue ?? 0);
  const trade: CsvTrade = {
    id: 0,
    type,
    event,
    ticker: ticker || null,
    market,
    strike: kind === 'cash' ? null : strike,
    quantity,
    entryPrice: kind === 'cash' ? 1 : Math.abs(price ?? 0),
    currentPrice: kind === 'cash' ? 1 : currentPrice === null ? null : Math.abs(currentPrice),
    fees: kind === 'cash' ? 0 : Math.abs(fees ?? 0),
    collateral: kind === 'cash' ? quantity : Math.abs(collateral ?? 0),
    openDate: openDate ?? '',
    expiryDate: kind === 'cash' ? null : expiryDate,
    closeDate,
    notes: plain(get('notes')).slice(0, 1000),
    status: closeDate ? 'closed' : 'open',
    quoteMode: quoteModeRaw === 'manual' ? 'manual' : quoteModeRaw === 'auto' ? 'auto' : 'manual',
  };
  if (!quoteModeRaw && trade.type === 'SDI') trade.quoteMode = 'auto';
  if (collateral === null && kind === 'option' && type === 'Sell' && event === 'PUT' && strikeNumber !== null && strikeNumber > 0 && closing !== 'yes') {
    trade.collateral = Number((strikeNumber * 100 * quantity).toFixed(2));
    warnings.push('擔保金以履約價 × 100 × 口數計算');
  }
  return { line, kind, closing, sideType: sideType || type, trade, exitPrice, priceGuessed: false, errors, warnings };
}

/** Status, current / exit price (from the file, 0 for a closed option at expiry, else the entry price) and quote mode. */
function finalizeLeg(leg: Leg) {
  const trade = leg.trade;
  trade.status = trade.closeDate ? 'closed' : 'open';
  if (trade.type === 'CASH') return;
  if (trade.status === 'closed') {
    const exit = leg.exitPrice ?? trade.currentPrice;
    if (exit !== null) trade.currentPrice = exit;
    else if (leg.kind === 'option' && trade.expiryDate && trade.closeDate! >= trade.expiryDate) {
      trade.currentPrice = 0;
      leg.warnings.push('未填平倉價，視為到期歸零（0）');
    } else leg.errors.push('已平倉交易缺少平倉價');
  } else if (trade.currentPrice === null) {
    trade.currentPrice = trade.entryPrice;
    leg.priceGuessed = true;
  }
  // Only open stocks follow live quotes, like the editor and POST /api/trades.
  trade.quoteMode = trade.type === 'SDI' && trade.status === 'open' && trade.quoteMode === 'auto' ? 'auto' : 'manual';
}
