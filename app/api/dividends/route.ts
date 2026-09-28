import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { NextResponse } from 'next/server';
import type { CreditOn, KnownPayDate, PaySource } from '@/lib/dividend-pay-dates';
import { entitledOnExDate, resolvePayDate } from '@/lib/dividend-pay-dates';
import { addDaysToKey, parseDateKey, zonedDate, zonedDateKey } from '@/lib/market-calendar';
import { nasdaqPayDates, yahooNextPayDate } from '@/lib/server/dividend-pay-sources';
import type { RequestBudget } from '@/lib/server/yahoo-summary';

export const dynamic = 'force-dynamic';

type DividendSettings = {
  enabled: boolean;
  usTaxRate: number;
  jpTaxRate: number;
  // Cash is credited on the pay date by default; 'ex' keeps the earlier ex-dividend behaviour.
  creditOn: CreditOn;
};

type YahooChart = {
  chart?: { result?: Array<{
    events?: { dividends?: Record<string, { amount?: number; date?: number }> };
  }> };
};

type DividendEvent = {
  eventKey: string;
  ticker: string;
  currency: 'USD' | 'JPY';
  date: string;
  amountPerShare: number;
  quantity: number;
  gross: number;
  tax: number;
  calculatedNet: number;
  adjustment: number;
  net: number;
  payDate: string;
  paySource: PaySource;
  /** Whether the cash is in the balance: paid already, or credited on the ex-date by setting. */
  credited: boolean;
};

type DividendAdjustment = { excluded?: boolean; net?: number };
type DividendAdjustments = Record<string, DividendAdjustment>;

const settingsKey = 'dividend_cash_settings_v1';
const adjustmentsKey = 'dividend_cash_adjustments_v1';
const existingUsdCashRemovalKey = 'dividend_cash_remove_existing_usd_v1';
// Pay dates typed in by hand, by event key. Kept apart from the adjustments so resetting them leaves these alone.
const payDatesKey = 'dividend_pay_dates_v1';
// Pay-date lookups only matter while a dividend may still be unpaid.
const payLookupDays = 120;
const maxPayLookups = 24;
const defaultSettings: DividendSettings = { enabled: true, usTaxRate: 30, jpTaxRate: 15.315, creditOn: 'pay' };
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
      creditOn: stored.creditOn === 'ex' ? 'ex' : 'pay',
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

async function readAdjustments() {
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(adjustmentsKey).first<{ value: string }>();
  if (!row?.value) return {} satisfies DividendAdjustments;
  try {
    const stored = JSON.parse(row.value) as DividendAdjustments;
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {} satisfies DividendAdjustments;
  }
}

async function writeAdjustments(adjustments: DividendAdjustments) {
  const db = await ensureDatabase();
  await db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(adjustmentsKey, JSON.stringify(adjustments)).run();
}

async function readPayDates() {
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(payDatesKey).first<{ value: string }>();
  try {
    const stored = row?.value ? JSON.parse(row.value) as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(parseDateKey(entry[1]))));
  } catch {
    return {} as Record<string, string>;
  }
}

async function writePayDates(payDates: Record<string, string>) {
  const db = await ensureDatabase();
  await db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(payDatesKey, JSON.stringify(payDates)).run();
}

async function removeExistingUsdCashOnce(events: DividendEvent[], adjustments: DividendAdjustments, failedTickers: string[]) {
  const visibleUsdEvents = events.filter((event) => event.currency === 'USD' && event.net > 0);
  const usDataComplete = failedTickers.every((ticker) => ticker.endsWith('.T'));
  if (!visibleUsdEvents.length || !usDataComplete) return adjustments;

  const db = await ensureDatabase();
  const completed = await db.prepare('SELECT value FROM app_meta WHERE key = ?')
    .bind(existingUsdCashRemovalKey)
    .first<{ value: string }>();
  if (completed?.value) return adjustments;

  const nextAdjustments = { ...adjustments };
  visibleUsdEvents.forEach((event) => {
    nextAdjustments[event.eventKey] = { excluded: true };
  });
  const upsert = `INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  await db.batch([
    db.prepare(upsert).bind(adjustmentsKey, JSON.stringify(nextAdjustments)),
    db.prepare(upsert).bind(existingUsdCashRemovalKey, JSON.stringify({
      completedAt: new Date().toISOString(),
      removedEventCount: visibleUsdEvents.length,
    })),
  ]);
  return nextAdjustments;
}

const dividendEventKey = (ticker: string, date: string, amountPerShare: number) => `${ticker}|${date}|${amountPerShare.toFixed(8)}`;
const emptyCash = () => ({ gross: 0, tax: 0, adjustment: 0, net: 0, count: 0 });

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
    let adjustments = await readAdjustments();
    if (new URL(request.url).searchParams.get('settings') === '1' || !settings.enabled) {
      return NextResponse.json({ settings, cash: { USD: emptyCash(), JPY: emptyCash() }, pending: { USD: emptyCash(), JPY: emptyCash() }, events: [], adjustmentCount: Object.keys(adjustments).length, failedTickers: [], updatedAt: new Date().toISOString() }, { headers: responseHeaders });
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

    // Pay dates for tickers with a dividend recent enough to be unpaid; older ones are paid by now.
    const manualPayDates = await readPayDates();
    const recentFrom = addDaysToKey(endDate, -payLookupDays);
    const budget: RequestBudget = { remaining: maxPayLookups };
    const paySources = new Map<string, { nasdaq: KnownPayDate[]; yahoo: KnownPayDate[] }>();
    for (const item of settled) {
      if (item.status !== 'fulfilled' || !item.value.dividends.some((dividend) => dividend.date >= recentFrom)) continue;
      const { ticker } = item.value;
      const nasdaq = ticker.endsWith('.T') ? [] : await nasdaqPayDates(ticker, budget);
      const latest = item.value.dividends.at(-1)!.date;
      const yahoo = nasdaq.some((entry) => Math.abs(Date.parse(entry.exDate) - Date.parse(latest)) <= 3 * 86_400_000) ? [] : await yahooNextPayDate(ticker, budget);
      paySources.set(ticker, { nasdaq, yahoo });
    }

    const calculatedEvents: DividendEvent[] = [];
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
        const quantity = lots.reduce((sum, lot) => entitledOnExDate(lot.openDate, lot.closeDate, dividend.date) ? sum + Math.max(0, Number(lot.quantity)) : sum, 0);
        if (!(quantity > 0)) return;
        const gross = dividend.amount * quantity;
        const tax = gross * rate;
        const calculatedNet = gross - tax;
        const eventKey = dividendEventKey(ticker, dividend.date, dividend.amount);
        const adjustment = adjustments[eventKey];
        if (adjustment?.excluded) return;
        const adjustedNet = typeof adjustment?.net === 'number' && Number.isFinite(adjustment.net)
          ? Math.min(calculatedNet, Math.max(0, adjustment.net))
          : calculatedNet;
        const sources = paySources.get(ticker);
        const { payDate, paySource } = resolvePayDate(dividend.date, currency, { manual: manualPayDates[eventKey], nasdaq: sources?.nasdaq, yahoo: sources?.yahoo });
        const today = zonedDateKey(zonedDate(Date.now(), currency === 'JPY' ? 'Asia/Tokyo' : 'America/New_York'));
        const credited = settings.creditOn === 'ex' || payDate <= today;
        calculatedEvents.push({ eventKey, ticker, currency, date: dividend.date, amountPerShare: dividend.amount, quantity, gross, tax, calculatedNet, adjustment: calculatedNet - adjustedNet, net: adjustedNet, payDate, paySource, credited });
      });
    });

    adjustments = await removeExistingUsdCashOnce(calculatedEvents, adjustments, failedTickers);
    const events = calculatedEvents.filter((event) => !adjustments[event.eventKey]?.excluded && event.net > 0);
    const total = (list: DividendEvent[], currency: 'USD' | 'JPY') => list.filter((event) => event.currency === currency).reduce((sum, event) => ({ gross: sum.gross + event.gross, tax: sum.tax + event.tax, adjustment: sum.adjustment + event.adjustment, net: sum.net + event.net, count: sum.count + 1 }), emptyCash());
    const credited = events.filter((event) => event.credited);
    const waiting = events.filter((event) => !event.credited);
    const cash = { USD: total(credited, 'USD'), JPY: total(credited, 'JPY') };
    const pending = { USD: total(waiting, 'USD'), JPY: total(waiting, 'JPY') };
    return NextResponse.json({ settings, cash, pending, events, adjustmentCount: Object.keys(adjustments).length, failedTickers, updatedAt: new Date().toISOString(), source: settings.creditOn === 'ex' ? 'Yahoo Finance dividend events; credited on the ex-dividend date' : 'Yahoo Finance dividend events; credited on the pay date (Nasdaq / Yahoo / manual / estimated)' }, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '股息現金目前無法計算' }, { status: 502, headers: responseHeaders });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Partial<DividendSettings> & { action?: 'adjust' | 'clear' | 'exclude' | 'reset-adjustments' | 'pay-date'; eventKey?: string; net?: number; payDate?: string };
    if (body.action === 'pay-date') {
      const eventKey = String(body.eventKey ?? '').trim();
      if (!eventKey || eventKey.length > 120 || !/^.+\|\d{4}-\d{2}-\d{2}\|\d+(?:\.\d+)?$/.test(eventKey)) throw new Error('股息來源識別碼無效');
      const payDate = String(body.payDate ?? '').trim();
      const exDate = eventKey.split('|')[1];
      if (payDate && (!parseDateKey(payDate) || payDate < exDate)) throw new Error('發放日必須是有效日期，且不早於除息日');
      const payDates = await readPayDates();
      if (payDate) payDates[eventKey] = payDate;
      else delete payDates[eventKey];
      await writePayDates(payDates);
      return NextResponse.json({ adjusted: true }, { headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
    }
    if (body.action) {
      if (!['adjust', 'clear', 'exclude', 'reset-adjustments'].includes(body.action)) throw new Error('不支援的股息調整動作');
      const adjustments = await readAdjustments();
      if (body.action === 'reset-adjustments') {
        await writeAdjustments({});
        return NextResponse.json({ adjusted: true, adjustmentCount: 0 }, { headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
      }
      const eventKey = String(body.eventKey ?? '').trim();
      if (!eventKey || eventKey.length > 120 || !/^.+\|\d{4}-\d{2}-\d{2}\|\d+(?:\.\d+)?$/.test(eventKey)) throw new Error('股息來源識別碼無效');
      if (body.action === 'clear') delete adjustments[eventKey];
      else if (body.action === 'exclude') adjustments[eventKey] = { excluded: true };
      else {
        const net = Number(body.net);
        if (!Number.isFinite(net) || net < 0) throw new Error('請輸入有效的股息入帳金額');
        adjustments[eventKey] = { net };
      }
      await writeAdjustments(adjustments);
      return NextResponse.json({ adjusted: true, adjustmentCount: Object.keys(adjustments).length }, { headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
    }
    const current = await readSettings();
    const settings: DividendSettings = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      usTaxRate: clampTaxRate(body.usTaxRate, current.usTaxRate),
      jpTaxRate: clampTaxRate(body.jpTaxRate, current.jpTaxRate),
      creditOn: body.creditOn === 'ex' || body.creditOn === 'pay' ? body.creditOn : current.creditOn,
    };
    await writeSettings(settings);
    return NextResponse.json({ settings }, { headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '股息設定無法保存' }, { status: 400, headers: { ...responseHeaders, 'Cache-Control': 'no-store' } });
  }
}
