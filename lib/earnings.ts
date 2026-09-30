/**
 * Earnings dates for held symbols: Yahoo's calendar merged with dates the user typed in, and the
 * reminders due in the coming week. Pure; dates are exchange-local YYYY-MM-DD keys.
 */
import { addDaysToKey, parseDateKey, zonedDate, zonedDateKey } from '@/lib/market-calendar';

/** Next earnings date from Yahoo. `timing` is only set when Yahoo gives a time of day. */
export type EarningsEvent = { date: string; endDate: string | null; estimate: boolean; timing: 'pre' | 'post' | null };
export type EarningsSource = 'yahoo' | 'manual';
export type EarningsEntry = EarningsEvent & { symbol: string; source: EarningsSource };
export type EarningsReminder = EarningsEntry & { daysAway: number };

export const earningsReminderDays = 7;

export const earningsTimeZone = (symbol: string) => symbol.endsWith('.T') ? 'Asia/Tokyo' : 'America/New_York';
export const exchangeTodayKey = (symbol: string, timestamp: number) => zonedDateKey(zonedDate(timestamp, earningsTimeZone(symbol)));

/** Whole calendar days from `fromKey` to `toKey`. */
export const daysBetweenKeys = (fromKey: string, toKey: string) => {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return Number.NaN;
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);
};

/**
 * One entry per symbol. A manual date wins over Yahoo while it is today or later; a past manual
 * date is ignored so Yahoo's next date shows again. A Yahoo date already in the past is dropped.
 */
export function mergeEarnings(symbols: string[], yahoo: Record<string, EarningsEvent>, manual: Record<string, string>, timestamp: number): Record<string, EarningsEntry | null> {
  const merged: Record<string, EarningsEntry | null> = {};
  symbols.forEach((symbol) => {
    const today = exchangeTodayKey(symbol, timestamp);
    const manualDate = manual[symbol];
    if (manualDate && parseDateKey(manualDate) && manualDate >= today) {
      merged[symbol] = { symbol, source: 'manual', date: manualDate, endDate: null, estimate: false, timing: null };
      return;
    }
    const event = yahoo[symbol];
    merged[symbol] = event && (event.endDate ?? event.date) >= today ? { symbol, source: 'yahoo', ...event } : null;
  });
  return merged;
}

/** Earnings from today through `days` days out, soonest first. */
export function earningsReminders(entries: Record<string, EarningsEntry | null>, timestamp: number, days = earningsReminderDays): EarningsReminder[] {
  return Object.values(entries)
    .flatMap((entry) => {
      if (!entry) return [];
      const daysAway = Math.max(0, daysBetweenKeys(exchangeTodayKey(entry.symbol, timestamp), entry.date));
      return daysAway <= days && (entry.endDate ?? entry.date) >= exchangeTodayKey(entry.symbol, timestamp) ? [{ ...entry, daysAway }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

/** Drops manual dates that have passed, so the stored map stays small. */
export function pruneManualEarnings(manual: Record<string, string>, timestamp: number) {
  return Object.fromEntries(Object.entries(manual).filter(([symbol, date]) => parseDateKey(date) && date >= addDaysToKey(exchangeTodayKey(symbol, timestamp), -1)));
}

export type AiProvider = 'anthropic' | 'openai';
/** A date an AI model found by web search. Shown as a suggestion; never saved without the user. */
export type AiEarningsSuggestion = {
  symbol: string;
  provider: AiProvider;
  model: string;
  date: string | null;
  timing: 'pre' | 'post' | null;
  confirmed: boolean;
  note: string;
  sources: Array<{ url: string; title: string }>;
};
