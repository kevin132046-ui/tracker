import { NextResponse } from 'next/server';
import type { EarningsEvent } from '@/lib/earnings';
import { zonedDate, zonedDateKey } from '@/lib/market-calendar';

export const dynamic = 'force-dynamic';

type EarningsDateValue = { raw?: number; fmt?: string };
type QuoteSummaryPayload = {
  quoteSummary?: {
    result?: Array<{ calendarEvents?: { earnings?: { earningsDate?: EarningsDateValue[]; isEarningsDateEstimate?: boolean } } }> | null;
    error?: { code?: string; description?: string } | null;
  };
};
type RequestBudget = { remaining: number };
type YahooSession = { cookie: string; crumb: string; fetchedAt: number };

const symbolPattern = /^[A-Z0-9.=^-]{1,15}$/;
const maxSymbols = 40;
const maxConcurrentSymbols = 6;
// Workers cap subrequests per invocation; leave headroom so one request never exceeds it.
const maxYahooAttempts = 45;
const earningsFreshMs = 6 * 60 * 60_000;
// A symbol Yahoo has nothing for is not asked again for a while.
const missingFreshMs = 60 * 60_000;
const sessionFreshMs = 60 * 60_000;
const yahooTimeoutMs = 5_000;
const yahooHost = 'query2.finance.yahoo.com';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const earningsCache = new Map<string, { event: EarningsEvent | null; fetchedAt: number }>();
const earningsRequests = new Map<string, Promise<EarningsEvent | null>>();
let yahooSession: YahooSession | null = null;
let sessionRequest: Promise<YahooSession> | null = null;

class CrumbRejected extends Error {}

function parseSymbols(value: string | null) {
  const symbols = [...new Set(String(value ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { error: '請提供至少一個股票代號。' } as const;
  if (symbols.length > maxSymbols) return { error: `一次最多查詢 ${maxSymbols} 個代號。` } as const;
  const invalid = symbols.find((symbol) => !symbolPattern.test(symbol));
  if (invalid) return { error: `無效的代號：${invalid.slice(0, 20)}` } as const;
  return { symbols } as const;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), yahooTimeoutMs);
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// quoteSummary needs a consent cookie and a crumb issued for that cookie.
async function openYahooSession(budget: RequestBudget): Promise<YahooSession> {
  if (yahooSession && Date.now() - yahooSession.fetchedAt < sessionFreshMs) return yahooSession;
  if (sessionRequest) return sessionRequest;
  if (budget.remaining < 2) throw new Error('Yahoo request budget exhausted.');
  budget.remaining -= 2;
  sessionRequest = (async () => {
    const consent = await fetchWithTimeout('https://fc.yahoo.com/', { headers: { 'User-Agent': userAgent }, redirect: 'manual' });
    const cookie = consent.headers.getSetCookie().map((value) => value.split(';')[0]).filter(Boolean).join('; ');
    if (!cookie) throw new Error('Yahoo did not issue a session cookie.');
    const crumbResponse = await fetchWithTimeout(`https://${yahooHost}/v1/test/getcrumb`, { headers: { 'User-Agent': userAgent, Cookie: cookie } });
    const crumb = (await crumbResponse.text()).trim();
    if (!crumbResponse.ok || !crumb || crumb.length > 64 || /[<{\s]/.test(crumb)) throw new Error(`Yahoo crumb request returned ${crumbResponse.status}.`);
    yahooSession = { cookie, crumb, fetchedAt: Date.now() };
    return yahooSession;
  })().finally(() => { sessionRequest = null; });
  return sessionRequest;
}

function toEvent(symbol: string, payload: QuoteSummaryPayload): EarningsEvent | null {
  const earnings = payload.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
  const dates = (earnings?.earningsDate ?? []).map((value) => value.raw).filter((raw): raw is number => typeof raw === 'number' && Number.isFinite(raw)).sort((a, b) => a - b);
  if (!dates.length) return null;
  const timeZone = symbol.endsWith('.T') ? 'Asia/Tokyo' : 'America/New_York';
  const date = zonedDateKey(zonedDate(dates[0] * 1000, timeZone));
  const endDate = dates.length > 1 ? zonedDateKey(zonedDate(dates.at(-1)! * 1000, timeZone)) : null;
  // Yahoo sends a time of day only for confirmed US reports; midnight means "time not known".
  let timing: EarningsEvent['timing'] = null;
  if (timeZone === 'America/New_York' && !endDate) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(dates[0] * 1000));
    const minutes = Number(parts.find((part) => part.type === 'hour')?.value) * 60 + Number(parts.find((part) => part.type === 'minute')?.value);
    if (minutes > 0 && minutes < 9 * 60 + 30) timing = 'pre';
    else if (minutes >= 16 * 60) timing = 'post';
  }
  return { date, endDate: endDate === date ? null : endDate, estimate: Boolean(earnings?.isEarningsDateEstimate), timing };
}

async function fetchQuoteSummary(symbol: string, session: YahooSession) {
  const response = await fetchWithTimeout(
    `https://${yahooHost}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents&crumb=${encodeURIComponent(session.crumb)}`,
    { headers: { Accept: 'application/json', 'User-Agent': userAgent, Cookie: session.cookie } },
  );
  if (response.status === 401 || response.status === 403) throw new CrumbRejected(`${symbol} quoteSummary returned ${response.status}.`);
  // 404 is Yahoo's answer for a symbol it has no summary for.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${symbol} quoteSummary returned ${response.status}.`);
  return toEvent(symbol, await response.json() as QuoteSummaryPayload);
}

async function fetchEarnings(symbol: string, budget: RequestBudget) {
  const cached = earningsCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < (cached.event ? earningsFreshMs : missingFreshMs)) return cached.event;
  const pending = earningsRequests.get(symbol);
  if (pending) return pending;

  const request = (async () => {
    let lastError: unknown = null;
    // A rejected crumb gets one fresh session and one retry.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const session = await openYahooSession(budget);
        if (budget.remaining <= 0) break;
        budget.remaining -= 1;
        const event = await fetchQuoteSummary(symbol, session);
        earningsCache.set(symbol, { event, fetchedAt: Date.now() });
        return event;
      } catch (error) {
        lastError = error;
        if (!(error instanceof CrumbRejected)) break;
        yahooSession = null;
      }
    }
    if (cached) return cached.event;
    throw lastError instanceof Error ? lastError : new Error(`${symbol} earnings date is unavailable.`);
  })().finally(() => earningsRequests.delete(symbol));

  earningsRequests.set(symbol, request);
  return request;
}

async function settleWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function GET(request: Request) {
  const parsed = parseSymbols(new URL(request.url).searchParams.get('symbols'));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const budget: RequestBudget = { remaining: maxYahooAttempts };
  const settled = await settleWithConcurrency(parsed.symbols, maxConcurrentSymbols, (symbol) => fetchEarnings(symbol, budget));
  const earnings: Record<string, EarningsEvent> = {};
  const missing: string[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    const symbol = parsed.symbols[index];
    if (result.status === 'rejected') failed.push(symbol);
    else if (result.value) earnings[symbol] = result.value;
    else missing.push(symbol);
  });
  if (failed.length) console.warn(`Earnings dates unavailable: ${failed.join(', ')}`);
  return NextResponse.json({
    earnings,
    missing,
    failed,
    source: 'Yahoo Finance quoteSummary calendarEvents; dates are exchange-local',
  }, { headers: { 'Cache-Control': 'private, max-age=1800' } });
}
