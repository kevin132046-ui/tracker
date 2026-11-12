/**
 * 每日彙總: what happened to the portfolio on the last US session, written after the close by the
 * Cron trigger (lib/server/daily-digest) or, when that didn't run (the desktop app), when the page
 * opens. Only describes; never advises buying or selling. Pure: the server gathers the data.
 */
import type { EarningsEvent } from '@/lib/earnings';
import type { FreeTierGroup, UsageTier } from '@/lib/openai-free-tier';
import { groupOfModel, limitFor } from '@/lib/openai-free-tier';
import { addDaysToKey, isTradingDay, previousTradingDay } from '@/lib/market-calendar';
import type { RegimeId } from '@/lib/market-regime';
import { optionRightFromEvent } from '@/lib/options';
import { isCashTrade, isStockTrade, normalizedUsdAmount, normalizeTickerForMarket } from '@/lib/performance';

export const maxDigestSearches = 3;
export const keptDigests = 30;
/** Days ahead for 快到期 and 30 天內事件. */
export const expiryWindow = 7;
export const eventWindow = 30;

export type DigestSettings = { enabled: boolean; search: boolean };
export const defaultDigestSettings: DigestSettings = { enabled: true, search: true };

export type DigestTrade = {
  id: number;
  type: string;
  ticker: string | null;
  event: string;
  strike: string | null;
  expiryDate: string | null;
  quantity: number;
  currentPrice: number | null;
  collateral: number;
};
export type DigestQuote = { price: number; changePercent: number | null };

export type DigestMover = { ticker: string; changePercent: number };
export type DigestExpiry = { ticker: string; right: 'PUT' | 'CALL'; strike: string; expiry: string; days: number; moneyness: 'ITM' | 'OTM' | 'ATM' | null };
export type DigestEvent = { ticker: string; date: string; timing: EarningsEvent['timing']; estimate: boolean };
export type DigestNews = { ticker: string; text: string; url: string };
export type DigestOpenAi = {
  /** The UTC day checked (the day before the run). */
  day: string;
  /** false: a model on the free list was billed while inside its daily allowance. null: not checked. */
  ok: boolean | null;
  billed: Array<{ model: string; cost: number }>;
  searchCost: number | null;
  note: string | null;
};
export type DigestBody = {
  /** The US session covered (Eastern date). */
  day: string;
  generatedAt: string;
  model: string | null;
  value: { total: number; previous: number | null; change: number | null; changePercent: number | null } | null;
  movers: DigestMover[];
  expiring: DigestExpiry[];
  events: DigestEvent[];
  regime: { id: RegimeId; vix: number; ratio: number; previousId: RegimeId | null } | null;
  concentration: { group: string; share: number; previousShare: number | null } | null;
  news: DigestNews[];
  /** Why there is no news (search off, quota, no key). */
  newsNote: string | null;
  openai: DigestOpenAi | null;
  /** Parts that could not be read this time. */
  missing: string[];
};
export type DigestStatus = 'ok' | 'error' | 'running';
export type DigestRecord = { day: string; status: DigestStatus; createdAt: string; body: DigestBody | null; error: string | null };

const round = (value: number, places = 2) => Number(value.toFixed(places));

/** Minutes past midnight in New York. */
export function easternMinutes(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return part('hour') * 60 + part('minute');
}
export const easternDay = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(now));

/** The session a digest written at `now` covers: today's from 16:30 ET on a trading day, else the last one before. */
export function digestDayFor(now: number) {
  const today = easternDay(now);
  return isTradingDay(today, 'US') && easternMinutes(now) >= 16 * 60 + 30 ? today : previousTradingDay(today, 'US');
}

const marketOf = (ticker: string | null) => /^\d{4}(\.T)?$/i.test(ticker ?? '') ? 'JP' as const : 'US' as const;
/** The Yahoo symbol a trade's price follows (the underlying for options); '' when it has none. */
export function quoteSymbolOf(trade: Pick<DigestTrade, 'type' | 'ticker' | 'event'>) {
  if (isCashTrade(trade) || !trade.ticker) return '';
  const symbol = normalizeTickerForMarket(trade.ticker, marketOf(trade.ticker));
  return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : '';
}

/** A trade's market value in USD, the way the page's 追蹤市值 counts it, with fresh prices for shares. */
export function marketValueUsd(trade: DigestTrade, quotes: Readonly<Record<string, DigestQuote>>, usdJpyRate: number) {
  const currency = { market: marketOf(trade.ticker), ticker: trade.ticker };
  if (isCashTrade(trade)) return normalizedUsdAmount(currency, Math.abs(trade.quantity), usdJpyRate);
  if (isStockTrade(trade)) {
    const price = quotes[quoteSymbolOf(trade)]?.price ?? trade.currentPrice;
    return price === null ? 0 : normalizedUsdAmount(currency, price * trade.quantity, usdJpyRate);
  }
  if (trade.currentPrice === null) return 0;
  return normalizedUsdAmount(currency, Math.max(trade.collateral, trade.currentPrice * trade.quantity * 100), usdJpyRate);
}

export function trackedValue(trades: readonly DigestTrade[], quotes: Readonly<Record<string, DigestQuote>>, usdJpyRate: number) {
  return round(trades.reduce((sum, trade) => sum + marketValueUsd(trade, quotes, usdJpyRate), 0));
}

/** The largest day moves among the symbols held (shares or option underlyings). */
export function topMovers(trades: readonly DigestTrade[], quotes: Readonly<Record<string, DigestQuote>>, count = 3): DigestMover[] {
  const symbols = [...new Set(trades.map(quoteSymbolOf).filter(Boolean))];
  return symbols.flatMap((ticker) => {
    const change = quotes[ticker]?.changePercent;
    return typeof change === 'number' && Number.isFinite(change) ? [{ ticker, changePercent: round(change, 4) }] : [];
  }).sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent) || a.ticker.localeCompare(b.ticker)).slice(0, count);
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Options expiring within `window` days of `day`, with where the underlying stands against the strike. */
export function expiringSoon(trades: readonly DigestTrade[], day: string, quotes: Readonly<Record<string, DigestQuote>>, window = expiryWindow): DigestExpiry[] {
  return trades.flatMap((trade): DigestExpiry[] => {
    const right = isCashTrade(trade) || isStockTrade(trade) ? null : optionRightFromEvent(trade.event);
    if (!right || !trade.expiryDate || !trade.ticker) return [];
    const days = daysBetween(day, trade.expiryDate);
    if (days < 0 || days > window) return [];
    const ticker = quoteSymbolOf(trade);
    const price = quotes[ticker]?.price;
    const strike = Number(trade.strike);
    let moneyness: DigestExpiry['moneyness'] = null;
    if (typeof price === 'number' && Number.isFinite(strike) && strike > 0) {
      const gap = (price - strike) / strike;
      moneyness = Math.abs(gap) < 0.01 ? 'ATM' : (right === 'put' ? price < strike : price > strike) ? 'ITM' : 'OTM';
    }
    return [{ ticker: ticker || trade.ticker, right: right === 'put' ? 'PUT' : 'CALL', strike: String(trade.strike ?? ''), expiry: trade.expiryDate, days, moneyness }];
  }).sort((a, b) => a.expiry.localeCompare(b.expiry) || a.ticker.localeCompare(b.ticker));
}

/** Earnings dates from `day` to `window` days ahead. */
export function upcomingEvents(earnings: Readonly<Record<string, EarningsEvent>>, day: string, window = eventWindow): DigestEvent[] {
  const last = addDaysToKey(day, window);
  return Object.entries(earnings).flatMap(([ticker, event]) => event.date > day && event.date <= last ? [{ ticker, date: event.date, timing: event.timing, estimate: event.estimate }] : [])
    .sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
}

/** The largest group's share of the tracked value. */
export function concentration(values: ReadonlyArray<{ group: string; value: number }>): { group: string; share: number } | null {
  const totals = new Map<string, number>();
  for (const { group, value } of values) if (value > 0) totals.set(group, (totals.get(group) ?? 0) + value);
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const [group, value] = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { group, share: round(value / total, 4) };
}

/** A Costs API line item ("gpt-5.4-mini, input", "web search tool calls") → its model, or 'search'. */
export function lineItemModel(lineItem: string) {
  if (/web[\s_-]*search/i.test(lineItem)) return 'search';
  const model = lineItem.split(',')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.:-]{1,63}$/.test(model) ? model : null;
}

/**
 * Was any model on the free list billed for a day on which its group stayed inside the allowance?
 * Costs and usage are the UTC day's totals from OpenAI; search calls are billed anyway and listed apart.
 */
export function freeTierCheck(costs: ReadonlyArray<{ lineItem: string; cost: number }>, usage: Readonly<Record<string, number>>, groups: readonly FreeTierGroup[], tier: UsageTier, day: string): DigestOpenAi {
  const byModel = new Map<string, number>();
  let searchCost = 0;
  for (const { lineItem, cost } of costs) {
    const model = lineItemModel(lineItem);
    if (!model || !(cost > 0)) continue;
    if (model === 'search') searchCost += cost;
    else byModel.set(model, (byModel.get(model) ?? 0) + cost);
  }
  const groupUsage = new Map<FreeTierGroup, number>();
  for (const [model, tokens] of Object.entries(usage)) {
    const group = groupOfModel(groups as FreeTierGroup[], model);
    if (group) groupUsage.set(group, (groupUsage.get(group) ?? 0) + tokens);
  }
  const billed = [...byModel.entries()].flatMap(([model, cost]) => {
    const group = groupOfModel(groups as FreeTierGroup[], model);
    // Over the allowance it is billed as it should be; under it, a charge means the free tier didn't apply.
    return group && cost >= 0.001 && (groupUsage.get(group) ?? 0) <= limitFor(group, tier) ? [{ model, cost: round(cost, 4) }] : [];
  }).sort((a, b) => b.cost - a.cost);
  return { day, ok: billed.length === 0, billed, searchCost: round(searchCost, 4), note: null };
}

/** What the model may write for 持倉相關新聞: at most one line per ticker held, https links only. */
export function cleanNews(raw: unknown, tickers: readonly string[]): DigestNews[] {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { news?: unknown }).news) ? (raw as { news: unknown[] }).news : [];
  const allowed = new Set(tickers);
  const seen = new Set<string>();
  return items.flatMap((item): DigestNews[] => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const ticker = String(entry.ticker ?? '').trim().toUpperCase();
    const text = String(entry.text ?? entry.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    let url = '';
    try { const parsed = new URL(String(entry.url ?? '')); url = parsed.protocol === 'https:' ? parsed.href.slice(0, 400) : ''; } catch { url = ''; }
    if (!allowed.has(ticker) || seen.has(ticker) || !text || !url) return [];
    seen.add(ticker);
    return [{ ticker, text, url }];
  }).slice(0, maxDigestSearches + 2);
}

export function cleanDigestSettings(value: unknown): DigestSettings {
  const input = value && typeof value === 'object' ? value as Partial<DigestSettings> : {};
  return { enabled: typeof input.enabled === 'boolean' ? input.enabled : defaultDigestSettings.enabled, search: typeof input.search === 'boolean' ? input.search : defaultDigestSettings.search };
}
