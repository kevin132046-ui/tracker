import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Mode = 'day' | 'week' | 'month' | 'year';
type ChartResult = {
  meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number };
  timestamp?: number[];
  indicators?: {
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
    quote?: Array<{ close?: Array<number | null> }>;
  };
};
type ChartPayload = { chart?: { result?: ChartResult[] } };
type MarketConfig = {
  id: 'USDJPY' | 'US10Y' | 'US30Y';
  symbol: string;
  label: string;
  unit: string;
  decimals: number;
};

const marketConfigs: MarketConfig[] = [
  { id: 'USDJPY', symbol: 'JPY=X', label: '美元／日圓', unit: '日圓／美元', decimals: 3 },
  { id: 'US10Y', symbol: 'ZN=F', label: '10 年美債期貨', unit: '價格點（面額 100）', decimals: 3 },
  { id: 'US30Y', symbol: 'ZB=F', label: '30 年美債期貨', unit: '價格點（面額 100）', decimals: 3 },
];

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
  if (mode === 'day') {
    const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date(current);
      date.setUTCDate(current.getUTCDate() - offset);
      keys.push(date.toISOString().slice(0, 10));
    }
  } else if (mode === 'week') {
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

function bucketKey(date: Date, mode: Mode) {
  if (mode === 'day') return date.toISOString().slice(0, 10);
  if (mode === 'week') return startOfWeek(date).toISOString().slice(0, 10);
  if (mode === 'month') return date.toISOString().slice(0, 7);
  return String(date.getUTCFullYear());
}

function yahooConfig(mode: Mode) {
  if (mode === 'day' || mode === 'week') return 'range=3mo&interval=1d';
  if (mode === 'month') return 'range=1y&interval=1d';
  return 'range=5y&interval=1mo';
}

async function fetchChart(symbol: string, mode: Mode) {
  let failure: Error | null = null;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${yahooConfig(mode)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`${symbol} history returned ${response.status}.`);
      const payload = await response.json() as ChartPayload;
      const result = payload.chart?.result?.[0];
      if (result) return result;
      throw new Error(`${symbol} history returned no data.`);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(`${symbol} history is unavailable.`);
    }
  }
  throw failure ?? new Error(`${symbol} history is unavailable.`);
}

function chartPoints(result: ChartResult, adjusted: boolean) {
  const timestamps = result.timestamp ?? [];
  const adjustedCloses = result.indicators?.adjclose?.[0]?.adjclose;
  const closes = adjusted && adjustedCloses?.length ? adjustedCloses : result.indicators?.quote?.[0]?.close ?? [];
  return timestamps.flatMap((timestamp, index) => {
    const close = closes[index];
    return typeof close === 'number' && Number.isFinite(close) && close > 0 ? [{ timestamp, close }] : [];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

async function benchmarkReturns(symbol: string, mode: Mode) {
  const points = chartPoints(await fetchChart(symbol, mode), true);
  if (mode === 'day') {
    const returns = new Map<string, number>();
    for (let index = 1; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[index - 1];
      returns.set(bucketKey(new Date(current.timestamp * 1000), mode), current.close / previous.close - 1);
    }
    return bucketKeys(mode).map((key) => returns.get(key) ?? 0);
  }
  const grouped = new Map<string, number[]>();
  points.forEach((point) => {
    const key = bucketKey(new Date(point.timestamp * 1000), mode);
    grouped.set(key, [...(grouped.get(key) ?? []), point.close]);
  });
  return bucketKeys(mode).map((key) => {
    const prices = grouped.get(key) ?? [];
    return prices.length > 1 ? prices.at(-1)! / prices[0] - 1 : 0;
  });
}

async function marketHistory(config: MarketConfig, mode: Mode) {
  const result = await fetchChart(config.symbol, mode);
  const points = chartPoints(result, false);
  const grouped = new Map<string, number>();
  points.forEach((point) => grouped.set(bucketKey(new Date(point.timestamp * 1000), mode), point.close));
  const last = points.at(-1)?.close ?? null;
  const prior = points.at(-2)?.close ?? null;
  const latest = typeof result.meta?.regularMarketPrice === 'number' ? result.meta.regularMarketPrice : last;
  const previous = typeof result.meta?.chartPreviousClose === 'number'
    ? result.meta.chartPreviousClose
    : typeof result.meta?.previousClose === 'number' ? result.meta.previousClose : prior;
  return {
    ...config,
    values: bucketKeys(mode).map((key) => grouped.get(key) ?? null),
    latest,
    change: latest !== null && previous !== null ? latest - previous : null,
    changePercent: latest !== null && previous ? latest / previous - 1 : null,
  };
}

function emptyMarket(config: MarketConfig, mode: Mode) {
  return { ...config, values: bucketKeys(mode).map(() => null), latest: null, change: null, changePercent: null };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const modeParam = params.get('mode');
  const scope = params.get('scope') === 'markets' ? 'markets' : params.get('scope') === 'benchmarks' ? 'benchmarks' : 'all';
  const mode: Mode = modeParam === 'day' || modeParam === 'week' || modeParam === 'year' ? modeParam : 'month';
  const emptyReturns = bucketKeys(mode).map(() => 0);
  const benchmarkResults = scope === 'markets' ? [] : await Promise.allSettled([benchmarkReturns('SPY', mode), benchmarkReturns('BOXX', mode)]);
  const marketResults = scope === 'benchmarks' ? [] : await Promise.allSettled(marketConfigs.map((config) => marketHistory(config, mode)));
  const spy = benchmarkResults[0]?.status === 'fulfilled' ? benchmarkResults[0].value : emptyReturns;
  const boxx = benchmarkResults[1]?.status === 'fulfilled' ? benchmarkResults[1].value : emptyReturns;
  const markets = marketConfigs.map((config, index) => marketResults[index]?.status === 'fulfilled' ? marketResults[index].value : emptyMarket(config, mode));
  const warnings = [
    ...benchmarkResults.flatMap((result, index) => result.status === 'rejected' ? [['SPY', 'BOXX'][index]] : []),
    ...marketResults.flatMap((result, index) => result.status === 'rejected' ? [marketConfigs[index].symbol] : []),
  ];
  if (warnings.length) console.warn(`Market data unavailable: ${warnings.join(', ')}`);
  return NextResponse.json({
    mode,
    SPY: spy,
    BOXX: boxx,
    markets,
    warnings,
    updatedAt: new Date().toISOString(),
    source: 'Yahoo Finance — adjusted close and daily close; Treasury prices use continuous futures proxies',
  }, { headers: { 'Cache-Control': scope === 'markets' ? 'public, max-age=60, stale-while-revalidate=180' : 'public, max-age=300, stale-while-revalidate=900' } });
}
