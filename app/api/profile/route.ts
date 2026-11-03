import { NextResponse } from 'next/server';
import { sectorLabel } from '@/lib/exposure';
import { quoteSummary, type RequestBudget } from '@/lib/server/yahoo-summary';

export const dynamic = 'force-dynamic';

/** Sector of each held symbol, for the 持倉風險 panel. */
export type SymbolProfile = { sector: string | null; industry: string | null; quoteType: string | null };

type QuoteSummaryPayload = {
  quoteSummary?: {
    result?: Array<{
      assetProfile?: { sector?: string; industry?: string };
      quoteType?: { quoteType?: string };
    }> | null;
  };
};

const symbolPattern = /^[A-Z0-9.=^-]{1,15}$/;
const maxSymbols = 40;
const maxConcurrentSymbols = 6;
// Workers cap subrequests per invocation; leave headroom so one request never exceeds it.
const maxYahooAttempts = 45;
// A company's sector rarely changes, so a week is plenty.
const profileFreshMs = 7 * 24 * 60 * 60_000;
const missingFreshMs = 6 * 60 * 60_000;

const profileCache = new Map<string, { profile: SymbolProfile | null; fetchedAt: number }>();
const profileRequests = new Map<string, Promise<SymbolProfile | null>>();

function parseSymbols(value: string | null) {
  const symbols = [...new Set(String(value ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { error: '請提供至少一個股票代號。' } as const;
  if (symbols.length > maxSymbols) return { error: `一次最多查詢 ${maxSymbols} 個代號。` } as const;
  const invalid = symbols.find((symbol) => !symbolPattern.test(symbol));
  if (invalid) return { error: `無效的代號：${invalid.slice(0, 20)}` } as const;
  return { symbols } as const;
}

function toProfile(payload: QuoteSummaryPayload): SymbolProfile | null {
  const result = payload.quoteSummary?.result?.[0];
  if (!result) return null;
  const quoteType = result.quoteType?.quoteType ?? null;
  const sector = sectorLabel(result.assetProfile?.sector ?? null, quoteType);
  if (!sector && !quoteType) return null;
  return { sector, industry: result.assetProfile?.industry ?? null, quoteType };
}

async function fetchProfile(symbol: string, budget: RequestBudget) {
  const cached = profileCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < (cached.profile ? profileFreshMs : missingFreshMs)) return cached.profile;
  const pending = profileRequests.get(symbol);
  if (pending) return pending;

  const request = (async () => {
    try {
      const payload = await quoteSummary<QuoteSummaryPayload>(symbol, 'assetProfile,quoteType', budget);
      const profile = payload ? toProfile(payload) : null;
      profileCache.set(symbol, { profile, fetchedAt: Date.now() });
      return profile;
    } catch (error) {
      if (cached) return cached.profile;
      throw error instanceof Error ? error : new Error(`${symbol} profile is unavailable.`);
    }
  })().finally(() => profileRequests.delete(symbol));

  profileRequests.set(symbol, request);
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
  const settled = await settleWithConcurrency(parsed.symbols, maxConcurrentSymbols, (symbol) => fetchProfile(symbol, budget));
  const profiles: Record<string, SymbolProfile> = {};
  const missing: string[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    const symbol = parsed.symbols[index];
    if (result.status === 'rejected') failed.push(symbol);
    else if (result.value) profiles[symbol] = result.value;
    else missing.push(symbol);
  });
  if (failed.length) console.warn(`Symbol profiles unavailable: ${failed.join(', ')}`);
  return NextResponse.json({
    profiles,
    missing,
    failed,
    source: 'Yahoo Finance quoteSummary assetProfile and quoteType',
  }, { headers: { 'Cache-Control': failed.length ? 'no-store' : 'private, max-age=86400' } });
}
