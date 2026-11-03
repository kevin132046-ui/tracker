/**
 * 持倉風險 (exposure) panel maths: positions grouped by sector or user theme, concentration,
 * equal-shock stress scenarios, the next 30 days of events, and what the option toolbox allows.
 * Pure; amounts are USD and dates are YYYY-MM-DD keys.
 */
import { daysBetweenKeys, type EarningsReminder } from '@/lib/earnings';
import { parseDateKey } from '@/lib/market-calendar';

export const exposureThemesKey = 'optionflow-exposure-themes';
export const exposureEventsKey = 'optionflow-exposure-events';
export const exposureOpenKey = 'optionflow-exposure-open';
export const exposureCashLikeKey = 'optionflow-exposure-cash-like';

/** Treasury-bill and box-spread ETFs counted with cash unless the user edits the list. */
export const defaultCashLike = ['BOXX', 'SGOV', 'BIL', 'SHV', 'USFR', 'TFLO'] as const;
export const cashLikeGroup = '類現金';
export const unclassifiedGroup = '未分類';
export const eventWindowDays = 30;
export const maxThemeLength = 12;
export const maxEventLabelLength = 20;
const maxCustomEvents = 30;
const tickerPattern = /^[A-Z0-9.^=-]{1,15}$/;

/** One open trade as the panel sees it. Options carry their dollar delta, not their premium. */
export type ExposureInput = {
  /** The label the rest of the page uses (the trade's ticker, upper case). */
  ticker: string;
  /** The quote symbol for sector lookups and earnings (7203.T for Tokyo). */
  symbol: string;
  kind: 'stock' | 'option' | 'cash';
  /** Stock market value, option delta dollars (0 when not priced), or cash balance. */
  value: number;
  shares?: number;
  /** Option without greeks yet: counted, but adds no exposure. */
  unpriced?: boolean;
};

export type ExposurePosition = {
  ticker: string;
  symbol: string;
  value: number;
  shares: number;
  cashLike: boolean;
  options: number;
  unpricedOptions: number;
};

export type GroupMode = 'sector' | 'theme';
export type ExposureGroup = { name: string; value: number; share: number; members: string[]; cashLike: boolean };
export type Concentration = { top1: { ticker: string; share: number }; top3: number; names: string[]; effective: number; count: number; level: 'high' | 'mid' | 'low' };
export type StressScenario = { id: 'top' | 'second' | 'all'; name: string | null; shock: number; loss: number };
export type CustomEvent = { id: string; date: string; ticker: string; label: string };
export type ExposureEvent = { key: string; date: string; ticker: string; label: string; kind: 'earnings' | 'custom'; estimate: boolean; timing: 'pre' | 'post' | null; daysAway: number; share: number };
export type OptionTools = { coveredCalls: Array<{ ticker: string; contracts: number }>; cashLike: number; putStrikeCap: number };

const upper = (value: string) => value.trim().toUpperCase();

/** Upper-case tickers from free text ("boxx, sgov bil"), deduplicated, invalid entries dropped. */
export function parseCashLike(text: string): string[] {
  return [...new Set(text.split(/[\s,，、]+/).map(upper).filter((ticker) => tickerPattern.test(ticker)))];
}

/** One position per ticker. Cash trades and cash-like tickers are flagged so they can be left out. */
export function buildPositions(inputs: ExposureInput[], cashLike: Iterable<string>): ExposurePosition[] {
  const cashSet = new Set([...cashLike].map(upper));
  const byTicker = new Map<string, ExposurePosition>();
  for (const input of inputs) {
    const ticker = upper(input.ticker || '');
    if (!ticker || !Number.isFinite(input.value)) continue;
    const position = byTicker.get(ticker) ?? { ticker, symbol: input.symbol || ticker, value: 0, shares: 0, cashLike: false, options: 0, unpricedOptions: 0 };
    position.value += input.value;
    if (input.kind === 'stock') position.shares += Math.max(0, input.shares ?? 0);
    if (input.kind === 'option') {
      position.options += 1;
      if (input.unpriced) position.unpricedOptions += 1;
    }
    if (input.kind === 'cash' || cashSet.has(ticker)) position.cashLike = true;
    byTicker.set(ticker, position);
  }
  return [...byTicker.values()].filter((position) => Math.abs(position.value) > 0.005 || position.options > 0);
}

/** Group name of one position: themes win in theme mode, else the sector, else 未分類. */
export function groupName(position: ExposurePosition, mode: GroupMode, sectors: Record<string, string | null | undefined>, themes: Record<string, string>) {
  if (position.cashLike) return cashLikeGroup;
  if (mode === 'theme' && themes[position.ticker]) return themes[position.ticker];
  return sectors[position.symbol] || sectors[position.ticker] || unclassifiedGroup;
}

/** Theme mode is the default once any held ticker has a theme. */
export const defaultGroupMode = (positions: ExposurePosition[], themes: Record<string, string>): GroupMode =>
  positions.some((position) => !position.cashLike && themes[position.ticker]) ? 'theme' : 'sector';

/** Shares use positive exposure only; a net-short group shows 0% but still counts in scenarios. */
export function exposureGroups(positions: ExposurePosition[], options: { mode: GroupMode; sectors: Record<string, string | null | undefined>; themes: Record<string, string>; includeCash: boolean }) {
  const groups = new Map<string, ExposureGroup>();
  for (const position of positions) {
    if (position.cashLike && !options.includeCash) continue;
    const name = groupName(position, options.mode, options.sectors, options.themes);
    const group = groups.get(name) ?? { name, value: 0, share: 0, members: [], cashLike: position.cashLike };
    group.value += position.value;
    group.members.push(position.ticker);
    groups.set(name, group);
  }
  const list = [...groups.values()];
  const total = list.reduce((sum, group) => sum + Math.max(0, group.value), 0);
  list.forEach((group) => { group.share = total > 0 ? Math.max(0, group.value) / total : 0; });
  // Risk groups by size first; cash-like last so the bar ends with the hatched block.
  list.sort((a, b) => Number(a.cashLike) - Number(b.cashLike) || b.value - a.value || a.name.localeCompare(b.name));
  return { groups: list, total };
}

/** Same thresholds as the allocation panel's line: top three ≥ 75% high, ≥ 50% mid. */
export const concentrationLevel = (top3: number): Concentration['level'] => top3 >= 0.75 ? 'high' : top3 >= 0.5 ? 'mid' : 'low';

/** Largest weight, top three and the effective number of positions (1 ÷ Σ weight²). */
export function concentration(positions: ExposurePosition[], includeCash: boolean): Concentration | null {
  const rows = positions.filter((position) => (includeCash || !position.cashLike) && position.value > 0);
  const total = rows.reduce((sum, position) => sum + position.value, 0);
  if (!rows.length || total <= 0) return null;
  const weights = rows.map((position) => ({ ticker: position.ticker, share: position.value / total })).sort((a, b) => b.share - a.share || a.ticker.localeCompare(b.ticker));
  const top3 = weights.slice(0, 3).reduce((sum, row) => sum + row.share, 0);
  const effective = 1 / weights.reduce((sum, row) => sum + row.share * row.share, 0);
  return { top1: weights[0], top3, names: weights.slice(0, 3).map((row) => row.ticker), effective, count: rows.length, level: concentrationLevel(top3) };
}

export const presetShocks = { top: 0.25, second: 0.15, all: 0.2 } as const;

/** Equal-shock losses: the largest group −25%, the second −15%, everything but cash −20%. */
export function stressScenarios(groups: ExposureGroup[], positions: ExposurePosition[]): StressScenario[] {
  const risky = groups.filter((group) => !group.cashLike && group.value > 0);
  const nonCash = positions.filter((position) => !position.cashLike).reduce((sum, position) => sum + position.value, 0);
  const scenarios: StressScenario[] = [];
  if (risky[0]) scenarios.push({ id: 'top', name: risky[0].name, shock: presetShocks.top, loss: risky[0].value * presetShocks.top });
  if (risky[1]) scenarios.push({ id: 'second', name: risky[1].name, shock: presetShocks.second, loss: risky[1].value * presetShocks.second });
  if (nonCash > 0) scenarios.push({ id: 'all', name: null, shock: presetShocks.all, loss: nonCash * presetShocks.all });
  return scenarios;
}

/** Loss in USD when `value` of exposure falls by `shock` (0.3 = −30%). */
export const scenarioLoss = (value: number, shock: number) => Math.max(0, value) * Math.min(1, Math.max(0, shock));

/** Stored custom events, cleaned: valid dates, upper-case tickers, short labels, past ones dropped. */
export function sanitizeCustomEvents(value: unknown, todayKey: string): CustomEvent[] {
  if (!Array.isArray(value)) return [];
  const events: CustomEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { id, date, ticker, label } = item as Record<string, unknown>;
    if (typeof date !== 'string' || !parseDateKey(date) || date < todayKey) continue;
    if (typeof ticker !== 'string' || !tickerPattern.test(upper(ticker))) continue;
    const text = typeof label === 'string' ? label.trim().slice(0, maxEventLabelLength) : '';
    if (!text) continue;
    events.push({ id: typeof id === 'string' && id ? id.slice(0, 40) : `${date}-${upper(ticker)}-${events.length}`, date, ticker: upper(ticker), label: text });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker)).slice(0, maxCustomEvents);
}

/** Stored themes, cleaned: ticker → short theme name. */
export function sanitizeThemes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const themes: Record<string, string> = {};
  for (const [ticker, theme] of Object.entries(value as Record<string, unknown>)) {
    const key = upper(ticker);
    if (!tickerPattern.test(key) || typeof theme !== 'string') continue;
    const name = theme.trim().slice(0, maxThemeLength);
    if (name && name !== cashLikeGroup) themes[key] = name;
  }
  return themes;
}

/** Earnings and custom events for held tickers within the window, soonest first, with each ticker's weight. */
export function upcomingEvents(earnings: EarningsReminder[], custom: CustomEvent[], positions: ExposurePosition[], todayKey: string, days = eventWindowDays): ExposureEvent[] {
  const total = positions.reduce((sum, position) => sum + Math.max(0, position.value), 0);
  const bySymbol = new Map<string, ExposurePosition>();
  positions.forEach((position) => { bySymbol.set(position.symbol, position); bySymbol.set(position.ticker, position); });
  const share = (position: ExposurePosition) => total > 0 ? Math.max(0, position.value) / total : 0;
  const events: ExposureEvent[] = [];
  for (const entry of earnings) {
    const position = bySymbol.get(entry.symbol);
    if (!position || entry.daysAway > days) continue;
    events.push({ key: `e-${entry.symbol}-${entry.date}`, date: entry.date, ticker: position.ticker, label: '財報', kind: 'earnings', estimate: entry.estimate, timing: entry.timing, daysAway: entry.daysAway, share: share(position) });
  }
  for (const event of custom) {
    const position = bySymbol.get(event.ticker);
    const daysAway = daysBetweenKeys(todayKey, event.date);
    if (!position || !Number.isFinite(daysAway) || daysAway < 0 || daysAway > days) continue;
    events.push({ key: `c-${event.id}`, date: event.date, ticker: position.ticker, label: event.label, kind: 'custom', estimate: false, timing: null, daysAway, share: share(position) });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker) || a.kind.localeCompare(b.kind));
}

/** Tickers with 100+ shares (one covered call per 100) and the strike one cash-secured put can carry. */
export function optionTools(positions: ExposurePosition[]): OptionTools {
  const coveredCalls = positions
    .filter((position) => !position.cashLike && position.shares >= 100)
    .map((position) => ({ ticker: position.ticker, contracts: Math.floor(position.shares / 100) }))
    .sort((a, b) => b.contracts - a.contracts || a.ticker.localeCompare(b.ticker));
  const cashLike = positions.filter((position) => position.cashLike).reduce((sum, position) => sum + Math.max(0, position.value), 0);
  return { coveredCalls, cashLike, putStrikeCap: Math.floor(cashLike / 100) };
}

/** Yahoo's English sector names in the page's Chinese; anything else passes through. */
const sectorNames: Record<string, string> = {
  Technology: '科技',
  'Financial Services': '金融',
  'Communication Services': '通訊服務',
  Utilities: '公用事業',
  'Consumer Cyclical': '非必需消費',
  'Consumer Defensive': '必需消費',
  Healthcare: '醫療保健',
  Industrials: '工業',
  Energy: '能源',
  'Basic Materials': '原物料',
  'Real Estate': '不動產',
};
export const sectorLabel = (sector: string | null | undefined, quoteType?: string | null) => {
  if (quoteType === 'ETF' || quoteType === 'MUTUALFUND') return 'ETF';
  if (!sector) return null;
  return sectorNames[sector] ?? sector;
};
