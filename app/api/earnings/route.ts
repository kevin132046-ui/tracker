import { NextResponse } from 'next/server';
import type { EarningsEvent } from '@/lib/earnings';
import { zonedDate, zonedDateKey } from '@/lib/market-calendar';
import { quoteSummary, type RequestBudget } from '@/lib/server/yahoo-summary';

export const dynamic = 'force-dynamic';

type EarningsDateValue = { raw?: number; fmt?: string };
type QuoteSummaryPayload = {
  quoteSummary?: {
    result?: Array<{ calendarEvents?: { earnings?: { earningsDate?: EarningsDateValue[]; isEarningsDateEstimate?: boolean } } }> | null;
    error?: { code?: string; description?: string } | null;
  };
};

const symbolPattern = /^[A-Z0-9.=^-]{1,15}$/;
const maxSymbols = 40;
const maxConcurrentSymbols = 6;
// Workers cap subrequests per invocation; leave headroom so one request never exceeds it.
const maxYahooAttempts = 45;
const earningsFreshMs = 6 * 60 * 60_000;
// A symbol Yahoo has nothing for is not asked again for a while.
const missingFreshMs = 60 * 60_000;

const earningsCache = new Map<string, { event: EarningsEvent | null; fetchedAt: number }>();
const earningsRequests = new Map<string, Promise<EarningsEvent | null>>();

function parseSymbols(value: string | null) {
  const symbols = [...new Set(String(value ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { error: '請提供至少一個股票代號。' } as const;
  if (symbols.length > maxSymbols) return { error: `一次最多查詢 ${maxSymbols} 個代號。` } as const;
  const invalid = symbols.find((symbol) => !symbolPattern.test(symbol));
  if (invalid) return { error: `無效的代號：${invalid.slice(0, 20)}` } as const;
  return { symbols } as const;
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

async function fetchEarnings(symbol: string, budget: RequestBudget) {
  const cached = earningsCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < (cached.event ? earningsFreshMs : missingFreshMs)) return cached.event;
  const pending = earningsRequests.get(symbol);
  if (pending) return pending;

  const request = (async () => {
    try {
      const payload = await quoteSummary<QuoteSummaryPayload>(symbol, 'calendarEvents', budget);
      const event = payload ? toEvent(symbol, payload) : null;
      earningsCache.set(symbol, { event, fetchedAt: Date.now() });
      return event;
    } catch (error) {
      if (cached) return cached.event;
      throw error instanceof Error ? error : new Error(`${symbol} earnings date is unavailable.`);
    }
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
