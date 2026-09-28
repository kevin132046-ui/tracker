/**
 * CSV export and import of trades.
 *
 * Export writes the app's own columns (UTF-8 with BOM). Import reads the app's export or a
 * broker/spreadsheet file: comma, tab or semicolon delimiters, quoted fields, English / 中文 /
 * 日本語 headers, and maps each row to the Trade shape that POST /api/trades accepts, with
 * per-row errors, warnings and duplicate detection. Pure: no React, no network.
 */

import { isYenTicker, normalizeTickerForMarket } from '@/lib/performance';

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
  | 'status' | 'quoteMode' | 'notes';

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
const cashWords = ['cash', '現金', '现金', 'deposit', '入金'];

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

export type ImportRow = {
  /** Line in the file (the header is line 1). */
  line: number;
  trade: CsvTrade | null;
  errors: string[];
  warnings: string[];
  /** Id of an existing trade with the same key. */
  duplicateOf: number | null;
  /** Earlier line in the file with the same key. */
  duplicateLine: number | null;
  /** A closing fill (BTC / STC / stock sale) folded into the opening row on this line. */
  mergedInto: number | null;
};

type Leg = {
  line: number;
  kind: 'stock' | 'option' | 'cash';
  closing: boolean;
  trade: CsvTrade;
  exitPrice: number | null;
  errors: string[];
  warnings: string[];
};

export type MapOptions = { existing: readonly CsvTrade[]; delimiter?: CsvDelimiter };

/** Each data row as a Trade for POST /api/trades, with validation, closing-fill pairing and duplicate flags. */
export function mapImportRows(table: CsvTable, mapping: ReadonlyArray<ImportField | ''>, options: MapOptions): ImportRow[] {
  const delimiter = options.delimiter ?? table.delimiter;
  const legs = table.rows.map((cells, index) => buildLeg(cells, index + 2, mapping, delimiter));
  const rows = new Map<number, ImportRow>(legs.map((leg) => [leg.line, { line: leg.line, trade: null, errors: leg.errors, warnings: leg.warnings, duplicateOf: null, duplicateLine: null, mergedInto: null }]));

  // Fold closing fills into the earliest matching open of the same contract and size (FIFO).
  const openings = legs.filter((leg) => !leg.closing && !leg.errors.length);
  const taken = new Set<number>();
  for (const closing of legs.filter((leg) => leg.closing)) {
    const row = rows.get(closing.line)!;
    if (closing.errors.length) continue;
    const sameContract = openings.filter((open) => open.kind === closing.kind && open.trade.ticker === closing.trade.ticker && open.trade.type === closing.trade.type
      && open.trade.event === closing.trade.event && strikeKey(open.trade.strike) === strikeKey(closing.trade.strike) && open.trade.expiryDate === closing.trade.expiryDate
      && !open.trade.closeDate && !taken.has(open.line) && open.trade.openDate <= closing.trade.openDate)
      .sort((a, b) => a.trade.openDate.localeCompare(b.trade.openDate) || a.line - b.line);
    const match = sameContract.find((open) => amountKey(open.trade.quantity) === amountKey(closing.trade.quantity));
    if (!match) {
      row.errors.push(sameContract.length ? '平倉數量與開倉紀錄不同，請手動拆分後再匯入' : '找不到對應的開倉紀錄（平倉成交需與開倉成交一起匯入）');
      continue;
    }
    taken.add(match.line);
    match.trade.closeDate = closing.trade.openDate;
    match.exitPrice = closing.trade.entryPrice;
    match.trade.fees = Number((match.trade.fees + closing.trade.fees).toFixed(6));
    match.warnings.push(`已合併第 ${closing.line} 列的平倉成交`);
    row.mergedInto = match.line;
  }

  const existingKeys = new Map<string, number>();
  for (const trade of options.existing) if (!trade.derived) existingKeys.set(tradeDuplicateKey(trade), trade.id);
  const fileKeys = new Map<string, number>();
  for (const leg of legs) {
    const row = rows.get(leg.line)!;
    if (leg.closing || row.errors.length) continue;
    finalizeLeg(leg);
    if (leg.errors.length) continue;
    row.trade = leg.trade;
    const key = tradeDuplicateKey(leg.trade);
    row.duplicateOf = existingKeys.get(key) ?? null;
    row.duplicateLine = fileKeys.get(key) ?? null;
    if (row.duplicateOf !== null) row.warnings.push(`與現有交易 #${row.duplicateOf} 相同（標的、類型、策略、履約價、開倉日、數量、成交價），預設不匯入`);
    else if (row.duplicateLine !== null) row.warnings.push(`與第 ${row.duplicateLine} 列相同，請確認不是重複成交`);
    if (!fileKeys.has(key)) fileKeys.set(key, leg.line);
  }
  return legs.map((leg) => rows.get(leg.line)!);
}

/** Rows checked by default: importable, not duplicates of existing trades and not folded into another row. */
export const defaultImportSelection = (rows: readonly ImportRow[]) => new Set(rows.filter((row) => row.trade && row.duplicateOf === null).map((row) => row.line));

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
  let closing = false;
  if (kind === 'cash') {
    type = 'CASH';
    event = 'CASH';
  } else if (kind === 'stock') {
    if (!appType) type = 'SDI';
    if (!event || event === 'PUT' || event === 'CALL') event = 'STOCK';
    if (!appType) {
      if (side === 'sell' || side === 'sellToClose') closing = true;
      else if (side === 'buyToClose') errors.push('不支援股票放空回補；股票部位只記錄買入');
      else if (!side && quantityValue !== null && quantityValue < 0) closing = true;
    }
  } else {
    if (market === 'JP') errors.push('日股只支援現股，無法匯入選擇權');
    if (!appType) {
      const direction = side ?? (quantityValue !== null && quantityValue < 0 ? 'sell' : null);
      if (!direction) errors.push('缺少買賣方向（Buy／Sell、BTO／STO…）');
      type = direction === 'sell' || direction === 'buyToClose' ? 'Sell' : 'Buy';
      closing = direction === 'buyToClose' || direction === 'sellToClose';
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
  if (collateral === null && kind === 'option' && type === 'Sell' && event === 'PUT' && strikeNumber !== null && strikeNumber > 0 && !closing) {
    trade.collateral = Number((strikeNumber * 100 * quantity).toFixed(2));
    warnings.push('擔保金以履約價 × 100 × 口數計算');
  }
  return { line, kind, closing, trade, exitPrice, errors, warnings };
}

/** Status, current / exit price and quote mode once any closing fill has been folded in. */
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
    if (leg.kind === 'option') leg.warnings.push('未填目前價格，暫以成交價計算');
  }
  // Only open stocks follow live quotes, like the editor and POST /api/trades.
  trade.quoteMode = trade.type === 'SDI' && trade.status === 'open' && trade.quoteMode === 'auto' ? 'auto' : 'manual';
}
