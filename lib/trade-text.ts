/**
 * Reads a trade written as a sentence ("今天以 2.30 賣出 KO 11/20 到期 75 PUT 一口") in the browser, with
 * no AI and nothing sent anywhere. One sentence is one fill. A sentence it can't read completely (a
 * missing price, a word it doesn't know such as 蘋果 or 上週) is reported with what is missing, so the
 * user can fix it or send just that text to an AI. The result has the AI reply's shape, so the import
 * dialog plans it the same way (planAiImport matches closing fills to open trades locally). Pure.
 */
import type { AiTradeParse, AiTradeRow } from '@/lib/ai-trade-entry';
import { parseOccSymbol } from '@/lib/trade-csv';

export type TextGap = { sentence: string; missing: string[] };
export type TextParse = { rows: AiTradeRow[]; gaps: TextGap[] };

const cjkDigits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 一 → 1, 十 → 10, 十二 → 12, 二十 → 20, 二十五 → 25 (enough for quantities). */
function cjkNumber(text: string): number | null {
  if (!/^[零〇一二兩两三四五六七八九十]+$/.test(text)) return null;
  if (!text.includes('十')) return text.length === 1 ? cjkDigits[text] : null;
  const [tens, ones] = text.split('十');
  return (tens ? cjkDigits[tens] ?? Number.NaN : 1) * 10 + (ones ? cjkDigits[ones] ?? Number.NaN : 0);
}

const pad = (value: number) => String(value).padStart(2, '0');
const isoDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
};
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Ticker-looking words that are not tickers.
const notTickers = new Set(['I', 'PUT', 'PUTS', 'CALL', 'CALLS', 'P', 'C', 'BTO', 'STO', 'BTC', 'STC', 'USD', 'JPY', 'EXP', 'ETF', 'OCC', 'AM', 'PM', 'AT', 'X', 'BUY', 'SELL', 'SOLD', 'BOUGHT', 'TO', 'OPEN', 'CLOSE', 'FEE', 'FEES', 'SH', 'SHARES', 'SHARE', 'CONTRACT', 'CONTRACTS', 'LOT', 'LOTS', 'CT', 'CTS']);
// Words that can stay around the parts without changing their meaning.
const fillers = ['到期日', '到期', '開倉', '平倉', '成交價', '成交', '價格', '均價', '手續費', '手数料', '費用', '選擇權', 'オプション', '本日', '期權', '股票', '現股', '合約', '美元', '日圓', '一筆', '總共', '共', '各', '以', '於', '在', '的', '了', '和', '與', '並', '再', '又', '筆', '約', '價', '元', '口', '張', '股', '株', '枚', '買', '賣', '到', '日', '時', '用', 'を', 'で', 'に', 'が', 'は'];

type Found = { at: number; value: string };

/** One sentence → a row, or what is missing. `known` are tickers the user already holds (any case). */
function readSentence(sentence: string, today: string, known: ReadonlySet<string>): { row: AiTradeRow | null; missing: string[] } {
  let text = sentence.normalize('NFKC').replace(/[，、]/g, ' ').replace(/(\d),(?=\d{3}\b)/g, '$1');
  // Quantities in Chinese numerals: 一口、兩張、十股.
  text = text.replace(/([零〇一二兩两三四五六七八九十]+)\s*(口|張|股|株|枚)/g, (all, digits: string, unit: string) => { const n = cjkNumber(digits); return n === null ? all : `${n}${unit}`; });
  // Every part that is read is blanked out, so what is left over can be checked for words not understood.
  let rest = text;
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match) rest = rest.slice(0, match.index) + ' '.repeat(match[0].length) + rest.slice(match.index + match[0].length);
    return match;
  };

  let ticker: string | null = null;
  let right: 'PUT' | 'CALL' | null = null;
  let strike: number | null = null;
  let expiry: string | null = null;
  let date: string | null = null;
  let quantity: number | null = null;
  let kindHint: 'stock' | 'option' | null = null;
  let price: number | null = null;
  let fees: number | null = null;

  // An OCC symbol carries the whole contract.
  const occ = take(/\b([A-Z][A-Z0-9.]{0,5})\s*(\d{6}[CP]\d{8})\b/);
  if (occ) {
    const contract = parseOccSymbol(`${occ[1]}${occ[2]}`);
    if (contract) { ticker = contract.ticker; expiry = contract.expiryDate; right = contract.right; strike = contract.strike; }
  }

  // Fees before prices, so 「手續費 0.65」 is not read as the price.
  const fee = take(/(?:手續費|手数料|費用|fees?|commission)\s*[:：]?\s*\$?(\d+(?:\.\d+)?)/i);
  if (fee) fees = Number(fee[1]);

  // Dates. A date followed by 到期 / exp, or right before a strike (「11/20 75P」), is the expiry.
  const dates: Array<Found & { iso: string | null; expiry: boolean }> = [];
  const relative: Array<[RegExp, number]> = [[/前天|一昨日/, -2], [/今天|今日|本日|today/i, 0], [/昨天|昨日|yesterday/i, -1]];
  for (const [pattern, offset] of relative) {
    const match = take(pattern);
    if (match) dates.push({ at: match.index, value: match[0], iso: addDays(today, offset), expiry: false });
  }
  const datePatterns: Array<[RegExp, (m: RegExpExecArray) => [number | null, number, number]]> = [
    [/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [/(?<![\d.])(\d{1,2})月(\d{1,2})日?/, (m) => [null, Number(m[1]), Number(m[2])]],
    [/(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/, (m) => [null, Number(m[1]), Number(m[2])]],
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})\b/i, (m) => [null, months.indexOf(m[1].toLowerCase()) + 1, Number(m[2])]],
  ];
  for (const [pattern, parts] of datePatterns) {
    for (let match = take(pattern); match; match = take(pattern)) {
      const [year, month, day] = parts(match);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 16);
      const before = text.slice(Math.max(0, match.index - 16), match.index);
      const isExpiry = /^\s*(到期|満期|exp)/i.test(after) || /(exp(?:iry|iring)?|到期日?)\s*[:：]?\s*$/i.test(before)
        || /^\s*\d+(?:\.\d+)?\s*(?:PUTS?|CALLS?|P|C|賣權|買權)(?![A-Za-z])/i.test(after) || /\d\s*(?:PUTS?|CALLS?|P|C|賣權|買權)\s*$/i.test(before);
      dates.push({ at: match.index, value: match[0], iso: year ? isoDate(year, month, day) : `${month}/${day}`, expiry: isExpiry });
    }
  }
  take(/到期日?|満期|exp(?:iry|iring)?/i);

  // Right and strike: 「75 PUT」「75P」「PUT 75」「75 賣權」.
  const rightOf = (word: string): 'PUT' | 'CALL' => /^(p|put|puts|賣權|プット)$/i.test(word) ? 'PUT' : 'CALL';
  if (!right) {
    const after = take(/(?<![\d.])(\d+(?:\.\d+)?)\s*(PUTS?|CALLS?|P|C|賣權|買權|プット|コール)(?![A-Za-z])/i);
    const before = after ? null : take(/(PUTS?|CALLS?|賣權|買權|プット|コール)\s*(\d+(?:\.\d+)?)/i);
    if (after) { strike = Number(after[1]); right = rightOf(after[2]); }
    else if (before) { strike = Number(before[2]); right = rightOf(before[1]); }
  }

  // Quantity: 「1 口」「2 張」「3 contracts」 for options, 「10 股」「100 shares」 for stocks, 「x2」.
  const contracts = take(/(\d+(?:\.\d+)?)\s*(口|張|枚|contracts?|cts?|lots?)(?![A-Za-z])/i);
  const shares = contracts ? null : take(/(\d+(?:\.\d+)?)\s*(股|shares?|sh|株)(?![A-Za-z])/i);
  const times = contracts || shares ? null : take(/(?<![A-Za-z])[x×]\s*(\d+)\b/i);
  if (contracts) { quantity = Number(contracts[1]); kindHint = 'option'; }
  else if (shares) { quantity = Number(shares[1]); kindHint = 'stock'; }
  else if (times) quantity = Number(times[1]);

  // Price: 「以 2.30」「@2.3」「成交價 228.5」「$2.30」「2.30 元」.
  const priced = take(/(?:以|@|成交價|成交|價格|均價|單價|\bprice\b|\bat\b)\s*[:：]?\s*\$?(\d+(?:\.\d+)?)/i)
    ?? take(/\$(\d+(?:\.\d+)?)/) ?? take(/(\d+(?:\.\d+)?)\s*(?:元|美元|円|ドル)/);
  if (priced) price = Number(priced[1]);

  // Side and whether it opens or closes.
  const sideWords: Array<[RegExp, 'buy' | 'sell', 'open' | 'close' | null]> = [
    [/買回|買い戻し|回補|buy\s*to\s*close|\bBTC\b/i, 'buy', 'close'],
    [/賣出平倉|賣平|sell\s*to\s*close|\bSTC\b|売り決済|返済売/i, 'sell', 'close'],
    [/賣出開倉|sell\s*to\s*open|\bSTO\b|新規売|売建/i, 'sell', 'open'],
    [/買入開倉|buy\s*to\s*open|\bBTO\b|新規買|買建/i, 'buy', 'open'],
    [/賣出|賣|卖|\bsell\b|\bsold\b|売り|売/i, 'sell', null],
    [/買入|買進|買进|買い|\bbuy\b|\bbought\b|買/i, 'buy', null],
  ];
  let side: 'buy' | 'sell' | null = null;
  let action: 'open' | 'close' | null = null;
  for (const [pattern, which, how] of sideWords) {
    if (take(pattern)) { side = which; action = how; break; }
  }
  if (!action && take(/平倉|決済|返済|\bclose[ds]?\b/i)) action = 'close';
  take(/開倉|\bopen\b/i);

  // Ticker: what is left in capitals (not a keyword), a Japanese 4-digit code, or a ticker the user holds.
  if (!ticker) {
    const words = [...rest.matchAll(/\b([A-Za-z]{1,5}(?:\.[A-Za-z])?|\d{4}(?:\.T)?)\b/g)];
    for (const word of words) {
      const candidate = word[1];
      const upper = candidate.toUpperCase();
      const isJp = /^\d{4}(\.T)?$/.test(upper);
      const fits = isJp ? /股|株/.test(text) || known.has(upper) || known.has(`${upper.replace(/\.T$/, '')}.T`)
        : (candidate === upper || known.has(upper)) && !notTickers.has(upper);
      if (!fits) continue;
      ticker = isJp && !upper.endsWith('.T') ? `${upper}.T` : upper;
      rest = rest.slice(0, word.index) + ' '.repeat(candidate.length) + rest.slice(word.index + candidate.length);
      break;
    }
  }

  const kind: 'stock' | 'option' = right ? 'option' : kindHint === 'option' ? 'option' : 'stock';
  // A lone number left over is the price (「昨天 0.05 買回 KO 75P」), or the quantity once the price is
  // known (「Sold 2 KO 75P @1.15」). Two of them read as quantity then price only when written that way:
  // a whole number, then one with decimals (「BTC 1 KO 75P 0.10」).
  const loose = [...rest.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)];
  const takeLoose = (match: RegExpMatchArray) => { rest = rest.slice(0, match.index) + ' '.repeat(match[0].length) + rest.slice((match.index ?? 0) + match[0].length); return Number(match[1]); };
  if (loose.length === 1 && price === null) price = takeLoose(loose[0]);
  else if (loose.length === 1 && quantity === null && Number.isInteger(Number(loose[0][1]))) quantity = takeLoose(loose[0]);
  else if (loose.length === 2 && price === null && quantity === null && /^\d+$/.test(loose[0][1]) && loose[1][1].includes('.')) {
    quantity = takeLoose(loose[0]);
    price = takeLoose(loose[1]);
  }

  // Dates: the expiry, and the trade date (today when none is written). For an option, an unmarked date
  // is the expiry when the trade date is written as 今天／昨天, when it is still ahead, or when it is the
  // later of two.
  dates.sort((a, b) => a.at - b.at);
  const written = dates.filter((found) => !relative.some(([pattern]) => pattern.test(found.value)));
  const ahead = (found: { iso: string | null }) => !!found.iso && !/^\d{4}-/.test(found.iso) && (isoDate(Number(today.slice(0, 4)), ...found.iso.split('/').map(Number) as [number, number]) ?? '') > today;
  const expiryFound = dates.find((found) => found.expiry)
    ?? (kind !== 'option' || expiry ? null
      : written.length === 1 && (written.length < dates.length || ahead(written[0])) ? written[0]
        : written.length === 2 ? written[1] : null);
  const tradeFound = dates.find((found) => found !== expiryFound);
  const resolve = (found: { iso: string | null } | undefined, after: string | null): string | null => {
    if (!found?.iso) return null;
    if (/^\d{4}-/.test(found.iso)) return found.iso;
    const [month, day] = found.iso.split('/').map(Number);
    const year = Number(today.slice(0, 4));
    if (after) {
      const same = isoDate(Number(after.slice(0, 4)), month, day);
      return same && same >= after ? same : isoDate(Number(after.slice(0, 4)) + 1, month, day);
    }
    const thisYear = isoDate(year, month, day);
    return thisYear && thisYear <= today ? thisYear : isoDate(year - 1, month, day);
  };
  date = tradeFound ? resolve(tradeFound, null) : today;
  if (!expiry && expiryFound) expiry = resolve(expiryFound, date ?? today);

  if (!action) action = kind === 'stock' && side === 'sell' ? 'close' : 'open';

  const missing: string[] = [];
  if (!ticker) missing.push('代號');
  if (!side) missing.push('買或賣');
  if (price === null) missing.push('價格');
  if (kind === 'option' && (right === null || strike === null)) missing.push('履約價與 PUT／CALL');
  if (kind === 'option' && action === 'open' && !expiry) missing.push('到期日');
  if (quantity === null && action === 'open') missing.push(kind === 'option' ? '口數' : '股數');
  if (!date) missing.push('日期');
  // Words that were not read: anything left other than spaces, punctuation and filler words.
  let leftover = rest.replace(/\b(?:of|on|the|for|an?|and|with|each|per|my)\b/gi, ' ');
  for (const word of fillers) leftover = leftover.split(word).join(' ');
  const unknown = leftover.replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/[\s,:;!?()（）「」『』【】\-–—/@＄$%＋+×*#~。！？：；…]+/g, ' ').trim();
  if (unknown) missing.push(`看不懂「${unknown.split(/\s+/).slice(0, 3).join(' ')}」`);
  if (missing.length) return { row: null, missing };
  return {
    row: { action, date, ticker, kind, side, right: kind === 'option' ? right : null, strike: kind === 'option' ? strike : null, expiry: kind === 'option' ? expiry : null, quantity, price, fees, note: '' },
    missing: [],
  };
}

/** Each line or sentence (。；; or a new line) as one fill. */
export function parseTradeText(input: string, today: string, knownTickers: Iterable<string> = []): TextParse {
  const known = new Set([...knownTickers].map((ticker) => ticker.toUpperCase()));
  const sentences = input.split(/[\n。；;]+/).map((sentence) => sentence.trim()).filter(Boolean);
  const rows: AiTradeRow[] = [];
  const gaps: TextGap[] = [];
  for (const sentence of sentences.slice(0, 50)) {
    const { row, missing } = readSentence(sentence, today, known);
    if (row) rows.push(row);
    else gaps.push({ sentence, missing });
  }
  return { rows, gaps };
}

/** The local result as the import dialog takes it (an empty questions list). */
export const asParse = (parse: TextParse): AiTradeParse => ({ rows: parse.rows, questions: [] });
