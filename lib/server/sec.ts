import { env } from 'cloudflare:workers';
import type { CompanyFilings, EarningsFiling, QuarterFigure, QuarterRow } from '@/lib/filings';

/**
 * SEC EDGAR reader: ticker → CIK, a company's latest earnings filings, the text of an 8-K press
 * release, and quarterly XBRL figures. Requests carry the contact User-Agent SEC requires and are
 * spaced so one isolate stays well under SEC's 10 requests per second.
 */

type Submissions = {
  name?: string;
  filings?: { recent?: { form?: string[]; filingDate?: string[]; reportDate?: string[]; accessionNumber?: string[]; primaryDocument?: string[]; items?: string[] } };
};
type ConceptFact = { start?: string; end?: string; val?: number; form?: string; filed?: string };
type Concept = { units?: Record<string, ConceptFact[]> };

export class SecNotConfigured extends Error {}

const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
const minSpacingMs = 125;
const timeoutMs = 10_000;
const maxDocumentBytes = 1_500_000;
const maxDocumentChars = 120_000;
const tickersFreshMs = 24 * 60 * 60_000;
const submissionsFreshMs = 60 * 60_000;
const factsFreshMs = 12 * 60 * 60_000;
const documentFreshMs = 6 * 60 * 60_000;

let nextSlot = 0;
let tickerMap: { map: Map<string, { cik: string; name: string }>; fetchedAt: number } | null = null;
let tickerRequest: Promise<Map<string, { cik: string; name: string }>> | null = null;
const submissionsCache = new Map<string, { value: Submissions; fetchedAt: number }>();
const conceptCache = new Map<string, { value: Concept | null; fetchedAt: number }>();
const documentCache = new Map<string, { value: { text: string; url: string; truncated: boolean }; fetchedAt: number }>();

export const isAccession = (value: string) => accessionPattern.test(value);
const padCik = (cik: string) => cik.padStart(10, '0');

function userAgent() {
  const contact = String(env.SEC_CONTACT ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new SecNotConfigured('SEC_CONTACT is not set.');
  return `OptionFlow/1.0 (${contact})`;
}

async function secFetch(url: string) {
  const agent = userAgent();
  // Reserve the next free slot so concurrent callers queue instead of bursting.
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + minSpacingMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { 'User-Agent': agent, Accept: 'application/json, text/html;q=0.9' }, cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function secJson<T>(url: string): Promise<T | null> {
  const response = await secFetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`SEC returned ${response.status} for ${new URL(url).pathname}.`);
  return await response.json() as T;
}

export async function lookupCik(ticker: string) {
  if (!tickerMap || Date.now() - tickerMap.fetchedAt > tickersFreshMs) {
    tickerRequest ??= (async () => {
      const payload = await secJson<Record<string, { cik_str?: number; ticker?: string; title?: string }>>('https://www.sec.gov/files/company_tickers.json');
      const map = new Map<string, { cik: string; name: string }>();
      Object.values(payload ?? {}).forEach((entry) => {
        if (entry.ticker && entry.cik_str) map.set(entry.ticker.toUpperCase(), { cik: String(entry.cik_str), name: entry.title ?? entry.ticker });
      });
      if (!map.size) throw new Error('SEC ticker list is empty.');
      tickerMap = { map, fetchedAt: Date.now() };
      return map;
    })().finally(() => { tickerRequest = null; });
    await tickerRequest;
  }
  // SEC writes share classes with a dash (BRK-B); Yahoo uses a dot (BRK.B).
  return tickerMap!.map.get(ticker.toUpperCase()) ?? tickerMap!.map.get(ticker.toUpperCase().replace('.', '-')) ?? null;
}

async function submissions(cik: string) {
  const cached = submissionsCache.get(cik);
  if (cached && Date.now() - cached.fetchedAt < submissionsFreshMs) return cached.value;
  const value = await secJson<Submissions>(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`) ?? {};
  submissionsCache.set(cik, { value, fetchedAt: Date.now() });
  return value;
}

const filingUrl = (cik: string, accession: string, document = '') => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${document}`;

/** Newest 8-K reporting results (Item 2.02) and newest 10-Q / 10-K. */
export async function latestEarningsFilings(cik: string, name: string): Promise<CompanyFilings> {
  const recent = (await submissions(cik)).filings?.recent ?? {};
  const forms = recent.form ?? [];
  let earningsRelease: EarningsFiling | null = null;
  let periodicReport: EarningsFiling | null = null;
  // `recent` is newest first.
  for (let index = 0; index < forms.length && (!earningsRelease || !periodicReport); index += 1) {
    const form = forms[index];
    const accession = recent.accessionNumber?.[index] ?? '';
    if (!isAccession(accession)) continue;
    const items = String(recent.items?.[index] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    const filing = { form, accession, filed: recent.filingDate?.[index] ?? '', reportDate: recent.reportDate?.[index] || null, items, url: filingUrl(cik, accession, recent.primaryDocument?.[index] ?? '') };
    if (!earningsRelease && (form === '8-K' || form === '8-K/A') && items.includes('2.02')) earningsRelease = filing;
    if (!periodicReport && (form === '10-Q' || form === '10-K')) periodicReport = filing;
  }
  return { cik, name: (await submissions(cik)).name ?? name, earningsRelease, periodicReport };
}

/** A filing listed in the company's recent submissions, or null. Guards against arbitrary accessions. */
export async function findFiling(cik: string, accession: string) {
  const recent = (await submissions(cik)).filings?.recent ?? {};
  const index = (recent.accessionNumber ?? []).indexOf(accession);
  if (index < 0) return null;
  return { form: recent.form?.[index] ?? '', filed: recent.filingDate?.[index] ?? '', primaryDocument: recent.primaryDocument?.[index] ?? '' };
}

const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', bull: '•' };

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|div|tr|li|h\d|table|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : ' ';
      }
      return entities[code.toLowerCase()] ?? match;
    })
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .trim();
}

async function readCapped(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxDocumentBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(size, maxDocumentBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.min(chunk.byteLength, bytes.length - offset));
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.length) break;
  }
  return new TextDecoder().decode(bytes);
}

/** The press release (EX-99.1) of an 8-K, or the filing's main document otherwise, as plain text. */
export async function filingText(cik: string, accession: string, primaryDocument: string) {
  const cached = documentCache.get(accession);
  if (cached && Date.now() - cached.fetchedAt < documentFreshMs) return cached.value;
  const index = await secJson<{ directory?: { item?: Array<{ name?: string }> } }>(filingUrl(cik, accession, 'index.json'));
  const names = (index?.directory?.item ?? []).map((item) => item.name ?? '').filter((name) => /\.html?$/i.test(name));
  const exhibit = names.find((name) => /ex[-_]?99[-_.]?0?1(?!\d)|exhibit[-_]?99[-_.]?0?1(?!\d)/i.test(name))
    ?? names.find((name) => /ex[-_]?99/i.test(name) && name !== primaryDocument);
  const document = exhibit ?? primaryDocument;
  if (!document) throw new Error('Filing has no readable document.');
  const url = filingUrl(cik, accession, document);
  const response = await secFetch(url);
  if (!response.ok) throw new Error(`SEC returned ${response.status} for the filing document.`);
  const text = htmlToText(await readCapped(response));
  const value = { text: text.slice(0, maxDocumentChars), url, truncated: text.length > maxDocumentChars };
  documentCache.set(accession, { value, fetchedAt: Date.now() });
  return value;
}

async function concept(cik: string, name: string) {
  const key = `${cik}:${name}`;
  const cached = conceptCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < factsFreshMs) return cached.value;
  const value = await secJson<Concept>(`https://data.sec.gov/api/xbrl/companyconcept/CIK${padCik(cik)}/us-gaap/${name}.json`);
  conceptCache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

const days = (start: string, end: string) => (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;

/**
 * Quarterly values of a flow concept, newest last. Fourth quarters are rarely tagged on their
 * own, so a missing one is the fiscal year minus its three quarters (marked derived).
 */
export function quarterlySeries(facts: ConceptFact[]): QuarterFigure[] {
  const latest = new Map<string, ConceptFact>();
  facts.forEach((fact) => {
    if (!fact.start || !fact.end || typeof fact.val !== 'number' || !Number.isFinite(fact.val)) return;
    const key = `${fact.start}|${fact.end}`;
    const current = latest.get(key);
    if (!current || String(fact.filed ?? '') > String(current.filed ?? '')) latest.set(key, fact);
  });
  const all = [...latest.values()];
  const quarters = new Map<string, QuarterFigure>();
  all.filter((fact) => { const length = days(fact.start!, fact.end!); return length >= 80 && length <= 100; })
    .forEach((fact) => quarters.set(fact.end!, { start: fact.start!, end: fact.end!, value: fact.val!, derived: false }));
  all.filter((fact) => { const length = days(fact.start!, fact.end!); return length >= 350 && length <= 380; })
    .forEach((year) => {
      if (quarters.has(year.end!)) return;
      const inside = [...quarters.values()].filter((quarter) => quarter.start >= year.start! && quarter.end < year.end!);
      if (inside.length !== 3) return;
      const lastEnd = inside.map((quarter) => quarter.end).sort().at(-1)!;
      const start = new Date(Date.parse(`${lastEnd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      quarters.set(year.end!, { start, end: year.end!, value: year.val! - inside.reduce((sum, quarter) => sum + quarter.value, 0), derived: true });
    });
  return [...quarters.values()].sort((a, b) => a.end.localeCompare(b.end));
}

async function firstSeries(cik: string, names: string[], unit: string) {
  let best: QuarterFigure[] = [];
  for (const name of names) {
    const series = quarterlySeries((await concept(cik, name))?.units?.[unit] ?? []);
    if (series.length && (!best.length || series.at(-1)!.end > best.at(-1)!.end)) best = series;
    // The first concept with a value in the last year is good enough.
    if (best.length && days(best.at(-1)!.end, new Date().toISOString().slice(0, 10)) < 370) break;
  }
  return best;
}

/** The last `count` quarters of revenue, diluted EPS and gross margin. */
export async function quarterlyFigures(cik: string, count = 8): Promise<QuarterRow[]> {
  const revenue = await firstSeries(cik, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], 'USD');
  const eps = await firstSeries(cik, ['EarningsPerShareDiluted'], 'USD/shares');
  let grossProfit = await firstSeries(cik, ['GrossProfit'], 'USD');
  if (!grossProfit.length && revenue.length) {
    const cost = await firstSeries(cik, ['CostOfRevenue', 'CostOfGoodsAndServicesSold'], 'USD');
    const revenueByEnd = new Map(revenue.map((quarter) => [quarter.end, quarter]));
    grossProfit = cost.flatMap((quarter) => {
      const sales = revenueByEnd.get(quarter.end);
      return sales ? [{ ...quarter, value: sales.value - quarter.value, derived: quarter.derived || sales.derived }] : [];
    });
  }
  const ends = [...new Set([...revenue, ...eps].map((quarter) => quarter.end))].sort().slice(-count);
  return ends.map((end) => {
    const sales = revenue.find((quarter) => quarter.end === end) ?? null;
    const perShare = eps.find((quarter) => quarter.end === end) ?? null;
    const gross = grossProfit.find((quarter) => quarter.end === end) ?? null;
    return {
      end,
      revenue: sales,
      epsDiluted: perShare,
      grossMargin: sales && gross && sales.value > 0 ? gross.value / sales.value : null,
      derived: Boolean(sales?.derived || perShare?.derived || gross?.derived),
    };
  });
}
