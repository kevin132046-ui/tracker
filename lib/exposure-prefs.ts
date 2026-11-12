/**
 * What the 持倉風險 panel lets the owner set, as one record every device and the server's daily digest
 * share: themes by ticker, custom events, and the cash-like ticker list. The site's database holds it
 * (lib/server/exposure-prefs-store); each browser keeps a copy to start from. Pure.
 */
import type { CustomEvent, ExposurePosition, GroupMode } from '@/lib/exposure';
import { cashLikeGroup, defaultCashLike, defaultGroupMode, exposureGroups, parseCashLike, sanitizeCustomEvents, sanitizeThemes } from '@/lib/exposure';

export type ExposurePrefs = {
  /** Ticker → theme name. */
  themes: Record<string, string>;
  events: CustomEvent[];
  /** null: the built-in list (BOXX, SGOV…); an empty list means none. */
  cashLike: string[] | null;
};
export type StoredExposurePrefs = ExposurePrefs & { updatedAt: string };

export const emptyExposurePrefs: ExposurePrefs = { themes: {}, events: [], cashLike: null };
const maxThemes = 200;
const maxCashLike = 60;

const cleanThemes = (value: unknown) => Object.fromEntries(Object.entries(sanitizeThemes(value)).slice(0, maxThemes));
// Past events are kept as stored: whoever reads them decides what "past" means for its own day.
const cleanEvents = (value: unknown) => sanitizeCustomEvents(value, '');
const cleanCashLike = (value: unknown) => Array.isArray(value)
  ? parseCashLike(value.filter((item): item is string => typeof item === 'string').join(' ')).slice(0, maxCashLike)
  : null;

/** A stored or received record with anything unsound dropped. */
export function cleanExposurePrefs(value: unknown): ExposurePrefs {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { themes: cleanThemes(source.themes), events: cleanEvents(source.events), cashLike: cleanCashLike(source.cashLike) };
}

/** `current` with the parts `patch` names replaced; parts it leaves out stay as they are. */
export function mergeExposurePrefs(current: ExposurePrefs, patch: unknown): ExposurePrefs {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch as Record<string, unknown> : {};
  return {
    themes: 'themes' in source ? cleanThemes(source.themes) : current.themes,
    events: 'events' in source ? cleanEvents(source.events) : current.events,
    cashLike: 'cashLike' in source ? cleanCashLike(source.cashLike) : current.cashLike,
  };
}

export const hasExposurePrefs = (prefs: ExposurePrefs) => Object.keys(prefs.themes).length > 0 || prefs.events.length > 0 || prefs.cashLike !== null;

/**
 * What a browser does with the database's answer: take its record when it has one (even an empty one:
 * another device cleared it), fill it from this browser when it has none and this browser has
 * something, otherwise nothing.
 */
export function planExposureSync(server: ExposurePrefs | null, local: ExposurePrefs): 'adopt' | 'seed' | 'none' {
  if (server) return 'adopt';
  return hasExposurePrefs(local) ? 'seed' : 'none';
}

export const cashLikeList = (prefs: Pick<ExposurePrefs, 'cashLike'> | null) => prefs?.cashLike ?? [...defaultCashLike];

export type GroupedHolding = { ticker: string; symbol: string; value: number; cash: boolean };
export type LargestGroup = { group: string; share: number; mode: GroupMode };

/**
 * The largest group the way the panel draws it: themes once any holding has one, sectors otherwise;
 * cash and cash-like tickers form their own group, which counts in the total but is never "the largest".
 */
export function largestExposureGroup(holdings: readonly GroupedHolding[], prefs: Pick<ExposurePrefs, 'themes' | 'cashLike'> | null, sectors: Readonly<Record<string, string | null | undefined>>): LargestGroup | null {
  const cashLike = new Set(cashLikeList(prefs).map((ticker) => ticker.toUpperCase()));
  const byTicker = new Map<string, ExposurePosition>();
  for (const holding of holdings) {
    const ticker = holding.ticker.trim().toUpperCase();
    if (!ticker || !Number.isFinite(holding.value)) continue;
    const position = byTicker.get(ticker) ?? { ticker, symbol: holding.symbol || ticker, value: 0, shares: 0, cashLike: false, options: 0, unpricedOptions: 0 };
    position.value += holding.value;
    if (holding.cash || cashLike.has(ticker)) position.cashLike = true;
    byTicker.set(ticker, position);
  }
  const positions = [...byTicker.values()];
  const themes = prefs?.themes ?? {};
  const mode = defaultGroupMode(positions, themes);
  const { groups } = exposureGroups(positions, { mode, sectors: { ...sectors }, themes, includeCash: true });
  const top = groups.find((group) => !group.cashLike && group.name !== cashLikeGroup && group.value > 0);
  return top ? { group: top.name, share: Number(top.share.toFixed(4)), mode } : null;
}
