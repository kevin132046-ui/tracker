/**
 * What the OpenAI account actually paid, from the organisation Costs API (admin key): free-tier tokens
 * cost nothing there, so anything it lists was billed (web-search calls, models outside the free list,
 * usage past the daily allowance). OpenAI shows no prepaid balance through its API, so the balance is
 * the one entered in the settings minus what was billed since. Pure: shared by the server and the browser.
 */

/** A web-search call is US$0.01; the pages it reads are billed as input tokens on top, so ~1.5¢ in practice. */
export const searchCostEstimate = 0.015;
/** Below this the settings warn: at zero balance even the free tokens stop working. */
export const lowBalance = 1;

export type CostBucket = { day: string; search: number; other: number };
export type SpendSummary = {
  today: { search: number; other: number; total: number };
  month: number;
  /** Billed since the balance was entered (that UTC day included, so the estimate errs low). */
  sinceBalance: number | null;
  days: CostBucket[];
};
export type SavedBalance = { amount: number; at: string };
export type BalanceEstimate = { amount: number; at: string; spent: number; remaining: number; searchesLeft: number; low: boolean };

const isSearch = (lineItem: string) => /web[\s_-]*search/i.test(lineItem);
const utcDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 10_000) / 10_000;

type CostsPage = { data?: Array<{ start_time?: number; results?: Array<{ amount?: { value?: number | string; currency?: string } | null; line_item?: string | null }> }> };

/** Daily buckets from Costs API pages (grouped by line_item), web-search calls kept apart from the rest. */
export function costBuckets(pages: readonly CostsPage[]): CostBucket[] {
  const byDay = new Map<string, CostBucket>();
  for (const page of pages) {
    for (const bucket of page.data ?? []) {
      if (typeof bucket.start_time !== 'number') continue;
      const day = utcDay(bucket.start_time);
      const row = byDay.get(day) ?? { day, search: 0, other: 0 };
      for (const result of bucket.results ?? []) {
        const value = Number(result.amount?.value ?? 0);
        if (!Number.isFinite(value) || value <= 0 || (result.amount?.currency && result.amount.currency.toLowerCase() !== 'usd')) continue;
        if (isSearch(String(result.line_item ?? ''))) row.search += value;
        else row.other += value;
      }
      byDay.set(day, row);
    }
  }
  return [...byDay.values()].map((row) => ({ day: row.day, search: round(row.search), other: round(row.other) })).sort((a, b) => a.day.localeCompare(b.day));
}

export function summarizeSpend(days: readonly CostBucket[], now: number, balanceAt: string | null): SpendSummary {
  const today = new Date(now).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const sinceDay = balanceAt ? balanceAt.slice(0, 10) : null;
  const todayRow = days.find((row) => row.day === today) ?? { search: 0, other: 0 };
  const sum = (rows: readonly CostBucket[]) => round(rows.reduce((total, row) => total + row.search + row.other, 0));
  return {
    today: { search: todayRow.search, other: todayRow.other, total: round(todayRow.search + todayRow.other) },
    month: sum(days.filter((row) => row.day.startsWith(month))),
    sinceBalance: sinceDay ? sum(days.filter((row) => row.day >= sinceDay)) : null,
    days: [...days],
  };
}

export function estimateBalance(saved: SavedBalance | null, spentSince: number | null): BalanceEstimate | null {
  if (!saved || spentSince === null) return null;
  const remaining = round(Math.max(0, saved.amount - spentSince));
  return { amount: saved.amount, at: saved.at, spent: spentSince, remaining, searchesLeft: Math.floor(remaining / searchCostEstimate), low: remaining < lowBalance };
}

/** An entered balance: US dollars, 0–10,000, at most cents. */
export function cleanBalance(value: unknown, now = new Date()): SavedBalance | string {
  const amount = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000) return '請輸入 0 到 10,000 之間的金額（美元）。';
  return { amount: Math.round(amount * 100) / 100, at: now.toISOString() };
}

/** The earliest day the summary needs: the month's first day, or the balance day if earlier (at most 90 days back). */
export function costsStart(now: number, balanceAt: string | null) {
  const monthStart = Date.parse(`${new Date(now).toISOString().slice(0, 7)}-01T00:00:00Z`);
  const balanceStart = balanceAt ? Date.parse(`${balanceAt.slice(0, 10)}T00:00:00Z`) : monthStart;
  const floor = now - 90 * 86_400_000;
  return Math.floor(Math.max(floor, Math.min(monthStart, Number.isFinite(balanceStart) ? balanceStart : monthStart)) / 1000);
}
