import type { KnownPayDate } from '@/lib/dividend-pay-dates';
import { usDateToKey } from '@/lib/dividend-pay-dates';
import { zonedDate, zonedDateKey } from '@/lib/market-calendar';
import { quoteSummary, type RequestBudget } from '@/lib/server/yahoo-summary';

/**
 * Where dividend pay dates come from: Nasdaq's dividend history (US listings, every past
 * dividend) and Yahoo's calendarEvents (the next dividend only, any market). Both are cached;
 * a failure just leaves the date to the estimate.
 */
const nasdaqFreshMs = 12 * 60 * 60_000;
const yahooFreshMs = 6 * 60 * 60_000;
const timeoutMs = 5_000;

const nasdaqCache = new Map<string, { value: KnownPayDate[]; fetchedAt: number }>();
const yahooCache = new Map<string, { value: KnownPayDate[]; fetchedAt: number }>();

type NasdaqPayload = { data?: { dividends?: { rows?: Array<{ exOrEffDate?: string; paymentDate?: string; type?: string }> | null } | null } | null };
type CalendarPayload = { quoteSummary?: { result?: Array<{ calendarEvents?: { exDividendDate?: { raw?: number }; dividendDate?: { raw?: number } } }> | null } };

export async function nasdaqPayDates(ticker: string, budget: RequestBudget): Promise<KnownPayDate[]> {
  const cached = nasdaqCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < nasdaqFreshMs) return cached.value;
  if (budget.remaining <= 0) return cached?.value ?? [];
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
    const value = (payload.data?.dividends?.rows ?? []).flatMap((row) => {
      if (row.type && !/cash/i.test(row.type)) return [];
      const exDate = usDateToKey(row.exOrEffDate);
      const payDate = usDateToKey(row.paymentDate);
      return exDate && payDate ? [{ exDate, payDate }] : [];
    });
    nasdaqCache.set(ticker, { value, fetchedAt: Date.now() });
    return value;
  } catch (error) {
    console.warn(`Nasdaq dividend dates unavailable for ${ticker}:`, error instanceof Error ? error.message : error);
    return cached?.value ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function yahooNextPayDate(ticker: string, budget: RequestBudget): Promise<KnownPayDate[]> {
  const cached = yahooCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < yahooFreshMs) return cached.value;
  try {
    const payload = await quoteSummary<CalendarPayload>(ticker, 'calendarEvents', budget);
    const calendar = payload?.quoteSummary?.result?.[0]?.calendarEvents;
    const timeZone = ticker.endsWith('.T') ? 'Asia/Tokyo' : 'America/New_York';
    const toKey = (raw?: number) => typeof raw === 'number' && Number.isFinite(raw) ? zonedDateKey(zonedDate(raw * 1000, timeZone)) : null;
    const exDate = toKey(calendar?.exDividendDate?.raw);
    const payDate = toKey(calendar?.dividendDate?.raw);
    const value = exDate && payDate ? [{ exDate, payDate }] : [];
    yahooCache.set(ticker, { value, fetchedAt: Date.now() });
    return value;
  } catch (error) {
    console.warn(`Yahoo dividend dates unavailable for ${ticker}:`, error instanceof Error ? error.message : error);
    return cached?.value ?? [];
  }
}
