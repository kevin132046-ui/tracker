import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type ChartResult = {
  meta?: { gmtoffset?: number };
  timestamp?: number[];
  indicators?: {
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
    quote?: Array<{ close?: Array<number | null> }>;
  };
  events?: { splits?: Record<string, { date?: number; numerator?: number; denominator?: number }> };
};
type ChartPayload = { chart?: { result?: ChartResult[] } };
/** [local exchange date, close, adjusted close] */
type PriceBar = [string, number, number];
/** [first local date at the new basis, numerator ÷ denominator]; Yahoo books spin-offs as splits too. */
type SplitEvent = [string, number];
type History = { bars: PriceBar[]; splits: SplitEvent[] };
type RequestBudget = { remaining: number };

const symbolPattern = /^[A-Z0-9.=^-]{1,15}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maxSymbols = 40;
const maxConcurrentSymbols = 6;
// Workers cap subrequests per invocation; leave headroom so one request never exceeds it.
const maxYahooAttempts = 45;
const historyFreshMs = 10 * 60_000;
const yahooTimeoutMs = 5_000;
const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'] as const;

const historyCache = new Map<string, { history: History; fetchedAt: number }>();
const historyRequests = new Map<string, Promise<History>>();

const roundPrice = (value: number) => Math.round(value * 1e6) / 1e6;

function parseSymbols(value: string | null) {
  const symbols = [...new Set(String(value ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { error: '請提供至少一個股票代號。' } as const;
  if (symbols.length > maxSymbols) return { error: `一次最多查詢 ${maxSymbols} 個代號。` } as const;
  const invalid = symbols.find((symbol) => !symbolPattern.test(symbol));
  if (invalid) return { error: `無效的代號：${invalid.slice(0, 20)}` } as const;
  return { symbols } as const;
}

/** Valid, not in the future, at most 10 years back, rounded down to the first of the month. */
function parseFrom(value: string | null) {
  const from = String(value ?? '');
  const timestamp = Date.parse(`${from}T00:00:00Z`);
  if (!datePattern.test(from) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== from) return null;
  const now = new Date();
  // Allow one day of slack for clients whose local date is ahead of UTC.
  const latest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
  if (from > latest) return null;
  const earliest = `${now.getUTCFullYear() - 10}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const monthStart = `${from.slice(0, 7)}-01`;
  return monthStart < earliest ? earliest : monthStart;
}

function toBars(result: ChartResult): PriceBar[] {
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const adjustedCloses = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const offset = Number.isFinite(result.meta?.gmtoffset) ? Number(result.meta?.gmtoffset) : 0;
  const byDate = new Map<string, PriceBar>();
  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0 || !Number.isFinite(timestamp)) return;
    const adjusted = adjustedCloses[index];
    const date = new Date((timestamp + offset) * 1000).toISOString().slice(0, 10);
    // A later bar on the same local date (e.g. Yahoo's live bar) replaces the earlier one.
    byDate.set(date, [date, roundPrice(close), roundPrice(typeof adjusted === 'number' && Number.isFinite(adjusted) && adjusted > 0 ? adjusted : close)]);
  });
  return [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Split (and spin-off) events with the local date they take effect: Yahoo's closes before it are scaled by 1 ÷ ratio. */
function toSplits(result: ChartResult): SplitEvent[] {
  const offset = Number.isFinite(result.meta?.gmtoffset) ? Number(result.meta?.gmtoffset) : 0;
  return Object.values(result.events?.splits ?? {}).flatMap((event) => {
    const numerator = Number(event?.numerator);
    const denominator = Number(event?.denominator);
    const timestamp = Number(event?.date);
    if (!(numerator > 0) || !(denominator > 0) || !Number.isFinite(timestamp) || numerator === denominator) return [];
    return [[new Date((timestamp + offset) * 1000).toISOString().slice(0, 10), Math.round((numerator / denominator) * 1e9) / 1e9] as SplitEvent];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}

async function fetchYahooHistory(host: string, symbol: string, period1: number, period2: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), yahooTimeoutMs);
  try {
    const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=split`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${symbol} history returned ${response.status}.`);
    const payload = await response.json() as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (!result) throw new Error(`${symbol} history returned no data.`);
    return { bars: toBars(result), splits: toSplits(result) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHistory(symbol: string, from: string, budget: RequestBudget) {
  const key = `${symbol}:${from}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < historyFreshMs) return cached.history;
  const pending = historyRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const period1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    const period2 = Math.floor(Date.now() / 1000) + 86_400;
    let lastError: unknown = null;
    for (const host of yahooHosts) {
      if (budget.remaining <= 0) break;
      budget.remaining -= 1;
      try {
        const history = await fetchYahooHistory(host, symbol, period1, period2);
        historyCache.set(key, { history, fetchedAt: Date.now() });
        return history;
      } catch (error) {
        lastError = error;
      }
    }
    if (cached) return cached.history;
    throw lastError instanceof Error ? lastError : new Error(`${symbol} history is unavailable.`);
  })().finally(() => historyRequests.delete(key));

  historyRequests.set(key, request);
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
  const params = new URL(request.url).searchParams;
  const parsed = parseSymbols(params.get('symbols'));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const from = parseFrom(params.get('from'));
  if (!from) return NextResponse.json({ error: '請提供有效且不晚於今天的開始日期（YYYY-MM-DD）。' }, { status: 400 });

  const budget: RequestBudget = { remaining: maxYahooAttempts };
  const settled = await settleWithConcurrency(parsed.symbols, maxConcurrentSymbols, (symbol) => fetchHistory(symbol, from, budget));
  const series: Record<string, PriceBar[]> = {};
  const splits: Record<string, SplitEvent[]> = {};
  const failed: string[] = [];
  settled.forEach((result, index) => {
    const symbol = parsed.symbols[index];
    if (result.status === 'fulfilled' && result.value.bars.length) {
      series[symbol] = result.value.bars;
      if (result.value.splits.length) splits[symbol] = result.value.splits;
    } else failed.push(symbol);
  });
  if (failed.length) console.warn(`Price history unavailable: ${failed.join(', ')}`);
  return NextResponse.json({
    from,
    series,
    splits,
    failed,
    source: 'Yahoo Finance daily close and adjusted close, with split and spin-off events; dates are exchange-local trading days',
  }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
