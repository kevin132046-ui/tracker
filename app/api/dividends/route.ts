import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type DividendSettings = {
  enabled: boolean;
  usTaxRate: number;
  jpTaxRate: number;
};

type YahooChart = {
  chart?: { result?: Array<{
    events?: { dividends?: Record<string, { amount?: number; date?: number }> };
  }> };
};

type DividendEvent = {
  ticker: string;
  currency: 'USD' | 'JPY';
  date: string;
  amountPerShare: number;
  quantity: number;
  gross: number;
  tax: number;
  net: number;
};

const settingsKey = 'dividend_cash_settings_v1';
const defaultSettings: DividendSettings = { enabled: true, usTaxRate: 30, jpTaxRate: 15.315 };
const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'] as const;
const dividendCache = new Map<string, { expiresAt: number; events: Array<{ date: string; amount: number }> }>();
const responseHeaders = { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' };

const clampTaxRate = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : fallback;
};

async function readSettings() {
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(settingsKey).first<{ value: string }>();
  if (!row?.value) return defaultSettings;
  try {
    const stored = JSON.parse(row.value) as Partial<DividendSettings>;
    return {
      enabled: stored.enabled !== false,
      usTaxRate: clampTaxRate(stored.usTaxRate, defaultSettings.usTaxRate),
      jpTaxRate: clampTaxRate(stored.jpTaxRate, defaultSettings.jpTaxRate),
    } satisfies DividendSettings;
  } catch {
    return defaultSettings;
  }
}

async function writeSettings(settings: DividendSettings) {
  const db = await ensureDatabase();
  await db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(settingsKey, JSON.stringify(settings)).run();
}

async function fetchDividendEvents(ticker: string, startDate: string, endDate: string) {
  const cacheKey = `${ticker}:${startDate}:${endDate}`;
  const cached = dividendCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.events;
  const period1 = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor((new Date(`${endDate}T23:59:59Z`).getTime() + 86_400_000) / 1000);
  for (const host of yahooHosts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_500);
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json() as YahooChart;
      const dividends = Object.values(payload.chart?.result?.[0]?.events?.dividends ?? {}).flatMap((item) => {
        const amount = Number(item.amount);
        const timestamp = Number(item.date);
        if (!(amount > 0) || !(timestamp > 0)) return [];
        return [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), amount }];
      }).sort((a, b) => a.date.localeCompare(b.date));
      dividendCache.set(cacheKey, { events: dividends, expiresAt: Date.now() + 6 * 60 * 60 * 1_000 });
      return dividends;
    } catch {
      // Try Yahoo's alternate chart host before returning an unavailable symbol.
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Dividend history unavailable for ${ticker}`);
}

export async function GET(request: Request) {
  try {
    const settings = await readSettings();
    if (new URL(request.url).searchParams.get('settings') === '1' || !settings.enabled) {
      return NextResponse.json({ settings, cash: { USD: { gross: 0, tax: 0, net: 0, count: 0 }, JPY: { gross: 0, tax: 0, net: 0, count: 0 } }, events: [], failedTickers: [], updatedAt: new Date().toISOString() }, { headers: responseHeaders });
    }

    const db = await ensureDatabase();
    const result = await db.prepare(`${tradeSelect}
      WHERE (type = 'SDI' OR event = 'STOCK') AND ticker IS NOT NULL
      ORDER BY ticker, open_date, id`).all<TradeRow>();
    const stockTrades = result.results.filter((trade) => trade.ticker && trade.quantity > 0);
    const grouped = new Map<string, TradeRow[]>();
    stockTrades.forEach((trade) => {
      const ticker = String(trade.ticker).toUpperCase();
      grouped.set(ticker, [...(grouped.get(ticker) ?? []), trade]);
    });
    const endDate = new Date().toISOString().slice(0, 10);
    const settled = await Promise.allSettled([...grouped.entries()].map(async ([ticker, lots]) => {
      const startDate = lots.reduce((earliest, lot) => lot.openDate < earliest ? lot.openDate : earliest, lots[0].openDate);
      return { ticker, lots, dividends: await fetchDividendEvents(ticker, startDate, endDate) };
    }));

    const events: DividendEvent[] = [];
    const failedTickers: string[] = [];
    settled.forEach((item, index) => {
      if (item.status === 'rejected') {
        failedTickers.push([...grouped.keys()][index]);
        return;
      }
      const { ticker, lots, dividends } = item.value;
      const currency: 'USD' | 'JPY' = ticker.endsWith('.T') ? 'JPY' : 'USD';
      const rate = (currency === 'JPY' ? settings.jpTaxRate : settings.usTaxRate) / 100;
      dividends.forEach((dividend) => {
        const quantity = lots.reduce((sum, lot) => {
          const heldOnExDate = lot.openDate <= dividend.date && (!lot.closeDate || lot.closeDate > dividend.date);
          return heldOnExDate ? sum + Math.max(0, Number(lot.quantity)) : sum;
        }, 0);
        if (!(quantity > 0)) return;
        const gross = dividend.amount * quantity;
        const tax = gross * rate;
        events.push({ ticker, currency, date: dividend.date, amountPerShare: dividend.amount, quantity, gross, tax, net: gross - tax });
      });
    });

    const cash = {
      USD: events.filter((event) => event.currency === 'USD').reduce((sum, event) => ({ gross: sum.gross + event.gross, tax: sum.tax + event.tax, net: sum.net + event.net, count: sum.count + 1 }), { gross: 0, tax: 0, net: 0, count: 0 }),
      JPY: events.filter((event) => event.currency === 'JPY').reduce((sum, event) => ({ gross: sum.gross + event.gross, tax: sum.tax + event.tax, net: sum.net + event.net, count: sum.count + 1 }), { gross: 0, tax: 0, net: 0, count: 0 }),
    };
    return NextResponse.json({ settings, cash, events, failedTickers, updatedAt: new Date().toISOString(), source: 'Yahoo Finance dividend events; credited on the ex-dividend event date' }, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '股息現金目前無法計算' }, { status: 502, headers: responseHeaders });
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await readSettings();
    const body = await request.json() as Partial<DividendSettings>;
    const settings: DividendSettings = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      usTaxRate: clampTaxRate(body.usTaxRate, current.usTaxRate),
      jpTaxRate: clampTaxRate(body.jpTaxRate, current.jpTaxRate),
    };
    await writeSettings(settings);
    return NextResponse.json({ settings }, { headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '股息設定無法保存' }, { status: 400, headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
  }
}
