/**
 * Dividend pay dates and who is entitled to them. Pure; dates are YYYY-MM-DD keys.
 * Shares count when bought before the ex-dividend date and still held at its open, so a sale on
 * the ex-date keeps the dividend and a purchase on it does not.
 */
import { addDaysToKey, parseDateKey } from '@/lib/market-calendar';

export type PaySource = 'nasdaq' | 'yahoo' | 'manual' | 'estimate';
export type KnownPayDate = { exDate: string; payDate: string };
export type CreditOn = 'pay' | 'ex';

export const defaultUsPayLagDays = 21;
export const jpPayLagDays = 75;

/** Lots entitled to a dividend with this ex-date. */
export const entitledOnExDate = (openDate: string, closeDate: string | null, exDate: string) => openDate < exDate && (!closeDate || closeDate >= exDate);

/** "MM/DD/YYYY" (Nasdaq) → YYYY-MM-DD, or null. */
export function usDateToKey(value: unknown) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const key = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return parseDateKey(key) ? key : null;
}

const dayDiff = (from: string, to: string) => {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  return a && b ? Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) : Number.NaN;
};

/** The known pay date for an ex-date, allowing a few days of difference between data sources. */
export function matchPayDate(exDate: string, known: KnownPayDate[], toleranceDays = 3) {
  let best: KnownPayDate | null = null;
  for (const entry of known) {
    const distance = Math.abs(dayDiff(entry.exDate, exDate));
    if (distance <= toleranceDays && (!best || distance < Math.abs(dayDiff(best.exDate, exDate)))) best = entry;
  }
  return best && best.payDate >= exDate ? best.payDate : null;
}

/** Median ex-date → pay-date gap of a company's known dividends, or null. */
export function medianPayLag(known: KnownPayDate[]) {
  const lags = known.map((entry) => dayDiff(entry.exDate, entry.payDate)).filter((lag) => Number.isFinite(lag) && lag >= 0 && lag <= 120).sort((a, b) => a - b);
  if (!lags.length) return null;
  const middle = Math.floor(lags.length / 2);
  return lags.length % 2 ? lags[middle] : Math.round((lags[middle - 1] + lags[middle]) / 2);
}

export function estimatePayDate(exDate: string, currency: 'USD' | 'JPY', known: KnownPayDate[]) {
  return addDaysToKey(exDate, currency === 'JPY' ? jpPayLagDays : medianPayLag(known) ?? defaultUsPayLagDays);
}

/** Pay date and its source: a manual date first, then a data source, then an estimate. */
export function resolvePayDate(exDate: string, currency: 'USD' | 'JPY', sources: { manual?: string | null; nasdaq?: KnownPayDate[]; yahoo?: KnownPayDate[] }): { payDate: string; paySource: PaySource } {
  if (sources.manual && parseDateKey(sources.manual)) return { payDate: sources.manual, paySource: 'manual' };
  const nasdaq = matchPayDate(exDate, sources.nasdaq ?? []);
  if (nasdaq) return { payDate: nasdaq, paySource: 'nasdaq' };
  const yahoo = matchPayDate(exDate, sources.yahoo ?? []);
  if (yahoo) return { payDate: yahoo, paySource: 'yahoo' };
  return { payDate: estimatePayDate(exDate, currency, sources.nasdaq ?? []), paySource: 'estimate' };
}
