import { ensureDatabase } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type YahooChart = {
  chart?: { result?: Array<{
    meta?: {
      regularMarketPrice?: number;
      regularMarketTime?: number;
      chartPreviousClose?: number;
      previousClose?: number;
      currency?: string;
      currentTradingPeriod?: {
        pre?: { start?: number; end?: number };
        regular?: { start?: number; end?: number };
        post?: { start?: number; end?: number };
      };
    };
    timestamp?: number[];
    indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  }> };
};

async function fetchLatestPrice(ticker: string) {
  let payload: YahooChart | null = null;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Quote unavailable for ${ticker}`);
      payload = await response.json() as YahooChart;
      if (payload.chart?.result?.[0]) break;
    } catch {
      payload = null;
    }
  }
  if (!payload) throw new Error(`Quote unavailable for ${ticker}`);
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const intradayPoints = timestamps.flatMap((timestamp, index) => {
    const close = closes[index];
    return typeof close === 'number' && Number.isFinite(close) && close > 0 ? [{ price: close, marketTime: timestamp }] : [];
  });
  const latestIntraday = intradayPoints.at(-1) ?? null;
  const regularPriceValue = result?.meta?.regularMarketPrice;
  const metaRegularPrice = Number.isFinite(regularPriceValue) && Number(regularPriceValue) > 0 ? Number(regularPriceValue) : null;
  const regularTime = result?.meta?.regularMarketTime ?? 0;
  const tradingPeriod = result?.meta?.currentTradingPeriod;
  const preStart = tradingPeriod?.pre?.start ?? 0;
  const preEnd = tradingPeriod?.pre?.end ?? tradingPeriod?.regular?.start ?? 0;
  const regularStart = tradingPeriod?.regular?.start ?? 0;
  const regularEnd = tradingPeriod?.regular?.end ?? 0;
  const postStart = tradingPeriod?.post?.start ?? regularEnd;
  const postEnd = tradingPeriod?.post?.end ?? 0;
  const latestRegularPoint = regularStart > 0 && regularEnd > 0
    ? intradayPoints.findLast((point) => point.marketTime >= regularStart && point.marketTime < regularEnd) ?? null
    : null;
  const regularPrice = metaRegularPrice ?? latestRegularPoint?.price ?? null;
  let session: 'pre' | 'regular' | 'post' | 'closed' = 'closed';
  const now = Math.floor(Date.now() / 1000);
  const latestTime = latestIntraday?.marketTime ?? 0;
  const hasCurrentPreQuote = latestTime >= preStart && latestTime < preEnd;
  const hasCurrentPostQuote = latestTime >= postStart && latestTime < postEnd;
  if (preStart > 0 && preEnd > 0 && now >= preStart && now < preEnd && hasCurrentPreQuote) session = 'pre';
  else if (regularStart > 0 && regularEnd > 0 && now >= regularStart && now < regularEnd) session = 'regular';
  else if (postStart > 0 && postEnd > 0 && now >= postStart && now < postEnd && hasCurrentPostQuote) session = 'post';
  else if (!tradingPeriod && latestIntraday && latestIntraday.marketTime >= regularTime) session = 'regular';
  const extendedPrice = session === 'pre' || session === 'post' ? latestIntraday?.price ?? null : null;
  const price = extendedPrice ?? regularPrice ?? latestIntraday?.price ?? null;
  if (!Number.isFinite(price) || Number(price) <= 0) throw new Error(`Quote unavailable for ${ticker}`);
  const intradayValues = closes.filter((close): close is number => typeof close === 'number' && Number.isFinite(close) && close > 0);
  const sampleSize = Math.min(48, intradayValues.length);
  const sparkline = sampleSize <= 1
    ? intradayValues
    : Array.from({ length: sampleSize }, (_, index) => intradayValues[Math.round((index / (sampleSize - 1)) * (intradayValues.length - 1))]);
  const previousCloseValue = result?.meta?.chartPreviousClose ?? result?.meta?.previousClose;
  const previousClose = Number.isFinite(previousCloseValue) && Number(previousCloseValue) > 0 ? Number(previousCloseValue) : null;
  const regularChange = regularPrice === null || previousClose === null ? null : regularPrice - previousClose;
  const regularChangePercent = regularChange === null || previousClose === null ? null : regularChange / previousClose;
  const extendedChange = extendedPrice === null || regularPrice === null ? null : extendedPrice - regularPrice;
  const extendedChangePercent = extendedChange === null || regularPrice === null ? null : extendedChange / regularPrice;
  const change = extendedPrice !== null ? extendedChange : regularChange;
  const changePercent = extendedPrice !== null ? extendedChangePercent : regularChangePercent;
  const marketTime = extendedPrice !== null
    ? latestIntraday?.marketTime ?? (regularTime || null)
    : regularTime || latestIntraday?.marketTime || null;
  return {
    price: Number(price),
    marketTime,
    session,
    regularPrice: regularPrice ?? Number(price),
    extendedPrice,
    currency: result?.meta?.currency ?? 'USD',
    previousClose,
    regularChange,
    regularChangePercent,
    extendedChange,
    extendedChangePercent,
    change,
    changePercent,
    sparkline,
  };
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) {
    return NextResponse.json({ error: '請輸入有效的股票代號。' }, { status: 400 });
  }
  try {
    const quote = await fetchLatestPrice(symbol);
    return NextResponse.json({ quote: { ticker: symbol, ...quote }, source: 'Yahoo Finance — latest regular or extended-hours quote' }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: `暫時無法取得 ${symbol} 的即時報價。` }, { status: 502 });
  }
}

export async function POST() {
  try {
    const db = await ensureDatabase();
    const tickerRows = await db.prepare(`SELECT DISTINCT ticker FROM trades
      WHERE status = 'open' AND ticker IS NOT NULL`).all<{ ticker: string }>();
    const tickers = tickerRows.results.map((row) => row.ticker).filter(Boolean);
    const settled = await Promise.allSettled(tickers.map(async (ticker) => ({ ticker, ...(await fetchLatestPrice(ticker)) })));
    const quotes = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const now = new Date().toISOString();
    if (quotes.length) {
      await db.batch(quotes.map((quote) => db.prepare(`UPDATE trades SET current_price = ?, updated_at = ?
        WHERE ticker = ? AND status = 'open' AND quote_mode = 'auto' AND type = 'SDI'`).bind(quote.price, now, quote.ticker)));
    }
    return NextResponse.json({ quotes, failed: settled.length - quotes.length, updatedAt: now, source: 'Yahoo Finance — latest regular or extended-hours quote' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to refresh prices.' }, { status: 502 });
  }
}
