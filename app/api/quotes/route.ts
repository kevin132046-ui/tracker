import { ensureDatabase } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type YahooChart = {
  chart?: { result?: Array<{
    meta?: { regularMarketPrice?: number; regularMarketTime?: number; currency?: string };
    indicators?: { quote?: Array<{ close?: Array<number | null> }> };
  }> };
};

async function fetchLatestPrice(ticker: string) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OptionFlow/1.0' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Quote unavailable for ${ticker}`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => typeof value === 'number') ?? [];
  const price = result?.meta?.regularMarketPrice ?? closes.at(-1);
  if (!Number.isFinite(price)) throw new Error(`Quote unavailable for ${ticker}`);
  return { price: Number(price), marketTime: result?.meta?.regularMarketTime ?? null, currency: result?.meta?.currency ?? 'USD' };
}

export async function POST() {
  try {
    const db = await ensureDatabase();
    const tickerRows = await db.prepare(`SELECT DISTINCT ticker FROM trades
      WHERE status = 'open' AND quote_mode = 'auto' AND type = 'SDI' AND ticker IS NOT NULL`).all<{ ticker: string }>();
    const tickers = tickerRows.results.map((row) => row.ticker).filter(Boolean);
    const settled = await Promise.allSettled(tickers.map(async (ticker) => ({ ticker, ...(await fetchLatestPrice(ticker)) })));
    const quotes = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const now = new Date().toISOString();
    if (quotes.length) {
      await db.batch(quotes.map((quote) => db.prepare(`UPDATE trades SET current_price = ?, updated_at = ?
        WHERE ticker = ? AND status = 'open' AND quote_mode = 'auto' AND type = 'SDI'`).bind(quote.price, now, quote.ticker)));
    }
    return NextResponse.json({ quotes, failed: settled.length - quotes.length, updatedAt: now, source: 'Yahoo Finance — latest available quote' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to refresh prices.' }, { status: 502 });
  }
}
