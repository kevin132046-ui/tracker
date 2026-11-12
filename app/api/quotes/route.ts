import { ensureDatabase } from '@/lib/server/database';
import { NextResponse } from 'next/server';
import { guarded } from '@/lib/server/data-gate';
import { fetchLatestPrice } from '@/lib/server/yahoo-quote';

export const dynamic = 'force-dynamic';

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

/** Refreshes the stored prices of the open stock lots; it reads and writes the owner's trades, so it is guarded. */
async function handlePOST() {
  try {
    const db = await ensureDatabase();
    const tickerRows = await db.prepare(`SELECT DISTINCT ticker FROM trades
      WHERE status = 'open' AND ticker IS NOT NULL AND quote_mode = 'auto' AND type = 'SDI'`).all<{ ticker: string }>();
    const tickers = tickerRows.results.map((row) => row.ticker).filter(Boolean);
    const settled = await Promise.allSettled(tickers.map(async (ticker) => ({ ticker, ...(await fetchLatestPrice(ticker)) })));
    const quotes = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failedTickers = settled.flatMap((result, index) => result.status === 'rejected' ? [tickers[index]] : []);
    const now = new Date().toISOString();
    if (quotes.length) {
      await db.batch(quotes.map((quote) => db.prepare(`UPDATE trades SET current_price = ?, updated_at = ?
        WHERE ticker = ? AND status = 'open' AND quote_mode = 'auto' AND type = 'SDI'`).bind(quote.price, now, quote.ticker)));
    }
    return NextResponse.json({ quotes, failed: failedTickers.length, failedTickers, updatedAt: now, source: 'Yahoo Finance — latest regular or extended-hours quote' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to refresh prices.' }, { status: 502 });
  }
}

// Owner data (which stocks are held): only behind Cloudflare Access (lib/server/data-gate).
export const POST = guarded(handlePOST);
