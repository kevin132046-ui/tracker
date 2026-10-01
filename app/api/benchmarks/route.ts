import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type Mode = 'day' | 'week' | 'month' | 'year';
type ChartResult = {
  meta?: { regularMarketPrice?: number; previousClose?: number };
  timestamp?: number[];
  indicators?: {
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
    quote?: Array<{ close?: Array<number | null> }>;
  };
};
type ChartPayload = { chart?: { result?: ChartResult[] } };
type MarketConfig = {
  id: 'USDJPY' | 'US10Y' | 'US30Y' | 'GOLD' | 'OIL' | 'US3M' | 'US5Y';
  providerSymbol: string;
  symbol: string;
  label: string;
  unit: string;
  decimals: number;
};

const marketConfigs: MarketConfig[] = [
  { id: 'USDJPY', providerSymbol: 'JPY=X', symbol: 'USD/JPY', label: '美元／日圓', unit: '日圓／美元', decimals: 2 },
  { id: 'US10Y', providerSymbol: '^TNX', symbol: 'US10-YR', label: '美國公債10年期', unit: '殖利率（%）', decimals: 2 },
  { id: 'US30Y', providerSymbol: '^TYX', symbol: 'US30-YR', label: '美國公債30年期', unit: '殖利率（%）', decimals: 2 },
  { id: 'GOLD', providerSymbol: 'GC=F', symbol: 'GC=F', label: '黃金期貨', unit: '美元／盎司', decimals: 2 },
  { id: 'OIL', providerSymbol: 'CL=F', symbol: 'CL=F', label: 'WTI 原油期貨', unit: '美元／桶', decimals: 2 },
];
// 殖利率曲線 only (Yahoo's Treasury yield indexes: 13-week bill, 5, 10 and 30 years).
const curveConfigs: MarketConfig[] = [
  { id: 'US3M', providerSymbol: '^IRX', symbol: '3M', label: '3 個月', unit: '殖利率（%）', decimals: 2 },
  { id: 'US5Y', providerSymbol: '^FVX', symbol: '5Y', label: '5 年', unit: '殖利率（%）', decimals: 2 },
  marketConfigs[1],
  marketConfigs[2],
];

const chartCache = new Map<string, { result: ChartResult; fetchedAt: number }>();
const chartRequests = new Map<string, Promise<ChartResult>>();
const chartFreshMs = 55_000;
const yahooTimeoutMs = 4_200;

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
    // The last 60 weekdays (weekends carry no prices).
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    while (keys.length < 60) {
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) keys.unshift(date.toISOString().slice(0, 10));
      date.setUTCDate(date.getUTCDate() - 1);
    }
  } else if (mode === 'week') {
    const current = startOfWeek(now);
    for (let offset = 51; offset >= 0; offset -= 1) {
      const date = new Date(current);
      date.setUTCDate(current.getUTCDate() - offset * 7);
      keys.push(date.toISOString().slice(0, 10));
    }
  } else if (mode === 'month') {
    for (let offset = 35; offset >= 0; offset -= 1) {
      keys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7));
    }
  } else {
    for (let offset = 5; offset >= 0; offset -= 1) keys.push(String(now.getUTCFullYear() - offset));
  }
  return keys;
}

function bucketKey(date: Date, mode: Mode) {
  if (mode === 'day') return date.toISOString().slice(0, 10);
  if (mode === 'week') return startOfWeek(date).toISOString().slice(0, 10);
  if (mode === 'month') return date.toISOString().slice(0, 7);
  return String(date.getUTCFullYear());
}

// Each range reaches back past the first bucket so chain-linked returns have a prior close.
function yahooConfig(mode: Mode) {
  if (mode === 'day') return 'range=6mo&interval=1d';
  if (mode === 'week') return 'range=2y&interval=1d';
  if (mode === 'month') return 'range=5y&interval=1wk';
  return 'range=10y&interval=1mo';
}

async function fetchYahooChart(host: string, symbol: string, mode: Mode, sharedSignal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  sharedSignal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), yahooTimeoutMs);
  try {
    const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${yahooConfig(mode)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${symbol} history returned ${response.status}.`);
    const payload = await response.json() as ChartPayload;
    const result = payload.chart?.result?.[0];
    if (result) return result;
    throw new Error(`${symbol} history returned no data.`);
  } finally {
    clearTimeout(timeout);
    sharedSignal.removeEventListener('abort', abort);
  }
}

async function fetchChart(symbol: string, mode: Mode, force = false) {
  const key = `${symbol}:${mode}`;
  const cached = chartCache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < chartFreshMs) return cached.result;
  const pending = chartRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const sharedController = new AbortController();
    let secondaryTimer: ReturnType<typeof setTimeout> | null = null;
    const secondary = new Promise<ChartResult>((resolve, reject) => {
      secondaryTimer = setTimeout(() => {
        void fetchYahooChart('query2.finance.yahoo.com', symbol, mode, sharedController.signal).then(resolve, reject);
      }, 250);
    });
    try {
      const result = await Promise.any([
        fetchYahooChart('query1.finance.yahoo.com', symbol, mode, sharedController.signal),
        secondary,
      ]);
      chartCache.set(key, { result, fetchedAt: Date.now() });
      return result;
    } catch (error) {
      if (cached) return cached.result;
      throw error instanceof Error ? error : new Error(`${symbol} history is unavailable.`);
    } finally {
      if (secondaryTimer) clearTimeout(secondaryTimer);
      sharedController.abort();
    }
  })().finally(() => chartRequests.delete(key));

  chartRequests.set(key, request);
  return request;
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

// Chain-linked bucket returns: the last close in a bucket over the last close of any earlier
// bucket, so consecutive buckets compound to the full-period return (0 when either is missing).
async function benchmarkReturns(symbol: string, mode: Mode, keys: string[]) {
  const points = chartPoints(await fetchChart(symbol, mode), true)
    .map((point) => ({ key: bucketKey(new Date(point.timestamp * 1000), mode), close: point.close }));
  return keys.map((key) => {
    let last: number | null = null;
    let base: number | null = null;
    for (const point of points) {
      if (point.key < key) base = point.close;
      else if (point.key === key) last = point.close;
    }
    return last !== null && base !== null ? last / base - 1 : 0;
  });
}

async function marketHistory(config: MarketConfig, mode: Mode, force = false) {
  const result = await fetchChart(config.providerSymbol, mode, force);
  const points = chartPoints(result, false);
  const grouped = new Map<string, number>();
  points.forEach((point) => grouped.set(bucketKey(new Date(point.timestamp * 1000), mode), point.close));
  const last = points.at(-1)?.close ?? null;
  const prior = points.at(-2)?.close ?? null;
  const latest = typeof result.meta?.regularMarketPrice === 'number' ? result.meta.regularMarketPrice : last;
  const previous = typeof result.meta?.previousClose === 'number' ? result.meta.previousClose : prior;
  return {
    id: config.id,
    symbol: config.symbol,
    label: config.label,
    unit: config.unit,
    decimals: config.decimals,
    values: bucketKeys(mode).map((key) => grouped.get(key) ?? null),
    latest,
    change: latest !== null && previous !== null ? latest - previous : null,
    changePercent: latest !== null && previous ? latest / previous - 1 : null,
  };
}

function emptyMarket(config: MarketConfig, mode: Mode) {
  return { id: config.id, symbol: config.symbol, label: config.label, unit: config.unit, decimals: config.decimals, values: bucketKeys(mode).map(() => null), latest: null, change: null, changePercent: null };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get('scope') === 'curve') {
    const settled = await Promise.allSettled(curveConfigs.map((config) => marketHistory(config, 'month', params.has('refresh'))));
    const points = curveConfigs.map((config, index) => {
      const result = settled[index];
      const value = result.status === 'fulfilled' ? result.value : null;
      return { id: config.id, tenor: config.symbol, label: config.label, latest: value?.latest ?? null, change: value?.change ?? null };
    });
    return NextResponse.json({ points, updatedAt: new Date().toISOString(), source: 'Yahoo Finance — U.S. Treasury yield indexes (^IRX, ^FVX, ^TNX, ^TYX)' }, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' } });
  }
  const modeParam = params.get('mode');
  const scope = params.get('scope') === 'markets' ? 'markets' : params.get('scope') === 'benchmarks' ? 'benchmarks' : 'all';
  const groupParam = params.get('group');
  const marketGroup = groupParam === 'commodities' ? 'commodities' : groupParam === 'all' ? 'all' : 'rates';
  const activeMarketConfigs = marketGroup === 'all' ? marketConfigs.filter((config) => ['USDJPY', 'US10Y', 'US30Y', 'GOLD', 'OIL'].includes(config.id))
    : marketGroup === 'commodities'
    ? marketConfigs.filter((config) => config.id === 'USDJPY' || config.id === 'GOLD' || config.id === 'OIL')
    : marketConfigs.filter((config) => config.id === 'USDJPY' || config.id === 'US10Y' || config.id === 'US30Y');
  const force = params.has('refresh');
  const mode: Mode = modeParam === 'day' || modeParam === 'week' || modeParam === 'year' ? modeParam : 'month';
  const keys = bucketKeys(mode);
  const emptyReturns = keys.map(() => 0);
  const [benchmarkResults, marketResults] = await Promise.all([
    scope === 'markets' ? Promise.resolve([]) : Promise.allSettled([benchmarkReturns('SPY', mode, keys), benchmarkReturns('BOXX', mode, keys)]),
    scope === 'benchmarks' ? Promise.resolve([]) : Promise.allSettled(activeMarketConfigs.map((config) => marketHistory(config, mode, force))),
  ]);
  const spy = benchmarkResults[0]?.status === 'fulfilled' ? benchmarkResults[0].value : emptyReturns;
  const boxx = benchmarkResults[1]?.status === 'fulfilled' ? benchmarkResults[1].value : emptyReturns;
  const markets = activeMarketConfigs.map((config, index) => marketResults[index]?.status === 'fulfilled' ? marketResults[index].value : emptyMarket(config, mode));
  const warnings = [
    ...benchmarkResults.flatMap((result, index) => result.status === 'rejected' ? [['SPY', 'BOXX'][index]] : []),
    ...marketResults.flatMap((result, index) => result.status === 'rejected' ? [activeMarketConfigs[index].providerSymbol] : []),
  ];
  if (warnings.length) console.warn(`Market data unavailable: ${warnings.join(', ')}`);
  return NextResponse.json({
    mode,
    marketGroup,
    keys,
    SPY: spy,
    BOXX: boxx,
    markets,
    warnings,
    updatedAt: new Date().toISOString(),
    source: 'Yahoo Finance — adjusted close and daily close; U.S. Treasury cards use yield indexes; commodity cards use continuous front-month futures',
  }, { headers: { 'Cache-Control': scope === 'markets' ? 'public, max-age=60, stale-while-revalidate=600' : 'public, max-age=300, stale-while-revalidate=900' } });
}
