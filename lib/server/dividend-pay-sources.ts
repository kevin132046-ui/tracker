import type { KnownPayDate } from '@/lib/dividend-pay-dates';
import { matchPayDate, usDateToKey } from '@/lib/dividend-pay-dates';
import { parseDateKey, zonedDate, zonedDateKey } from '@/lib/market-calendar';
import { skipLookup, type MarketCache } from '@/lib/server/market-cache';
import { quoteSummary, type RequestBudget } from '@/lib/server/yahoo-summary';

/**
 * Where the dividend data comes from: Yahoo's chart events (every dividend since a date), Nasdaq's
 * dividend history (US listings, pay dates of past and declared dividends) and Yahoo's calendarEvents
 * (the next dividend only, any market). All three go through the market cache (memory, then D1), so
 * a new isolate does not ask again; a failed pay-date source just leaves the date to the estimate.
 */
const historyFreshMs = 6 * 60 * 60_000;
const nasdaqFreshMs = 12 * 60 * 60_000;
const yahooFreshMs = 6 * 60 * 60_000;
// Pay dates that already cover the latest dividend don't change: no need to ask again every few hours.
const settledMs = 14 * 24 * 60 * 60_000;
const retryMs = 15 * 60_000;
const timeoutMs = 5_000;
const chartTimeoutMs = 4_500;
const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'] as const;

export const historyKey = (ticker: string) => `dividend:history:${ticker}`;
export const nasdaqKey = (ticker: string) => `dividend:nasdaq:${ticker}`;
export const yahooPayKey = (ticker: string) => `dividend:yahoo:${ticker}`;
/** The ticker a cache key belongs to ("dividend:nasdaq:KO" → "KO"). */
export const tickerOfKey = (key: string) => key.split(':').slice(2).join(':');

export type DividendPayout = { date: string; amount: number };
type DividendHistory = { from: string; events: DividendPayout[] };
type YahooChart = { chart?: { result?: Array<{ events?: { dividends?: Record<string, { amount?: number; date?: number }> } }> } };
type NasdaqPayload = { data?: { dividends?: { rows?: Array<{ exOrEffDate?: string; paymentDate?: string; type?: string }> | null } | null } | null };
type CalendarPayload = { quoteSummary?: { result?: Array<{ calendarEvents?: { exDividendDate?: { raw?: number }; dividendDate?: { raw?: number } } }> | null } };

const isPayDates = (value: unknown): value is KnownPayDate[] => Array.isArray(value)
  && value.every((entry) => entry && typeof entry === 'object' && Boolean(parseDateKey((entry as KnownPayDate).exDate)) && Boolean(parseDateKey((entry as KnownPayDate).payDate)));
const isHistory = (value: unknown): value is DividendHistory => Boolean(value) && typeof value === 'object'
  && typeof (value as DividendHistory).from === 'string' && Array.isArray((value as DividendHistory).events)
  && (value as DividendHistory).events.every((event) => event && typeof event.date === 'string' && Number.isFinite(event.amount));

async function fetchHistory(ticker: string, from: string, endDate: string): Promise<DividendHistory> {
  const period1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor((new Date(`${endDate}T23:59:59Z`).getTime() + 86_400_000) / 1000);
  for (const host of yahooHosts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), chartTimeoutMs);
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json() as YahooChart;
      const events = Object.values(payload.chart?.result?.[0]?.events?.dividends ?? {}).flatMap((item) => {
        const amount = Number(item.amount);
        const timestamp = Number(item.date);
        if (!(amount > 0) || !(timestamp > 0)) return [];
        return [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), amount }];
      }).sort((a, b) => a.date.localeCompare(b.date));
      return { from, events };
    } catch {
      // Try Yahoo's alternate chart host before returning an unavailable symbol.
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Dividend history unavailable for ${ticker}`);
}

/**
 * Every dividend of `ticker` from the start of `startDate`'s year to `endDate`. The stored range starts
 * on 1 January so the cache holds a year, not the day a position was opened; dividends before the
 * position are dropped later (no shares entitled).
 */
export async function dividendHistory(ticker: string, startDate: string, endDate: string, cache: MarketCache): Promise<DividendPayout[]> {
  const from = `${startDate.slice(0, 4)}-01-01`;
  const history = await cache.load<DividendHistory>(historyKey(ticker), () => fetchHistory(ticker, from, endDate), {
    freshMs: historyFreshMs,
    retryMs,
    usable: (value) => isHistory(value) && value.from <= from,
  });
  return history.events;
}

/** Nasdaq's pay dates for a US listing. Kept while they cover `latestExDate`, the newest dividend known. */
export function nasdaqPayDates(ticker: string, latestExDate: string, budget: RequestBudget, cache: MarketCache): Promise<KnownPayDate[]> {
  return cache.load<KnownPayDate[]>(nasdaqKey(ticker), async () => {
    if (budget.remaining <= 0) return skipLookup;
    budget.remaining -= 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker.replace('-', '.'))}/dividends?assetclass=stocks`, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
          Origin: 'https://www.nasdaq.com',
          Referer: 'https://www.nasdaq.com/',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Nasdaq returned ${response.status}.`);
      const payload = await response.json() as NasdaqPayload;
      return (payload.data?.dividends?.rows ?? []).flatMap((row) => {
        if (row.type && !/cash/i.test(row.type)) return [];
        const exDate = usDateToKey(row.exOrEffDate);
        const payDate = usDateToKey(row.paymentDate);
        return exDate && payDate ? [{ exDate, payDate }] : [];
      });
    } catch (error) {
      console.warn(`Nasdaq dividend dates unavailable for ${ticker}:`, error instanceof Error ? error.message : error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }, { freshMs: nasdaqFreshMs, retryMs, usable: isPayDates, keep: (value) => matchPayDate(latestExDate, value) !== null, keepMs: settledMs, fallback: [] });
}

/** Yahoo's next dividend (ex-date and pay date), for when Nasdaq doesn't have the latest one. */
export function yahooNextPayDate(ticker: string, latestExDate: string, budget: RequestBudget, cache: MarketCache): Promise<KnownPayDate[]> {
  return cache.load<KnownPayDate[]>(yahooPayKey(ticker), async () => {
    if (budget.remaining <= 0) return skipLookup;
    try {
      const payload = await quoteSummary<CalendarPayload>(ticker, 'calendarEvents', budget);
      const calendar = payload?.quoteSummary?.result?.[0]?.calendarEvents;
      const timeZone = ticker.endsWith('.T') ? 'Asia/Tokyo' : 'America/New_York';
      const toKey = (raw?: number) => typeof raw === 'number' && Number.isFinite(raw) ? zonedDateKey(zonedDate(raw * 1000, timeZone)) : null;
      const exDate = toKey(calendar?.exDividendDate?.raw);
      const payDate = toKey(calendar?.dividendDate?.raw);
      return exDate && payDate ? [{ exDate, payDate }] : [];
    } catch (error) {
      console.warn(`Yahoo dividend dates unavailable for ${ticker}:`, error instanceof Error ? error.message : error);
      throw error;
    }
  }, { freshMs: yahooFreshMs, retryMs, usable: isPayDates, keep: (value) => matchPayDate(latestExDate, value) !== null, keepMs: settledMs, fallback: [] });
}
