'use client';

import type { ChangeEvent, CSSProperties } from 'react';
import { FormEvent, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrokerWorkspace } from '@/lib/broker-workspace';
import EditableHeroTitle from '@/components/EditableHeroTitle';
import LanguageSwitcher from '@/components/LanguageSwitcher';

type Trade = {
  id: number;
  type: string;
  openDate: string;
  expiryDate: string | null;
  closeDate: string | null;
  ticker: string | null;
  event: string;
  strike: string | null;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  fees: number;
  collateral: number;
  notes: string;
  status: 'open' | 'closed';
  quoteMode: 'auto' | 'manual';
  market?: 'US' | 'JP';
  sourceRow?: number | null;
  derived?: boolean;
  dividendSourceTicker?: string;
  dividendAmountPerShare?: number;
  dividendGross?: number;
  dividendTax?: number;
  dividendEventKey?: string;
  dividendCalculatedNet?: number;
  dividendAdjustment?: number;
};

type RangeMode = 'day' | 'week' | 'month' | 'year';
type MacroMarketGroup = 'rates' | 'commodities';
type FilterMode = 'all' | 'open' | 'closed' | 'options' | 'stock' | 'cash';
type PositionViewMode = 'visual' | 'details';
type AllocationChartMode = 'donut' | 'bars';
type SymbolSuggestion = { symbol: string; name: string; exchange: string; type: string };
type QuoteSession = 'pre' | 'regular' | 'post' | 'closed';
type LiveQuote = { ticker: string; price: number; marketTime: number | null; session: QuoteSession; currency: string; regularPrice: number; extendedPrice: number | null; previousClose: number | null; regularChange: number | null; regularChangePercent: number | null; extendedChange: number | null; extendedChangePercent: number | null; change: number | null; changePercent: number | null; sparkline: number[] };
type AllocationHistory = {
  date: string;
  positions: Array<{ label: string; value: number; tradeCount: number; estimated: boolean }>;
  total: number;
  tradeCount: number;
  estimatedTickers: string[];
};
type AllocationItem = { label: string; value: number; tradeCount: number; estimated: boolean; members: string[]; share: number; color: string };
type TechnicalRange = '1d' | '1w' | '1mo' | '3mo' | '6mo' | '1y' | 'custom';
type PriceChartMode = 'line' | 'candles';
type TechnicalPoint = {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  bollMiddle: number | null;
  bollUpper: number | null;
  bollLower: number | null;
};
type TechnicalData = {
  symbol: string;
  range: TechnicalRange;
  from: string;
  to: string;
  interval: string;
  intervalLabel: string;
  points: TechnicalPoint[];
  latestPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  marketTime: number;
  updatedAt: string;
};
type TechnicalCacheEntry = { data: TechnicalData; fetchedAt: number };
const emptyTechnicalPoints: TechnicalPoint[] = [];
type BenchmarkMarket = {
  id: 'USDJPY' | 'US10Y' | 'US30Y' | 'GOLD' | 'OIL';
  symbol: string;
  label: string;
  unit: string;
  decimals: number;
  values: Array<number | null>;
  latest: number | null;
  change: number | null;
  changePercent: number | null;
};
type BenchmarkData = { SPY: number[]; BOXX: number[] };
type MacroMarketData = { mode: RangeMode | null; markets: BenchmarkMarket[]; updatedAt: string | null };
type MacroCacheEntry = { markets: BenchmarkMarket[]; updatedAt: string; fetchedAt: number };
type BackgroundMode = 'default' | 'image';
type DividendSettings = { enabled: boolean; usTaxRate: number; jpTaxRate: number };
type DividendCash = {
  USD: { gross: number; tax: number; adjustment: number; net: number; count: number };
  JPY: { gross: number; tax: number; adjustment: number; net: number; count: number };
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
};

const loadBrokerHub = () => import('@/components/BrokerHub');
const loadDcfCalculator = () => import('@/components/DcfCalculator');
const loadCompanyFundamentals = () => import('@/components/CompanyFundamentals');
const BrokerHub = lazy(loadBrokerHub);
const DcfCalculator = lazy(loadDcfCalculator);
const CompanyFundamentals = lazy(loadCompanyFundamentals);

const palette = ['#2f6fd5', '#248fa8', '#6c5dd3', '#188f70', '#b9781f', '#c75267'];
const companyNames: Record<string, string> = {
  AAPL: 'Apple', AMZN: 'Amazon', AXP: 'American Express', BOXX: 'Alpha Architect', GOOGL: 'Alphabet', KO: 'Coca-Cola',
  CNC: 'Centene', META: 'Meta Platforms', MSFT: 'Microsoft', NVDA: 'NVIDIA', SPGI: 'S&P Global', SPY: 'SPDR S&P 500',
  TRV: 'The Travelers Companies', TSLA: 'Tesla', TTWO: 'Take-Two Interactive', V: 'Visa', VST: 'Vistra',
  '7203.T': 'Toyota Motor', '6758.T': 'Sony Group', '9984.T': 'SoftBank Group', '6861.T': 'Keyence',
  '8306.T': 'Mitsubishi UFJ Financial Group', '8035.T': 'Tokyo Electron', '9983.T': 'Fast Retailing', '7974.T': 'Nintendo',
};
const panelRatioKey = 'optionflow-analytics-panel-ratio';
const backgroundImageKey = 'optionflow-custom-background';
const backgroundModeKey = 'optionflow-background-mode';
const backgroundPendingKey = 'optionflow-pending-background';
const backgroundPendingModeKey = 'optionflow-pending-background-mode';
const usdJpyRateKey = 'optionflow-usdjpy-rate';
const usdJpyUpdatedAtKey = 'optionflow-usdjpy-updated-at';
const macroMarketStorageKey = 'optionflow-macro-markets-v2';
const localBackgroundPattern = /^data:image\/jpeg;base64,/i;
const serverBackgroundPattern = /^\/api\/background\?image=1&version=\d{10,16}-[0-9a-f-]{36}$/i;
const isLocalBackground = (value: string) => localBackgroundPattern.test(value);
const isServerBackground = (value: string) => serverBackgroundPattern.test(value);
const isStoredBackground = (value: string) => isLocalBackground(value) || isServerBackground(value);
const clampPanelRatio = (value: number) => Math.min(72, Math.max(46, value));
const initialPanelRatio = () => {
  if (typeof window === 'undefined') return 60;
  const savedRatio = Number(window.localStorage.getItem(panelRatioKey));
  return Number.isFinite(savedRatio) && savedRatio > 0 ? clampPanelRatio(savedRatio) : 60;
};
const initialUsdJpyRate = () => {
  if (typeof window === 'undefined') return 150;
  const savedRate = Number(window.localStorage.getItem(usdJpyRateKey));
  return Number.isFinite(savedRate) && savedRate > 50 ? savedRate : 150;
};
const initialUsdJpyUpdatedAt = () => {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(usdJpyUpdatedAtKey);
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) && Date.now() - timestamp < 7 * 24 * 60 * 60 * 1_000 ? value : null;
};
const readStoredMacroMarket = (key: string): MacroCacheEntry | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = JSON.parse(window.localStorage.getItem(macroMarketStorageKey) ?? '{}') as Record<string, MacroCacheEntry>;
    const entry = stored[key];
    return entry && Array.isArray(entry.markets) && typeof entry.updatedAt === 'string' && Number.isFinite(entry.fetchedAt) ? entry : null;
  } catch {
    return null;
  }
};
const writeStoredMacroMarket = (key: string, entry: MacroCacheEntry) => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(macroMarketStorageKey) ?? '{}') as Record<string, MacroCacheEntry>;
    stored[key] = entry;
    window.localStorage.setItem(macroMarketStorageKey, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory cache still works.
  }
};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const monthsBefore = (dateString: string, months: number) => {
  const date = new Date(`${dateString}T00:00:00Z`);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString().slice(0, 10);
};
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const yenMoney = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const quantityNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const percent = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });
const precisePercent = new Intl.NumberFormat('zh-TW', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedPrecisePercent = (value: number) => `${value > 0 ? '+' : ''}${precisePercent.format(value)}`;
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`)) : '—';
const clockFormatter = (timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const easternClockFormatter = clockFormatter('America/New_York');
const japanClockFormatter = clockFormatter('Asia/Tokyo');
const easternZoneFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
const easternZoneName = (timestamp: number) => easternZoneFormatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName')?.value ?? 'ET';
const japaneseCalendarFormatter = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { timeZone: 'Asia/Tokyo', era: 'long', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

type ZonedDate = { year: number; month: number; day: number };
type MarketCalendarStatus = {
  japaneseDate: string;
  japanHoliday: string | null;
  japanClosedReason: string | null;
  usClosedReason: string | null;
};

const dateKey = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const zonedDateKey = (date: ZonedDate) => dateKey(date.year, date.month, date.day);
const zonedDate = (timestamp: number, timeZone: string): ZonedDate => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
};
const weekday = ({ year, month, day }: ZonedDate) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
const nthWeekday = (year: number, month: number, targetWeekday: number, occurrence: number) => {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((targetWeekday - firstWeekday + 7) % 7) + (occurrence - 1) * 7;
};
const lastWeekday = (year: number, month: number, targetWeekday: number) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDayWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((lastDayWeekday - targetWeekday + 7) % 7);
};
const addUtcDays = (date: ZonedDate, offset: number): ZonedDate => {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
};
const japaneseHolidayCache = new Map<number, Map<string, string>>();
const usHolidayCache = new Map<number, Map<string, string>>();

function japaneseHolidays(year: number) {
  const cached = japaneseHolidayCache.get(year);
  if (cached) return cached;
  const base = new Map<string, string>();
  const add = (month: number, day: number, name: string) => base.set(dateKey(year, month, day), name);
  add(1, 1, '元日');
  add(1, nthWeekday(year, 1, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(3, Math.floor(20.8431 + .242194 * (year - 1980) - Math.floor((year - 1980) / 4)), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthWeekday(year, 7, 1, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthWeekday(year, 9, 1, 3), '敬老の日');
  add(9, Math.floor(23.2488 + .242194 * (year - 1980) - Math.floor((year - 1980) / 4)), '秋分の日');
  add(10, nthWeekday(year, 10, 1, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  const holidays = new Map(base);
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 2; day < days; day += 1) {
      const key = dateKey(year, month, day);
      if (holidays.has(key)) continue;
      const current = { year, month, day };
      if (base.has(zonedDateKey(addUtcDays(current, -1))) && base.has(zonedDateKey(addUtcDays(current, 1)))) holidays.set(key, '国民の休日');
    }
  }
  [...base.entries()].forEach(([key, name]) => {
    const [holidayYear, holidayMonth, holidayDay] = key.split('-').map(Number);
    if (new Date(Date.UTC(holidayYear, holidayMonth - 1, holidayDay)).getUTCDay() !== 0) return;
    let substitute = addUtcDays({ year: holidayYear, month: holidayMonth, day: holidayDay }, 1);
    while (holidays.has(zonedDateKey(substitute))) substitute = addUtcDays(substitute, 1);
    holidays.set(zonedDateKey(substitute), `振替休日（${name}）`);
  });
  japaneseHolidayCache.set(year, holidays);
  return holidays;
}

function easterSunday(year: number): ZonedDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return { year, month, day: ((h + l - 7 * m + 114) % 31) + 1 };
}

function usMarketHolidays(year: number) {
  const cached = usHolidayCache.get(year);
  if (cached) return cached;
  const holidays = new Map<string, string>();
  const add = (date: ZonedDate, name: string) => holidays.set(dateKey(date.year, date.month, date.day), name);
  const observed = (month: number, day: number, name: string, saturdayObserved = true) => {
    const actual = { year, month, day };
    const dayOfWeek = weekday(actual);
    if (dayOfWeek === 6 && saturdayObserved) add(addUtcDays(actual, -1), name);
    else if (dayOfWeek === 0) add(addUtcDays(actual, 1), name);
    else add(actual, name);
  };
  observed(1, 1, '元旦', false);
  add({ year, month: 1, day: nthWeekday(year, 1, 1, 3) }, '馬丁路德金恩紀念日');
  add({ year, month: 2, day: nthWeekday(year, 2, 1, 3) }, '華盛頓誕辰');
  add(addUtcDays(easterSunday(year), -2), '耶穌受難日');
  add({ year, month: 5, day: lastWeekday(year, 5, 1) }, '陣亡將士紀念日');
  observed(6, 19, '六月節');
  observed(7, 4, '美國獨立日');
  add({ year, month: 9, day: nthWeekday(year, 9, 1, 1) }, '勞動節');
  add({ year, month: 11, day: nthWeekday(year, 11, 4, 4) }, '感恩節');
  observed(12, 25, '聖誕節');
  usHolidayCache.set(year, holidays);
  return holidays;
}

function marketCalendarStatus(timestamp: number): MarketCalendarStatus {
  const japanDate = zonedDate(timestamp, 'Asia/Tokyo');
  const usDate = zonedDate(timestamp, 'America/New_York');
  const japanHoliday = japaneseHolidays(japanDate.year).get(dateKey(japanDate.year, japanDate.month, japanDate.day)) ?? null;
  const japanWeekend = weekday(japanDate) === 0 || weekday(japanDate) === 6;
  const japanExchangeHoliday = japanDate.month === 1 && [2, 3].includes(japanDate.day) ? '年始休業' : japanDate.month === 12 && japanDate.day === 31 ? '年末休業' : null;
  const usHoliday = usMarketHolidays(usDate.year).get(dateKey(usDate.year, usDate.month, usDate.day)) ?? null;
  const usWeekend = weekday(usDate) === 0 || weekday(usDate) === 6;
  return {
    japaneseDate: japaneseCalendarFormatter.format(new Date(timestamp)),
    japanHoliday,
    japanClosedReason: japanWeekend ? '週末' : japanExchangeHoliday ?? japanHoliday,
    usClosedReason: usWeekend ? '週末' : usHoliday,
  };
}
const isJapaneseTicker = (ticker: string | null | undefined) => Boolean(ticker?.toUpperCase().endsWith('.T'));
const isCashTrade = (trade: Pick<Trade, 'type' | 'event'>) => trade.type === 'CASH' || trade.event === 'CASH' || trade.event === 'DIVIDEND';
const isYenTicker = (ticker: string | null | undefined) => ticker?.toUpperCase() === 'JPY' || isJapaneseTicker(ticker);
const nativeMoney = (ticker: string | null | undefined, value: number) => isYenTicker(ticker) ? yenMoney.format(value) : money.format(value);
const quoteSessionLabel = (session: QuoteSession) => session === 'pre' ? '盤前' : session === 'post' ? '盤後' : session === 'regular' ? '正常交易時段' : '最近收盤';
const normalizeTickerForMarket = (ticker: string | null | undefined, market: 'US' | 'JP') => {
  const normalized = String(ticker ?? '').trim().toUpperCase();
  return market === 'JP' && /^\d{4}$/.test(normalized) ? `${normalized}.T` : normalized;
};
const normalizedUsdAmount = (trade: Trade, value: number, usdJpyRate: number) => (trade.market === 'JP' || isYenTicker(trade.ticker)) && usdJpyRate > 0 ? value / usdJpyRate : value;

function investedCapitalUsd(trade: Trade, usdJpyRate: number) {
  if (isCashTrade(trade)) return normalizedUsdAmount(trade, Math.abs(trade.quantity), usdJpyRate);
  const stock = trade.type === 'SDI' || trade.event === 'STOCK';
  const multiplier = stock ? 1 : 100;
  const entryCost = Math.abs(trade.entryPrice * trade.quantity * multiplier) + Math.max(0, trade.fees);
  const shortOption = !stock && trade.type.toLowerCase() === 'sell';
  const nativeCapital = shortOption && trade.collateral > 0 ? trade.collateral : entryCost;
  return normalizedUsdAmount(trade, nativeCapital, usdJpyRate);
}

function selectZeroNumberInput(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement) || (target.type !== 'number' && target.inputMode !== 'decimal') || target.readOnly || target.disabled) return;
  if (target.value !== '' && Number(target.value) === 0) target.select();
}

function blankTrade(): Trade {
  return {
    id: 0, type: 'Sell', openDate: today(), expiryDate: null, closeDate: null,
    ticker: '', event: 'PUT', strike: '', quantity: 1, entryPrice: 0,
    currentPrice: 0, fees: 0, collateral: 0, notes: '', status: 'open', quoteMode: 'manual', market: 'US',
  };
}

function metrics(trade: Trade, usdJpyRate = 1) {
  if (isCashTrade(trade)) {
    const marketValue = normalizedUsdAmount(trade, Math.max(0, Math.abs(trade.quantity)), usdJpyRate);
    return { pnl: 0, days: 0, roc: 0, marketValue };
  }
  const current = trade.currentPrice;
  if (current === null) return { pnl: 0, days: 0, roc: 0, marketValue: 0 };
  const stock = trade.type === 'SDI' || trade.event === 'STOCK';
  const multiplier = stock ? 1 : 100;
  const direction = trade.type.toLowerCase() === 'sell' ? -1 : 1;
  const nativePnl = (current - trade.entryPrice) * trade.quantity * multiplier * direction - trade.fees;
  const pnl = normalizedUsdAmount(trade, nativePnl, usdJpyRate);
  const end = new Date(`${trade.closeDate ?? today()}T00:00:00Z`).getTime();
  const start = new Date(`${trade.openDate}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const collateralUsd = normalizedUsdAmount(trade, trade.collateral, usdJpyRate);
  const roc = collateralUsd > 0 ? pnl / collateralUsd : 0;
  const nativeMarketValue = stock ? current * trade.quantity : Math.max(trade.collateral, current * trade.quantity * 100);
  const marketValue = normalizedUsdAmount(trade, nativeMarketValue, usdJpyRate);
  return { pnl, days, roc, marketValue };
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function buildReturnSeries(trades: Trade[], mode: RangeMode, usdJpyRate = 1) {
  const now = new Date(`${today()}T00:00:00Z`);
  const buckets: Array<{ key: string; label: string; pnl: number; capital: number }> = [];
  if (mode === 'day') {
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setUTCDate(now.getUTCDate() - offset);
      buckets.push({ key: date.toISOString().slice(0, 10), label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, pnl: 0, capital: 0 });
    }
  } else if (mode === 'week') {
    const current = startOfWeek(now);
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(current);
      date.setUTCDate(current.getUTCDate() - offset * 7);
      buckets.push({ key: date.toISOString().slice(0, 10), label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, pnl: 0, capital: 0 });
    }
  } else if (mode === 'month') {
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      buckets.push({ key: date.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('zh-TW', { month: 'short' }).format(date), pnl: 0, capital: 0 });
    }
  } else {
    for (let offset = 4; offset >= 0; offset -= 1) {
      const year = now.getUTCFullYear() - offset;
      buckets.push({ key: String(year), label: String(year), pnl: 0, capital: 0 });
    }
  }

  for (const trade of trades) {
    if (isCashTrade(trade)) continue;
    const activityDate = new Date(`${trade.closeDate ?? today()}T00:00:00Z`);
    const key = mode === 'day'
      ? activityDate.toISOString().slice(0, 10)
      : mode === 'week' ? startOfWeek(activityDate).toISOString().slice(0, 10)
        : mode === 'month' ? activityDate.toISOString().slice(0, 7) : String(activityDate.getUTCFullYear());
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) {
      bucket.pnl += metrics(trade, usdJpyRate).pnl;
      bucket.capital += trade.collateral ? normalizedUsdAmount(trade, trade.collateral, usdJpyRate) : metrics(trade, usdJpyRate).marketValue;
    }
  }
  return buckets.map((bucket) => ({ ...bucket, value: bucket.capital > 0 ? bucket.pnl / bucket.capital : 0 }));
}

const CompanyLogo = memo(function CompanyLogo({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  if (ticker === 'USD' || ticker === 'JPY') return <span className={`company-logo cash-logo ${compact ? 'compact' : ''}`} data-ticker={ticker} aria-hidden="true"><span>{ticker === 'JPY' ? '¥' : '$'}</span></span>;
  return <span className={`company-logo ${compact ? 'compact' : ''}`} data-ticker={ticker} aria-hidden="true">
    <span>{ticker.slice(0, compact ? 1 : 2)}</span>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      key={ticker}
      src={`/api/logo?ticker=${encodeURIComponent(ticker)}&v=6`}
      alt=""
      width={compact ? 46 : 58}
      height={compact ? 46 : 58}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={(event) => { event.currentTarget.hidden = false; }}
      onError={(event) => { event.currentTarget.hidden = true; }}
    />
  </span>;
});

const donutPoint = (radius: number, fraction: number) => {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
};

const donutSegmentPath = (start: number, share: number) => {
  const outerRadius = 49.35;
  const innerRadius = 28.15;
  const safeShare = Math.min(.999999, Math.max(.000001, share));
  const end = start + safeShare;
  const outerStart = donutPoint(outerRadius, start);
  const outerEnd = donutPoint(outerRadius, end);
  const innerEnd = donutPoint(innerRadius, end);
  const innerStart = donutPoint(innerRadius, start);
  const largeArc = safeShare > .5 ? 1 : 0;
  const point = ({ x, y }: { x: number; y: number }) => `${x.toFixed(4)} ${y.toFixed(4)}`;
  return `M ${point(outerStart)} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${point(outerEnd)} L ${point(innerEnd)} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${point(innerStart)} Z`;
};

const AllocationDonut = memo(function AllocationDonut({ items, total, loading, activeLabel, onHover, onPin, onSelect }: {
  items: AllocationItem[];
  total: number;
  loading: boolean;
  activeLabel: string | null;
  onHover: (label: string | null) => void;
  onPin: (label: string | null) => void;
  onSelect: (item: AllocationItem) => void;
}) {
  const segments = useMemo(() => items.map((item, index) => {
    const start = items.slice(0, index).reduce((sum, previous) => sum + previous.share, 0);
    const midpoint = start + item.share / 2;
    const angle = midpoint * Math.PI * 2 - Math.PI / 2;
    const labelRadius = item.share < .04 ? (index % 2 ? 34 : 43) : 39;
    return { ...item, index, start, path: donutSegmentPath(start, item.share), labelX: 50 + Math.cos(angle) * labelRadius, labelY: 50 + Math.sin(angle) * labelRadius };
  }), [items]);
  const active = segments.find((item) => item.label === activeLabel) ?? null;
  const activate = (item: typeof segments[number]) => { onPin(item.label); onSelect(item); };
  return <div className={`donut ${loading ? 'is-loading' : ''} ${items.length ? 'has-items' : ''}`}>
    <svg className="donut-svg" viewBox="0 0 100 100" role="group" aria-label="按標的計算的互動持倉圓環">
      <circle cx="50" cy="50" r="39" className="donut-track" />
      {segments.map((item) => <path key={`base-${item.label}`} d={item.path} className="donut-segment" fill={item.color} stroke={item.color} />)}
      {active && <><path d={active.path} className="donut-segment-outline" fill="none" stroke="white" /><path d={active.path} className="donut-segment-active" fill={active.color} stroke={active.color} /></>}
      {segments.map((item) => <path
        key={`hit-${item.label}`}
        d={item.path}
        className="donut-segment-hit"
        fill="transparent"
        stroke="transparent"
        role="button"
        tabIndex={0}
        aria-pressed={activeLabel === item.label}
        aria-label={`${item.label} ${companyNames[item.label] ?? ''}，${money.format(item.value)}，占 ${percent.format(item.share)}`}
        onMouseEnter={() => onHover(item.label)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(item.label)}
        onBlur={() => onHover(null)}
        onClick={() => activate(item)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(item); }
          if (event.key === 'Escape') { event.preventDefault(); onPin(null); onHover(null); }
        }}
      />)}
      {segments.map((item) => <text key={`label-${item.label}`} x={item.labelX} y={item.labelY} className={`donut-svg-label ${item.share < .04 ? 'is-small' : ''}`}>{percent.format(item.share)}</text>)}
    </svg>
    <span className={`donut-center ${active ? 'has-active-segment' : ''}`}>
      <strong>{loading ? '讀取中…' : active ? active.label : money.format(total)}</strong>
      {active && <span>{active.label === '其他' ? `${active.members.length} 個其他標的` : companyNames[active.label] ?? '持倉標的'}</span>}
      <small>{active ? `${money.format(active.value)} · ${percent.format(active.share)}` : '目前曝險'}</small>
    </span>
  </div>;
});

const PriceSparkline = memo(function PriceSparkline({ ticker, values, changePercent }: { ticker: string; values: number[]; changePercent: number | null }) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return <span className="sparkline-placeholder">等待走勢</span>;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const spread = Math.max(max - min, Math.max(Math.abs(max), 1) * .002);
  const points = finite.map((value, index) => `${(index / (finite.length - 1)) * 100},${39 - ((value - min) / spread) * 34}`).join(' ');
  const positive = (changePercent ?? finite.at(-1)! - finite[0]) >= 0;
  return <svg className={`price-sparkline ${positive ? 'positive' : 'negative'}`} viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={`${ticker} 當日價格波動`}>
    <line x1="0" x2="100" y1="39" y2="39" className="sparkline-baseline" />
    <polygon points={`0,39 ${points} 100,39`} className="sparkline-fill" />
    <polyline points={points} className="sparkline-line" />
  </svg>;
});

const MacroMarketCard = memo(function MacroMarketCard({ market, startLabel, endLabel, rangeLabel }: { market: BenchmarkMarket; startLabel: string; endLabel: string; rangeLabel: string }) {
  const plotted = market.values.flatMap((value, index) => typeof value === 'number' && Number.isFinite(value) ? [{ value, index }] : []);
  const finite = plotted.map((point) => point.value);
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const spread = Math.max(max - min, Math.max(Math.abs(max), 1) * .0025);
  const low = min - spread * .12;
  const high = max + spread * .12;
  const points = plotted.map((point) => {
    const x = market.values.length <= 1 ? 50 : point.index / (market.values.length - 1) * 100;
    const y = 50 - ((point.value - low) / (high - low)) * 45;
    return `${x},${y}`;
  }).join(' ');
  const direction = (market.changePercent ?? 0) > 0 ? 'positive' : (market.changePercent ?? 0) < 0 ? 'negative' : 'neutral';
  const formatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: market.decimals, maximumFractionDigits: market.decimals });
  const latest = market.latest === null ? '—' : `${market.id === 'USDJPY' ? '¥' : ''}${formatter.format(market.latest)}`;
  const changeArrow = market.change === null ? '' : market.change > 0 ? '▲' : market.change < 0 ? '▼' : '•';
  const changeValue = market.change === null ? null : formatter.format(Math.abs(market.change));
  const changePercent = market.changePercent === null ? '—' : precisePercent.format(Math.abs(market.changePercent));
  const gradientId = `macro-fill-${market.id}`;
  return <article className={`macro-market-card ${direction}`}>
    <header><div><span>{market.id === 'USDJPY' ? 'FX' : market.id === 'GOLD' || market.id === 'OIL' ? 'CMD' : 'UST'}</span><div><h4>{market.label}</h4><small>{market.unit}</small></div></div><b>{market.symbol}</b></header>
    <div className="macro-market-quote"><strong>{latest}</strong><span>{changeValue === null ? '等待更新' : <><b aria-hidden="true">{changeArrow}</b><em>{changeValue}</em><em>{changePercent}</em></>}</span></div>
    <div className="macro-history-chart">
      {points ? <svg viewBox="0 0 100 54" preserveAspectRatio="none" role="img" aria-label={`${market.label}${rangeLabel}${market.id === 'USDJPY' ? '匯率' : market.id === 'US10Y' || market.id === 'US30Y' ? '殖利率' : '價格'}走勢`}><defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".2"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs><line x1="0" x2="100" y1="50" y2="50"/><polygon points={`0,50 ${points} 100,50`} fill={`url(#${gradientId})`}/><polyline points={points}/></svg> : <span>暫時沒有歷史資料</span>}
    </div>
    <footer><span>{startLabel}</span><b>{rangeLabel}走勢</b><span>{endLabel}</span></footer>
  </article>;
});

const LiveMarketClocks = memo(function LiveMarketClocks({ lastQuoteAt }: { lastQuoteAt: string | null }) {
  const [clockNow, setClockNow] = useState<number | null>(null);
  const [activeZone, setActiveZone] = useState<'eastern' | 'japan'>('eastern');
  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const easternTimeLabel = clockNow === null ? '--:--:--' : easternClockFormatter.format(new Date(clockNow));
  const japanTimeLabel = clockNow === null ? '--:--:--' : japanClockFormatter.format(new Date(clockNow));
  const easternZoneLabel = clockNow === null ? 'ET' : easternZoneName(clockNow);
  const lastQuoteLabel = lastQuoteAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(lastQuoteAt)) : '等待首次更新';
  const clocks = [
    { id: 'eastern' as const, label: '美東', time: easternTimeLabel, zone: easternZoneLabel },
    { id: 'japan' as const, label: '日本', time: japanTimeLabel, zone: 'JST' },
  ];
  return <div className="as-of">
    <div className="clock-stack-heading"><span>即時市場時間</span><div className="clock-zone-switch" role="group" aria-label="切換即時時區">{clocks.map((clock) => <button type="button" key={clock.id} className={activeZone === clock.id ? 'active' : ''} aria-pressed={activeZone === clock.id} onClick={() => setActiveZone(clock.id)}>{clock.label}</button>)}</div></div>
    <div className="stacked-clock-deck" aria-live="polite">{clocks.map((clock) => <div key={clock.id} className={`stacked-clock-card ${activeZone === clock.id ? 'is-active' : 'is-behind'}`} aria-hidden={activeZone !== clock.id}><span>{clock.label}</span><strong>{clock.time}</strong><b>[{clock.zone}]</b></div>)}</div>
    <p>報價每 60 秒更新 · 上次 {lastQuoteLabel}</p>
  </div>;
});

const HeaderMarketCalendar = memo(function HeaderMarketCalendar() {
  const [timestamp, setTimestamp] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setTimestamp(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const status = timestamp === null ? null : marketCalendarStatus(timestamp);
  return <div className="brand-calendar" aria-live="polite">
    <strong>{status?.japaneseDate ?? '日本日期讀取中'}</strong>
    {status && (status.japanHoliday || status.japanClosedReason || status.usClosedReason) && <span className="market-calendar-tags">
      {status.japanHoliday && <em className="holiday-tag">日本祝日 · {status.japanHoliday}</em>}
      {status.japanClosedReason && <em>日股休市 · {status.japanClosedReason}</em>}
      {status.usClosedReason && <em>美股休市 · {status.usClosedReason}</em>}
    </span>}
  </div>;
});

function chartBounds(values: Array<number | null>, includeZero = false, paddingRatio = .1) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!valid.length) return { min: 0, max: 1 };
  let min = Math.min(...valid, ...(includeZero ? [0] : []));
  let max = Math.max(...valid, ...(includeZero ? [0] : []));
  if (min === max) {
    const singleValuePadding = Math.abs(max) * .01 || 1;
    return { min: min - singleValuePadding, max: max + singleValuePadding };
  }
  const padding = (max - min || Math.abs(max) * .04 || 1) * paddingRatio;
  min -= padding;
  max += padding;
  return { min, max };
}

function technicalY(value: number, min: number, max: number) {
  return 7 + ((max - value) / (max - min || 1)) * 86;
}

function technicalPoints(values: Array<number | null>, min: number, max: number) {
  return values.flatMap((value, index) => typeof value === 'number' && Number.isFinite(value)
    ? [`${values.length === 1 ? 50 : index / (values.length - 1) * 100},${technicalY(value, min, max)}`]
    : []).join(' ');
}

function technicalBandPolygon(upper: Array<number | null>, lower: Array<number | null>, min: number, max: number) {
  const valid = upper.flatMap((value, index) => typeof value === 'number' && Number.isFinite(value) && typeof lower[index] === 'number' && Number.isFinite(lower[index])
    ? [{ index, upper: value, lower: lower[index] as number }]
    : []);
  if (valid.length < 2) return '';
  const x = (index: number) => upper.length === 1 ? 50 : index / (upper.length - 1) * 100;
  return [
    ...valid.map((point) => `${x(point.index)},${technicalY(point.upper, min, max)}`),
    ...valid.toReversed().map((point) => `${x(point.index)},${technicalY(point.lower, min, max)}`),
  ].join(' ');
}

function aggregateCandles(points: TechnicalPoint[], maximum = 180) {
  if (points.length <= maximum) return points;
  const bucketSize = Math.ceil(points.length / maximum);
  const result: TechnicalPoint[] = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    const first = bucket[0];
    const last = bucket.at(-1)!;
    result.push({
      ...last,
      open: first.open,
      high: Math.max(...bucket.map((point) => point.high)),
      low: Math.min(...bucket.map((point) => point.low)),
      close: last.close,
    });
  }
  return result;
}

function signedPrice(ticker: string, value: number) {
  if (Math.abs(value) < .0000001) return nativeMoney(ticker, 0);
  return `${value > 0 ? '+' : '−'}${nativeMoney(ticker, Math.abs(value))}`;
}

function lastIndicator(values: Array<number | null>) {
  return values.findLast((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

const StockTechnicalPanel = memo(function StockTechnicalPanel({ symbol, range, customFrom, customTo, data, loading, error, stockTrades, lotSavingId, valuationOpen, onRangeChange, onCustomRangeApply, onClose, onOpenDcf, onAddLot, onSaveLot, onEditLot, onDeleteLot }: {
  symbol: string;
  range: TechnicalRange;
  customFrom: string;
  customTo: string;
  data: TechnicalData | null;
  loading: boolean;
  error: string;
  stockTrades: Trade[];
  lotSavingId: number | null;
  valuationOpen: boolean;
  onRangeChange: (range: TechnicalRange) => void;
  onCustomRangeApply: (from: string, to: string) => void;
  onClose: () => void;
  onOpenDcf: () => void;
  onAddLot: () => void;
  onSaveLot: (trade: Trade, openDate: string, entryPrice: number) => void;
  onEditLot: (trade: Trade) => void;
  onDeleteLot: (trade: Trade) => void;
}) {
  const [priceHoverIndex, setPriceHoverIndex] = useState<number | null>(null);
  const [priceChartMode, setPriceChartMode] = useState<PriceChartMode>('line');
  const [customRangeOpen, setCustomRangeOpen] = useState(range === 'custom');
  const [draftFrom, setDraftFrom] = useState(customFrom);
  const [draftTo, setDraftTo] = useState(customTo);
  const [overlays, setOverlays] = useState({ boll: false, ma20: true, ma50: false, ma200: false });
  const activeData = data?.symbol === symbol && data.range === range ? data : null;
  const points = activeData?.points ?? emptyTechnicalPoints;
  const chartSeries = useMemo(() => {
    const closes = points.map((point) => point.close);
    const highs = points.map((point) => point.high);
    const lows = points.map((point) => point.low);
    const ma20 = points.map((point) => point.ma20);
    const ma50 = points.map((point) => point.ma50);
    const ma200 = points.map((point) => point.ma200);
    const bollUpper = points.map((point) => point.bollUpper);
    const bollLower = points.map((point) => point.bollLower);
    const rsi = points.map((point) => point.rsi);
    const macd = points.map((point) => point.macd);
    const signal = points.map((point) => point.signal);
    const histogram = points.map((point) => point.histogram);
    const priceScaleValues: Array<number | null> = [
      ...(priceChartMode === 'candles' ? [...highs, ...lows] : closes),
      ...(overlays.ma20 ? ma20 : []),
      ...(overlays.ma50 ? ma50 : []),
      ...(overlays.ma200 ? ma200 : []),
      ...(overlays.boll ? [...bollUpper, ...bollLower] : []),
    ];
    return {
      closes, highs, lows, ma20, ma50, ma200, bollUpper, bollLower, rsi, macd, signal, histogram,
      priceBounds: chartBounds(priceScaleValues, false, 0),
      macdBounds: chartBounds([...macd, ...signal, ...histogram], true),
      dateIndexes: points.length ? [...new Set([0, Math.round((points.length - 1) * .25), Math.round((points.length - 1) * .5), Math.round((points.length - 1) * .75), points.length - 1])] : [],
      periodHigh: highs.length ? Math.max(...highs) : 0,
      periodLow: lows.length ? Math.min(...lows) : 0,
      candles: aggregateCandles(points),
    };
  }, [points, priceChartMode, overlays]);
  const { closes, ma20, ma50, ma200, bollUpper, bollLower, rsi, macd, signal, histogram, priceBounds, macdBounds, dateIndexes, periodHigh, periodLow, candles } = chartSeries;
  const latestRsi = lastIndicator(rsi);
  const latestMacd = lastIndicator(macd);
  const latestSignal = lastIndicator(signal);
  const openLots = stockTrades.filter((trade) => trade.status === 'open');
  const summaryLots = openLots.length ? openLots : stockTrades;
  const totalQuantity = summaryLots.reduce((sum, trade) => sum + Math.abs(trade.quantity), 0);
  const averageEntry = totalQuantity ? summaryLots.reduce((sum, trade) => sum + trade.entryPrice * Math.abs(trade.quantity), 0) / totalQuantity : 0;
  const firstPurchaseDate = summaryLots.reduce((first, trade) => !first || trade.openDate < first ? trade.openDate : first, '');
  const currencySymbol = isJapaneseTicker(symbol) ? '¥' : '$';
  const priceMoney = (value: number) => nativeMoney(symbol, value);
  const activePriceIndex = priceHoverIndex !== null && points[priceHoverIndex] ? priceHoverIndex : null;
  const activePricePoint = activePriceIndex === null ? null : points[activePriceIndex];
  const activePriceX = activePriceIndex === null ? 0 : points.length === 1 ? 50 : activePriceIndex / (points.length - 1) * 100;
  const activePriceY = activePricePoint ? technicalY(activePricePoint.close, priceBounds.min, priceBounds.max) : 0;
  const selectPriceAtClientX = (clientX: number, left: number, width: number) => {
    if (!points.length || width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - left) / width));
    const nextIndex = Math.round(ratio * (points.length - 1));
    setPriceHoverIndex((current) => current === nextIndex ? current : nextIndex);
  };
  const toggleOverlay = (key: keyof typeof overlays) => setOverlays((current) => ({ ...current, [key]: !current[key] }));
  const pointDateLabel = (point: TechnicalPoint, short = false) => new Intl.DateTimeFormat('zh-TW', activeData?.interval === '1d'
    ? { month: 'numeric', day: 'numeric' }
    : short
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(point.timestamp * 1000));

  return <section className="panel stock-analysis-panel" id="stock-analysis" aria-live="polite">
    <header className="technical-header">
      <div className="technical-title"><CompanyLogo ticker={symbol} /><div><p className="eyebrow">Technical view</p><div className="technical-title-heading"><h2>{symbol} 股票走勢</h2><button type="button" className="technical-back-inline" onClick={onClose}>← 返回持倉總覽</button></div><span>{activeData?.intervalLabel ?? '價格'} · RSI 14 · MACD 12/26/9</span></div></div>
      {activeData && <div className="technical-quote"><span>最新價格</span><strong>{priceMoney(activeData.latestPrice)}</strong><b className={activeData.change >= 0 ? 'positive' : 'negative'}>{signedPrice(symbol, activeData.change)} · {signedPrecisePercent(activeData.changePercent)}</b><small>前收 {priceMoney(activeData.previousClose)}</small></div>}
      <div className="technical-actions"><div className="segmented technical-range-switch" aria-label="技術走勢期間">{([['1d', '1日'], ['1w', '1週'], ['1mo', '1月'], ['3mo', '3月'], ['6mo', '6月'], ['1y', '1年']] as const).map(([value, label]) => <button key={value} className={range === value ? 'selected' : ''} aria-pressed={range === value} onClick={() => { setPriceHoverIndex(null); setCustomRangeOpen(false); onRangeChange(value); }}>{label}</button>)}<button className={range === 'custom' ? 'selected' : ''} aria-pressed={range === 'custom'} onClick={() => setCustomRangeOpen((current) => !current)}>自訂</button></div><button type="button" className={`technical-close ${valuationOpen ? 'is-active' : ''}`} aria-pressed={valuationOpen} onClick={onOpenDcf}>{valuationOpen ? '關閉 DCF 估值' : '開啟 DCF 估值'}</button></div>
    </header>
    {customRangeOpen && <form className="technical-custom-range" onSubmit={(event) => { event.preventDefault(); if (draftFrom && draftTo && draftFrom < draftTo) { setPriceHoverIndex(null); onCustomRangeApply(draftFrom, draftTo); } }}><span>自由調整期間</span><label>開始<input type="date" required max={draftTo || today()} value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label><i>—</i><label>結束<input type="date" required min={draftFrom} max={today()} value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label><button type="submit" disabled={!draftFrom || !draftTo || draftFrom >= draftTo}>套用</button></form>}
    {loading && !activeData && <div className="technical-state"><span className="technical-spinner" />正在讀取 {symbol} 日線資料…</div>}
    {!loading && error && <div className="technical-state error">{error}</div>}
    {activeData && <div className={`technical-grid ${loading ? 'is-refreshing' : ''}`}>
      <article className="technical-card price-card">
        <div className="technical-card-heading"><div><span>Price trend</span><h3>價格走勢</h3></div><div className="technical-period-stats"><p><strong>{priceMoney(periodHigh)}</strong>期間高點</p><p><strong>{priceMoney(periodLow)}</strong>期間低點</p></div></div>
        <div className="technical-chart-controls"><div className="segmented technical-chart-mode" role="group" aria-label="價格圖表類型"><button type="button" className={priceChartMode === 'line' ? 'selected' : ''} aria-pressed={priceChartMode === 'line'} onClick={() => { setPriceChartMode('line'); setPriceHoverIndex(null); }}>折線</button><button type="button" className={priceChartMode === 'candles' ? 'selected' : ''} aria-pressed={priceChartMode === 'candles'} onClick={() => { setPriceChartMode('candles'); setPriceHoverIndex(null); }}>蠟燭</button></div><div className="technical-overlay-switches" role="group" aria-label="技術線疊圖">{([['boll', 'Boll', 'boll'], ['ma20', 'MA20', 'ma20'], ['ma50', 'MA50', 'ma50'], ['ma200', 'MA200', 'ma200']] as const).map(([key, label, tone]) => <button type="button" key={key} className={`${overlays[key] ? 'is-active' : ''} ${tone}`} aria-pressed={overlays[key]} onClick={() => toggleOverlay(key)}><i />{label}</button>)}</div></div>
        <div className="technical-chart large"><span className="technical-axis top">{priceMoney(priceBounds.max)}</span><span className="technical-axis bottom">{priceMoney(priceBounds.min)}</span><svg
          className="technical-price-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          tabIndex={0}
          aria-label={`${symbol} ${activeData.intervalLabel}價格走勢；滑鼠移動、觸控或方向鍵可查看日期與價格`}
          onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); selectPriceAtClientX(event.clientX, rect.left, rect.width); }}
          onPointerDown={(event) => { const rect = event.currentTarget.getBoundingClientRect(); selectPriceAtClientX(event.clientX, rect.left, rect.width); }}
          onPointerLeave={(event) => { if (event.pointerType === 'mouse') setPriceHoverIndex(null); }}
          onFocus={() => setPriceHoverIndex(points.length ? points.length - 1 : null)}
          onBlur={() => setPriceHoverIndex(null)}
          onKeyDown={(event) => {
            if (!points.length) return;
            const current = activePriceIndex ?? points.length - 1;
            if (event.key === 'ArrowLeft') { event.preventDefault(); setPriceHoverIndex(Math.max(0, current - 1)); }
            if (event.key === 'ArrowRight') { event.preventDefault(); setPriceHoverIndex(Math.min(points.length - 1, current + 1)); }
            if (event.key === 'Home') { event.preventDefault(); setPriceHoverIndex(0); }
            if (event.key === 'End') { event.preventDefault(); setPriceHoverIndex(points.length - 1); }
          }}
        ><defs><linearGradient id={`price-fill-${symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f73ed" stopOpacity=".25"/><stop offset="100%" stopColor="#2f73ed" stopOpacity="0"/></linearGradient></defs><line x1="0" x2="100" y1="93" y2="93" className="technical-grid-line"/>{overlays.boll && <><polygon points={technicalBandPolygon(bollUpper, bollLower, priceBounds.min, priceBounds.max)} className="technical-boll-band"/><polyline points={technicalPoints(bollUpper, priceBounds.min, priceBounds.max)} className="technical-boll-line"/><polyline points={technicalPoints(bollLower, priceBounds.min, priceBounds.max)} className="technical-boll-line"/></>}{priceChartMode === 'line' ? <><polygon points={`0,93 ${technicalPoints(closes, priceBounds.min, priceBounds.max)} 100,93`} fill={`url(#price-fill-${symbol})`}/><polyline points={technicalPoints(closes, priceBounds.min, priceBounds.max)} className="technical-price-line"/></> : <g className="technical-candles">{candles.map((point, index) => {
          const x = candles.length === 1 ? 50 : index / (candles.length - 1) * 100;
          const width = Math.max(.28, Math.min(1.35, 62 / candles.length));
          const openY = technicalY(point.open, priceBounds.min, priceBounds.max);
          const closeY = technicalY(point.close, priceBounds.min, priceBounds.max);
          const highY = technicalY(point.high, priceBounds.min, priceBounds.max);
          const lowY = technicalY(point.low, priceBounds.min, priceBounds.max);
          const rising = point.close >= point.open;
          return <g key={`${point.timestamp}-${index}`} className={rising ? 'technical-candle rising' : 'technical-candle falling'}><line x1={x} x2={x} y1={highY} y2={lowY}/>{Math.abs(openY - closeY) < .35 ? <line className="technical-candle-doji" x1={x - width / 2} x2={x + width / 2} y1={closeY} y2={closeY}/> : <rect x={x - width / 2} y={Math.min(openY, closeY)} width={width} height={Math.max(.35, Math.abs(openY - closeY))}/>}</g>;
        })}</g>}{overlays.ma20 && <polyline points={technicalPoints(ma20, priceBounds.min, priceBounds.max)} className="technical-ma-line ma20"/>}{overlays.ma50 && <polyline points={technicalPoints(ma50, priceBounds.min, priceBounds.max)} className="technical-ma-line ma50"/>}{overlays.ma200 && <polyline points={technicalPoints(ma200, priceBounds.min, priceBounds.max)} className="technical-ma-line ma200"/>}{activePricePoint && <line x1={activePriceX} x2={activePriceX} y1="7" y2="93" className="technical-price-guide"/>}</svg>{activePricePoint && <>{priceChartMode === 'line' && <span className="technical-price-dot" style={{ left: `${activePriceX}%`, top: `${activePriceY}%` }} aria-hidden="true"/>}<div className={`technical-price-tooltip ${priceChartMode === 'candles' ? 'is-ohlc' : ''} ${activePriceX > 78 ? 'align-right' : activePriceX < 22 ? 'align-left' : ''}`} style={{ left: `${activePriceX}%`, top: `${Math.max(24, Math.min(84, activePriceY))}%` }} role="status"><span>{pointDateLabel(activePricePoint)}</span>{priceChartMode === 'candles' ? <div className="technical-tooltip-ohlc"><span>開 <b>{priceMoney(activePricePoint.open)}</b></span><span>高 <b>{priceMoney(activePricePoint.high)}</b></span><span>低 <b>{priceMoney(activePricePoint.low)}</b></span><span>收 <b>{priceMoney(activePricePoint.close)}</b></span></div> : <strong>{priceMoney(activePricePoint.close)}</strong>}<div className="technical-tooltip-overlays">{overlays.boll && activePricePoint.bollUpper !== null && <span>Boll {priceMoney(activePricePoint.bollUpper)} / {priceMoney(activePricePoint.bollLower ?? 0)}</span>}{overlays.ma20 && activePricePoint.ma20 !== null && <span>MA20 {priceMoney(activePricePoint.ma20)}</span>}{overlays.ma50 && activePricePoint.ma50 !== null && <span>MA50 {priceMoney(activePricePoint.ma50)}</span>}{overlays.ma200 && activePricePoint.ma200 !== null && <span>MA200 {priceMoney(activePricePoint.ma200)}</span>}</div></div></>}</div>
        <div className="technical-dates">{dateIndexes.map((index) => <span key={`${points[index].timestamp}-${index}`}>{pointDateLabel(points[index], true)}</span>)}</div>
      </article>
      <article className="technical-card indicator-card">
        <div className="technical-card-heading"><div><span>Momentum</span><h3>RSI（14）</h3></div><p className={latestRsi !== null && latestRsi >= 70 ? 'negative' : latestRsi !== null && latestRsi <= 30 ? 'positive' : ''}><strong>{latestRsi?.toFixed(1) ?? '—'}</strong>{latestRsi !== null && latestRsi >= 70 ? '偏熱' : latestRsi !== null && latestRsi <= 30 ? '偏弱' : '中性區間'}</p></div>
        <div className="technical-chart"><span className="rsi-label overbought">70</span><span className="rsi-label oversold">30</span><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${symbol} RSI 14`}><rect x="0" y="7" width="100" height="25.8" className="rsi-hot-zone"/><rect x="0" y="67.2" width="100" height="25.8" className="rsi-cool-zone"/><line x1="0" x2="100" y1={technicalY(70, 0, 100)} y2={technicalY(70, 0, 100)} className="technical-threshold"/><line x1="0" x2="100" y1={technicalY(30, 0, 100)} y2={technicalY(30, 0, 100)} className="technical-threshold"/><polyline points={technicalPoints(rsi, 0, 100)} className="technical-rsi-line"/></svg></div>
      </article>
      <article className="technical-card indicator-card">
        <div className="technical-card-heading"><div><span>Trend signal</span><h3>MACD（12/26/9）</h3></div><p><strong>{latestMacd?.toFixed(2) ?? '—'}</strong>Signal {latestSignal?.toFixed(2) ?? '—'}</p></div>
        <div className="technical-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${symbol} MACD`}><line x1="0" x2="100" y1={technicalY(0, macdBounds.min, macdBounds.max)} y2={technicalY(0, macdBounds.min, macdBounds.max)} className="technical-zero-line"/>{histogram.map((value, index) => {
          if (value === null) return null;
          const x = histogram.length === 1 ? 50 : index / (histogram.length - 1) * 100;
          const zero = technicalY(0, macdBounds.min, macdBounds.max);
          const y = technicalY(value, macdBounds.min, macdBounds.max);
          return <rect key={`${points[index].timestamp}-${index}`} x={x - Math.max(.2, 38 / histogram.length)} y={Math.min(y, zero)} width={Math.max(.4, 76 / histogram.length)} height={Math.max(.45, Math.abs(zero - y))} className={value >= 0 ? 'macd-bar positive-bar' : 'macd-bar negative-bar'} />;
        })}<polyline points={technicalPoints(macd, macdBounds.min, macdBounds.max)} className="technical-macd-line"/><polyline points={technicalPoints(signal, macdBounds.min, macdBounds.max)} className="technical-signal-line"/></svg></div>
        <div className="macd-legend"><span><i className="macd-key"/>MACD</span><span><i className="signal-key"/>Signal</span><span><i className="histogram-key"/>Histogram</span></div>
      </article>
    </div>}
    <Suspense fallback={<div className="technical-state"><span className="technical-spinner" />正在讀取 {symbol} 公司資料…</div>}><CompanyFundamentals key={symbol} symbol={symbol} valuationOpen={valuationOpen} onOpenDcf={onOpenDcf} onReturn={onClose} /></Suspense>
    <section className="stock-lots-section">
      <div className="stock-lots-heading"><div><p className="eyebrow">Cost basis</p><h3>買入均價與購買紀錄</h3><span>直接修改日期或均價；儲存後持倉、損益與圖表會立即重算。</span></div><button type="button" onClick={onAddLot}>＋新增 {symbol} 買入紀錄</button></div>
      <div className="stock-lot-summary"><div><span>股票加權均價</span><strong>{summaryLots.length ? priceMoney(averageEntry) : '—'}</strong></div><div><span>持股數量</span><strong>{totalQuantity || '—'}</strong></div><div><span>首次買入日期</span><strong>{firstPurchaseDate ? dateLabel(firstPurchaseDate) : '—'}</strong></div><div><span>購買紀錄</span><strong>{stockTrades.length} 筆</strong></div></div>
      <div className="stock-lot-list">
        {!stockTrades.length && <div className="stock-lot-empty">這個標的目前沒有股票買入紀錄；可使用右上角按鈕新增。</div>}
        {stockTrades.map((trade) => <form key={`${trade.id}-${trade.openDate}-${trade.entryPrice}`} className="stock-lot-row" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSaveLot(trade, String(form.get('openDate') ?? ''), Number(form.get('entryPrice')));
        }}>
          <div className="stock-lot-identity"><CompanyLogo ticker={symbol} compact /><div><strong>紀錄 #{trade.id}</strong><span className={`status ${trade.status}`}><i />{trade.status === 'open' ? '未平倉' : '已平倉'}</span></div></div>
          <label>買入日期<input required name="openDate" type="date" defaultValue={trade.openDate} /></label>
          <label>買入均價<span className="stock-lot-money"><i>{currencySymbol}</i><input required name="entryPrice" min="0" step="0.01" type="number" defaultValue={trade.entryPrice} /></span></label>
          <div className="stock-lot-readonly"><span>數量</span><strong>{trade.quantity}</strong></div>
          <div className="stock-lot-readonly"><span>目前價格</span><strong>{trade.currentPrice === null ? '未設定' : priceMoney(trade.currentPrice)}</strong></div>
          <div className="stock-lot-actions"><button type="submit" className="lot-save" disabled={lotSavingId === trade.id}>{lotSavingId === trade.id ? '儲存中…' : '儲存'}</button><button type="button" onClick={() => onEditLot(trade)}>完整編輯</button><button type="button" className="delete" onClick={() => onDeleteLot(trade)}>刪除</button></div>
        </form>)}
      </div>
    </section>
    <footer className="technical-note">價格、OHLC 與技術指標採同一組交易所時段資料計算；短期間使用分時 K，長期間使用日 K。僅供持倉追蹤，不構成投資建議。</footer>
  </section>;
}, (previous, next) => previous.symbol === next.symbol
  && previous.range === next.range
  && previous.customFrom === next.customFrom
  && previous.customTo === next.customTo
  && previous.data === next.data
  && previous.loading === next.loading
  && previous.error === next.error
  && previous.stockTrades === next.stockTrades
  && previous.lotSavingId === next.lotSavingId
  && previous.valuationOpen === next.valuationOpen);

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lotSavingId, setLotSavingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [returnHoverIndex, setReturnHoverIndex] = useState<number | null>(null);
  const [macroRangeMode, setMacroRangeMode] = useState<RangeMode>('month');
  const [macroMarketGroup, setMacroMarketGroup] = useState<MacroMarketGroup>('rates');
  const [macroDeckDirection, setMacroDeckDirection] = useState<'up' | 'down'>('up');
  const [allocationChartMode, setAllocationChartMode] = useState<AllocationChartMode>('donut');
  const [allocationGroupSelection, setAllocationGroupSelection] = useState<{ label: string; members: string[] } | null>(null);
  const [allocationHoveredLabel, setAllocationHoveredLabel] = useState<string | null>(null);
  const [allocationPinnedLabel, setAllocationPinnedLabel] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [positionView, setPositionView] = useState<PositionViewMode>('visual');
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<'overview' | 'positions' | 'returns' | 'valuation'>('overview');
  const [valuationOpen, setValuationOpen] = useState(false);
  const [valuationTicker, setValuationTicker] = useState('MSFT');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [brokerHubEnabled, setBrokerHubEnabled] = useState(false);
  const [brokerHubLoading, setBrokerHubLoading] = useState(true);
  const [brokerHubToggleSaving, setBrokerHubToggleSaving] = useState(false);
  const [brokerWorkspaceSeed, setBrokerWorkspaceSeed] = useState<BrokerWorkspace | null>(null);
  const [editor, setEditor] = useState<Trade | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Trade | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dividendAdjustmentCandidate, setDividendAdjustmentCandidate] = useState<Trade | null>(null);
  const [dividendNetInput, setDividendNetInput] = useState('');
  const [dividendAdjusting, setDividendAdjusting] = useState(false);
  const [priceEditId, setPriceEditId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [toast, setToast] = useState('');
  const [lastQuoteAt, setLastQuoteAt] = useState<string | null>(null);
  const [marketSnapshots, setMarketSnapshots] = useState<Record<string, LiveQuote>>({});
  const [failedQuoteTickers, setFailedQuoteTickers] = useState<Set<string>>(new Set());
  const [dividendSettings, setDividendSettings] = useState<DividendSettings>({ enabled: true, usTaxRate: 30, jpTaxRate: 15.315 });
  const [dividendCash, setDividendCash] = useState<DividendCash>({ USD: { gross: 0, tax: 0, adjustment: 0, net: 0, count: 0 }, JPY: { gross: 0, tax: 0, adjustment: 0, net: 0, count: 0 } });
  const [dividendEvents, setDividendEvents] = useState<DividendEvent[]>([]);
  const [dividendAdjustmentCount, setDividendAdjustmentCount] = useState(0);
  const [dividendLoading, setDividendLoading] = useState(true);
  const [dividendSaving, setDividendSaving] = useState(false);
  const [dividendError, setDividendError] = useState('');
  const [dividendUpdatedAt, setDividendUpdatedAt] = useState<string | null>(null);
  const [usdJpyRate, setUsdJpyRate] = useState(initialUsdJpyRate);
  const [usdJpyUpdatedAt, setUsdJpyUpdatedAt] = useState<string | null>(initialUsdJpyUpdatedAt);
  const [benchmarks, setBenchmarks] = useState<{ mode: RangeMode | null } & BenchmarkData>({ mode: null, SPY: [], BOXX: [] });
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [macroMarkets, setMacroMarkets] = useState<MacroMarketData>({ mode: null, markets: [], updatedAt: null });
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroError, setMacroError] = useState('');
  const [macroRefreshKey, setMacroRefreshKey] = useState(0);
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolSuggestion[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolFocused, setSymbolFocused] = useState(false);
  const [activeSymbolIndex, setActiveSymbolIndex] = useState(0);
  const [editorQuoteLoading, setEditorQuoteLoading] = useState(false);
  const [editorQuoteError, setEditorQuoteError] = useState('');
  const [editorQuote, setEditorQuote] = useState<LiveQuote | null>(null);
  const [editorQuoteRetry, setEditorQuoteRetry] = useState(0);
  const [panelRatio, setPanelRatio] = useState(initialPanelRatio);
  const [resizingPanels, setResizingPanels] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState('');
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('default');
  const [backgroundSaving, setBackgroundSaving] = useState(false);
  const [drilledTicker, setDrilledTicker] = useState<string | null>(null);
  const [technicalRange, setTechnicalRange] = useState<TechnicalRange>('6mo');
  const [technicalCustomFrom, setTechnicalCustomFrom] = useState(() => monthsBefore(today(), 6));
  const [technicalCustomTo, setTechnicalCustomTo] = useState(today);
  const [technicalData, setTechnicalData] = useState<TechnicalData | null>(null);
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const [technicalError, setTechnicalError] = useState('');
  const [allocationDate, setAllocationDate] = useState(today);
  const [allocationHistory, setAllocationHistory] = useState<AllocationHistory | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const contentGridRef = useRef<HTMLElement>(null);
  const panelRatioRef = useRef(panelRatio);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const backgroundOperationRef = useRef(false);
  const backgroundGenerationRef = useRef(0);
  const editorQuoteCacheRef = useRef(new Map<string, { quote: LiveQuote; fetchedAt: number }>());
  const benchmarkCacheRef = useRef(new Map<RangeMode, BenchmarkData>());
  const macroCacheRef = useRef(new Map<string, MacroCacheEntry>());
  const macroRefreshRequestedRef = useRef(false);
  const macroDeckSwipeStartRef = useRef<number | null>(null);
  const technicalCacheRef = useRef(new Map<string, TechnicalCacheEntry>());
  const allocationHistoryCacheRef = useRef(new Map<string, AllocationHistory>());
  const quoteRefreshInFlightRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast('');
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  const refreshDividendCash = useCallback(async (announce = false) => {
    setDividendLoading(true);
    try {
      const response = await fetch('/api/dividends', { cache: 'no-store' });
      const payload = await response.json() as { settings?: DividendSettings; cash?: DividendCash; events?: DividendEvent[]; adjustmentCount?: number; updatedAt?: string; failedTickers?: string[]; error?: string };
      if (!response.ok || !payload.settings || !payload.cash) throw new Error(payload.error ?? '股息現金目前無法更新');
      setDividendSettings(payload.settings);
      setDividendCash(payload.cash);
      setDividendEvents(Array.isArray(payload.events) ? payload.events : []);
      setDividendAdjustmentCount(Math.max(0, Number(payload.adjustmentCount) || 0));
      setDividendUpdatedAt(payload.updatedAt ?? new Date().toISOString());
      setDividendError(payload.failedTickers?.length ? `${payload.failedTickers.join('、')} 的股息資料暫時無法取得` : '');
      if (announce) notify(`股息現金已更新：USD ${money.format(payload.cash.USD.net)} · JPY ${yenMoney.format(payload.cash.JPY.net)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '股息現金目前無法更新';
      setDividendError(message);
      if (announce) notify(message);
    } finally {
      setDividendLoading(false);
    }
  }, [notify]);

  const persistDividendSettings = useCallback(async (next: DividendSettings) => {
    if (dividendSaving) return;
    setDividendSaving(true);
    try {
      const response = await fetch('/api/dividends', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      const payload = await response.json() as { settings?: DividendSettings; error?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? '股息設定無法保存');
      setDividendSettings(payload.settings);
      notify(payload.settings.enabled ? '股息自動入帳設定已保存' : '股息自動入帳已關閉');
      await refreshDividendCash(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : '股息設定無法保存');
    } finally {
      setDividendSaving(false);
    }
  }, [dividendSaving, notify, refreshDividendCash]);

  const resetDividendAdjustments = useCallback(async () => {
    if (dividendSaving || dividendAdjustmentCount < 1) return;
    setDividendSaving(true);
    try {
      const response = await fetch('/api/dividends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-adjustments' }),
      });
      const payload = await response.json() as { adjusted?: boolean; error?: string };
      if (!response.ok || !payload.adjusted) throw new Error(payload.error ?? '股息調整無法還原');
      await refreshDividendCash(false);
      notify('全部股息調整與刪除紀錄已還原');
    } catch (error) {
      notify(error instanceof Error ? error.message : '股息調整無法還原');
    } finally {
      setDividendSaving(false);
    }
  }, [dividendAdjustmentCount, dividendSaving, notify, refreshDividendCash]);

  const showMacroMarketGroup = useCallback((group: MacroMarketGroup, direction: 'up' | 'down') => {
    setMacroDeckDirection(direction);
    setMacroMarketGroup(group);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/broker-hub?summary=1', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { enabled?: boolean; error?: string };
        if (!response.ok || typeof payload.enabled !== 'boolean') throw new Error(payload.error ?? '設定無法讀取');
        if (!controller.signal.aborted) setBrokerHubEnabled(payload.enabled);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setBrokerHubEnabled(false);
      })
      .finally(() => { if (!controller.signal.aborted) setBrokerHubLoading(false); });
    return () => controller.abort();
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshDividendCash(false), 650);
    return () => window.clearTimeout(timer);
  }, [refreshDividendCash]);

  const openBrokerHub = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => document.getElementById('broker-hub')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }, []);

  const toggleBrokerHub = useCallback(async () => {
    if (brokerHubLoading || brokerHubToggleSaving) return;
    const nextEnabled = !brokerHubEnabled;
    setBrokerHubToggleSaving(true);
    try {
      const response = await fetch('/api/broker-hub', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const payload = await response.json() as { workspace?: BrokerWorkspace; error?: string };
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? '功能狀態無法保存');
      setBrokerHubEnabled(nextEnabled);
      setBrokerWorkspaceSeed(nextEnabled ? payload.workspace : null);
      notify(nextEnabled ? '跨券商資產追蹤已開啟' : '跨券商資產追蹤已關閉；已保存的資料不會刪除');
      if (nextEnabled) window.requestAnimationFrame(() => document.getElementById('broker-hub')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
    } catch (error) {
      notify(error instanceof Error ? error.message : '功能狀態無法保存');
    } finally {
      setBrokerHubToggleSaving(false);
    }
  }, [brokerHubEnabled, brokerHubLoading, brokerHubToggleSaving, notify]);

  const handleBackgroundUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (backgroundOperationRef.current) return;
    if (!file.type.startsWith('image/')) return notify('請選擇圖片檔案');
    if (file.size > 20 * 1024 * 1024) return notify('原始圖片不可超過 20 MB');
    backgroundOperationRef.current = true;
    backgroundGenerationRef.current += 1;
    setBackgroundSaving(true);
    const finish = () => {
      backgroundOperationRef.current = false;
      setBackgroundSaving(false);
    };
    const reader = new FileReader();
    reader.onload = () => {
      const source = typeof reader.result === 'string' ? reader.result : '';
      if (!source) {
        finish();
        return notify('無法讀取這張圖片');
      }
      const preview = new window.Image();
      preview.onload = async () => {
        let compressed = '';
        try {
          if (preview.naturalWidth * preview.naturalHeight > 60_000_000) {
            throw new Error('圖片解析度過高，請改用較小的圖片');
          }
          const maxEdge = 1920;
          const scale = Math.min(1, maxEdge / Math.max(preview.naturalWidth, preview.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(preview.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(preview.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('目前瀏覽器無法處理背景圖片');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(preview, 0, 0, canvas.width, canvas.height);
          compressed = canvas.toDataURL('image/jpeg', .78);
          const compressedBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .78));
          if (!compressedBlob) throw new Error('目前瀏覽器無法壓縮背景圖片');
          setBackgroundImage(compressed);
          setBackgroundMode('image');
          try {
            window.localStorage.setItem(backgroundPendingKey, compressed);
            window.localStorage.setItem(backgroundPendingModeKey, 'image');
            window.localStorage.setItem(backgroundImageKey, compressed);
            window.localStorage.setItem(backgroundModeKey, 'image');
          } catch {
            // Continue with the cloud save when browser storage is restricted.
          }

          const response = await fetch('/api/background?mode=image', {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            body: compressedBlob,
          });
          const payload = await response.json() as { imageUrl?: string; error?: string };
          if (!response.ok || !payload.imageUrl) throw new Error(payload.error ?? '背景圖片無法保存');
          const durableImageUrl = payload.imageUrl;
          try {
            window.localStorage.removeItem(backgroundPendingKey);
            window.localStorage.removeItem(backgroundPendingModeKey);
          } catch {
            // Replaying a completed upload later is safe because the request is idempotent for display state.
          }
          try {
            window.localStorage.setItem(backgroundImageKey, durableImageUrl);
            window.localStorage.setItem(backgroundModeKey, 'image');
          } catch {
            // The cloud copy is authoritative when browser storage is restricted.
          }
          setBackgroundImage(durableImageUrl);
          setBackgroundMode('image');
          notify('背景圖片已永久保存，重開頁面也會自動恢復');
        } catch (error) {
          if (compressed) {
            try {
              window.localStorage.setItem(backgroundImageKey, compressed);
              window.localStorage.setItem(backgroundPendingKey, compressed);
              window.localStorage.setItem(backgroundPendingModeKey, 'image');
              window.localStorage.setItem(backgroundModeKey, 'image');
              notify('背景暫時保存在目前裝置，重開時會自動重試同步');
              return;
            } catch {
              // Keep the in-memory preview even if neither persistent store is available.
            }
          }
          notify(error instanceof Error ? error.message : '背景圖片目前無法保存');
        } finally {
          finish();
        }
      };
      preview.onerror = () => {
        finish();
        notify('無法解析這張圖片');
      };
      preview.src = source;
    };
    reader.onerror = () => {
      finish();
      notify('無法讀取這張圖片');
    };
    reader.readAsDataURL(file);
  }, [notify]);

  const switchBackgroundMode = useCallback(async (mode: BackgroundMode) => {
    if (backgroundOperationRef.current || mode === backgroundMode) return;
    if (mode === 'image' && !backgroundImage) {
      backgroundInputRef.current?.click();
      return;
    }
    const previousMode = backgroundMode;
    backgroundGenerationRef.current += 1;
    setBackgroundMode(mode);
    try {
      window.localStorage.setItem(backgroundPendingModeKey, mode);
      window.localStorage.setItem(backgroundModeKey, mode);
    } catch {
      // The cloud setting is authoritative when browser storage is restricted.
    }
    if (isLocalBackground(backgroundImage)) {
      notify(mode === 'image' ? '已切換為圖片背景，待連線後會同步' : '已切換為原始背景，待連線後會同步');
      return;
    }
    backgroundOperationRef.current = true;
    setBackgroundSaving(true);
    try {
      const response = await fetch('/api/background', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
        keepalive: true,
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '背景模式無法保存');
      try {
        window.localStorage.removeItem(backgroundPendingModeKey);
      } catch {
        // The same mode can be safely replayed after reopening.
      }
      notify(mode === 'image' ? '已切換為圖片背景並保存' : '已切換為原始背景，圖片仍永久保留');
    } catch (error) {
      setBackgroundMode(previousMode);
      try {
        window.localStorage.removeItem(backgroundPendingModeKey);
      } catch {
        // The in-memory rollback remains correct for this session.
      }
      try {
        window.localStorage.setItem(backgroundModeKey, previousMode);
      } catch {
        // Keep the restored cloud setting even if a local cache cannot be written.
      }
      notify(error instanceof Error ? error.message : '背景模式無法保存');
    } finally {
      backgroundOperationRef.current = false;
      setBackgroundSaving(false);
    }
  }, [backgroundImage, backgroundMode, notify]);

  const fetchTrades = useCallback(async () => {
    const response = await fetch('/api/trades', { cache: 'no-store' });
    const payload = await response.json() as { trades?: Trade[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? '無法載入交易資料');
    setTrades(payload.trades ?? []);
    setLoading(false);
  }, []);

  const refreshQuotes = useCallback(async (announce = true) => {
    if (quoteRefreshInFlightRef.current) {
      if (announce) notify('報價正在更新中');
      return;
    }
    quoteRefreshInFlightRef.current = true;
    if (announce) setRefreshing(true);
    try {
      const response = await fetch('/api/quotes', { method: 'POST' });
      const payload = await response.json() as { quotes?: LiveQuote[]; failed?: number; failedTickers?: string[]; updatedAt?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? '報價更新失敗');
      const quotes = payload.quotes ?? [];
      const marketTimes = quotes.flatMap((quote) => typeof quote.marketTime === 'number' ? [quote.marketTime] : []);
      setMarketSnapshots((current) => ({ ...current, ...Object.fromEntries(quotes.map((quote) => [quote.ticker, quote])) }));
      setFailedQuoteTickers(new Set(payload.failedTickers ?? []));
      setLastQuoteAt(marketTimes.length ? new Date(Math.max(...marketTimes) * 1000).toISOString() : payload.updatedAt ?? new Date().toISOString());
      if (quotes.length) {
        const quotesByTicker = new Map(quotes.map((quote) => [quote.ticker.toUpperCase(), quote]));
        setTrades((current) => current.map((trade) => {
          if (trade.status !== 'open' || trade.quoteMode !== 'auto' || trade.type !== 'SDI' || !trade.ticker) return trade;
          const quote = quotesByTicker.get(trade.ticker.toUpperCase());
          return quote && trade.currentPrice !== quote.price ? { ...trade, currentPrice: quote.price } : trade;
        }));
      }
      if (announce) notify(`已更新 ${quotes.length} 個股票報價${payload.failed ? `，${payload.failed} 個暫時無法取得` : ''}`);
    } catch (error) {
      if (announce) notify(error instanceof Error ? error.message : '報價更新失敗');
    } finally {
      quoteRefreshInFlightRef.current = false;
      if (announce) setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void fetchTrades().catch((error) => { setLoading(false); notify(error.message); });
    }, 0);
    const quoteWarmup = window.setTimeout(() => {
      if (document.visibilityState === 'visible') void refreshQuotes(false);
    }, 900);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshQuotes(false);
    }, 60_000);
    return () => { window.clearTimeout(initialLoad); window.clearTimeout(quoteWarmup); window.clearInterval(timer); };
  }, [fetchTrades, notify, refreshQuotes]);

  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      void loadDcfCalculator();
      void loadCompanyFundamentals();
      if (brokerHubEnabled) void loadBrokerHub();
    }, 1_500);
    return () => window.clearTimeout(preloadTimer);
  }, [brokerHubEnabled]);

  useEffect(() => {
    const cached = benchmarkCacheRef.current.get(rangeMode);
    if (cached) {
      setBenchmarks({ mode: rangeMode, ...cached });
      setBenchmarkLoading(false);
      return;
    }
    const controller = new AbortController();
    setBenchmarkLoading(true);
    fetch(`/api/benchmarks?mode=${rangeMode}&scope=benchmarks`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { SPY?: number[]; BOXX?: number[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? '基準資料暫時無法取得');
        if (!controller.signal.aborted) {
          const next = { SPY: payload.SPY ?? [], BOXX: payload.BOXX ?? [] };
          benchmarkCacheRef.current.set(rangeMode, next);
          setBenchmarks({ mode: rangeMode, ...next });
        }
      })
      .catch(() => { if (!controller.signal.aborted) setBenchmarks({ mode: rangeMode, SPY: [], BOXX: [] }); })
      .finally(() => { if (!controller.signal.aborted) setBenchmarkLoading(false); });
    return () => controller.abort();
  }, [rangeMode]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const cacheKey = `${macroRangeMode}:${macroMarketGroup}`;
    const cached = macroCacheRef.current.get(cacheKey) ?? readStoredMacroMarket(cacheKey);
    const mergeMarketState = (current: MacroMarketData, markets: BenchmarkMarket[], updatedAt: string) => {
      const incomingIds = new Set(markets.map((market) => market.id));
      const retained = current.mode === macroRangeMode ? current.markets.filter((market) => !incomingIds.has(market.id)) : [];
      return { mode: macroRangeMode, markets: [...retained, ...markets], updatedAt };
    };
    if (cached) {
      macroCacheRef.current.set(cacheKey, cached);
      setMacroMarkets((current) => mergeMarketState(current, cached.markets, cached.updatedAt));
    }
    else setMacroLoading(true);
    const forceRefresh = macroRefreshRequestedRef.current;
    macroRefreshRequestedRef.current = false;
    const loadMarkets = async (quiet = false, force = false) => {
      if (inFlight) return;
      inFlight = true;
      if (!quiet) setMacroLoading(true);
      try {
        const refreshParam = force ? '&refresh=1' : '';
        const response = await fetch(`/api/benchmarks?mode=${macroRangeMode}&scope=markets&group=${macroMarketGroup}${refreshParam}`, { signal: controller.signal });
        const payload = await response.json() as { markets?: BenchmarkMarket[]; updatedAt?: string; warnings?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? '宏觀行情暫時無法取得');
        if (controller.signal.aborted) return;
        const incomingMarkets = payload.markets ?? [];
        const fallbackMarkets = macroCacheRef.current.get(cacheKey)?.markets ?? cached?.markets ?? [];
        let usedFallback = false;
        const nextMarkets = incomingMarkets.length ? incomingMarkets.map((market) => {
          const fallback = fallbackMarkets.find((candidate) => candidate.id === market.id);
          if (market.latest !== null || !fallback || fallback.latest === null) return market;
          usedFallback = true;
          return { ...market, values: fallback.values, latest: fallback.latest, change: fallback.change, changePercent: fallback.changePercent };
        }) : fallbackMarkets;
        const freshUpdatedAt = payload.updatedAt ?? new Date().toISOString();
        const updatedAt = usedFallback && cached?.updatedAt ? cached.updatedAt : freshUpdatedAt;
        const freshFxRate = incomingMarkets.find((market) => market.id === 'USDJPY')?.latest;
        const fxRate = nextMarkets.find((market) => market.id === 'USDJPY')?.latest;
        if (typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 50) {
          setUsdJpyRate(fxRate);
          window.localStorage.setItem(usdJpyRateKey, String(fxRate));
        }
        if (typeof freshFxRate === 'number' && Number.isFinite(freshFxRate) && freshFxRate > 50) {
          setUsdJpyUpdatedAt(freshUpdatedAt);
          window.localStorage.setItem(usdJpyUpdatedAtKey, freshUpdatedAt);
        }
        const entry = { markets: nextMarkets, updatedAt, fetchedAt: Date.now() };
        macroCacheRef.current.set(cacheKey, entry);
        writeStoredMacroMarket(cacheKey, entry);
        setMacroMarkets((current) => mergeMarketState(current, nextMarkets, updatedAt));
        setMacroError(payload.warnings?.length ? '部分即時資料暫時延遲，已保留最近一次有效報價' : '');
      } catch (error) {
        if (!controller.signal.aborted) setMacroError(cached ? '即時資料暫時延遲，目前顯示最近一次有效報價' : error instanceof Error ? error.message : '宏觀行情暫時無法取得');
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setMacroLoading(false);
      }
    };
    void loadMarkets(Boolean(cached), forceRefresh);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMarkets(true, false); }, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [macroMarketGroup, macroRangeMode, macroRefreshKey]);

  useEffect(() => {
    const currentDate = today();
    if (allocationDate === currentDate) return;
    if (allocationHistory?.date === allocationDate) return;
    const controller = new AbortController();
    fetch(`/api/allocation-history?date=${encodeURIComponent(allocationDate)}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as AllocationHistory & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? '無法載入歷史持倉');
        allocationHistoryCacheRef.current.set(allocationDate, payload);
        setAllocationHistory(payload);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAllocationHistory(null);
          notify(error instanceof Error ? error.message : '無法載入歷史持倉');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setAllocationLoading(false); });
    return () => controller.abort();
  }, [allocationDate, allocationHistory?.date, notify]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id === 'overview' || visible?.target.id === 'positions' || visible?.target.id === 'returns' || visible?.target.id === 'valuation') {
        setActiveSection((current) => current === visible.target.id ? current : visible.target.id as 'overview' | 'positions' | 'returns' | 'valuation');
      }
    }, { rootMargin: '-22% 0px -58% 0px', threshold: [0, .15, .4, .7] });
    ['overview', 'positions', 'returns', 'valuation'].forEach((id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, [valuationOpen]);

  useEffect(() => {
    const controller = new AbortController();
    const restoreGeneration = backgroundGenerationRef.current;
    const restoreIsStale = () => controller.signal.aborted || restoreGeneration !== backgroundGenerationRef.current;
    const restoreBackground = async () => {
      let savedImage = '';
      let pendingImage = '';
      let savedMode: string | null = null;
      let pendingMode: string | null = null;
      try {
        savedImage = window.localStorage.getItem(backgroundImageKey) ?? '';
        pendingImage = window.localStorage.getItem(backgroundPendingKey) ?? '';
        savedMode = window.localStorage.getItem(backgroundModeKey);
        pendingMode = window.localStorage.getItem(backgroundPendingModeKey);
      } catch {
        // The durable server copy remains available when browser storage is restricted.
      }
      const validPendingMode: BackgroundMode | null = pendingMode === 'default' || pendingMode === 'image' ? pendingMode : null;
      const mode: BackgroundMode = validPendingMode ?? (savedMode === 'default' ? 'default' : 'image');
      const validPendingImage = isLocalBackground(pendingImage) ? pendingImage : '';
      const validSavedImage = isStoredBackground(savedImage) ? savedImage : '';
      const localPreview = validPendingImage || validSavedImage;
      if (localPreview && !restoreIsStale()) {
        setBackgroundImage(localPreview);
        setBackgroundMode(mode);
      }

      const uploadCandidate = validPendingImage || (isLocalBackground(validSavedImage) ? validSavedImage : '');
      if (uploadCandidate) {
        backgroundOperationRef.current = true;
        setBackgroundSaving(true);
        try {
          const legacyBlob = await (await fetch(uploadCandidate)).blob();
          const migrationResponse = await fetch(`/api/background?mode=${mode}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            body: legacyBlob,
            signal: controller.signal,
          });
          const migrationPayload = await migrationResponse.json() as { imageUrl?: string; error?: string };
          if (!migrationResponse.ok || !migrationPayload.imageUrl) throw new Error(migrationPayload.error ?? '舊背景無法同步');
          if (restoreIsStale()) return;
          setBackgroundImage(migrationPayload.imageUrl);
          setBackgroundMode(mode);
          try {
            window.localStorage.removeItem(backgroundPendingKey);
            window.localStorage.removeItem(backgroundPendingModeKey);
          } catch {
            // A completed cloud save can be safely replayed if local cleanup is blocked.
          }
          try {
            window.localStorage.setItem(backgroundImageKey, migrationPayload.imageUrl);
            window.localStorage.setItem(backgroundModeKey, mode);
          } catch {
            // The migrated cloud copy remains authoritative.
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            try {
              window.localStorage.setItem(backgroundPendingKey, uploadCandidate);
              window.localStorage.setItem(backgroundPendingModeKey, mode);
            } catch {
              // The existing in-memory preview remains visible for this session.
            }
          }
        } finally {
          backgroundOperationRef.current = false;
          if (!controller.signal.aborted) setBackgroundSaving(false);
        }
        return;
      }

      try {
        const response = await fetch('/api/background', { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { exists?: boolean; mode?: BackgroundMode; imageUrl?: string | null; error?: string };
        if (!response.ok) throw new Error(payload.error ?? '背景設定無法讀取');
        if (payload.exists && payload.imageUrl) {
          const durableImageUrl = payload.imageUrl;
          if (restoreIsStale()) return;
          const serverMode: BackgroundMode = payload.mode === 'default' ? 'default' : 'image';
          const restoredMode = validPendingMode ?? serverMode;
          setBackgroundImage(durableImageUrl);
          setBackgroundMode(restoredMode);

          let pendingModeSynced = !validPendingMode || validPendingMode === serverMode;
          if (validPendingMode && validPendingMode !== serverMode) {
            try {
              const modeResponse = await fetch('/api/background', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: validPendingMode }),
                keepalive: true,
                signal: controller.signal,
              });
              pendingModeSynced = modeResponse.ok;
            } catch {
              pendingModeSynced = false;
            }
          }
          if (pendingModeSynced) {
            try {
              window.localStorage.removeItem(backgroundPendingModeKey);
            } catch {
              // Replaying the same mode later does not alter the selected result.
            }
          }
          try {
            window.localStorage.setItem(backgroundImageKey, durableImageUrl);
            window.localStorage.setItem(backgroundModeKey, restoredMode);
          } catch {
            // Server persistence is authoritative, so local cache failures are harmless.
          }
          return;
        }

        if (!restoreIsStale()) {
          setBackgroundImage('');
          setBackgroundMode('default');
          try {
            window.localStorage.removeItem(backgroundImageKey);
            window.localStorage.removeItem(backgroundPendingKey);
            window.localStorage.removeItem(backgroundPendingModeKey);
            window.localStorage.setItem(backgroundModeKey, 'default');
          } catch {
            // The empty server state is already reflected in memory.
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError') && !localPreview && !restoreIsStale()) {
          setBackgroundImage('');
          setBackgroundMode('default');
        }
      }
    };
    void restoreBackground();
    return () => controller.abort();
  }, []);

  const updatePanelRatio = useCallback((clientX: number) => {
    const bounds = contentGridRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const nextRatio = clampPanelRatio(((clientX - bounds.left) / bounds.width) * 100);
    panelRatioRef.current = nextRatio;
    contentGridRef.current?.style.setProperty('--return-panel-ratio', `${nextRatio}%`);
  }, []);

  const adjustPanelRatio = useCallback((delta: number) => {
    const nextRatio = clampPanelRatio(panelRatioRef.current + delta);
    panelRatioRef.current = nextRatio;
    setPanelRatio(nextRatio);
    window.localStorage.setItem(panelRatioKey, String(nextRatio));
  }, []);

  useEffect(() => {
    if (!resizingPanels) return;
    const move = (event: PointerEvent) => updatePanelRatio(event.clientX);
    const finish = () => {
      setPanelRatio(panelRatioRef.current);
      window.localStorage.setItem(panelRatioKey, String(panelRatioRef.current));
      setResizingPanels(false);
    };
    document.body.classList.add('is-resizing-panels');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      document.body.classList.remove('is-resizing-panels');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [resizingPanels, updatePanelRatio]);

  const editorMarket: 'US' | 'JP' = editor?.market ?? (editor?.ticker === 'JPY' || isJapaneseTicker(editor?.ticker) ? 'JP' : 'US');
  const editorCurrencySymbol = editorMarket === 'JP' ? '¥' : '$';
  const tickerQuery = editor?.ticker?.trim() ?? '';
  const editorAutoQuoteTicker = editor?.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto'
    ? normalizeTickerForMarket(tickerQuery, editorMarket)
    : '';
  const editorDisplayTicker = editor?.type === 'CASH' ? (editorMarket === 'JP' ? 'JPY' : 'USD') : normalizeTickerForMarket(tickerQuery, editorMarket);
  const editorPriceMoney = (value: number) => editorMarket === 'JP' ? yenMoney.format(value) : money.format(value);
  const editorPreviewTrade = editor ? { ...editor, ticker: editorDisplayTicker, market: editorMarket } : null;
  const editorPreviewMetrics = editorPreviewTrade ? metrics(editorPreviewTrade, usdJpyRate) : null;
  useEffect(() => {
    if (!symbolFocused || !tickerQuery || editor?.type === 'CASH') {
      const clearResults = window.setTimeout(() => {
        setSymbolSuggestions([]);
        setSymbolLoading(false);
      }, 0);
      return () => window.clearTimeout(clearResults);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSymbolLoading(true);
      try {
        const response = await fetch(`/api/symbols?q=${encodeURIComponent(tickerQuery)}&market=${editorMarket}`, { signal: controller.signal });
        const payload = await response.json() as { suggestions?: SymbolSuggestion[] };
        if (!response.ok) throw new Error('Ticker search unavailable');
        setSymbolSuggestions(payload.suggestions ?? []);
        setActiveSymbolIndex(0);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setSymbolSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSymbolLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editor?.type, editorMarket, tickerQuery, symbolFocused]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!editorAutoQuoteTicker || !/^[A-Z0-9.-]{1,12}$/.test(editorAutoQuoteTicker)) {
        setEditorQuoteLoading(false);
        setEditorQuoteError('');
        setEditorQuote(null);
        return;
      }

      const cached = editorQuoteCacheRef.current.get(editorAutoQuoteTicker);
      if (cached && Date.now() - cached.fetchedAt < 45_000) {
        setEditor((current) => current?.type === 'SDI' && current.status === 'open' && current.quoteMode === 'auto' && normalizeTickerForMarket(current.ticker, current.market ?? (isJapaneseTicker(current.ticker) ? 'JP' : 'US')) === editorAutoQuoteTicker
          ? { ...current, currentPrice: cached.quote.price }
          : current);
        setEditorQuote(cached.quote);
        setEditorQuoteError('');
        setEditorQuoteLoading(false);
        if (cached.quote.marketTime) setLastQuoteAt(new Date(cached.quote.marketTime * 1000).toISOString());
        return;
      }

      setEditorQuoteLoading(true);
      setEditorQuoteError('');
      setEditorQuote(null);
      try {
        const response = await fetch(`/api/quotes?symbol=${encodeURIComponent(editorAutoQuoteTicker)}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { quote?: LiveQuote; error?: string };
        if (!response.ok || !payload.quote || !Number.isFinite(payload.quote.price) || payload.quote.price <= 0) {
          throw new Error(payload.error ?? '暫時無法取得最新報價');
        }
        const quote = payload.quote;
        editorQuoteCacheRef.current.set(editorAutoQuoteTicker, { quote, fetchedAt: Date.now() });
        setEditor((current) => current?.type === 'SDI' && current.status === 'open' && current.quoteMode === 'auto' && normalizeTickerForMarket(current.ticker, current.market ?? (isJapaneseTicker(current.ticker) ? 'JP' : 'US')) === editorAutoQuoteTicker
          ? { ...current, currentPrice: quote.price }
          : current);
        setEditorQuote(quote);
        if (quote.marketTime) setLastQuoteAt(new Date(quote.marketTime * 1000).toISOString());
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setEditorQuoteError(error instanceof Error ? error.message : '暫時無法取得最新報價');
        }
      } finally {
        if (!controller.signal.aborted) setEditorQuoteLoading(false);
      }
    }, editorAutoQuoteTicker ? 280 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editorAutoQuoteTicker, editorQuoteRetry]);

  useEffect(() => {
    if (!drilledTicker) return;
    const customQuery = technicalRange === 'custom' ? `&from=${technicalCustomFrom}&to=${technicalCustomTo}` : '';
    const cacheKey = `${drilledTicker}:${technicalRange}:${technicalRange === 'custom' ? `${technicalCustomFrom}:${technicalCustomTo}` : ''}`;
    const cached = technicalCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 120_000) {
      setTechnicalData(cached.data);
      setTechnicalError('');
      setTechnicalLoading(false);
      return;
    }
    const controller = new AbortController();
    setTechnicalLoading(true);
    fetch(`/api/technical?symbol=${encodeURIComponent(drilledTicker)}&range=${technicalRange}${customQuery}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TechnicalData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? '技術指標暫時無法取得');
        if (!controller.signal.aborted) {
          technicalCacheRef.current.set(cacheKey, { data: payload, fetchedAt: Date.now() });
          setTechnicalData(payload);
          setTechnicalError('');
        }
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setTechnicalError(error instanceof Error ? error.message : '技術指標暫時無法取得');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setTechnicalLoading(false); });
    return () => controller.abort();
  }, [drilledTicker, technicalRange, technicalCustomFrom, technicalCustomTo]);

  const selectSymbol = useCallback((suggestion: SymbolSuggestion) => {
    setEditor((current) => current ? { ...current, ticker: suggestion.symbol, market: isJapaneseTicker(suggestion.symbol) ? 'JP' : 'US' } : current);
    setSymbolSuggestions([]);
    setSymbolFocused(false);
  }, []);

  const derivedDividendTrades = useMemo<Trade[]>(() => {
    if (!dividendSettings.enabled) return [];
    return dividendEvents
      .filter((event) => event.net > 0)
      .sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker))
      .map((event, index) => ({
        id: -910_000 - index,
        type: 'CASH',
        openDate: event.date,
        expiryDate: null,
        closeDate: null,
        ticker: event.currency,
        event: 'DIVIDEND',
        strike: null,
        quantity: event.net,
        entryPrice: 1,
        currentPrice: 1,
        fees: 0,
        collateral: event.net,
        notes: `${event.ticker} 股息 · 每股 ${nativeMoney(event.ticker, event.amountPerShare)} · ${quantityNumber.format(event.quantity)} 股 · 稅前 ${nativeMoney(event.ticker, event.gross)} · 預扣 ${nativeMoney(event.ticker, event.tax)}`,
        status: 'open',
        quoteMode: 'manual',
        market: event.currency === 'JPY' ? 'JP' : 'US',
        sourceRow: null,
        derived: true,
        dividendSourceTicker: event.ticker,
        dividendAmountPerShare: event.amountPerShare,
        dividendGross: event.gross,
        dividendTax: event.tax,
        dividendEventKey: event.eventKey,
        dividendCalculatedNet: event.calculatedNet,
        dividendAdjustment: event.adjustment,
      }));
  }, [dividendEvents, dividendSettings.enabled]);
  const portfolioTrades = useMemo(() => [...trades, ...derivedDividendTrades], [derivedDividendTrades, trades]);
  const enriched = useMemo(() => portfolioTrades.map((trade) => ({ trade, ...metrics(trade, usdJpyRate) })), [portfolioTrades, usdJpyRate]);
  const openTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'open'), [enriched]);
  const closedTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'closed'), [enriched]);
  const openPnl = openTrades.reduce((sum, item) => sum + item.pnl, 0);
  const trackedValue = openTrades.reduce((sum, item) => sum + item.marketValue, 0);
  const capitalAtRisk = openTrades.reduce((sum, item) => sum + investedCapitalUsd(item.trade, usdJpyRate), 0);
  const openReturnOnCapital = capitalAtRisk > 0 ? openPnl / capitalAtRisk : null;
  const currentRocYear = Number(today().slice(0, 4));
  const annualRocSummary = useMemo(() => {
    const completed = closedTrades.filter((item) => item.trade.closeDate?.startsWith(`${currentRocYear}-`)
      && item.trade.collateral > 0
      && Number.isFinite(item.pnl)
      && item.days > 0);
    const realizedPnl = completed.reduce((sum, item) => sum + item.pnl, 0);
    const capitalYears = completed.reduce((sum, item) => {
      const collateralUsd = normalizedUsdAmount(item.trade, item.trade.collateral, usdJpyRate);
      return sum + collateralUsd * (item.days / 365);
    }, 0);
    return {
      count: completed.length,
      value: capitalYears > 0 ? realizedPnl / capitalYears : null,
    };
  }, [closedTrades, currentRocYear, usdJpyRate]);

  const returnSeries = useMemo(() => buildReturnSeries(trades, rangeMode, usdJpyRate), [trades, rangeMode, usdJpyRate]);
  const activeBenchmarks = benchmarks.mode === rangeMode ? benchmarks : { mode: rangeMode, SPY: [], BOXX: [] };
  const chartStep = .05;
  const chartValues = [...returnSeries.map((item) => item.value), ...activeBenchmarks.SPY, ...activeBenchmarks.BOXX].filter(Number.isFinite);
  const chartStepCount = Math.max(1, Math.ceil(Math.max(0, ...chartValues.map(Math.abs)) / chartStep));
  const maxAbsReturn = chartStepCount * chartStep;
  const chartY = (value: number) => 50 - (value / maxAbsReturn) * 50;
  const chartTicks = Array.from({ length: chartStepCount * 2 + 1 }, (_, index) => (chartStepCount - index) * chartStep);
  const pointsFor = (values: number[]) => values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = chartY(value);
    return `${x},${y}`;
  }).join(' ');
  const chartPoints = pointsFor(returnSeries.map((item) => item.value));
  const spyPoints = pointsFor(activeBenchmarks.SPY);
  const boxxPoints = pointsFor(activeBenchmarks.BOXX);
  const rangeModeLabel = rangeMode === 'day' ? '日' : rangeMode === 'week' ? '週' : rangeMode === 'month' ? '月' : '年';
  const macroRangeModeLabel = macroRangeMode === 'day' ? '日' : macroRangeMode === 'week' ? '週' : macroRangeMode === 'month' ? '月' : '年';
  const macroTimeline = useMemo(() => buildReturnSeries([], macroRangeMode), [macroRangeMode]);
  const activeMacroIds: BenchmarkMarket['id'][] = macroMarketGroup === 'rates' ? ['USDJPY', 'US10Y', 'US30Y'] : ['GOLD', 'OIL'];
  const activeMacroMarkets = macroMarkets.mode === macroRangeMode ? activeMacroIds.flatMap((id) => {
    const market = macroMarkets.markets.find((candidate) => candidate.id === id);
    return market ? [market] : [];
  }) : [];
  const usdJpyEstimated = !(usdJpyRate > 50 && usdJpyUpdatedAt);
  const macroUpdatedLabel = macroMarkets.updatedAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(macroMarkets.updatedAt)) : '等待更新';
  const chartDateStep = Math.max(1, Math.ceil((returnSeries.length - 1) / 5));
  const activeReturnHoverIndex = returnHoverIndex !== null && returnSeries[returnHoverIndex] ? returnHoverIndex : null;

  const currentAllocationDate = today();
  const allocationPresets = [
    { label: '目前', date: currentAllocationDate },
    { label: '1 個月', date: monthsBefore(currentAllocationDate, 1) },
    { label: '3 個月', date: monthsBefore(currentAllocationDate, 3) },
    { label: '1 年', date: monthsBefore(currentAllocationDate, 12) },
  ];
  const earliestAllocationDate = trades.reduce((earliest, trade) => !earliest || trade.openDate < earliest ? trade.openDate : earliest, '') || currentAllocationDate;
  const allocationSnapshot = useMemo(() => {
    const current = allocationDate === currentAllocationDate;
    const groups = new Map<string, { label: string; value: number; tradeCount: number; estimated: boolean }>();
    if (current) {
      for (const item of openTrades) {
        const label = item.trade.ticker || '其他';
        const group = groups.get(label) ?? { label, value: 0, tradeCount: 0, estimated: false };
        group.value += Math.max(0, item.marketValue);
        group.tradeCount += 1;
        groups.set(label, group);
      }
    } else if (allocationHistory?.date === allocationDate) {
      allocationHistory.positions.forEach((position) => groups.set(position.label, { ...position }));
    }
    const sorted = [...groups.values()].sort((a, b) => b.value - a.value);
    const total = sorted.reduce((sum, item) => sum + item.value, 0);
    type AllocationGroupWithMembers = { label: string; value: number; tradeCount: number; estimated: boolean; members: string[] };
    const top: AllocationGroupWithMembers[] = sorted.slice(0, 5).map((item) => ({ ...item, members: [item.label] }));
    if (sorted.length > 5) {
      top.push(sorted.slice(5).reduce<AllocationGroupWithMembers>((other, item) => ({
        label: '其他',
        value: other.value + item.value,
        tradeCount: other.tradeCount + item.tradeCount,
        estimated: other.estimated || item.estimated,
        members: [...other.members, item.label],
      }), { label: '其他', value: 0, tradeCount: 0, estimated: false, members: [] as string[] }));
    }
    return {
      items: top.map((item, index) => ({ ...item, share: total > 0 ? item.value / total : 0, color: palette[index % palette.length] })),
      total,
      tradeCount: current ? openTrades.length : allocationHistory?.date === allocationDate ? allocationHistory.tradeCount : 0,
      estimatedTickers: current ? [] : allocationHistory?.date === allocationDate ? allocationHistory.estimatedTickers : [],
    };
  }, [allocationDate, allocationHistory, currentAllocationDate, openTrades]);
  const allocation = allocationSnapshot.items as AllocationItem[];
  const allocationFallbackLabel = allocationGroupSelection?.label ?? allocation.find((item) => drilledTicker && item.members.includes(drilledTicker))?.label ?? null;
  const activeAllocationLabel = allocationHoveredLabel ?? allocationPinnedLabel ?? allocationFallbackLabel;
  const activeAllocationItem = allocation.find((item) => item.label === activeAllocationLabel) ?? null;

  const filteredTrades = useMemo(() => enriched.filter((item) => {
    const matchesQuery = !query || `${item.trade.ticker} ${item.trade.event} ${item.trade.notes}`.toLowerCase().includes(query.toLowerCase());
    const matchesAllocationGroup = !allocationGroupSelection || allocationGroupSelection.members.includes((item.trade.ticker || 'OTHER').toUpperCase());
    const matchesFilter = filter === 'all' ||
      (filter === 'open' && item.trade.status === 'open') ||
      (filter === 'closed' && item.trade.status === 'closed') ||
      (filter === 'options' && item.trade.type !== 'SDI' && !isCashTrade(item.trade)) ||
      (filter === 'stock' && item.trade.type === 'SDI') ||
      (filter === 'cash' && isCashTrade(item.trade));
    return matchesQuery && matchesAllocationGroup && matchesFilter;
  }), [allocationGroupSelection, enriched, filter, query]);

  const visualPositions = useMemo(() => {
    const groups = new Map<string, {
      ticker: string;
      items: typeof filteredTrades;
      marketValue: number;
      pnl: number;
      capital: number;
      entryWeighted: number;
      currentWeighted: number;
      priceWeight: number;
      stockQuantity: number;
      optionQuantity: number;
      cashQuantity: number;
      strategies: Set<string>;
    }>();
    for (const item of filteredTrades) {
      const ticker = item.trade.ticker || 'OTHER';
      const group = groups.get(ticker) ?? {
        ticker, items: [], marketValue: 0, pnl: 0, capital: 0, entryWeighted: 0,
        currentWeighted: 0, priceWeight: 0, stockQuantity: 0, optionQuantity: 0, cashQuantity: 0, strategies: new Set<string>(),
      };
      const units = Math.max(.0001, Math.abs(item.trade.quantity));
      const cash = isCashTrade(item.trade);
      const stock = item.trade.type === 'SDI' || item.trade.event === 'STOCK';
      const multiplier = stock || cash ? 1 : 100;
      group.items.push(item);
      group.marketValue += item.marketValue;
      group.pnl += item.pnl;
      group.capital += normalizedUsdAmount(item.trade, item.trade.collateral || Math.abs(item.trade.entryPrice * item.trade.quantity * multiplier), usdJpyRate);
      group.entryWeighted += item.trade.entryPrice * units;
      group.currentWeighted += (item.trade.currentPrice ?? item.trade.entryPrice) * units;
      group.priceWeight += units;
      if (cash) group.cashQuantity += item.trade.status === 'open' ? Math.abs(item.trade.quantity) : 0;
      else if (stock) group.stockQuantity += item.trade.status === 'open' ? Math.abs(item.trade.quantity) : 0;
      else group.optionQuantity += item.trade.status === 'open' ? Math.abs(item.trade.quantity) : 0;
      group.strategies.add(item.trade.event);
      groups.set(ticker, group);
    }
    const grouped = [...groups.values()].sort((a, b) => b.marketValue - a.marketValue);
    const total = grouped.reduce((sum, item) => sum + Math.max(0, item.marketValue), 0) || 1;
    return grouped.map((group) => ({
      ...group,
      company: group.ticker === 'USD' ? '美元現金' : group.ticker === 'JPY' ? '日圓現金' : companyNames[group.ticker] ?? (isJapaneseTicker(group.ticker) ? '日本股票持倉' : '美股／ETF 持倉'),
      entryPrice: group.entryWeighted / group.priceWeight,
      currentPrice: group.currentWeighted / group.priceWeight,
      roc: group.capital > 0 ? group.pnl / group.capital : 0,
      share: Math.max(0, group.marketValue) / total,
      strategy: [...group.strategies].slice(0, 2).join(' · '),
    }));
  }, [filteredTrades, usdJpyRate]);

  async function persistTrade(trade: Trade, method: 'POST' | 'PUT') {
    const response = await fetch('/api/trades', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
    const payload = await response.json() as { trade?: Trade; error?: string };
    if (!response.ok || !payload.trade) throw new Error(payload.error ?? '儲存失敗');
    setTrades((current) => method === 'POST' ? [payload.trade!, ...current] : current.map((item) => item.id === payload.trade!.id ? payload.trade! : item));
    window.setTimeout(() => void refreshDividendCash(false), 0);
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    if (editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto' && editorQuoteLoading) {
      return notify('正在取得最新報價，請稍候再儲存');
    }
    if (editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto' && (!editor.currentPrice || editor.currentPrice <= 0)) {
      return notify(editorQuoteError || '請先取得有效的股票報價');
    }
    if (editor.status === 'closed' && !editor.closeDate) return notify('請填寫平倉日');
    if (editor.closeDate && editor.closeDate < editor.openDate) return notify('平倉日不得早於開倉日');
    if (!(editor.quantity > 0)) return notify(editor.type === 'CASH' ? '請輸入大於 0 的現金餘額' : '請輸入大於 0 的持倉數量');
    setSaving(true);
    try {
      const cash = editor.type === 'CASH';
      const preparedTrade: Trade = {
        ...editor,
        ticker: cash ? (editorMarket === 'JP' ? 'JPY' : 'USD') : normalizeTickerForMarket(editor.ticker, editorMarket),
        market: editorMarket,
        type: cash ? 'CASH' : editorMarket === 'JP' ? 'SDI' : editor.type,
        event: cash ? 'CASH' : editorMarket === 'JP' ? 'STOCK' : editor.event,
        expiryDate: cash ? null : editor.expiryDate,
        strike: cash ? null : editor.strike,
        entryPrice: cash ? 1 : editor.entryPrice,
        currentPrice: cash ? 1 : editor.currentPrice,
        fees: cash ? 0 : editor.fees,
        collateral: cash ? editor.quantity : editor.collateral,
        quoteMode: cash ? 'manual' : editor.quoteMode,
      };
      await persistTrade(preparedTrade, editor.id ? 'PUT' : 'POST');
      setEditor(null);
      notify('交易已安全儲存');
    } catch (error) {
      notify(error instanceof Error ? error.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function saveInlinePrice(trade: Trade) {
    const price = Number(priceInput);
    if (!Number.isFinite(price) || price < 0) return notify('請輸入有效價格');
    try {
      await persistTrade({ ...trade, currentPrice: price, quoteMode: 'manual' }, 'PUT');
      setPriceEditId(null);
      notify(`${trade.ticker ?? '持倉'} 價格已儲存，並切換為手動報價`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '價格儲存失敗');
    }
  }

  async function saveStockLot(trade: Trade, openDate: string, entryPrice: number) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openDate)) return notify('請選擇有效的買入日期');
    if (!Number.isFinite(entryPrice) || entryPrice < 0) return notify('請輸入有效的買入均價');
    setLotSavingId(trade.id);
    try {
      await persistTrade({ ...trade, openDate, entryPrice, strike: trade.event === 'STOCK' ? String(entryPrice) : trade.strike }, 'PUT');
      notify(`${trade.ticker ?? '股票'} 買入資料已更新，平均成本與損益已重新計算`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '買入資料儲存失敗');
    } finally {
      setLotSavingId(null);
    }
  }

  function openDividendAdjustment(trade: Trade) {
    if (!trade.derived || !trade.dividendEventKey) return;
    const decimals = trade.ticker === 'JPY' ? 0 : 2;
    setDividendAdjustmentCandidate(trade);
    setDividendNetInput(trade.quantity.toFixed(decimals));
  }

  async function saveDividendAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!dividendAdjustmentCandidate?.dividendEventKey) return;
    const requestedNet = Number(dividendNetInput);
    const calculatedNet = dividendAdjustmentCandidate.dividendCalculatedNet ?? dividendAdjustmentCandidate.quantity;
    const currencyDecimals = dividendAdjustmentCandidate.ticker === 'JPY' ? 0 : 2;
    const roundingTolerance = 0.5 / (10 ** currencyDecimals);
    if (!Number.isFinite(requestedNet) || requestedNet < 0) return notify('請輸入有效的股息入帳金額');
    if (requestedNet > calculatedNet + roundingTolerance) return notify(`調整後金額不可高於原始稅後股息 ${nativeMoney(dividendAdjustmentCandidate.ticker, calculatedNet)}`);
    const adjustedNet = Math.min(requestedNet, calculatedNet);
    const action = calculatedNet - adjustedNet <= roundingTolerance ? 'clear' : 'adjust';
    setDividendAdjusting(true);
    try {
      const response = await fetch('/api/dividends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, eventKey: dividendAdjustmentCandidate.dividendEventKey, net: adjustedNet }),
      });
      const payload = await response.json() as { adjusted?: boolean; error?: string };
      if (!response.ok || !payload.adjusted) throw new Error(payload.error ?? '股息入帳金額無法保存');
      const sourceTicker = dividendAdjustmentCandidate.dividendSourceTicker ?? '股息';
      setDividendAdjustmentCandidate(null);
      await refreshDividendCash(false);
      notify(`${sourceTicker} 股息已調整為 ${nativeMoney(dividendAdjustmentCandidate.ticker, adjustedNet)}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '股息入帳金額無法保存');
    } finally {
      setDividendAdjusting(false);
    }
  }

  async function deleteTrade() {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      if (deleteCandidate.derived && deleteCandidate.dividendEventKey) {
        const response = await fetch('/api/dividends', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'exclude', eventKey: deleteCandidate.dividendEventKey }),
        });
        const payload = await response.json() as { adjusted?: boolean; error?: string };
        if (!response.ok || !payload.adjusted) throw new Error(payload.error ?? '股息紀錄無法刪除');
        const sourceTicker = deleteCandidate.dividendSourceTicker ?? '股息';
        setDeleteCandidate(null);
        await refreshDividendCash(false);
        notify(`${sourceTicker} 的這筆股息已從現金與交易紀錄刪除`);
        return;
      }
      const response = await fetch('/api/trades', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteCandidate.id }),
      });
      const payload = await response.json() as { deletedId?: number; error?: string };
      if (!response.ok || payload.deletedId !== deleteCandidate.id) throw new Error(payload.error ?? '刪除失敗');
      setTrades((current) => current.filter((trade) => trade.id !== deleteCandidate.id));
      window.setTimeout(() => void refreshDividendCash(false), 0);
      if (editor?.id === deleteCandidate.id) setEditor(null);
      if (priceEditId === deleteCandidate.id) setPriceEditId(null);
      setDeleteCandidate(null);
      notify(`${deleteCandidate.ticker ?? '交易'} 紀錄已刪除，圖表與持倉已重新計算`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '刪除失敗');
    } finally {
      setDeleting(false);
    }
  }

  function selectAllocationDate(date: string) {
    if (!date || date === allocationDate) return;
    const currentDate = today();
    const cached = allocationHistoryCacheRef.current.get(date);
    setAllocationDate(date);
    setAllocationHoveredLabel(null);
    setAllocationPinnedLabel(null);
    setAllocationLoading(date !== currentDate && !cached);
    if (date === currentDate) setAllocationHistory(null);
    else if (cached) setAllocationHistory(cached);
  }

  function openTickerDetails(ticker: string) {
    if (ticker === 'USD' || ticker === 'JPY') return;
    const tickerChanged = ticker !== drilledTicker;
    setAllocationGroupSelection(null);
    setDrilledTicker(ticker);
    setQuery(ticker);
    setFilter('all');
    setPositionView('details');
    if (tickerChanged) {
      setTechnicalLoading(true);
      setTechnicalError('');
    }
    window.requestAnimationFrame(() => document.getElementById('stock-analysis')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }

  function selectTechnicalRange(range: TechnicalRange) {
    if (range === technicalRange) return;
    setTechnicalRange(range);
    setTechnicalLoading(true);
    setTechnicalError('');
  }

  function applyTechnicalCustomRange(from: string, to: string) {
    if (!from || !to || from >= to) {
      notify('請選擇有效的自訂開始與結束日期');
      return;
    }
    setTechnicalCustomFrom(from);
    setTechnicalCustomTo(to);
    setTechnicalRange('custom');
    setTechnicalLoading(true);
    setTechnicalError('');
  }

  function returnToPositionsOverview() {
    setAllocationGroupSelection(null);
    setAllocationHoveredLabel(null);
    setAllocationPinnedLabel(null);
    setDrilledTicker(null);
    setQuery('');
    setPositionView('visual');
    setTechnicalData(null);
    setTechnicalLoading(false);
    setTechnicalError('');
    window.requestAnimationFrame(() => document.getElementById('positions')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }

  function openValuation(ticker?: string) {
    if (ticker) setValuationTicker(ticker);
    setValuationOpen(true);
    setActiveSection('valuation');
    window.setTimeout(() => document.getElementById('valuation')?.scrollIntoView({ behavior: 'auto', block: 'start' }), 0);
  }

  function closeValuation() {
    setValuationOpen(false);
    setActiveSection(drilledTicker ? 'positions' : 'overview');
    window.requestAnimationFrame(() => document.getElementById(drilledTicker ? 'stock-analysis' : 'overview')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }

  function toggleValuation(ticker?: string) {
    const target = ticker || valuationTicker;
    if (valuationOpen && target === valuationTicker) {
      closeValuation();
      return;
    }
    openValuation(target);
  }

  function selectAllocationItem(item: { label: string; members: string[] }) {
    setAllocationPinnedLabel(item.label);
    if (item.members.length === 1) {
      openTickerDetails(item.members[0]);
      return;
    }
    setAllocationGroupSelection({ label: item.label, members: item.members });
    setDrilledTicker(null);
    setQuery('');
    setFilter('all');
    setPositionView('visual');
    setTechnicalData(null);
    setTechnicalLoading(false);
    setTechnicalError('');
    window.requestAnimationFrame(() => document.getElementById('positions')?.scrollIntoView({ behavior: 'auto', block: 'start' }));
  }

  const marketOpen = (() => {
    const timestamp = Date.now();
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(timestamp));
    const day = parts.find((part) => part.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const clock = hour * 60 + minute;
    const easternDate = zonedDate(timestamp, 'America/New_York');
    const holiday = usMarketHolidays(easternDate.year).has(zonedDateKey(easternDate));
    return !holiday && !['Sat', 'Sun'].includes(day) && clock >= 570 && clock < 960;
  })();
  const contentGridStyle = useMemo(() => ({ '--return-panel-ratio': `${panelRatio}%` }) as CSSProperties, [panelRatio]);
  const imageBackgroundActive = backgroundMode === 'image' && Boolean(backgroundImage);
  const shellStyle = useMemo(() => imageBackgroundActive ? { '--custom-background': `url("${backgroundImage}")` } as CSSProperties : undefined, [backgroundImage, imageBackgroundActive]);
  const selectedStockTrades = useMemo(() => drilledTicker ? trades.filter((trade) => trade.ticker === drilledTicker && (trade.type === 'SDI' || trade.event === 'STOCK')) : [], [drilledTicker, trades]);

  return (
    <main
      className={`shell ${imageBackgroundActive ? 'has-custom-background' : ''}`}
      id="top"
      style={shellStyle}
      onFocusCapture={(event) => selectZeroNumberInput(event.target)}
      onClickCapture={(event) => selectZeroNumberInput(event.target)}
    >
      <header className="topbar">
        <div className="brand-cluster">
          <a className="brand" href="#top" aria-label="OptionFlow 首頁">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/optionflow-logo.jpg" alt="" width="52" height="52" />
            <span>OPTIONFLOW</span>
          </a>
          <HeaderMarketCalendar />
        </div>
        <div className="header-actions">
          <LanguageSwitcher />
          <span className={`market-pill ${marketOpen ? 'is-open' : ''}`}><span />{marketOpen ? '美股交易中' : '非交易時段'}</span>
          <button className="secondary-button" type="button" onClick={() => refreshQuotes()} disabled={refreshing}>{refreshing ? '更新中…' : '↻ 更新報價'}</button>
          <button className="primary-button" type="button" onClick={() => setEditor(blankTrade())}>＋新增交易</button>
        </div>
      </header>

      <div className="page-frame">
        <nav className="side-nav" aria-label="頁面切換">
          <button type="button" className={`settings-nav-button ${settingsOpen ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><i>⚙</i><span>設定</span></button>
          {([['overview', '總覽', '⌂'], ['positions', '持倉', '▦'], ['returns', '收益', '⌁']] as const).map(([section, label, icon]) => <a key={section} href={`#${section}`} className={activeSection === section ? 'active' : ''} aria-current={activeSection === section ? 'page' : undefined} onClick={(event) => { event.preventDefault(); setActiveSection(section); window.history.replaceState(null, '', `#${section}`); document.getElementById(section)?.scrollIntoView({ behavior: 'auto', block: 'start' }); }}><i>{icon}</i><span>{label}</span></a>)}
          <button type="button" className={`settings-nav-button ${activeSection === 'valuation' ? 'active' : ''}`} aria-current={activeSection === 'valuation' ? 'page' : undefined} onClick={() => openValuation(drilledTicker ?? valuationTicker)}><i>◇</i><span>估值</span></button>
          <div className="background-control">
            <button type="button" className="background-trigger" disabled={backgroundSaving} onClick={() => backgroundInputRef.current?.click()} title={backgroundSaving ? '正在永久保存背景圖片' : backgroundImage ? '更換背景圖片' : '加入背景圖片'}><i>{backgroundSaving ? '◌' : '▧'}</i><span>{backgroundSaving ? '保存中' : backgroundImage ? '換圖片' : '背景'}</span></button>
            {backgroundImage && <div className="background-mode-switch" aria-label="背景顯示方式"><button type="button" disabled={backgroundSaving} className={backgroundMode === 'default' ? 'active' : ''} aria-pressed={backgroundMode === 'default'} onClick={() => switchBackgroundMode('default')}>原始</button><button type="button" disabled={backgroundSaving} className={backgroundMode === 'image' ? 'active' : ''} aria-pressed={backgroundMode === 'image'} onClick={() => switchBackgroundMode('image')}>圖片</button></div>}
            <input ref={backgroundInputRef} className="visually-hidden" type="file" accept="image/*" disabled={backgroundSaving} onChange={handleBackgroundUpload} />
          </div>
        </nav>
        <div className="dashboard">
        <section className="hero" id="overview">
          <div><EditableHeroTitle onNotify={notify} /></div>
          <LiveMarketClocks lastQuoteAt={lastQuoteAt} />
        </section>

        <section className="metric-grid" aria-label="投資組合摘要">
          <article className="metric-card featured"><p>追蹤市值</p><strong>{loading ? '—' : money.format(trackedValue)}</strong><span>{openTrades.length} 筆未平倉持倉</span></article>
          <article className="metric-card"><p>未實現損益</p><strong className={openPnl >= 0 ? 'positive' : 'negative'}>{loading ? '—' : money.format(openPnl)}</strong><span className={`metric-return ${openReturnOnCapital === null ? '' : openReturnOnCapital >= 0 ? 'positive' : 'negative'}`}>{loading ? '計算中…' : openReturnOnCapital === null ? 'ROIC —' : `ROIC ${openReturnOnCapital >= 0 ? '+' : ''}${percent.format(openReturnOnCapital)}`}</span></article>
          <article className="metric-card"><p>擔保／投入資本</p><strong>{loading ? '—' : money.format(capitalAtRisk)}</strong><span>股票採買入成本；賣方選擇權採擔保金</span></article>
          <article className="metric-card" title="本年度已實現損益 ÷ 資金占用年數（投入資本 × 持有天數 ÷ 365）"><p>本年度加權年化 ROC</p><strong className={annualRocSummary.value === null ? '' : annualRocSummary.value >= 0 ? 'positive' : 'negative'}>{loading || annualRocSummary.value === null ? '—' : percent.format(annualRocSummary.value)}</strong><span>{currentRocYear} · {annualRocSummary.count} 筆有效平倉交易</span></article>
        </section>

        {brokerHubEnabled && <Suspense fallback={<section className="broker-hub-loader" id="broker-hub" aria-busy="true"><span /><strong>正在開啟跨券商資產中樞…</strong></section>}>
          <BrokerHub initialWorkspace={brokerWorkspaceSeed} usdJpyRate={usdJpyRate} usdJpyEstimated={usdJpyEstimated} usdJpyUpdatedAt={usdJpyEstimated ? null : usdJpyUpdatedAt} onNotify={notify} />
        </Suspense>}

        <section ref={contentGridRef} className={`content-grid ${resizingPanels ? 'is-resizing' : ''}`} style={contentGridStyle}>
          <article className="panel return-panel" id="returns" aria-busy={benchmarkLoading}>
            <div className="panel-heading">
              <div><p className="eyebrow">Return analytics</p><h2>{rangeModeLabel}收益率</h2></div>
              <div className="segmented" role="group" aria-label="收益率期間">
                {([['day', '日'], ['week', '週'], ['month', '月'], ['year', '年']] as const).map(([mode, label]) => <button type="button" key={mode} className={rangeMode === mode ? 'selected' : ''} aria-pressed={rangeMode === mode} onClick={() => setRangeMode(mode)}>{label}</button>)}
              </div>
            </div>
            <div className="return-summary"><strong>{percent.format(returnSeries.at(-1)?.value ?? 0)}</strong><span>最近一期報酬率</span><div className="benchmark-legend"><span><i className="portfolio-key" />我的組合</span><span><i className="spy-key" />SPY</span><span><i className="boxx-key" />BOXX</span></div></div>
            <div className="chart-shell">
              {chartTicks.map((tick) => <span key={`label-${tick.toFixed(4)}`} className="axis-label" style={{ top: `${chartY(tick)}%` }}>{tick > 0 ? '+' : ''}{Math.round(tick * 100)}%</span>)}
              <svg className="return-chart" viewBox="0 0 100 100" role="img" aria-label="日週月年收益率折線圖" preserveAspectRatio="none">
                <defs><linearGradient id="returnFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2f73ed" stopOpacity=".24"/><stop offset="100%" stopColor="#2f73ed" stopOpacity="0"/></linearGradient></defs>
                {chartTicks.map((tick) => <line key={`grid-${tick.toFixed(4)}`} x1="0" x2="100" y1={chartY(tick)} y2={chartY(tick)} className={Math.abs(tick) < .0001 ? 'zero-line' : 'chart-grid-line'} />)}
                {chartPoints && <><polygon points={`0,${chartY(0)} ${chartPoints} 100,${chartY(0)}`} fill="url(#returnFade)" /><polyline points={chartPoints} className="return-line portfolio-line" /></>}
                {spyPoints && <polyline points={spyPoints} className="return-line spy-line" />}
                {boxxPoints && <polyline points={boxxPoints} className="return-line boxx-line" />}
              </svg>
              <div className="return-markers" aria-hidden="true">{returnSeries.map((item, index) => {
                const x = returnSeries.length === 1 ? 50 : (index / (returnSeries.length - 1)) * 100;
                const y = chartY(item.value);
                return <span key={item.key} className={item.value >= 0 ? 'point-positive' : 'point-negative'} style={{ left: `${x}%`, top: `${y}%` }} title={`${item.label}: ${percent.format(item.value)}`} />;
              })}</div>
              {activeReturnHoverIndex !== null && (() => {
                const item = returnSeries[activeReturnHoverIndex];
                const x = returnSeries.length === 1 ? 50 : activeReturnHoverIndex / (returnSeries.length - 1) * 100;
                const spyValue = activeBenchmarks.SPY[activeReturnHoverIndex] ?? 0;
                const boxxValue = activeBenchmarks.BOXX[activeReturnHoverIndex] ?? 0;
                return <><span className="return-hover-line" style={{ left: `${x}%` }} aria-hidden="true" /><div className={`return-chart-tooltip ${x < 18 ? 'align-left' : x > 82 ? 'align-right' : ''}`} style={{ left: `${x}%` }} role="status"><strong>{item.label}</strong><span><i className="portfolio-key" />我的組合 <b>{signedPrecisePercent(item.value)}</b></span><span><i className="spy-key" />SPY <b>{signedPrecisePercent(spyValue)}</b></span><span><i className="boxx-key" />BOXX <b>{signedPrecisePercent(boxxValue)}</b></span></div></>;
              })()}
              <div className="return-hover-zones" onMouseLeave={() => setReturnHoverIndex(null)}>{returnSeries.map((item, index) => {
                const pointX = returnSeries.length === 1 ? 50 : index / (returnSeries.length - 1) * 100;
                const previousX = index === 0 ? 0 : (index - 1) / (returnSeries.length - 1) * 100;
                const nextX = index === returnSeries.length - 1 ? 100 : (index + 1) / (returnSeries.length - 1) * 100;
                const left = index === 0 ? 0 : (previousX + pointX) / 2;
                const right = index === returnSeries.length - 1 ? 100 : (pointX + nextX) / 2;
                return <button type="button" key={`hover-${item.key}`} style={{ left: `${left}%`, width: `${right - left}%` }} aria-label={`${item.label}：我的組合 ${signedPrecisePercent(item.value)}，SPY ${signedPrecisePercent(activeBenchmarks.SPY[index] ?? 0)}，BOXX ${signedPrecisePercent(activeBenchmarks.BOXX[index] ?? 0)}`} onMouseEnter={() => setReturnHoverIndex(index)} onFocus={() => setReturnHoverIndex(index)} onBlur={() => setReturnHoverIndex(null)} onClick={() => setReturnHoverIndex(index)} />;
              })}</div>
            </div>
            <div className="chart-dates">{returnSeries.map((item, index) => <span key={item.key} className={index !== 0 && index !== returnSeries.length - 1 && index % chartDateStep !== 0 ? 'hide-small-label' : ''}>{item.label}</span>)}</div>
            <section className="macro-market-section" aria-labelledby="macro-market-title">
              <div className="macro-market-heading"><div><p className="eyebrow">Macro price monitor</p><h3 id="macro-market-title">{macroMarketGroup === 'rates' ? '匯率與美債殖利率' : '黃金與原油期貨'}</h3></div><div className="macro-market-actions"><button type="button" className="macro-deck-toggle" onClick={() => showMacroMarketGroup(macroMarketGroup === 'rates' ? 'commodities' : 'rates', macroMarketGroup === 'rates' ? 'up' : 'down')} aria-label={macroMarketGroup === 'rates' ? '向上切換至黃金與原油期貨' : '向下切換至匯率與美債殖利率'}><span aria-hidden="true">{macroMarketGroup === 'rates' ? '↑' : '↓'}</span><b>{macroMarketGroup === 'rates' ? '黃金／原油' : '美元／美債'}</b><i aria-hidden="true"><em className={macroMarketGroup === 'rates' ? 'active' : ''} /><em className={macroMarketGroup === 'commodities' ? 'active' : ''} /></i></button><div className="segmented macro-range-switch" role="group" aria-label="宏觀歷史期間">{([['day', '日'], ['week', '週'], ['month', '月'], ['year', '年']] as const).map(([mode, label]) => <button type="button" key={mode} className={macroRangeMode === mode ? 'selected' : ''} aria-pressed={macroRangeMode === mode} onClick={() => setMacroRangeMode(mode)}>{label}</button>)}</div><button type="button" className="macro-refresh-button" disabled={macroLoading} onClick={() => { macroRefreshRequestedRef.current = true; setMacroRefreshKey((current) => current + 1); }}>↻ 更新</button><span>美東 {macroUpdatedLabel} · 每 60 秒</span></div></div>
              {macroError && <p className="macro-market-error" role="status">{macroError}</p>}
              <div className={`macro-market-deck deck-${macroDeckDirection}`} onPointerDown={(event) => { if (event.pointerType === 'mouse' && event.button !== 0) return; macroDeckSwipeStartRef.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => { const start = macroDeckSwipeStartRef.current; macroDeckSwipeStartRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (start === null) return; const distance = event.clientY - start; if (distance < -34 && macroMarketGroup === 'rates') showMacroMarketGroup('commodities', 'up'); if (distance > 34 && macroMarketGroup === 'commodities') showMacroMarketGroup('rates', 'down'); }} onPointerCancel={() => { macroDeckSwipeStartRef.current = null; }}>
                <div key={`${macroMarketGroup}-${macroRangeMode}`} className={`macro-market-grid group-${macroMarketGroup} ${macroLoading ? 'is-loading' : ''}`} aria-busy={macroLoading}>
                  {activeMacroMarkets.map((market) => <MacroMarketCard key={market.id} market={market} startLabel={macroTimeline[0]?.label ?? ''} endLabel={macroTimeline.at(-1)?.label ?? ''} rangeLabel={macroRangeModeLabel} />)}
                  {!activeMacroMarkets.length && Array.from({ length: macroMarketGroup === 'rates' ? 3 : 2 }, (_, item) => <article className="macro-market-card macro-market-placeholder" key={item}><span /><b /><i /></article>)}
                </div>
              </div>
              <p className="macro-market-note">{macroMarketGroup === 'rates' ? '美元／日圓顯示至小數點後 2 位；美國 10 年與 30 年公債顯示殖利率、變動點數與漲跌幅。' : '黃金與 WTI 原油採連續近月期貨價格；上下滑動卡片或使用推疊按鈕即可返回匯率與美債。'}</p>
            </section>
          </article>

          <div
            className="panel-resizer"
            role="separator"
            aria-label="調整收益圖與持倉配置寬度"
            aria-orientation="vertical"
            aria-valuemin={46}
            aria-valuemax={72}
            aria-valuenow={Math.round(panelRatio)}
            tabIndex={0}
            onPointerDown={(event) => { event.preventDefault(); setResizingPanels(true); }}
            onDoubleClick={() => {
              panelRatioRef.current = 60;
              setPanelRatio(60);
              window.localStorage.setItem(panelRatioKey, '60');
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); adjustPanelRatio(-2); }
              if (event.key === 'ArrowRight') { event.preventDefault(); adjustPanelRatio(2); }
              if (event.key === 'Home') { event.preventDefault(); adjustPanelRatio(46 - panelRatioRef.current); }
              if (event.key === 'End') { event.preventDefault(); adjustPanelRatio(72 - panelRatioRef.current); }
            }}
          ><span /></div>

          <article className="panel allocation-panel">
            <div className="panel-heading"><div><p className="eyebrow">Holdings</p><h2>持倉配置</h2></div><div className="allocation-heading-actions"><div className="allocation-chart-switch" role="group" aria-label="持倉配置圖表類型"><button type="button" className={allocationChartMode === 'donut' ? 'active' : ''} aria-pressed={allocationChartMode === 'donut'} onClick={() => setAllocationChartMode('donut')}>圓餅圖</button><button type="button" className={allocationChartMode === 'bars' ? 'active' : ''} aria-pressed={allocationChartMode === 'bars'} onClick={() => setAllocationChartMode('bars')}>長條圖</button></div><span className="count-badge">{allocationSnapshot.tradeCount} positions</span></div></div>
            <div className="allocation-history-controls" aria-label="持倉配置歷史日期">
              <div>{allocationPresets.map((preset) => <button key={preset.label} className={allocationDate === preset.date ? 'active' : ''} onClick={() => selectAllocationDate(preset.date)}>{preset.label}</button>)}</div>
              <label><span>歷史日期</span><input type="date" min={earliestAllocationDate} max={currentAllocationDate} value={allocationDate} onChange={(event) => selectAllocationDate(event.target.value || currentAllocationDate)} /></label>
            </div>
            {allocationChartMode === 'donut' ? <div className="allocation-content">
              <AllocationDonut items={allocation} total={allocationSnapshot.total} loading={allocationLoading} activeLabel={activeAllocationItem?.label ?? null} onHover={setAllocationHoveredLabel} onPin={setAllocationPinnedLabel} onSelect={selectAllocationItem} />
              <div className="legend">
                {allocationLoading && <p className="allocation-empty">正在讀取歷史持倉…</p>}
                {!allocationLoading && !allocation.length && <p className="allocation-empty">這個日期沒有持倉紀錄</p>}
                {!allocationLoading && allocation.map((item) => <button type="button" className={`allocation-legend-item ${activeAllocationItem?.label === item.label ? 'is-selected is-active' : ''}`} key={item.label} aria-pressed={activeAllocationItem?.label === item.label} onMouseEnter={() => setAllocationHoveredLabel(item.label)} onMouseLeave={() => setAllocationHoveredLabel(null)} onFocus={() => setAllocationHoveredLabel(item.label)} onBlur={() => setAllocationHoveredLabel(null)} onClick={() => selectAllocationItem(item)} aria-label={`查看 ${item.label}，${money.format(item.value)}，占 ${percent.format(item.share)}`}><i style={{ background: item.color }} /><span>{item.label}</span><b>{money.format(item.value)}</b><strong>{percent.format(item.share)}</strong></button>)}
              </div>
            </div> : <div className={`allocation-bars ${allocationLoading ? 'is-loading' : ''}`} role="list" aria-busy={allocationLoading} aria-label={`${allocationDate} 按標的計算的持倉長條圖`}>
              {allocationLoading && <p className="allocation-empty" role="status">正在讀取歷史持倉…</p>}
              {!allocationLoading && !allocation.length && <p className="allocation-empty">這個日期沒有持倉紀錄</p>}
              {!allocationLoading && allocation.map((item) => <button type="button" className={`allocation-bar-row ${(drilledTicker === item.label || allocationGroupSelection?.label === item.label) ? 'is-selected' : ''}`} role="listitem" key={item.label} onClick={() => selectAllocationItem(item)} aria-label={`查看 ${item.label}，${money.format(item.value)}，占 ${percent.format(item.share)}`}><div><span><i style={{ background: item.color }} />{item.label}</span><b>{money.format(item.value)}</b><strong>{percent.format(item.share)}</strong></div><span className="allocation-bar-track" aria-hidden="true"><i style={{ width: `${item.share > 0 ? Math.max(1.5, Math.min(100, item.share * 100)) : 0}%`, background: item.color }} /></span></button>)}
            </div>}
            <p className="panel-note">{allocationDate === currentAllocationDate
              ? '股票按目前價格、選擇權按擔保金、現金按原幣餘額計算；日圓部位會換算為 USD。'
              : `股票使用所選日期以前最近一個交易日的收盤價，選擇權按當時擔保金、現金按當時餘額計算${allocationSnapshot.estimatedTickers.length ? `；${allocationSnapshot.estimatedTickers.join('、')} 因缺少歷史報價而以成交價估算` : ''}。`}</p>
          </article>
        </section>

        {drilledTicker && <StockTechnicalPanel
          key={drilledTicker}
          symbol={drilledTicker}
          range={technicalRange}
          customFrom={technicalCustomFrom}
          customTo={technicalCustomTo}
          data={technicalData}
          loading={technicalLoading}
          error={technicalError}
          stockTrades={selectedStockTrades}
          lotSavingId={lotSavingId}
          valuationOpen={valuationOpen && valuationTicker === drilledTicker}
          onRangeChange={selectTechnicalRange}
          onCustomRangeApply={applyTechnicalCustomRange}
          onClose={returnToPositionsOverview}
          onOpenDcf={() => toggleValuation(drilledTicker)}
          onAddLot={() => setEditor({ ...blankTrade(), type: 'SDI', ticker: drilledTicker, event: 'STOCK', quoteMode: 'auto' })}
          onSaveLot={saveStockLot}
          onEditLot={(trade) => setEditor({ ...trade })}
          onDeleteLot={(trade) => setDeleteCandidate(trade)}
        />}

        {valuationOpen && <Suspense fallback={<section className="broker-hub-loader" id="valuation" aria-busy="true"><span /><strong>正在開啟 DCF 估值工作區…</strong></section>}><DcfCalculator key={valuationTicker} initialTicker={valuationTicker} onClose={closeValuation} /></Suspense>}

        <section className="panel positions-panel" id="positions">
          <div className="positions-toolbar">
            <div><p className="eyebrow">Active book</p><h2>交易與持倉</h2></div>
            <div className="toolbar-actions"><div className="view-switch" aria-label="持倉顯示方式"><button className={positionView === 'visual' ? 'active' : ''} onClick={() => (drilledTicker || allocationGroupSelection) ? returnToPositionsOverview() : setPositionView('visual')}>圖形持倉</button><button className={positionView === 'details' ? 'active' : ''} onClick={() => setPositionView('details')}>交易明細</button></div><label className="search"><span>⌕</span><input value={query} onChange={(event) => { setAllocationGroupSelection(null); setQuery(event.target.value); }} placeholder="搜尋 ticker、策略或備註" aria-label="搜尋交易" /></label><button className="primary-button" onClick={() => setEditor(blankTrade())}>＋新增</button></div>
          </div>
          {drilledTicker && <div className="drilldown-bar"><button type="button" onClick={returnToPositionsOverview}>← 返回持倉總覽</button><span>正在查看 <strong>{drilledTicker}</strong> 的 {filteredTrades.length} 筆交易紀錄</span></div>}
          {allocationGroupSelection && !drilledTicker && <div className="drilldown-bar"><button type="button" onClick={returnToPositionsOverview}>← 返回持倉總覽</button><span>持倉配置已選擇 <strong>{allocationGroupSelection.label}</strong>：{allocationGroupSelection.members.join('、')}</span></div>}
          <div className="filter-row">{([['open', '未平倉'], ['closed', '已平倉'], ['options', '選擇權'], ['stock', '股票'], ['cash', '現金'], ['all', '全部']] as const).map(([mode, label]) => <button key={mode} className={filter === mode ? 'active' : ''} onClick={() => setFilter(mode)}>{label}<span>{mode === 'all' ? portfolioTrades.length : mode === 'open' ? openTrades.length : mode === 'closed' ? closedTrades.length : portfolioTrades.filter((trade) => mode === 'stock' ? trade.type === 'SDI' : mode === 'cash' ? isCashTrade(trade) : trade.type !== 'SDI' && !isCashTrade(trade)).length}</span></button>)}</div>
          {positionView === 'visual' ? <div className="visual-positions">
            <div className="visual-head"><span>#</span><span>標的／公司</span><span>持倉市值</span><span>成本均價／現價</span><span>標的價格波動／今日漲跌</span><span>損益／報酬率</span><span>組合占比</span></div>
            {!loading && !visualPositions.length && <div className="visual-empty">沒有符合目前篩選條件的持倉。</div>}
            {loading && <div className="visual-empty">正在整理圖形化持倉…</div>}
            {!loading && visualPositions.map((position, index) => {
              const cashPosition = position.items.every((item) => isCashTrade(item.trade));
              const openPositionItems = position.items.filter((item) => item.trade.status === 'open');
              const autoPosition = !cashPosition && openPositionItems.some((item) => item.trade.type === 'SDI' && item.trade.quoteMode === 'auto');
              const snapshot = marketSnapshots[position.ticker];
              const regularDisplayPrice = snapshot?.session === 'regular' ? snapshot.price : snapshot?.regularPrice ?? position.currentPrice;
              const extendedSession = snapshot?.session === 'pre' || snapshot?.session === 'post' ? snapshot.session : null;
              const extendedDisplayPrice = extendedSession ? snapshot?.extendedPrice ?? null : null;
              const marketDisplayPrice = extendedDisplayPrice ?? snapshot?.regularPrice ?? position.currentPrice;
              const marketChange = extendedSession ? snapshot?.extendedChange ?? null : snapshot?.regularChange ?? null;
              const marketChangePercent = extendedSession ? snapshot?.extendedChangePercent ?? null : snapshot?.regularChangePercent ?? null;
              const currentPriceLabel = extendedSession ? '正常收盤' : '目前價格';
              const marketMoveLabel = extendedSession === 'pre' ? '盤前漲跌' : extendedSession === 'post' ? '盤後漲跌' : '標的今日漲跌';
              const rowAllocation = allocationDate === currentAllocationDate ? allocation.find((item) => item.members.includes(position.ticker)) : null;
              const allocationLinked = Boolean(rowAllocation && activeAllocationItem?.label === rowAllocation.label);
              const quantityParts = [position.stockQuantity > 0 ? `${quantityNumber.format(position.stockQuantity)} 股` : '', position.optionQuantity > 0 ? `${quantityNumber.format(position.optionQuantity)} 口` : ''].filter(Boolean);
              const positionStatus = cashPosition
                ? position.items.some((item) => item.trade.derived) ? '股息自動入帳' : '現金餘額'
                : autoPosition ? snapshot ? `API · ${quoteSessionLabel(snapshot.session)}` : failedQuoteTickers.has(position.ticker) ? 'API 無法取得' : 'API 待更新'
                  : position.items.some((item) => item.trade.type === 'SDI') ? '手動價格' : '權利金手動';
              const positionStatusClass = cashPosition ? 'cash' : autoPosition ? snapshot ? 'live' : failedQuoteTickers.has(position.ticker) ? 'error' : 'pending' : 'manual';
              return <article className={`visual-position-row ${allocationLinked ? 'is-allocation-linked' : ''}`} key={position.ticker} onMouseEnter={() => rowAllocation && setAllocationHoveredLabel(rowAllocation.label)} onMouseLeave={() => rowAllocation && setAllocationHoveredLabel(null)} onFocus={() => rowAllocation && setAllocationHoveredLabel(rowAllocation.label)} onBlur={() => rowAllocation && setAllocationHoveredLabel(null)}>
                <span className="position-rank">{String(index + 1).padStart(2, '0')}</span>
                {cashPosition ? <div className="visual-asset"><CompanyLogo ticker={position.ticker} /><span className="visual-asset-copy"><strong>{position.ticker}</strong><span>{position.company}</span><small>{position.items.length} 筆 · 持倉數量 {nativeMoney(position.ticker, position.cashQuantity)}</small><em className={`position-data-status ${positionStatusClass}`}><i />{positionStatus}</em></span></div> : <button type="button" className="visual-asset visual-asset-button" onClick={() => openTickerDetails(position.ticker)}><CompanyLogo ticker={position.ticker} /><span className="visual-asset-copy"><strong>{position.ticker}</strong><span>{position.company}</span><small>{position.items.length} 筆 · 持倉數量 {quantityParts.join(' · ') || '0'} · {position.strategy}</small><em className={`position-data-status ${positionStatusClass}`}><i />{positionStatus}</em></span></button>}
                <div className="visual-value"><span>持倉市值</span><strong>{money.format(position.marketValue)}</strong></div>
                {cashPosition ? <div className="visual-price-flow cash-price-flow"><div><span>原幣現金</span><strong>{nativeMoney(position.ticker, position.cashQuantity)}</strong></div><div><span>組合換算</span><strong>{money.format(position.marketValue)}</strong></div></div> : <div className="visual-price-flow"><div><span>{position.items.every((item) => item.trade.type === 'SDI' || item.trade.event === 'STOCK') ? '股票均價' : '成交均價'}</span><strong>{nativeMoney(position.ticker, position.entryPrice)}</strong></div><div><span>{currentPriceLabel}</span><strong>{nativeMoney(position.ticker, regularDisplayPrice)}</strong>{extendedDisplayPrice !== null && <small className={`after-hours-price ${extendedDisplayPrice >= regularDisplayPrice ? 'is-up' : 'is-down'}`}><em>{extendedSession === 'pre' ? '盤前' : '盤後'}</em>{nativeMoney(position.ticker, extendedDisplayPrice)}</small>}</div></div>}
                {cashPosition ? <div className="visual-market-move neutral cash-market-move"><span className="cash-balance-icon">◎</span><div><span>資料來源</span><strong>不需報價</strong><small>{position.items.some((item) => item.trade.derived) ? '含稅後股息自動現金' : '手動現金餘額'}</small></div></div> : <div className={`visual-market-move ${marketChangePercent === null ? 'neutral' : marketChangePercent >= 0 ? 'positive' : 'negative'}`}><PriceSparkline ticker={position.ticker} values={snapshot?.sparkline ?? []} changePercent={marketChangePercent} /><div><span>{marketMoveLabel}</span><strong>{marketChangePercent === null ? '等待報價' : `${marketChangePercent >= 0 ? '+' : ''}${precisePercent.format(marketChangePercent)}`}</strong><small>{marketChange === null ? '—' : `${nativeMoney(position.ticker, marketDisplayPrice)} · ${marketChange >= 0 ? '+' : ''}${nativeMoney(position.ticker, marketChange)}`}</small></div></div>}
                <div className={`visual-gain ${cashPosition ? 'neutral' : position.pnl >= 0 ? 'positive' : 'negative'}`}><strong>{cashPosition ? money.format(0) : `${position.pnl >= 0 ? '+' : ''}${money.format(position.pnl)}`}</strong><span>{cashPosition ? '現金部位' : `${position.roc >= 0 ? '▲' : '▼'} ${percent.format(Math.abs(position.roc))}`}</span></div>
                <div className="visual-weight"><div><span>組合占比</span><strong>{percent.format(position.share)}</strong></div><b><i style={{ width: `${Math.max(2, Math.min(100, position.share * 100))}%` }} /></b></div>
              </article>;
            })}
          </div> : <div className="table-wrap">
            <table>
              <thead><tr><th>標的</th><th>交易／策略</th><th>開倉／到期</th><th>履約價</th><th>數量</th><th>買入／成交價</th><th>目前價格</th><th>損益</th><th>ROC</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="empty-state">正在載入你的交易紀錄…</td></tr>}
                {!loading && !filteredTrades.length && <tr><td colSpan={11} className="empty-state">沒有符合目前篩選條件的交易。</td></tr>}
                {filteredTrades.map(({ trade, pnl, roc }) => {
                  const dividendSource = trade.event === 'DIVIDEND' ? trade.dividendSourceTicker : null;
                  return <tr key={trade.id}>
                  <td>{dividendSource ? <span className="symbol-cell dividend-source-cell"><CompanyLogo ticker={dividendSource} compact /><span><strong>{dividendSource}</strong><small>{companyNames[dividendSource] ?? (isJapaneseTicker(dividendSource) ? '日本股票' : '股息發放公司')}</small></span></span> : isCashTrade(trade) ? <span className="symbol-cell"><CompanyLogo ticker={trade.ticker || 'USD'} compact /><strong>{trade.ticker || 'USD'}</strong></span> : <button type="button" className="symbol-cell symbol-cell-button" onClick={() => trade.ticker && openTickerDetails(trade.ticker)}><CompanyLogo ticker={trade.ticker || 'OTHER'} compact /><strong>{trade.ticker || '—'}</strong></button>}</td>
                  <td><strong className="strategy-name">{trade.event}</strong><span className="subtle">{dividendSource ? `${dividendSource} 發放 · 稅後入帳 ${trade.ticker}` : trade.derived ? '自動股息現金' : trade.type === 'CASH' ? 'Cash' : trade.type === 'SDI' ? 'Stock' : trade.type}</span></td>
                  <td><strong>{dateLabel(trade.openDate)}</strong><span className="subtle">Exp {dateLabel(trade.expiryDate)}</span></td>
                  <td>{trade.strike || '—'}</td><td>{isCashTrade(trade) ? nativeMoney(trade.ticker, trade.quantity) : trade.quantity}</td><td>{isCashTrade(trade) ? '—' : nativeMoney(trade.ticker, trade.entryPrice)}</td>
                  <td>{isCashTrade(trade) ? <span className="cash-table-status"><i />不需報價</span> : priceEditId === trade.id ? <div className="inline-price"><span>{isJapaneseTicker(trade.ticker) ? '¥' : '$'}</span><input autoFocus inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveInlinePrice(trade); if (event.key === 'Escape') setPriceEditId(null); }} /><button onClick={() => saveInlinePrice(trade)}>✓</button></div> : <button className="price-button" onClick={() => { setPriceEditId(trade.id); setPriceInput(String(trade.currentPrice ?? '')); }}><span className={trade.quoteMode === 'auto' ? 'live-dot' : 'manual-dot'} />{trade.currentPrice === null ? '設定' : nativeMoney(trade.ticker, trade.currentPrice)} <i>✎</i></button>}</td>
                  <td className={pnl >= 0 ? 'positive' : 'negative'}><strong>{money.format(pnl)}</strong></td>
                  <td className={roc >= 0 ? 'positive' : 'negative'}>{percent.format(roc)}</td>
                  <td><span className={`status ${trade.status}`}><i />{trade.status === 'open' ? '未平倉' : '已平倉'}</span></td>
                  <td>{trade.derived ? <span className="row-actions"><button className="row-action-button" onClick={() => openDividendAdjustment(trade)} aria-label={`調減 ${trade.dividendSourceTicker ?? '股息'}`}>調減</button><button className="row-action-button delete" onClick={() => setDeleteCandidate(trade)} aria-label={`刪除 ${trade.dividendSourceTicker ?? '股息'}`}>刪除</button></span> : <span className="row-actions"><button className="row-action-button" onClick={() => setEditor({ ...trade })} aria-label={`編輯 ${trade.ticker ?? '交易'}`}>編輯</button><button className="row-action-button delete" onClick={() => setDeleteCandidate(trade)} aria-label={`刪除 ${trade.ticker ?? '交易'}`}>刪除</button></span>}</td>
                </tr>})}
              </tbody>
            </table>
          </div>}
          <footer className="table-footer"><span><i className="live-dot" />股票 API 報價</span><span><i className="manual-dot" />手動價格</span><span><i className="cash-dot" />現金／稅後股息</span><p>現金不呼叫股票報價；股息依持有期間、除息事件與設定的外國投資人預扣稅率試算。</p></footer>
        </section>
        </div>
      </div>

      {settingsOpen && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><div><p className="eyebrow">Workspace controls</p><h2 id="settings-title">設定</h2><span>選擇要啟用的擴充工作區。</span></div><button type="button" className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="關閉設定">×</button></header>
          <div className="settings-body">
            <section className={`settings-feature-card ${brokerHubEnabled ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon" aria-hidden="true">◎</span><div><p>Optional module</p><h3>跨券商資產追蹤與再平衡</h3></div><span className="settings-feature-status">{brokerHubLoading ? '讀取中' : brokerHubEnabled ? '已開啟' : '預設關閉'}</span></div>
              <p>把不同券商的手動部位聚合成單一全景，提供 USD／JPY 平抑檢視、偏離診斷、只買不賣試算與跨券商待辦清單。</p>
              <div className="settings-feature-actions">
                <span>關閉時不載入資料、不啟動額外計算；再次開啟時會保留原資料。</span>
                <button type="button" className={`settings-toggle ${brokerHubEnabled ? 'is-on' : ''}`} role="switch" aria-checked={brokerHubEnabled} disabled={brokerHubLoading || brokerHubToggleSaving} onClick={toggleBrokerHub}><i /><b>{brokerHubToggleSaving ? '保存中…' : brokerHubEnabled ? '開啟' : '關閉'}</b></button>
              </div>
              {brokerHubEnabled && <button type="button" className="settings-open-workspace" onClick={openBrokerHub}>前往跨券商工作區</button>}
            </section>
            <section className={`settings-feature-card dividend-settings-card ${dividendSettings.enabled ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon dividend" aria-hidden="true">$</span><div><p>Cash automation</p><h3>外國投資人股息稅與現金入帳</h3></div><span className="settings-feature-status">{dividendLoading ? '計算中' : dividendSettings.enabled ? '已開啟' : '已關閉'}</span></div>
              <p>依美股與日股持倉在除息事件日的股數，分別計算稅後股息並自動加入 USD／JPY 現金。稅率可依券商、稅務身分或租稅協定自行調整。</p>
              <div className="dividend-tax-grid">
                <label><span>美股外國人股息預扣稅率</span><div><input type="number" min="0" max="100" step="0.001" value={dividendSettings.usTaxRate} onChange={(event) => setDividendSettings((current) => ({ ...current, usTaxRate: Math.min(100, Math.max(0, Number(event.target.value))) }))} /><i>%</i></div><small>暫定 30%，可依適用協定修改</small></label>
                <label><span>日股外國人股息預扣稅率</span><div><input type="number" min="0" max="100" step="0.001" value={dividendSettings.jpTaxRate} onChange={(event) => setDividendSettings((current) => ({ ...current, jpTaxRate: Math.min(100, Math.max(0, Number(event.target.value))) }))} /><i>%</i></div><small>上市股票預設 15.315%，可自行修改</small></label>
              </div>
              <div className="dividend-cash-preview"><div><span>USD 稅後股息現金</span><strong>{money.format(dividendCash.USD.net)}</strong><small>{dividendCash.USD.count} 筆事件 · 預扣 {money.format(dividendCash.USD.tax)}{dividendCash.USD.adjustment > 0 ? ` · 手動調減 ${money.format(dividendCash.USD.adjustment)}` : ''}</small></div><div><span>JPY 稅後股息現金</span><strong>{yenMoney.format(dividendCash.JPY.net)}</strong><small>{dividendCash.JPY.count} 筆事件 · 預扣 {yenMoney.format(dividendCash.JPY.tax)}{dividendCash.JPY.adjustment > 0 ? ` · 手動調減 ${yenMoney.format(dividendCash.JPY.adjustment)}` : ''}</small></div></div>
              {dividendError && <p className="dividend-settings-error">{dividendError}</p>}
              <div className="settings-feature-actions dividend-settings-actions"><span>{dividendUpdatedAt ? `最近計算 ${new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dividendUpdatedAt))}` : '開啟後會依現有股票持倉自動試算；僅供追蹤，不是稅務建議。'}</span><div>{dividendAdjustmentCount > 0 && <button type="button" className="dividend-save-button restore" disabled={dividendSaving} onClick={resetDividendAdjustments}>還原 {dividendAdjustmentCount} 筆調整</button>}<button type="button" className="dividend-save-button" disabled={dividendSaving} onClick={() => persistDividendSettings(dividendSettings)}>{dividendSaving ? '保存中…' : '保存稅率'}</button><button type="button" className={`settings-toggle ${dividendSettings.enabled ? 'is-on' : ''}`} role="switch" aria-checked={dividendSettings.enabled} disabled={dividendSaving} onClick={() => persistDividendSettings({ ...dividendSettings, enabled: !dividendSettings.enabled })}><i /><b>{dividendSettings.enabled ? '開啟' : '關閉'}</b></button></div></div>
            </section>
            <p className="settings-disclaimer"><i>i</i><span>目前為手動聚合與試算工具，不會登入券商、讀取券商帳密或送出真實訂單。</span></p>
          </div>
        </aside>
      </div>}

      {editor && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <section className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-editor-title">
          <header><div><p className="eyebrow">Trade workspace</p><div className="editor-title-row"><h2 id="trade-editor-title">{editor.id ? '編輯交易' : '新增交易'}</h2><span>{editor.id ? `#${editor.id}` : 'New position'}</span></div></div><button className="close-button" onClick={() => setEditor(null)} aria-label="關閉">×</button></header>
          <form onSubmit={saveEditor}>
            <div className="editor-layout">
              <div className="editor-fields">
                <section className="editor-section">
                  <div className="editor-section-heading"><span>01</span><div><h3>交易設定</h3><p>先選擇交易方向，再搜尋標的與策略。</p></div></div>
                  <fieldset className="choice-field editor-market-switch"><legend>{editor.type === 'CASH' ? '現金幣別' : '股票市場'}</legend><div className="market-choice">
                    <button type="button" className={editorMarket === 'US' ? 'active' : ''} onClick={() => { setEditor({ ...editor, market: 'US', ticker: editor.type === 'CASH' ? 'USD' : isJapaneseTicker(editor.ticker) ? '' : editor.ticker, event: editor.type === 'CASH' ? 'CASH' : editor.event }); setSymbolSuggestions([]); setEditorQuote(null); }}>美元 USD</button>
                    <button type="button" className={editorMarket === 'JP' ? 'active' : ''} onClick={() => { setEditor(editor.type === 'CASH' ? { ...editor, market: 'JP', ticker: 'JPY', event: 'CASH', quoteMode: 'manual' } : { ...editor, market: 'JP', ticker: isJapaneseTicker(editor.ticker) ? editor.ticker : '', type: 'SDI', event: 'STOCK', quoteMode: 'auto' }); setSymbolSuggestions([]); setEditorQuote(null); }}>日圓 JPY</button>
                  </div><small>{editor.type === 'CASH' ? '現金以原幣餘額保存；組合總值會用最新 USD／JPY 匯率換算。' : editorMarket === 'JP' ? '支援東京證券交易所 4 位股票代碼，價格以日圓顯示。' : '支援美股、ETF 與選擇權交易。'}</small></fieldset>
                  <fieldset className="choice-field"><legend>交易類型</legend><div className="trade-type-picker">
                    {([
                      ['Sell', '賣方', '收取權利金'],
                      ['Buy', '買方', '支付權利金'],
                      ['Ass', '指派', '承接標的'],
                      ['SDI', '股票', '現股持倉'],
                      ['CASH', '現金', 'USD／JPY 餘額'],
                    ] as const).map(([type, label, description]) => <button key={type} type="button" disabled={editorMarket === 'JP' && type !== 'SDI' && type !== 'CASH'} className={editor.type === type ? 'active' : ''} onClick={() => setEditor({ ...editor, type, ticker: type === 'CASH' ? (editorMarket === 'JP' ? 'JPY' : 'USD') : editor.ticker === 'USD' || editor.ticker === 'JPY' ? '' : editor.ticker, event: type === 'CASH' ? 'CASH' : type === 'SDI' ? 'STOCK' : editor.event === 'CASH' ? 'PUT' : editor.event, entryPrice: type === 'CASH' ? 1 : editor.entryPrice, currentPrice: type === 'CASH' ? 1 : editor.currentPrice, fees: type === 'CASH' ? 0 : editor.fees, quoteMode: type === 'SDI' ? 'auto' : 'manual' })}><i>{type === 'Sell' ? '↓' : type === 'Buy' ? '↑' : type === 'Ass' ? '↳' : type === 'CASH' ? '$' : '◇'}</i><span><strong>{label}</strong><small>{description}</small></span></button>)}
                  </div></fieldset>
                  <div className="form-grid">
                    <label className="ticker-search-field">{editor.type === 'CASH' ? '幣別' : 'Ticker'}
                      <span className="ticker-input-shell">
                        <input
                          required
                          value={editor.type === 'CASH' ? editorDisplayTicker : editor.ticker ?? ''}
                          readOnly={editor.type === 'CASH'}
                          onChange={(event) => setEditor({ ...editor, ticker: event.target.value.toUpperCase() })}
                          onFocus={() => { if (editor.type !== 'CASH') setSymbolFocused(true); }}
                          onBlur={() => window.setTimeout(() => { setSymbolFocused(false); setEditor((current) => current ? { ...current, ticker: normalizeTickerForMarket(current.ticker, current.market ?? (isJapaneseTicker(current.ticker) ? 'JP' : 'US')) } : current); }, 120)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowDown' && symbolSuggestions.length) { event.preventDefault(); setActiveSymbolIndex((current) => (current + 1) % symbolSuggestions.length); }
                            if (event.key === 'ArrowUp' && symbolSuggestions.length) { event.preventDefault(); setActiveSymbolIndex((current) => (current - 1 + symbolSuggestions.length) % symbolSuggestions.length); }
                            if (event.key === 'Enter' && symbolSuggestions[activeSymbolIndex]) { event.preventDefault(); selectSymbol(symbolSuggestions[activeSymbolIndex]); }
                            if (event.key === 'Escape') { setSymbolSuggestions([]); setSymbolFocused(false); }
                          }}
                          placeholder={editor.type === 'CASH' ? '由上方幣別自動設定' : editorMarket === 'JP' ? '輸入 7203 或 Toyota…' : '輸入 MS 搜尋 MSFT…'}
                          autoComplete="off"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={symbolFocused && (symbolLoading || symbolSuggestions.length > 0)}
                          aria-controls="symbol-suggestions"
                          aria-activedescendant={symbolSuggestions[activeSymbolIndex] ? `symbol-option-${activeSymbolIndex}` : undefined}
                        />
                        {symbolLoading && <span className="symbol-search-spinner" aria-label="搜尋中" />}
                      </span>
                      {symbolFocused && (symbolLoading || symbolSuggestions.length > 0) && <span className="symbol-results" id="symbol-suggestions" role="listbox">
                        {symbolLoading && !symbolSuggestions.length && <span className="symbol-loading-copy">正在搜尋{editorMarket === 'JP' ? '日本股票' : '美股'}代號…</span>}
                        {symbolSuggestions.map((suggestion, index) => <button
                          key={suggestion.symbol}
                          id={`symbol-option-${index}`}
                          type="button"
                          role="option"
                          aria-selected={index === activeSymbolIndex}
                          className={`symbol-option ${index === activeSymbolIndex ? 'active' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectSymbol(suggestion)}
                        ><span><strong>{suggestion.symbol}</strong>{suggestion.name}</span><small>{suggestion.exchange || suggestion.type}</small></button>)}
                      </span>}
                    </label>
                    <label>策略／事件<input required readOnly={editor.type === 'CASH'} value={editor.type === 'CASH' ? 'CASH' : editor.event} onChange={(event) => setEditor({ ...editor, event: event.target.value.toUpperCase() })} placeholder="PUT / CALL / STOCK" /></label>
                    <label>履約價／組合<input readOnly={editor.type === 'CASH'} value={editor.type === 'CASH' ? '不適用' : editor.strike ?? ''} onChange={(event) => setEditor({ ...editor, strike: event.target.value })} placeholder="70 或 185/180" /></label>
                  </div>
                </section>

                <section className="editor-section">
                  <div className="editor-section-heading"><span>02</span><div><h3>{editor.type === 'CASH' ? '現金餘額' : '合約期間'}</h3><p>{editor.type === 'CASH' ? '記錄日期與目前可用現金；之後可隨時編輯或刪除。' : '設定日期與口數；填入平倉日會自動切換狀態。'}</p></div></div>
                  <div className="form-grid date-fields">
                    <label>開倉日<input required type="date" value={editor.openDate} onChange={(event) => setEditor({ ...editor, openDate: event.target.value })} /></label>
                    {editor.type !== 'CASH' && <label>到期日<input type="date" value={editor.expiryDate ?? ''} onChange={(event) => setEditor({ ...editor, expiryDate: event.target.value || null })} /></label>}
                    {editor.type !== 'CASH' && <label>平倉日<input type="date" value={editor.closeDate ?? ''} onChange={(event) => setEditor({ ...editor, closeDate: event.target.value || null, status: event.target.value ? 'closed' : 'open' })} /></label>}
                    <label>{editor.type === 'CASH' ? '現金餘額' : '數量'}<input min="0" step="0.01" type="number" value={editor.quantity} onChange={(event) => setEditor({ ...editor, quantity: Number(event.target.value), collateral: editor.type === 'CASH' ? Number(event.target.value) : editor.collateral })} /></label>
                  </div>
                </section>

                <section className="editor-section">
                  <div className="editor-section-heading"><span>03</span><div><h3>價格與風險</h3><p>輸入價格、費用與投入資本，損益會立即重算。</p></div></div>
                  {editor.type === 'CASH' ? <div className="cash-editor-info"><span>{editorCurrencySymbol}</span><div><strong>{editorPriceMoney(editor.quantity)}</strong><small>現金不需股票報價；會以 {editorDisplayTicker} 原幣保存並納入持倉配置。</small></div></div> : <>
                  <div className="form-grid price-fields">
                    <label>成本／成交價<div className="money-input"><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" value={editor.entryPrice} onChange={(event) => setEditor({ ...editor, entryPrice: Number(event.target.value) })} /></div></label>
                    <label><span className="field-label-row"><span>持倉／平倉價</span>{editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto' && <small>自動填入</small>}</span><div className={`money-input ${editorQuoteLoading ? 'is-quote-loading' : ''}`} aria-busy={editorQuoteLoading}><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" readOnly={editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto'} value={editor.currentPrice ?? ''} onChange={(event) => setEditor({ ...editor, currentPrice: event.target.value === '' ? null : Number(event.target.value) })} />{editorQuoteLoading && <i className="quote-price-spinner" aria-label="正在取得報價" />}</div>{editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto' && <span className={`auto-quote-status ${editorQuoteError ? 'error' : ''}`} aria-live="polite">{editorQuoteLoading ? '正在取得最新可用報價…' : editorQuoteError ? <>{editorQuoteError}<button type="button" onClick={() => setEditorQuoteRetry((current) => current + 1)}>重試</button></> : editorQuote?.ticker === editorAutoQuoteTicker ? `${quoteSessionLabel(editorQuote.session)} ${nativeMoney(editorAutoQuoteTicker, editorQuote.price)} 已填入` : '輸入 Ticker 後會自動填入'}</span>}</label>
                    <label>手續費<div className="money-input"><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" value={editor.fees} onChange={(event) => setEditor({ ...editor, fees: Number(event.target.value) })} /></div></label>
                    <label>擔保／投入資本<div className="money-input"><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" value={editor.collateral} onChange={(event) => setEditor({ ...editor, collateral: Number(event.target.value) })} /></div></label>
                  </div>
                  <div className="editor-choice-row">
                    {editor.type === 'SDI' && <fieldset className="choice-field compact-choice"><legend>報價方式</legend><div><button type="button" disabled={editor.status === 'closed'} className={editor.quoteMode === 'auto' ? 'active' : ''} onClick={() => { setEditor({ ...editor, quoteMode: 'auto' }); setEditorQuoteRetry((current) => current + 1); }}>自動更新</button><button type="button" className={editor.quoteMode === 'manual' ? 'active' : ''} onClick={() => setEditor({ ...editor, quoteMode: 'manual' })}>手動輸入</button></div></fieldset>}
                    <fieldset className="choice-field compact-choice"><legend>持倉狀態</legend><div><button type="button" className={editor.status === 'open' ? 'active' : ''} onClick={() => setEditor({ ...editor, status: 'open', closeDate: null })}>未平倉</button><button type="button" className={editor.status === 'closed' ? 'active' : ''} onClick={() => setEditor({ ...editor, status: 'closed', closeDate: editor.closeDate ?? today(), quoteMode: editor.type === 'SDI' ? 'manual' : editor.quoteMode })}>已平倉</button></div></fieldset>
                  </div>
                  </>}
                  <label className="notes-field">備註<textarea rows={3} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="記錄交易想法、催化劑或檢討…" /></label>
                </section>
              </div>
              <aside className="editor-summary">
                <div className="summary-sticky">
                   <p className="eyebrow">Live preview</p><h3>{editor.type === 'CASH' ? '現金預覽' : '交易預覽'}</h3>
                  <div className="summary-symbol"><span>{editorDisplayTicker?.slice(0, 1) || '—'}</span><div><strong>{editorDisplayTicker || '尚未選擇標的'}</strong><small>{editorMarket === 'JP' ? '日本 · ' : '美國 · '}{editor.event || '選擇策略'}</small></div></div>
                   <div className="summary-price-pair">{editor.type === 'CASH' ? <><div><span>原幣餘額</span><strong>{editorPriceMoney(editor.quantity)}</strong></div><div><span>組合換算 USD</span><strong>{money.format(editorPreviewMetrics?.marketValue ?? 0)}</strong></div></> : <><div><span>買入／成交價</span><strong>{editorPriceMoney(editor.entryPrice)}</strong></div><div><span>目前價格</span><strong>{editor.currentPrice === null ? '尚未設定' : editorPriceMoney(editor.currentPrice)}</strong></div></>}</div>
                   <div className="summary-result"><span>{editor.type === 'CASH' ? '納入組合價值（USD）' : '即時計算損益（USD）'}</span><strong className={editor.type === 'CASH' ? '' : (editorPreviewMetrics?.pnl ?? 0) >= 0 ? 'positive' : 'negative'}>{money.format(editor.type === 'CASH' ? editorPreviewMetrics?.marketValue ?? 0 : editorPreviewMetrics?.pnl ?? 0)}</strong></div>
                   <dl>{editor.type === 'CASH' ? <><div><dt>幣別</dt><dd>{editorDisplayTicker}</dd></div><div><dt>狀態</dt><dd>可用現金</dd></div><div><dt>報價</dt><dd>不需股票 API</dd></div></> : <><div><dt>ROC</dt><dd className={(editorPreviewMetrics?.roc ?? 0) >= 0 ? 'positive' : 'negative'}>{percent.format(editorPreviewMetrics?.roc ?? 0)}</dd></div><div><dt>持有天數</dt><dd>{editorPreviewMetrics?.days || 0} 天</dd></div><div><dt>狀態</dt><dd>{editor.status === 'open' ? '未平倉' : '已平倉'}</dd></div><div><dt>報價</dt><dd>{editorQuoteLoading ? '讀取中…' : editor.quoteMode === 'auto' && editorQuote?.ticker === editorAutoQuoteTicker ? `${quoteSessionLabel(editorQuote.session)} ${nativeMoney(editorAutoQuoteTicker, editorQuote.price)}` : editor.quoteMode === 'auto' ? '自動更新' : '手動價格'}</dd></div></>}</dl>
                  <p className="summary-tip"><i>✓</i> 所有欄位可隨時回來修改，儲存後會同步更新圖表與持倉配置。</p>
                </div>
              </aside>
            </div>
            <footer className="editor-actions">{editor.id > 0 && <button type="button" className="editor-delete-button" onClick={() => setDeleteCandidate(editor)}>刪除交易</button>}<p><span>●</span> 資料會安全儲存並立即更新儀表板</p><button type="button" className="cancel-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button save-button" disabled={saving || editorQuoteLoading}>{saving ? '儲存中…' : editorQuoteLoading ? '取得報價中…' : '儲存交易'}</button></footer>
          </form>
        </section>
      </div>}
      {dividendAdjustmentCandidate && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!dividendAdjusting && event.target === event.currentTarget) setDividendAdjustmentCandidate(null); }}>
        <section className="dividend-adjustment-modal" role="dialog" aria-modal="true" aria-labelledby="dividend-adjustment-title">
          <header><div><p className="eyebrow">Dividend cash</p><h2 id="dividend-adjustment-title">調減股息入帳</h2></div><button type="button" className="close-button" disabled={dividendAdjusting} onClick={() => setDividendAdjustmentCandidate(null)} aria-label="關閉">×</button></header>
          <form onSubmit={saveDividendAdjustment}>
            <div className="dividend-adjustment-source"><CompanyLogo ticker={dividendAdjustmentCandidate.dividendSourceTicker ?? 'OTHER'} /><span><small>股息來源</small><strong>{dividendAdjustmentCandidate.dividendSourceTicker ?? '未知股票'}</strong><b>{companyNames[dividendAdjustmentCandidate.dividendSourceTicker ?? ''] ?? (isJapaneseTicker(dividendAdjustmentCandidate.dividendSourceTicker) ? '日本股票' : '股息發放公司')} · {dateLabel(dividendAdjustmentCandidate.openDate)}</b></span></div>
            <div className="dividend-adjustment-stats"><div><span>原始稅後金額</span><strong>{nativeMoney(dividendAdjustmentCandidate.ticker, dividendAdjustmentCandidate.dividendCalculatedNet ?? dividendAdjustmentCandidate.quantity)}</strong></div><div><span>目前入帳</span><strong>{nativeMoney(dividendAdjustmentCandidate.ticker, dividendAdjustmentCandidate.quantity)}</strong></div></div>
            <label className="dividend-adjustment-field"><span>調整後入帳金額</span><div><i>{dividendAdjustmentCandidate.ticker === 'JPY' ? '¥' : '$'}</i><input autoFocus inputMode="decimal" type="number" min="0" max={Number((dividendAdjustmentCandidate.dividendCalculatedNet ?? dividendAdjustmentCandidate.quantity).toFixed(dividendAdjustmentCandidate.ticker === 'JPY' ? 0 : 2))} step={dividendAdjustmentCandidate.ticker === 'JPY' ? '1' : '0.01'} value={dividendNetInput} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDividendNetInput(event.target.value)} /><b>{dividendAdjustmentCandidate.ticker}</b></div><small>只能調低指定股票的這次派息；來源與稅額紀錄會保留。</small></label>
            <div className="dividend-adjustment-preview"><span>手動調減</span><strong>{nativeMoney(dividendAdjustmentCandidate.ticker, Math.max(0, (dividendAdjustmentCandidate.dividendCalculatedNet ?? dividendAdjustmentCandidate.quantity) - (Number.isFinite(Number(dividendNetInput)) ? Number(dividendNetInput) : 0)))}</strong></div>
            <footer><button type="button" className="cancel-button" disabled={dividendAdjusting} onClick={() => setDividendAdjustmentCandidate(null)}>取消</button><button type="submit" className="primary-button" disabled={dividendAdjusting}>{dividendAdjusting ? '保存中…' : '保存調整'}</button></footer>
          </form>
        </section>
      </div>}
      {deleteCandidate && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!deleting && event.target === event.currentTarget) setDeleteCandidate(null); }}>
        <section className="delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-copy">
          <span className="delete-confirm-icon" aria-hidden="true">!</span>
          <p className="eyebrow">{deleteCandidate.derived ? 'Dividend cash' : 'Permanent action'}</p>
          <h2 id="delete-confirm-title">{deleteCandidate.derived ? '刪除這筆股息紀錄？' : '刪除這筆交易紀錄？'}</h2>
          <p id="delete-confirm-copy">{deleteCandidate.derived ? '刪除後，這次派息會從現金與交易紀錄中排除，刷新後也不會重新產生；可在設定中還原。' : '刪除後會立即從持倉、損益與收益圖表中移除，這個動作無法復原。'}</p>
          <div className="delete-trade-summary"><strong>{deleteCandidate.dividendSourceTicker || deleteCandidate.ticker || '未命名標的'}</strong><span>{deleteCandidate.event} · {dateLabel(deleteCandidate.openDate)} · {deleteCandidate.derived ? `稅後入帳 ${nativeMoney(deleteCandidate.ticker, deleteCandidate.quantity)} ${deleteCandidate.ticker}` : nativeMoney(deleteCandidate.ticker, deleteCandidate.entryPrice)}</span></div>
          <footer><button type="button" className="cancel-button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>保留紀錄</button><button type="button" className="confirm-delete-button" disabled={deleting} onClick={deleteTrade}>{deleting ? '刪除中…' : deleteCandidate.derived ? '刪除股息' : '永久刪除'}</button></footer>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
