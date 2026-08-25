import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Mode = 'week' | 'month' | 'year';
type ChartPayload = {
  chart?: { result?: Array<{
    timestamp?: number[];
    indicators?: {
      adjclose?: Array<{ adjclose?: Array<number | null> }>;
      quote?: Array<{ close?: Array<number | null> }>;
    };
  }> };
};

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function bucketKeys(mode: Mode) {
  const now = new Date();
  const keys: string[] = [];
  if (mode === 'week') {
    const current = startOfWeek(now);
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(current);
      date.setUTCDate(current.getUTCDate() - offset * 7);
      keys.push(date.toISOString().slice(0, 10));
    }
  } else if (mode === 'month') {
    for (let offset = 11; offset >= 0; offset -= 1) {
      keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7));
    }
  } else {
    for (let offset = 4; offset >= 0; offset -= 1) keys.push(String(now.getUTCFullYear() - offset));
  }
  return keys;
}

async function benchmarkReturns(symbol: string, mode: Mode) {
  const config = mode === 'week' ? 'range=3mo&interval=1d' : mode === 'month' ? 'range=1y&interval=1d' : 'range=5y&interval=1mo';
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?${config}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OptionFlow/1.0' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${symbol} benchmark is unavailable.`);
  const payload = await response.json() as ChartPayload;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
  const grouped = new Map<string, number[]>();
  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== 'number' || !Number.isFinite(close)) return;
    const date = new Date(timestamp * 1000);
    const key = mode === 'week' ? startOfWeek(date).toISOString().slice(0, 10) : mode === 'month' ? date.toISOString().slice(0, 7) : String(date.getUTCFullYear());
    grouped.set(key, [...(grouped.get(key) ?? []), close]);
  });
  return bucketKeys(mode).map((key) => {
    const prices = grouped.get(key) ?? [];
    return prices.length > 1 ? prices.at(-1)! / prices[0] - 1 : 0;
  });
}

export async function GET(request: Request) {
  const modeParam = new URL(request.url).searchParams.get('mode');
  const mode: Mode = modeParam === 'week' || modeParam === 'year' ? modeParam : 'month';
  try {
    const [spy, boxx] = await Promise.all([benchmarkReturns('SPY', mode), benchmarkReturns('BOXX', mode)]);
    return NextResponse.json({ mode, SPY: spy, BOXX: boxx, updatedAt: new Date().toISOString(), source: 'Yahoo Finance — adjusted close' }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load benchmarks.' }, { status: 502 });
  }
}
