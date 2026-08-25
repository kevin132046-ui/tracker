import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type YahooChart = {
  chart?: { result?: Array<{
    timestamp?: number[];
    indicators?: {
      adjclose?: Array<{ adjclose?: Array<number | null> }>;
      quote?: Array<{ close?: Array<number | null> }>;
    };
  }> };
};

async function historicalClose(ticker: string, date: string) {
  const target = new Date(`${date}T23:59:59Z`).getTime();
  const period1 = Math.floor((target - 8 * 86_400_000) / 1000);
  const period2 = Math.floor((target + 86_400_000) / 1000);
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`, {
    headers: { Accept: 'application/json', 'User-Agent': 'OptionFlow/1.0' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Historical quote unavailable for ${ticker}`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
  let latest: number | null = null;
  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (timestamp * 1000 <= target && typeof close === 'number' && Number.isFinite(close)) latest = close;
  });
  if (latest === null) throw new Error(`Historical quote unavailable for ${ticker}`);
  return latest;
}

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get('date') ?? '';
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
    return NextResponse.json({ error: 'A valid historical date is required.' }, { status: 400 });
  }

  try {
    const db = await ensureDatabase();
    const result = await db.prepare(`${tradeSelect}
      WHERE open_date <= ? AND (close_date IS NULL OR close_date > ?)
      ORDER BY ticker, open_date, id`).bind(date, date).all<TradeRow>();
    const trades = result.results;
    const stockTickers = [...new Set(trades
      .filter((trade) => trade.type === 'SDI' || trade.event === 'STOCK')
      .map((trade) => trade.ticker)
      .filter((ticker): ticker is string => Boolean(ticker)))];
    const settled = await Promise.allSettled(stockTickers.map(async (ticker) => [ticker, await historicalClose(ticker, date)] as const));
    const historicalPrices = new Map<string, number>();
    settled.forEach((item) => {
      if (item.status === 'fulfilled') historicalPrices.set(item.value[0], item.value[1]);
    });

    const groups = new Map<string, { label: string; value: number; tradeCount: number; estimated: boolean }>();
    for (const trade of trades) {
      const label = trade.ticker || '其他';
      const stock = trade.type === 'SDI' || trade.event === 'STOCK';
      const historicalPrice = stock && trade.ticker ? historicalPrices.get(trade.ticker) : undefined;
      const value = stock
        ? (historicalPrice ?? trade.entryPrice) * Math.abs(trade.quantity)
        : trade.collateral || Math.abs(trade.entryPrice * trade.quantity * 100);
      const group = groups.get(label) ?? { label, value: 0, tradeCount: 0, estimated: false };
      group.value += Math.max(0, value);
      group.tradeCount += 1;
      group.estimated ||= stock && historicalPrice === undefined;
      groups.set(label, group);
    }
    const positions = [...groups.values()].sort((a, b) => b.value - a.value);
    return NextResponse.json({
      date,
      positions,
      total: positions.reduce((sum, position) => sum + position.value, 0),
      tradeCount: trades.length,
      estimatedTickers: positions.filter((position) => position.estimated).map((position) => position.label),
      source: 'Yahoo Finance historical adjusted close; option exposure uses collateral',
    }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load allocation history.' }, { status: 502 });
  }
}
