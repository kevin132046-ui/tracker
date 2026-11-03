import { NextResponse } from 'next/server';
import type { FuturesCurve, IndexQuote, IndexSymbol, MarketRegimePayload } from '@/lib/market-regime';
import { easternDate, indexSymbols, isIntraday, mergeRatioHistory, parseCboeHistoryTail, parseCboeQuote, parseSettlementCsv, weekdaysBack } from '@/lib/market-regime';

export const dynamic = 'force-dynamic';

/*
 * 市場定調: Cboe's delayed index quotes (VIX9D … VIX1Y), the daily VIX and VIX3M closes for the ratio's
 * history, and the VX futures daily settlements (the latest day and the one before). Cached in memory
 * per isolate like the benchmarks route; a failed source leaves its part empty and is listed in errors.
 */
const quoteBase = 'https://cdn-api.cboe.com/api/global/delayed_quotes';
const settlementUrl = (date: string) => `https://www.cboe.com/us/futures/market_statistics/settlement/csv?dt=${date}`;
const requestHeaders = { 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' };
const timeoutMs = 6_000;
const quoteFreshMs = 60_000;
const historyFreshMs = 30 * 60_000;
const settledFreshMs = 12 * 60 * 60_000;
const pendingFreshMs = 15 * 60_000;

type Entry = { value: unknown; fetchedAt: number; freshMs: number };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** One cached request: fresh values are reused, concurrent callers share a fetch, a failure falls back to the last value. */
function cached<T>(key: string, load: () => Promise<T>, freshFor: (value: T) => number, force = false): Promise<T> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.fetchedAt < hit.freshMs) return Promise.resolve(hit.value as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const request = load().then((value) => {
    cache.set(key, { value, fetchedAt: Date.now(), freshMs: freshFor(value) });
    return value;
  }, (error: unknown) => {
    if (hit) return hit.value as T;
    throw error instanceof Error ? error : new Error(`${key} is unavailable.`);
  }).finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

async function fetchText(url: string, accept: string) {
  const response = await fetch(url, { headers: { ...requestHeaders, Accept: accept }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return response.text();
}

const quote = (symbol: IndexSymbol, force: boolean) => cached(`quote:${symbol}`, async () => {
  const parsed = parseCboeQuote(symbol, JSON.parse(await fetchText(`${quoteBase}/quotes/_${symbol}.json`, 'application/json')));
  if (!parsed) throw new Error(`${symbol} quote has no price.`);
  return parsed;
}, () => quoteFreshMs, force);

const history = (symbol: 'VIX' | 'VIX3M') => cached(`history:${symbol}`, async () => {
  const rows = parseCboeHistoryTail(await fetchText(`${quoteBase}/charts/historical/_${symbol}.json`, 'application/json'));
  if (!rows.length) throw new Error(`${symbol} history is empty.`);
  return rows;
}, () => historyFreshMs);

/** One day's VX settlements; a day without them (not published yet, weekend, holiday) is rechecked later. */
const settlement = (date: string) => cached(`vx:${date}`, async () => parseSettlementCsv(await fetchText(settlementUrl(date), 'text/csv')), (points) => points.length ? settledFreshMs : pendingFreshMs);

/** The two latest days with VX settlements, newest first, looking back through up to eight weekdays. */
async function futuresCurves(today: string): Promise<FuturesCurve[]> {
  const days = weekdaysBack(today, 8);
  const curves: FuturesCurve[] = [];
  for (const batch of [days.slice(0, 4), days.slice(4)]) {
    const settled = await Promise.allSettled(batch.map(settlement));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.length) curves.push({ date: batch[index], points: result.value });
    });
    if (curves.length >= 2) break;
  }
  return curves.slice(0, 2);
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.has('refresh');
  const today = easternDate(new Date());
  const [quoteResults, vixHistory, vix3mHistory, curves] = await Promise.all([
    Promise.allSettled(indexSymbols.map((symbol) => quote(symbol, force))),
    history('VIX').catch(() => null),
    history('VIX3M').catch(() => null),
    futuresCurves(today).catch(() => null),
  ]);
  const quotes: IndexQuote[] = quoteResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const errors = [
    ...indexSymbols.filter((_, index) => quoteResults[index].status === 'rejected'),
    ...(vixHistory && vix3mHistory ? [] : ['history']),
    ...(curves?.length ? [] : ['futures']),
  ];
  const vix = quotes.find((item) => item.symbol === 'VIX');
  const vix3m = quotes.find((item) => item.symbol === 'VIX3M');
  const latestDate = vix?.time?.slice(0, 10);
  const latest = vix && vix3m && latestDate && latestDate === vix3m.time?.slice(0, 10) ? { date: latestDate, vix: vix.price, vix3m: vix3m.price } : null;
  const ratioHistory = mergeRatioHistory(vixHistory ?? [], vix3mHistory ?? [], latest);
  const asOf = ratioHistory.at(-1)?.date ?? null;
  if (errors.length) console.warn(`Market regime data unavailable: ${errors.join(', ')}`);
  const payload: MarketRegimePayload = {
    asOf,
    intraday: Boolean(latest && latest.date === asOf && isIntraday(vix?.time ?? null)),
    quotes,
    ratioHistory,
    futures: curves?.[0] ?? null,
    futuresPrev: curves?.[1] ?? null,
    updatedAt: new Date().toISOString(),
    errors,
  };
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' } });
}
