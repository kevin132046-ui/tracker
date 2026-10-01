'use client';

import type { ChangeEvent, CSSProperties } from 'react';
import { FormEvent, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrokerWorkspace } from '@/lib/broker-workspace';
import {
  buildAnnualRocSummary,
  capitalBase,
  investedCapitalUsd,
  isCashTrade,
  isJapaneseTicker,
  isShortTrade,
  isStockTrade,
  isYenTicker,
  isYenTrade,
  normalizeTickerForMarket,
  normalizedUsdAmount,
  priceHistoryRequest,
  priceSymbolFor,
  rangeBuckets,
  timeWeightedReturnSeries,
  dailyTimeWeightedReturns,
} from '@/lib/performance';
import type { AnnualRocSummary, CapitalBasis, PriceHistorySeries, RangeMode } from '@/lib/performance';
import { addDaysToKey, dateKey, japaneseHolidays, parseDateKey, upcomingClosures, usMarketHolidays, weekday, zonedDate, zonedDateKey } from '@/lib/market-calendar';
import type { UpcomingClosure } from '@/lib/market-calendar';
import { earningsReminders, exchangeTodayKey, mergeEarnings, pruneManualEarnings } from '@/lib/earnings';
import type { AiEarningsSuggestion, AiProvider, EarningsEntry, EarningsEvent, EarningsReminder } from '@/lib/earnings';
import { aiKeyHeaders, emptyAiKeys, loadAiKeys, loadAnalyses, loadDefaultProvider, loadQuestions, releaseNoticeDays, saveAiKeys, saveAnalyses, saveDefaultProvider, saveQuestions } from '@/lib/filings';
import type { AiKeys, CompanyFilings, FilingAnalysis } from '@/lib/filings';
import { loadUsageTier, saveUsageTier } from '@/lib/filings';
import type { ClaudeModel } from '@/lib/ai-models';
import { defaultClaudeModel, loadClaudeModel, requestModel, saveClaudeModel } from '@/lib/ai-models';
import type { QuotaReport, UsageTier } from '@/lib/openai-free-tier';
import { OPTION_CONTRACT_SIZE, analyzeOptionPosition, calendarDaysBetween, daysToExpiry, optionRightFromEvent, parseStrike, strikeChoices, summarizeOptionRisk } from '@/lib/options';
import type { OptionPositionAnalytics, OptionRight, OptionRiskItem, OptionRiskSummary } from '@/lib/options';
import { isDefaultTradeColumns, readStoredTradeColumns, tradeColumns, writeStoredTradeColumns } from '@/lib/trade-columns';
import type { TradeColumnId } from '@/lib/trade-columns';
import { tradesToCsv } from '@/lib/trade-csv';
import AiSettingsCard from '@/components/AiSettingsCard';
import type { AiStatus } from '@/components/AiSettingsCard';
import type { AiEntryContext } from '@/components/AiTradeEntry';
import type { Tone, ToneSetting } from '@/lib/wafu/tone';
import { applyTone, loadToneSetting, resolveTone, saveToneSetting, toneChoices } from '@/lib/wafu/tone';
import EditableHeroTitle from '@/components/EditableHeroTitle';
import FilingAnalysisDialog from '@/components/FilingAnalysisDialog';
import { freeQuotaLine, freeQuotaOpen } from '@/components/FreeQuota';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import HaloIcon from '@/components/wafu/HaloIcon';
// The opening's controller (its markup ships with the layout: StaticOpening).
import WafuOpening from '@/components/wafu/opening/Opening';
import NavIcon from '@/components/wafu/NavIcon';
import type { WafuNavIconName } from '@/components/wafu/NavIcon';
import WafuThemeCard from '@/components/wafu/WafuThemeCard';
import WafuBackdrop from '@/components/wafu/Backdrop';
import MusicDock from '@/components/wafu/MusicDock';
import NotifyCenter from '@/components/wafu/NotifyCenter';
import GuideBar from '@/components/wafu/GuideBar';
import { MetricsGrid, MonthlyHeatmap } from '@/components/wafu/PerfMetrics';
import { VisualFieldPicker, defaultVisualFields, loadVisualFields, saveVisualFields, visualFields as visualFieldList } from '@/components/wafu/VisualFields';
import type { VisualFieldId } from '@/components/wafu/VisualFields';
import ManualQuotes from '@/components/wafu/ManualQuotes';
import SpreadCard from '@/components/wafu/SpreadCard';
import PerfChart from '@/components/wafu/PerfChart';
import type { ManualQuoteRow } from '@/components/wafu/ManualQuotes';
import { computeRiskMetrics, monthlyGrid } from '@/lib/wafu/metrics';
import HankoTile from '@/components/wafu/HankoTile';
import ResearchDrawer from '@/components/wafu/ResearchDrawer';
import type { ResearchChip, ResearchTab } from '@/components/wafu/ResearchDrawer';
import HomeBar from '@/components/wafu/HomeBar';
import type { NoticeCalendar, NoticeItem } from '@/components/wafu/NotifyCenter';
import WafuMediaCard from '@/components/wafu/WafuMediaCard';
import { useMediaPrefs } from '@/lib/wafu/media';
import { applyPerf, probeFramesOnce } from '@/lib/wafu/perf';
import { jikanOf, sekkiOf } from '@/lib/wafu/koyomi';
import { kikyoInner, kikyoOutline, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';
import type { AssistantPrefs, PortfolioSnapshot, SnapshotPosition } from '@/lib/ai-assistant';
import { defaultAssistantPrefs, loadAssistantPrefs, saveAssistantPrefs } from '@/lib/ai-assistant';
import type { WafuPreference, WafuTheme } from '@/lib/wafu/theme';
import { applyWafu, defaultWafuPreference, loadWafuPreference, resolveWafu, saveWafuPreference } from '@/lib/wafu/theme';
import type { WafuIntroPreference } from '@/lib/wafu/intro';
import { defaultWafuIntro, introPending, liftIntroVeil, loadIntroLiteAuto, loadWafuIntro, saveIntroLiteAuto, saveWafuIntro } from '@/lib/wafu/intro';
import DatePicker from '@/components/DatePicker';
import TradeColumnPicker from '@/components/TradeColumnPicker';

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

type FilterMode = 'all' | 'open' | 'closed' | 'options' | 'stock' | 'cash';
type PositionViewMode = 'visual' | 'details' | 'gains';
type AllocationChartMode = 'donut' | 'bars';
type SymbolSuggestion = { symbol: string; name: string; exchange: string; type: string };
type QuoteSession = 'pre' | 'regular' | 'post' | 'closed';
type LiveQuote = { ticker: string; price: number; marketTime: number | null; session: QuoteSession; currency: string; regularPrice: number; extendedPrice: number | null; previousClose: number | null; regularChange: number | null; regularChangePercent: number | null; extendedChange: number | null; extendedChangePercent: number | null; change: number | null; changePercent: number | null; sparkline: number[]; yearHigh?: number | null; yearLow?: number | null };
type UnderlyingQuote = { price: number; session: QuoteSession; marketTime: number | null; fetchedAt: number };
type OptionRowAnalytics = { right: OptionRight; direction: 1 | -1; strike: number | null; dte: number | null; underlying: number | null; analytics: OptionPositionAnalytics | null };
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
type BenchmarkData = { SPY: number[]; BOXX: number[]; keys?: string[] };
type PriceHistoryState = { key: string; series: PriceHistorySeries };
type MacroMarketData = { mode: RangeMode | null; markets: BenchmarkMarket[]; updatedAt: string | null };
type MacroCacheEntry = { markets: BenchmarkMarket[]; updatedAt: string; fetchedAt: number };
type BackgroundMode = 'default' | 'image';
type DividendSettings = { enabled: boolean; usTaxRate: number; jpTaxRate: number; creditOn: 'pay' | 'ex' };
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
  payDate: string;
  paySource: 'nasdaq' | 'yahoo' | 'manual' | 'estimate';
  credited: boolean;
};

const paySourceLabels: Record<DividendEvent['paySource'], string> = { nasdaq: 'Nasdaq', yahoo: 'Yahoo', manual: '手動', estimate: '預估' };

const loadBrokerHub = () => import('@/components/BrokerHub');
const loadDcfCalculator = () => import('@/components/DcfCalculator');
const loadCompanyFundamentals = () => import('@/components/CompanyFundamentals');
const loadTradeImportDialog = () => import('@/components/TradeImportDialog');
const BrokerHub = lazy(loadBrokerHub);
const DcfCalculator = lazy(loadDcfCalculator);
const GainsLedger = lazy(() => import('@/components/wafu/GainsLedger'));
const CompanyFundamentals = lazy(loadCompanyFundamentals);
const TradeImportDialog = lazy(loadTradeImportDialog);
// The AI assistant panel is only fetched when it is opened.
const loadAssistantPanel = () => import('@/components/wafu/AssistantPanel');
const AssistantPanel = lazy(loadAssistantPanel);

// Allocation colours per theme: tonal steps of the theme's own accents (the largest holding in the
// main accent), with the theme's gold as the one warm note. 桔梗: periwinkle → wisteria → indigo;
// 時雨: teal → frost → lavender.
const palettes: Record<WafuTheme, string[]> = {
  kikyo: ['#9dbcf0', '#b3a5f0', '#7d93d6', '#8f7fd0', '#c9a45c', '#6479b4', '#a9b6dc', '#5c5a9e'],
  shigure: ['#62d4d2', '#3fa7ae', '#9fd8e6', '#b69ae8', '#f0c24b', '#2f8590', '#c7e6ea', '#7c8fd6'],
};
// 色調 palettes: 燈籠 warm lantern steps with the theme's own accent as the second colour; 和紙 deeper
// ink tones that hold up on paper.
const tonePalettes: Record<Tone, Record<WafuTheme, string[]>> = {
  lantern: {
    kikyo: ['#e6b778', '#c9a8e6', '#d98f6a', '#a98fd0', '#f0d29a', '#b8735a', '#e2c7b0', '#8c7bb8'],
    shigure: ['#e8b878', '#8fd0c4', '#d98f6a', '#5fb3ab', '#f0d29a', '#b8735a', '#c4e2da', '#7c9fd0'],
  },
  washi: {
    kikyo: ['#4f55a3', '#8a5aa8', '#b5533c', '#7d86c9', '#9a7128', '#3d4390', '#b9a0cf', '#6b5b4a'],
    shigure: ['#2a7a7b', '#7a5aa8', '#b5533c', '#5fa7a3', '#9a7128', '#1f5f63', '#a6c9c4', '#6b5b4a'],
  },
};
const companyNames: Record<string, string> = {
  AAPL: 'Apple', AMZN: 'Amazon', AXP: 'American Express', BOXX: 'Alpha Architect', GOOGL: 'Alphabet', KO: 'Coca-Cola',
  CNC: 'Centene', META: 'Meta Platforms', MSFT: 'Microsoft', NVDA: 'NVIDIA', SPGI: 'S&P Global', SPY: 'SPDR S&P 500',
  TRV: 'The Travelers Companies', TSLA: 'Tesla', TTWO: 'Take-Two Interactive', V: 'Visa', VST: 'Vistra',
  COST: 'Costco', DIS: 'Disney', F: 'Ford Motor', INTC: 'Intel', JNJ: 'Johnson & Johnson', JPM: 'JPMorgan Chase', KHC: 'Kraft Heinz',
  '7203.T': 'Toyota Motor', '6758.T': 'Sony Group', '9984.T': 'SoftBank Group', '6861.T': 'Keyence',
  '8306.T': 'Mitsubishi UFJ Financial Group', '8035.T': 'Tokyo Electron', '9983.T': 'Fast Retailing', '7974.T': 'Nintendo',
};
const backgroundImageKey = 'optionflow-custom-background';
const backgroundModeKey = 'optionflow-background-mode';
const backgroundPendingKey = 'optionflow-pending-background';
const backgroundPendingModeKey = 'optionflow-pending-background-mode';
const usdJpyRateKey = 'optionflow-usdjpy-rate';
const holidayNoticeKey = 'optionflow-holiday-notice';
const holidayNoticeDismissedKey = 'optionflow-holiday-notice-dismissed';
const aiEnabledKey = 'optionflow-ai-enabled';
const notifyCenterKey = 'optionflow-notify-center';
const notifyBarKey = 'optionflow-notify-bar';
// The 益損 tab in 交易與持倉 ('off' hides it).
const gainsTabKey = 'optionflow-gains-tab';
const bottomNavKey = 'optionflow-bottom-nav';
type SettingsTab = 'look' | 'sound' | 'ai' | 'modules' | 'data';
const settingsTabs: ReadonlyArray<readonly [SettingsTab, string]> = [['look', '外觀'], ['sound', '音樂'], ['ai', 'AI'], ['modules', '模組'], ['data', '資料']];
// The page's sections, in page order, for the guide bar's swipes.
const guideSections = [{ id: 'overview', label: '總覽' }, { id: 'returns', label: '收益' }, { id: 'positions', label: '持倉' }, { id: 'valuation', label: '估值' }];
type BottomNav = 'guide' | 'menu' | 'off';
const earningsReminderKey = 'optionflow-earnings-reminder';
const manualEarningsKey = 'optionflow-earnings-manual';
const openAiModelKey = 'optionflow-openai-model';
const usdJpyUpdatedAtKey = 'optionflow-usdjpy-updated-at';
const macroMarketStorageKey = 'optionflow-macro-markets-v2';
const localBackgroundPattern = /^data:image\/jpeg;base64,/i;
const serverBackgroundPattern = /^\/api\/background\?image=1&version=\d{10,16}-[0-9a-f-]{36}$/i;
const isLocalBackground = (value: string) => localBackgroundPattern.test(value);
const isServerBackground = (value: string) => serverBackgroundPattern.test(value);
const perfColors = { mine: 'var(--wa-accent)', spy: 'var(--wa-ink-2)', boxx: 'var(--wa-gold)' };
const perfNames = { mine: '我的組合', spy: 'SPY', boxx: 'BOXX' };
const isStoredBackground = (value: string) => isLocalBackground(value) || isServerBackground(value);
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
// Rounded first, so a tiny loss shows 0.00% rather than −0.00%.
const signedPrecisePercent = (value: number) => { const rounded = Math.round(value * 10000) / 10000 || 0; return `${rounded > 0 ? '+' : ''}${precisePercent.format(rounded)}`; };
// 收益分析 labels: 36 months span three years, so month labels carry the year (2025/9).
const perfLabel = (mode: string, item: { key: string; label: string }) => mode === 'month' ? `${item.key.slice(0, 4)}/${Number(item.key.slice(5, 7))}` : item.label;
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`)) : '—';
const clockFormatter = (timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const easternClockFormatter = clockFormatter('America/New_York');
const japanClockFormatter = clockFormatter('Asia/Tokyo');
const easternZoneFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
const easternZoneName = (timestamp: number) => easternZoneFormatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName')?.value ?? 'ET';
const japaneseCalendarFormatter = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { timeZone: 'Asia/Tokyo', era: 'long', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

type MarketCalendarStatus = {
  japaneseDate: string;
  japanHoliday: string | null;
  japanClosedReason: string | null;
  usClosedReason: string | null;
};

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
const nativeMoney = (ticker: string | null | undefined, value: number) => isYenTicker(ticker) ? yenMoney.format(value) : money.format(value);
const quoteSessionLabel = (session: QuoteSession) => session === 'pre' ? '盤前' : session === 'post' ? '盤後' : session === 'regular' ? '正常交易時段' : '最近收盤';
const signedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money.format(Math.abs(value))}`;
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// Signed figures for the option columns; a value that rounds to zero is shown without a sign.
const withSign = (formatted: string, value: number) => /^[^1-9]*$/.test(formatted) ? formatted : `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}`;
const signedDecimal = (value: number) => withSign(oneDecimal.format(Math.abs(value)), value);
const signedPercent = (value: number) => withSign(percent.format(Math.abs(value)), value);
// Annualized figures explode for very short holds; cap the display instead of printing huge numbers.
const cappedAnnualized = (value: number | null) => value === null || Number.isNaN(value) ? '—' : value > 9.99 ? '> 999%' : value < -9.99 ? '< −999%' : signedPrecisePercent(value);
const capitalBasisLabels: Record<CapitalBasis, string> = { collateral: '擔保金', strike: '履約價名目', cost: '買入成本', premium: '權利金' };

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
  const capital = investedCapitalUsd(trade, usdJpyRate);
  const roc = capital > 0 ? pnl / capital : 0;
  const nativeMarketValue = stock ? current * trade.quantity : Math.max(trade.collateral, current * trade.quantity * 100);
  const marketValue = normalizedUsdAmount(trade, nativeMarketValue, usdJpyRate);
  return { pnl, days, roc, marketValue };
}

/** PUT or CALL of a US option trade; null for stock, cash and yen trades or other events. */
const optionRightOf = (trade: Trade): OptionRight | null => isCashTrade(trade) || isStockTrade(trade) || isYenTrade(trade) ? null : optionRightFromEvent(trade.event);
/** The option's underlying as a /api/quotes symbol, or '' when the ticker cannot be quoted. */
const underlyingSymbolOf = (ticker: string | null | undefined) => {
  const symbol = normalizeTickerForMarket(ticker, 'US');
  return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : '';
};

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
    <footer><span>{startLabel}</span><b>{`${rangeLabel}走勢`}</b><span>{endLabel}</span></footer>
  </article>;
});

const RocBreakdownDialog = memo(function RocBreakdownDialog({ summary, onClose }: { summary: AnnualRocSummary; onClose: () => void }) {
  const { rows } = summary;
  const weighted = summary.value === null ? '—' : precisePercent.format(summary.value);
  const tone = (value: number | null) => value === null ? '' : value >= 0 ? 'positive' : 'negative';
  return <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="roc-breakdown-modal" role="dialog" aria-modal="true" aria-labelledby="roc-breakdown-title" aria-describedby="roc-breakdown-formula">
      <header>
        <div><p className="eyebrow">Annualized ROC · {summary.year}</p><h2 id="roc-breakdown-title">本年度加權年化 ROC 明細</h2></div>
        <button type="button" className="close-button" onClick={onClose} aria-label="關閉" autoFocus>×</button>
      </header>
      <div className="roc-breakdown-body">
        <div className="roc-breakdown-stats">
          <div><span>加權年化 ROC</span><strong className={tone(summary.value)}>{weighted}</strong></div>
          <div><span>已實現損益</span><strong className={tone(summary.realizedPnl)}>{signedMoney(summary.realizedPnl)}</strong></div>
          <div><span>資本 × 年</span><strong>{money.format(summary.capitalYears)}</strong></div>
          <div><span>平倉交易</span><strong>{summary.count} 筆</strong></div>
        </div>
        <p className="roc-breakdown-formula" id="roc-breakdown-formula">
          <span>Σ已實現損益 ÷ Σ(投入資本×天數÷365)</span>
          <span>= {signedMoney(summary.realizedPnl)} ÷ {money.format(summary.capitalYears)} = <strong>{weighted}</strong></span>
        </p>
        <div className="roc-breakdown-table-wrap">
          <table className="roc-breakdown-table">
            <thead><tr><th scope="col">標的／策略</th><th scope="col">開倉 → 平倉</th><th scope="col" className="numeric">天數</th><th scope="col" className="numeric">投入資本</th><th scope="col" className="numeric">損益</th><th scope="col" className="numeric">ROC</th><th scope="col" className="numeric">單利年化</th><th scope="col" className="numeric">複利年化</th><th scope="col" className="numeric">資本×年</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={9} className="roc-breakdown-empty">{summary.year} 年尚無已平倉交易。</td></tr>}
              {rows.map((row) => <tr key={row.id}>
                <td><strong>{row.ticker}</strong><span className="subtle">{row.strategy}</span></td>
                <td className="roc-breakdown-dates">{row.openDate} → {row.closeDate}</td>
                <td className="numeric">{row.days}</td>
                <td className="numeric" title={`資本基礎：${capitalBasisLabels[row.basis]}`}>{money.format(row.capital)}{row.basis === 'strike' && <small className="roc-basis-tag" title="未填擔保金，以履約價 × 100 × 口數估算">履約價名目</small>}</td>
                <td className={`numeric ${tone(row.pnl)}`}>{signedMoney(row.pnl)}</td>
                <td className={`numeric ${tone(row.roc)}`}>{row.roc === null ? '—' : signedPrecisePercent(row.roc)}</td>
                <td className="numeric">{cappedAnnualized(row.simpleAnnualized)}</td>
                <td className="numeric">{cappedAnnualized(row.compoundAnnualized)}</td>
                <td className="numeric">{money.format(row.capitalYears)}</td>
              </tr>)}
            </tbody>
            {rows.length > 0 && <tfoot><tr>
              <td>合計 {summary.count} 筆</td>
              <td>—</td>
              <td className="numeric">—</td>
              <td className="numeric">{money.format(summary.totalCapital)}</td>
              <td className={`numeric ${tone(summary.realizedPnl)}`}>{signedMoney(summary.realizedPnl)}</td>
              <td className="numeric">{summary.totalCapital > 0 ? signedPrecisePercent(summary.realizedPnl / summary.totalCapital) : '—'}</td>
              <td className={`numeric ${tone(summary.value)}`}>{summary.value === null ? '—' : cappedAnnualized(summary.value)}<small className="roc-basis-tag is-weighted">加權</small></td>
              <td className="numeric">—</td>
              <td className="numeric">{money.format(summary.capitalYears)}</td>
            </tr></tfoot>}
          </table>
        </div>
        <ul className="roc-breakdown-notes">
          <li>持有未滿 30 天的年化數字會被放大，僅供參考。</li>
          <li>已實現損益已扣除手續費；日股金額以目前 USD／JPY 匯率換算。</li>
          <li>投入資本：賣方選擇權採擔保金，未填擔保金時以履約價名目（履約價 × 100 × 口數）估算；股票採買入成本＋手續費；買方選擇權採權利金＋手續費。</li>
          <li>合計列：ROC ＝ Σ損益 ÷ Σ投入資本；單利年化欄即加權年化 ROC（各筆投入資本依持有天數加權）。</li>
        </ul>
      </div>
    </section>
  </div>;
});

const OptionRiskStrip = memo(function OptionRiskStrip({ risk, premium }: { risk: OptionRiskSummary; premium: { received: number; count: number; kept: number; closed: number } | null }) {
  const unpriced = risk.positions - risk.analyzed;
  const greeksReady = risk.analyzed > 0;
  const { nearestExpiry: nearest, maxAssignment: assignment } = risk;
  return <section className="option-risk-strip" aria-label="選擇權賣方風險摘要">
    <header>
      <div><p className="eyebrow">Option seller risk</p><h3>選擇權部位風險</h3></div>
      <span>{`${risk.positions} 筆未平倉選擇權`}{unpriced > 0 && <em title="缺少標的報價、履約價無法解析或權利金無法反推 IV">{`${unpriced} 筆未計入 Greeks`}</em>}</span>
    </header>
    <dl>
      <div><dt>淨 Delta（股數當量）</dt><dd><strong>{greeksReady ? `${signedDecimal(risk.netDelta)} 股` : '—'}</strong><small>{greeksReady ? `≈ ${signedMoney(risk.netDeltaDollars)} 標的名目` : '等待標的報價'}</small></dd></div>
      <div><dt>每日 Theta</dt><dd><strong className={greeksReady ? risk.theta >= 0 ? 'positive' : 'negative' : ''}>{greeksReady ? signedMoney(risk.theta) : '—'}</strong><small>時間價值收入；每過一天，賣方為正</small></dd></div>
      <div><dt>Vega（$／vol 點）</dt><dd><strong>{greeksReady ? signedMoney(risk.vega) : '—'}</strong><small>隱含波動率上升 1 點</small></dd></div>
      <div><dt>最近到期</dt><dd><strong>{nearest ? `${nearest.ticker} · ${nearest.days} 天` : '—'}</strong><small>{nearest ? dateLabel(nearest.expiryDate) : '未填到期日'}</small></dd></div>
      <div><dt>最高被指派機率</dt><dd><strong>{assignment ? percent.format(assignment.probability) : '—'}</strong><small>{assignment ? `${assignment.ticker} ${assignment.strike ?? ''} ${assignment.right === 'put' ? 'PUT' : 'CALL'}` : greeksReady ? '沒有賣方部位' : '等待標的報價'}</small></dd></div>
      {premium && <div><dt>本年權利金</dt><dd><strong className="positive">{signedMoney(premium.received)}</strong><small>{`${premium.count} 筆賣出`}{premium.closed > 0 && ` · 已平倉實收 ${signedMoney(premium.kept)}`}</small></dd></div>}
      <div><dt>擔保占用</dt><dd><strong>{money.format(risk.shortCapital)}</strong><small>{risk.shortCapitalShare === null ? '賣方選擇權的投入資本' : `占全部投入資本 ${percent.format(risk.shortCapitalShare)}`}</small></dd></div>
    </dl>
  </section>;
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
    <div className="stacked-clock-deck" aria-live="polite">{clocks.map((clock) => <div key={clock.id} className={`stacked-clock-card ${activeZone === clock.id ? 'is-active' : 'is-behind'}`} aria-hidden={activeZone !== clock.id}><span>{clock.label}</span><strong>{clock.time}</strong><b>[{clock.zone}]</b>{clockNow !== null && <em className="clock-jikan">{jikanOf(clockNow)}</em>}</div>)}</div>
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
    <strong>{status?.japaneseDate ?? '日本日期讀取中'}{timestamp !== null && <small className="brand-sekki"> · {sekkiOf(timestamp)}</small>}</strong>
    {status && (status.japanHoliday || status.japanClosedReason || status.usClosedReason) && <span className="market-calendar-tags">
      {status.japanHoliday && <em className="holiday-tag">日本祝日 · {status.japanHoliday}</em>}
      {status.japanClosedReason && <em>日股休市 · {status.japanClosedReason}</em>}
      {status.usClosedReason && <em>美股休市 · {status.usClosedReason}</em>}
    </span>}
  </div>;
});

const closureWeekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const closureId = (closure: UpcomingClosure) => `${closure.market}:${closure.key}:${closure.kind}`;
const closureLabel = (closure: UpcomingClosure) => closure.kind === 'early' ? '美股提前收盤' : closure.market === 'US' ? '美股休市' : '日股休市';
const dayWhen = (key: string, daysAway: number) => {
  const date = parseDateKey(key)!;
  const distance = daysAway === 0 ? '今天' : `${daysAway} 天後`;
  return `${date.month}/${date.day} ${closureWeekdays[weekday(date)]} · ${distance}`;
};
// Dismissal ids keep the date second so old ones can be pruned by date.
const earningsReminderId = (reminder: EarningsReminder) => `EARN:${reminder.date}:${reminder.symbol}`;
const earningsTimingLabel = (timing: EarningsEvent['timing']) => timing === 'pre' ? '盤前' : timing === 'post' ? '盤後' : '';

function readDismissedClosures() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(holidayNoticeDismissedKey) ?? '[]');
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

type NoticeEarnings = { symbols: string[]; yahoo: Record<string, EarningsEvent>; manual: Record<string, string> };

// US and Japanese closures in the coming week, US early closes, and earnings of held symbols.
// Hidden when there is nothing to show, when everything shown has been dismissed, or when both
// parts are switched off in settings.
const HolidayNotice = memo(function HolidayNotice({ enabled, earnings, releases, onOpenRelease }: { enabled: boolean; earnings: NoticeEarnings | null; releases: Array<{ symbol: string; filed: string }>; onOpenRelease: (symbol: string) => void }) {
  const [timestamp, setTimestamp] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    const update = () => setTimestamp(Date.now());
    queueMicrotask(() => {
      update();
      setDismissed(readDismissedClosures());
    });
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const closures = useMemo(() => {
    if (timestamp === null || !enabled) return [];
    return [
      ...upcomingClosures('US', zonedDateKey(zonedDate(timestamp, 'America/New_York'))),
      ...upcomingClosures('JP', zonedDateKey(zonedDate(timestamp, 'Asia/Tokyo'))),
    ].sort((a, b) => a.key.localeCompare(b.key) || a.market.localeCompare(b.market));
  }, [enabled, timestamp]);
  const reminders = useMemo(() => {
    if (timestamp === null || !earnings) return [];
    return earningsReminders(mergeEarnings(earnings.symbols, earnings.yahoo, earnings.manual, timestamp), timestamp);
  }, [earnings, timestamp]);
  const releaseId = (release: { symbol: string; filed: string }) => `FILED:${release.filed}:${release.symbol}`;
  const ids = [...releases.map(releaseId), ...closures.map(closureId), ...reminders.map(earningsReminderId)];
  if (dismissed === null || !ids.length || ids.every((id) => dismissed.includes(id))) return null;
  const dismiss = () => {
    // Keep only ids that can still come up, so the stored list stays small.
    const today = zonedDateKey(zonedDate(Date.now(), 'Asia/Tokyo'));
    const next = [...new Set([...dismissed.filter((id) => id.split(':')[1] >= addDaysToKey(today, -2)), ...ids])];
    setDismissed(next);
    try { window.localStorage.setItem(holidayNoticeDismissedKey, JSON.stringify(next)); } catch { /* storage unavailable: hide for this visit only */ }
  };
  const title = reminders.length || releases.length ? '市場提醒' : '休市預告';
  return <div className="holiday-notice" role="status">
    <strong>{title}</strong>
    <ul>
      {releases.map((release) => <li key={releaseId(release)} className="holiday-notice-item is-release">
        <b>財報已公布</b>
        <button type="button" onClick={() => onOpenRelease(release.symbol)} aria-label={`查看 ${release.symbol} 財報解讀`}>{release.symbol} · 查看解讀</button>
        <small>{release.filed.slice(5).replace('-', '/')} 申報</small>
      </li>)}
      {closures.map((closure) => <li key={closureId(closure)} className={`holiday-notice-item is-${closure.market.toLowerCase()} ${closure.kind === 'early' ? 'is-early' : ''}`}>
        <b>{closureLabel(closure)}</b>
        <span>{closure.name}{closure.kind === 'early' ? ' · 13:00 ET' : ''}</span>
        <small>{dayWhen(closure.key, closure.daysAway)}</small>
      </li>)}
      {reminders.map((reminder) => <li key={earningsReminderId(reminder)} className="holiday-notice-item is-earnings">
        <b>財報</b>
        <span>{reminder.symbol}{earningsTimingLabel(reminder.timing) ? ` · ${earningsTimingLabel(reminder.timing)}` : ''}{reminder.estimate ? '（預估）' : ''}</span>
        <small>{reminder.endDate ? `${reminder.date.slice(5).replace('-', '/')}～${reminder.endDate.slice(5).replace('-', '/')}` : dayWhen(reminder.date, reminder.daysAway)}</small>
      </li>)}
    </ul>
    <button type="button" className="holiday-notice-close" onClick={dismiss} aria-label={`關閉${title}`}>×</button>
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

const StockTechnicalPanel = memo(function StockTechnicalPanel({ view, symbol, range, customFrom, customTo, data, loading, error, stockTrades, lotSavingId, valuationOpen, ai, onRangeChange, onCustomRangeApply, onClose, onOpenDcf, onAddLot, onSaveLot, onEditLot, onDeleteLot }: {
  /** Which part the research drawer shows: the charts, the company fundamentals or the purchase lots. */
  view: 'technical' | 'fundamentals' | 'lots';
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
  /** AI settings for the fundamentals' AI lookup; null while AI is off. */
  ai: AiEntryContext | null;
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

  return <section className={`panel stock-analysis-panel is-embedded view-${view}`} id="stock-analysis" aria-live="polite">
    {view === 'technical' && <>
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
        ><defs><linearGradient id={`price-fill-${symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: 'var(--wa-accent)' }} stopOpacity=".25"/><stop offset="100%" style={{ stopColor: 'var(--wa-accent)' }} stopOpacity="0"/></linearGradient></defs><line x1="0" x2="100" y1="93" y2="93" className="technical-grid-line"/>{overlays.boll && <><polygon points={technicalBandPolygon(bollUpper, bollLower, priceBounds.min, priceBounds.max)} className="technical-boll-band"/><polyline points={technicalPoints(bollUpper, priceBounds.min, priceBounds.max)} className="technical-boll-line"/><polyline points={technicalPoints(bollLower, priceBounds.min, priceBounds.max)} className="technical-boll-line"/></>}{priceChartMode === 'line' ? <><polygon points={`0,93 ${technicalPoints(closes, priceBounds.min, priceBounds.max)} 100,93`} fill={`url(#price-fill-${symbol})`}/><polyline points={technicalPoints(closes, priceBounds.min, priceBounds.max)} className="technical-price-line"/></> : <g className="technical-candles">{candles.map((point, index) => {
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
    <footer className="technical-note">價格、OHLC 與技術指標採同一組交易所時段資料計算；短期間使用分時 K，長期間使用日 K。僅供持倉追蹤，不構成投資建議。</footer>
    </>}
    {view === 'fundamentals' && <Suspense fallback={<div className="technical-state"><span className="technical-spinner" />正在讀取 {symbol} 公司資料…</div>}><CompanyFundamentals key={symbol} symbol={symbol} valuationOpen={valuationOpen} onOpenDcf={onOpenDcf} onReturn={onClose} ai={ai} /></Suspense>}
    {view === 'lots' && <section className="stock-lots-section">
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
    </section>}
  </section>;
}, (previous, next) => previous.view === next.view
  && previous.symbol === next.symbol
  && previous.range === next.range
  && previous.customFrom === next.customFrom
  && previous.customTo === next.customTo
  && previous.data === next.data
  && previous.loading === next.loading
  && previous.error === next.error
  && previous.stockTrades === next.stockTrades
  && previous.lotSavingId === next.lotSavingId
  && previous.valuationOpen === next.valuationOpen
  && previous.ai === next.ai);

/** The 欄位 strip under a visual position; a field without a value for this position is left out. */
function VisualFieldStrip({ fields, values }: { fields: VisualFieldId[]; values: Partial<Record<VisualFieldId, { text: string; tone?: 'positive' | 'negative'; range?: number; title?: string }>> }) {
  const shown = visualFieldList.filter((field) => fields.includes(field.id) && values[field.id]);
  if (!shown.length) return null;
  return <div className="wafu-vstrip">{shown.map((field) => {
    const value = values[field.id]!;
    return <span key={field.id} className={value.tone ?? ''} title={field.hint}>
      <small>{field.label}</small>
      {value.range !== undefined ? <><i className="wafu-vrange"><em style={{ left: `${value.range * 100}%` }} /></i><b>{value.text}</b></> : <b>{value.text}</b>}
    </span>;
  })}</div>;
}

// US session for the top-bar pill: 盤前 04:00–09:30, 交易中 09:30–16:00, 盤後 16:00–20:00 (ET).
type MarketSession = 'pre' | 'open' | 'post' | 'closed';
function marketSessionAt(timestamp: number): MarketSession {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(timestamp));
  const day = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const clock = hour * 60 + minute;
  const easternDate = zonedDate(timestamp, 'America/New_York');
  const holiday = usMarketHolidays(easternDate.year).has(zonedDateKey(easternDate));
  if (holiday || ['Sat', 'Sun'].includes(day)) return 'closed';
  return clock >= 570 && clock < 960 ? 'open' : clock >= 240 && clock < 570 ? 'pre' : clock >= 960 && clock < 1200 ? 'post' : 'closed';
}

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lotSavingId, setLotSavingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [manualQuotesOpen, setManualQuotesOpen] = useState(false);
  const [returnView, setReturnView] = useState<'period' | 'cum' | 'dd' | 'heat'>('cum');
  const [perfVisible, setPerfVisible] = useState({ mine: true, spy: true, boxx: true });
  const [visualFieldSet, setVisualFieldSet] = useState<VisualFieldId[]>(defaultVisualFields);
  useEffect(() => { setVisualFieldSet(loadVisualFields()); }, []);
  const updateVisualFields = useCallback((next: VisualFieldId[]) => { setVisualFieldSet(next); saveVisualFields(next); }, []);
  const [macroRangeMode, setMacroRangeMode] = useState<RangeMode>('month');
  const [allocationChartMode, setAllocationChartMode] = useState<AllocationChartMode>('donut');
  const [allocationGroupSelection, setAllocationGroupSelection] = useState<{ label: string; members: string[] } | null>(null);
  const [allocationHoveredLabel, setAllocationHoveredLabel] = useState<string | null>(null);
  const [allocationPinnedLabel, setAllocationPinnedLabel] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [positionView, setPositionView] = useState<PositionViewMode>('visual');
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<'overview' | 'positions' | 'returns' | 'valuation'>('overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [holidayNoticeEnabled, setHolidayNoticeEnabled] = useState(true);
  // The notification center gathers the header notice line and more; off → the line as before.
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  // The notice bar in the middle of the top bar (wide screens); can be turned off in the settings.
  const [notifyBar, setNotifyBar] = useState(true);
  const [gainsTab, setGainsTab] = useState(true);
  // 色調: read at once (the boot script already painted it), so the first effect does not undo it.
  const [toneSetting, setToneSetting] = useState<ToneSetting>(() => typeof window === 'undefined' ? 'off' : loadToneSetting());
  const [noticeNow, setNoticeNow] = useState<number | null>(null);
  // Phones: the main menu as a bar along the bottom instead of the top strip.
  // Bottom navigation: the guide bar (every screen, default), the phone menu bar, or nothing.
  const [bottomNav, setBottomNav] = useState<BottomNav>('guide');
  const homeBarEnabled = bottomNav === 'menu';
  const [notifySignal, setNotifySignal] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('look');
  const [researchTab, setResearchTab] = useState<ResearchTab>('technical');
  // Android Chrome offers installing the site as an app; the event is kept for the settings button.
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [earningsEnabled, setEarningsEnabled] = useState(true);
  const [manualEarnings, setManualEarnings] = useState<Record<string, string>>({});
  const [aiStatus, setAiStatus] = useState<AiStatus>(null);
  const [openAiTier, setOpenAiTier] = useState<UsageTier>('low');
  // Bumped after each AI call so the quota is read again.
  const [quotaCheck, setQuotaCheck] = useState(0);
  const refreshQuota = useCallback(() => setQuotaCheck((current) => current + 1), []);
  const [aiKeys, setAiKeys] = useState<AiKeys>(emptyAiKeys);
  const [defaultAiProvider, setDefaultAiProvider] = useState<AiProvider>('openai');
  const [analysisQuestions, setAnalysisQuestions] = useState<string[]>([]);
  const [filingAnalyses, setFilingAnalyses] = useState<Record<string, FilingAnalysis>>({});
  const [secFilings, setSecFilings] = useState<{ key: string; filings: Record<string, CompanyFilings> } | null>(null);
  const [filingDialogSymbol, setFilingDialogSymbol] = useState<string | null>(null);
  const [openAiModel, setOpenAiModel] = useState('');
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>(defaultClaudeModel);
  const [wafuPreference, setWafuPreference] = useState<WafuPreference>(defaultWafuPreference);
  // The server renders 桔梗; the saved choice is applied on load (the boot script already set <html data-wafu>).
  const [wafuTheme, setWafuTheme] = useState<WafuTheme>('kikyo');
  const [wafuIntro, setWafuIntro] = useState<WafuIntroPreference>(defaultWafuIntro);
  const [introLiteAuto, setIntroLiteAuto] = useState(true);
  // The opening playing now (on load, or previewed from the settings).
  const [intro, setIntro] = useState<{ theme: WafuTheme; reduced: boolean } | null>(null);
  const wafuMedia = useMediaPrefs();
  const [assistantPrefs, setAssistantPrefs] = useState<AssistantPrefs>(defaultAssistantPrefs);
  // The master switch for every AI feature (財報解讀、AI 查財報日、AI 記錄交易、AI 助理); the rest of the site is unaffected.
  const [aiEnabled, setAiEnabled] = useState(true);
  const assistantOn = aiEnabled && assistantPrefs.enabled;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [aiLookups, setAiLookups] = useState<Record<string, { loading: boolean; suggestion?: AiEarningsSuggestion; error?: string }>>({});
  const [yahooEarnings, setYahooEarnings] = useState<{ key: string; events: Record<string, EarningsEvent>; failed: string[] } | null>(null);
  const [brokerHubEnabled, setBrokerHubEnabled] = useState(false);
  const [brokerHubLoading, setBrokerHubLoading] = useState(true);
  const [brokerHubToggleSaving, setBrokerHubToggleSaving] = useState(false);
  const [brokerWorkspaceSeed, setBrokerWorkspaceSeed] = useState<BrokerWorkspace | null>(null);
  const [editor, setEditor] = useState<Trade | null>(null);
  const [importOpen, setImportOpen] = useState(false);
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
  const [underlyingQuotes, setUnderlyingQuotes] = useState<Record<string, UnderlyingQuote>>({});
  const [underlyingFailures, setUnderlyingFailures] = useState<Set<string>>(new Set());
  const [tradeColumnSet, setTradeColumnSet] = useState<TradeColumnId[]>(readStoredTradeColumns);
  const [dividendSettings, setDividendSettings] = useState<DividendSettings>({ enabled: true, usTaxRate: 30, jpTaxRate: 15.315, creditOn: 'pay' });
  const [dividendCash, setDividendCash] = useState<DividendCash>({ USD: { gross: 0, tax: 0, adjustment: 0, net: 0, count: 0 }, JPY: { gross: 0, tax: 0, adjustment: 0, net: 0, count: 0 } });
  const [dividendEvents, setDividendEvents] = useState<DividendEvent[]>([]);
  const [dividendPending, setDividendPending] = useState<DividendCash | null>(null);
  const [dividendAdjustmentCount, setDividendAdjustmentCount] = useState(0);
  const [dividendLoading, setDividendLoading] = useState(true);
  const [dividendSaving, setDividendSaving] = useState(false);
  const [dividendError, setDividendError] = useState('');
  const [dividendUpdatedAt, setDividendUpdatedAt] = useState<string | null>(null);
  const [usdJpyRate, setUsdJpyRate] = useState(initialUsdJpyRate);
  const [usdJpyUpdatedAt, setUsdJpyUpdatedAt] = useState<string | null>(initialUsdJpyUpdatedAt);
  const [benchmarks, setBenchmarks] = useState<{ mode: RangeMode | null } & BenchmarkData>({ mode: null, SPY: [], BOXX: [] });
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryState | null>(null);
  const [rocBreakdownOpen, setRocBreakdownOpen] = useState(false);
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
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const backgroundOperationRef = useRef(false);
  const backgroundGenerationRef = useRef(0);
  const editorQuoteCacheRef = useRef(new Map<string, { quote: LiveQuote; fetchedAt: number }>());
  const benchmarkCacheRef = useRef(new Map<RangeMode, BenchmarkData>());
  const priceHistoryCacheRef = useRef(new Map<string, PriceHistoryState>());
  const rocTriggerRef = useRef<HTMLButtonElement>(null);
  const macroCacheRef = useRef(new Map<string, MacroCacheEntry>());
  const macroRefreshRequestedRef = useRef(false);
  const technicalCacheRef = useRef(new Map<string, TechnicalCacheEntry>());
  const allocationHistoryCacheRef = useRef(new Map<string, AllocationHistory>());
  const quoteRefreshInFlightRef = useRef(false);
  const underlyingFetchedAtRef = useRef(new Map<string, number>());
  const toastTimerRef = useRef<number | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);

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
      const payload = await response.json() as { settings?: DividendSettings; cash?: DividendCash; pending?: DividendCash; events?: DividendEvent[]; adjustmentCount?: number; updatedAt?: string; failedTickers?: string[]; error?: string };
      if (!response.ok || !payload.settings || !payload.cash) throw new Error(payload.error ?? '股息現金目前無法更新');
      setDividendSettings(payload.settings);
      setDividendCash(payload.cash);
      setDividendPending(payload.pending ?? null);
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

  const saveDividendPayDate = useCallback(async (eventKey: string, payDate: string) => {
    if (dividendSaving) return;
    setDividendSaving(true);
    try {
      const response = await fetch('/api/dividends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay-date', eventKey, payDate }),
      });
      const payload = await response.json() as { adjusted?: boolean; error?: string };
      if (!response.ok || !payload.adjusted) throw new Error(payload.error ?? '發放日無法保存');
      await refreshDividendCash(false);
      notify(payDate ? '發放日已更新' : '發放日已改回自動判斷');
    } catch (error) {
      notify(error instanceof Error ? error.message : '發放日無法保存');
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

  useEffect(() => {
    try {
      if (window.localStorage.getItem(holidayNoticeKey) === 'off') queueMicrotask(() => setHolidayNoticeEnabled(false));
      if (window.localStorage.getItem(notifyCenterKey) === 'off') queueMicrotask(() => setNotifyEnabled(false));
      if (window.localStorage.getItem(notifyBarKey) === 'off') queueMicrotask(() => setNotifyBar(false));
      if (window.localStorage.getItem(gainsTabKey) === 'off') queueMicrotask(() => setGainsTab(false));
      const storedNav = window.localStorage.getItem(bottomNavKey);
      if (storedNav === 'menu' || storedNav === 'off') queueMicrotask(() => setBottomNav(storedNav));
    } catch { /* storage unavailable: keep the default */ }
  }, []);

  useEffect(() => {
    try {
      const off = window.localStorage.getItem(earningsReminderKey) === 'off';
      const stored = JSON.parse(window.localStorage.getItem(manualEarningsKey) ?? '{}') as unknown;
      const manual = stored && typeof stored === 'object' && !Array.isArray(stored)
        ? pruneManualEarnings(Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), Date.now())
        : {};
      const model = window.localStorage.getItem(openAiModelKey) ?? '';
      const keys = loadAiKeys();
      const provider = loadDefaultProvider();
      const tier = loadUsageTier();
      const claude = loadClaudeModel();
      const wafu = loadWafuPreference();
      const wafuShown = resolveWafu(wafu);
      const introPreference = loadWafuIntro();
      const assistant = loadAssistantPrefs();
      const liteAuto = loadIntroLiteAuto();
      const aiOn = window.localStorage.getItem(aiEnabledKey) !== 'off';
      // The boot script veiled the page when the opening should play; otherwise lift any veil now.
      const playIntro = introPending() ? { theme: wafuShown, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches } : null;
      if (!playIntro) liftIntroVeil();
      const questions = loadQuestions();
      // Loading also drops analyses older than half a year.
      const analyses = loadAnalyses();
      queueMicrotask(() => {
        if (off) setEarningsEnabled(false);
        setManualEarnings(manual);
        setOpenAiModel(model);
        setAiKeys(keys);
        setDefaultAiProvider(provider);
        setOpenAiTier(tier);
        setClaudeModel(claude);
        setWafuPreference(wafu);
        setWafuTheme(wafuShown);
        applyWafu(wafuShown);
        setWafuIntro(introPreference);
        setAssistantPrefs(assistant);
        setIntroLiteAuto(liteAuto);
        setAiEnabled(aiOn);
        setIntro(playIntro);
        setAnalysisQuestions(questions);
        setFilingAnalyses(analyses);
      });
    } catch { liftIntroVeil(); /* storage unavailable: keep the defaults */ }
  }, []);

  // 游標光暈 (prototype): the panel under the pointer gets its position for a soft radial light.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.documentElement.dataset.perf === 'lite') return;
        const panel = (event.target as Element | null)?.closest?.('.panel, .metric-card') as HTMLElement | null;
        if (!panel) return;
        const box = panel.getBoundingClientRect();
        panel.style.setProperty('--mx', `${event.clientX - box.left}px`);
        panel.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame); };
  }, []);

  // 效能模式: the boot script already set it; this adds the device check, and measures once after
  // the page settles when nothing has measured this device yet (the opening does it when it plays).
  useEffect(() => {
    applyPerf();
    if (intro) return;
    return probeFramesOnce();
  }, [intro]);

  const toggleEarnings = useCallback(() => {
    setEarningsEnabled((current) => {
      try { window.localStorage.setItem(earningsReminderKey, current ? 'off' : 'on'); } catch { /* storage unavailable */ }
      return !current;
    });
  }, []);

  const setManualEarningsDate = useCallback((symbol: string, date: string | null) => {
    setManualEarnings((current) => {
      const next = { ...current };
      if (date) next[symbol] = date;
      else delete next[symbol];
      try { window.localStorage.setItem(manualEarningsKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const updateOpenAiModel = useCallback((value: string) => {
    setOpenAiModel(value);
    try { window.localStorage.setItem(openAiModelKey, value.trim()); } catch { /* storage unavailable */ }
  }, []);

  // AI lookups use the Worker's keys only behind Cloudflare Access (else the browser's own keys). The status carries today's free ChatGPT tokens, so it
  // is asked again every time the settings panel or the analysis dialog opens, after every AI call,
  // and when the model or usage tier changes.
  useEffect(() => {
    if (!aiEnabled || (!settingsOpen && !filingDialogSymbol)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/ai?model=${encodeURIComponent(openAiModel.trim())}&tier=${openAiTier}`, { cache: 'no-store', headers: aiKeyHeaders(aiKeys), signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { mode?: 'access' | 'byok'; note?: string | null; providers?: Record<AiProvider, boolean>; openAiModel?: string | null; sec?: boolean; quota?: QuotaReport; error?: string };
          if (!response.ok || !payload.providers) throw new Error(payload.error ?? 'AI 查詢暫時無法使用。');
          if (!controller.signal.aborted) setAiStatus({ state: 'ok', mode: payload.mode === 'byok' ? 'byok' : 'access', note: payload.note ?? null, providers: payload.providers, openAiModel: payload.openAiModel ?? null, sec: Boolean(payload.sec), quota: payload.quota ?? null });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setAiStatus({ state: 'error', message: error instanceof Error ? error.message : 'AI 查詢暫時無法使用。' });
        });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [aiEnabled, aiKeys, filingDialogSymbol, openAiModel, openAiTier, quotaCheck, settingsOpen]);

  const lookupEarningsWithAi = useCallback(async (symbol: string, provider: AiProvider) => {
    const id = `${provider}:${symbol}`;
    setAiLookups((current) => ({ ...current, [id]: { loading: true } }));
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiKeyHeaders(aiKeys) },
        body: JSON.stringify({ task: 'earnings-date', symbol, provider, model: requestModel(provider, openAiModel, claudeModel), usageTier: openAiTier }),
      });
      const payload = await response.json() as { suggestion?: AiEarningsSuggestion; error?: string };
      if (!response.ok || !payload.suggestion) throw new Error(payload.error ?? '查詢失敗，請稍後再試。');
      setAiLookups((current) => ({ ...current, [id]: { loading: false, suggestion: payload.suggestion } }));
    } catch (error) {
      setAiLookups((current) => ({ ...current, [id]: { loading: false, error: error instanceof Error ? error.message : '查詢失敗，請稍後再試。' } }));
    } finally {
      refreshQuota();
    }
  }, [aiKeys, claudeModel, openAiModel, openAiTier, refreshQuota]);

  const dismissAiLookup = useCallback((id: string) => {
    setAiLookups((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const updateAiKeys = useCallback((keys: AiKeys) => { setAiKeys(keys); saveAiKeys(keys); }, []);
  const updateAiEnabled = useCallback((enabled: boolean) => {
    setAiEnabled(enabled);
    if (!enabled) { setAssistantOpen(false); setFilingDialogSymbol(null); }
    try { window.localStorage.setItem(aiEnabledKey, enabled ? 'on' : 'off'); } catch { /* storage unavailable */ }
  }, []);
  const updateOpenAiTier = useCallback((tier: UsageTier) => { setOpenAiTier(tier); saveUsageTier(tier); }, []);
  const updateClaudeModel = useCallback((model: ClaudeModel) => { setClaudeModel(model); saveClaudeModel(model); }, []);
  const updateWafuPreference = useCallback((preference: WafuPreference) => {
    const theme = resolveWafu(preference);
    saveWafuPreference(preference);
    setWafuPreference(preference);
    setWafuTheme(theme);
    applyWafu(theme);
  }, []);
  const updateAssistantPrefs = useCallback((change: Partial<AssistantPrefs>) => {
    setAssistantPrefs((current) => {
      const next = { ...current, ...change };
      saveAssistantPrefs(next);
      if (!next.enabled) setAssistantOpen(false);
      return next;
    });
  }, []);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
  const updateWafuIntro = useCallback((preference: WafuIntroPreference) => { setWafuIntro(preference); saveWafuIntro(preference); }, []);
  const updateIntroLiteAuto = useCallback((on: boolean) => { setIntroLiteAuto(on); saveIntroLiteAuto(on); }, []);
  const previewIntro = useCallback(() => {
    setIntro({ theme: wafuTheme, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  }, [wafuTheme]);
  const finishIntro = useCallback(() => setIntro(null), []);
  // As the doors open the page rises into place (wafu-opening.css).
  const revealAfterIntro = useCallback(() => {
    const root = document.documentElement;
    root.dataset.wafuReveal = '1';
    window.setTimeout(() => { delete root.dataset.wafuReveal; }, 1500);
  }, []);
  // The import dialog's AI entry starts from the AI settings and can pick another model per use.
  const importAi = useMemo(() => ({ keys: aiKeys, defaultProvider: defaultAiProvider, openAiModel, claudeModel, usageTier: openAiTier, onUsed: refreshQuota }), [aiKeys, claudeModel, defaultAiProvider, openAiModel, openAiTier, refreshQuota]);
  // The research drawer's AI lookups (基本面 / DCF) when the usual company data fails.
  const researchAi = aiEnabled ? importAi : null;
  const updateDefaultAiProvider = useCallback((provider: AiProvider) => { setDefaultAiProvider(provider); saveDefaultProvider(provider); }, []);
  const updateAnalysisQuestions = useCallback((questions: string[]) => { setAnalysisQuestions(questions); saveQuestions(questions); }, []);
  const saveFilingAnalysis = useCallback((analysis: FilingAnalysis) => {
    setFilingAnalyses((current) => {
      const next = { ...current, [analysis.accession]: analysis };
      saveAnalyses(next);
      return next;
    });
  }, []);
  // A provider is usable with a key typed into this browser or one set on the server.
  const aiProviderReady = useCallback((provider: AiProvider) => Boolean(aiKeys[provider].trim()) || (aiStatus?.state === 'ok' && aiStatus.providers[provider]), [aiKeys, aiStatus]);

  const updateBottomNav = useCallback((nav: BottomNav) => {
    setBottomNav(nav);
    try { window.localStorage.setItem(bottomNavKey, nav); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    const offer = (event: Event) => { event.preventDefault(); setInstallPrompt(event as Event & { prompt: () => Promise<void> }); };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', offer); window.removeEventListener('appinstalled', installed); };
  }, []);
  // wafu-mobile.css keys the phone layout off <html data-home-bar>.
  useEffect(() => {
    const root = document.documentElement;
    if (homeBarEnabled) root.dataset.homeBar = '1';
    else delete root.dataset.homeBar;
    if (bottomNav === 'guide') root.dataset.guideBar = '1';
    else delete root.dataset.guideBar;
  }, [bottomNav, homeBarEnabled]);
  const goToSection = useCallback((section: 'overview' | 'positions' | 'returns') => {
    setActiveSection(section);
    window.history.replaceState(null, '', `#${section}`);
    document.getElementById(section)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, []);
  const toggleNotifyBar = useCallback(() => {
    setNotifyBar((current) => {
      try { window.localStorage.setItem(notifyBarKey, current ? 'off' : 'on'); } catch { /* storage unavailable */ }
      return !current;
    });
  }, []);
  // 暖色自動 follows the clock: 和紙 by day, 燈籠 at night, checked every few minutes.
  const [activeTone, setActiveTone] = useState<Tone | null>(() => resolveTone(toneSetting));
  useEffect(() => {
    const apply = () => { const tone = resolveTone(toneSetting); applyTone(tone); setActiveTone(tone); };
    apply();
    if (toneSetting !== 'auto') return;
    const timer = window.setInterval(apply, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [toneSetting]);
  const updateTone = useCallback((setting: ToneSetting) => { setToneSetting(setting); saveToneSetting(setting); }, []);
  const toggleGainsTab = useCallback(() => {
    setGainsTab((current) => {
      try { window.localStorage.setItem(gainsTabKey, current ? 'off' : 'on'); } catch { /* storage unavailable */ }
      if (current) setPositionView((view) => view === 'gains' ? 'visual' : view);
      return !current;
    });
  }, []);
  const toggleNotifyCenter = useCallback(() => {
    setNotifyEnabled((current) => {
      try { window.localStorage.setItem(notifyCenterKey, current ? 'off' : 'on'); } catch { /* storage unavailable */ }
      return !current;
    });
  }, []);
  // Notification dates move with the clock (checked each minute).
  useEffect(() => {
    queueMicrotask(() => setNoticeNow(Date.now()));
    const timer = window.setInterval(() => setNoticeNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const toggleHolidayNotice = useCallback(() => {
    setHolidayNoticeEnabled((current) => {
      try { window.localStorage.setItem(holidayNoticeKey, current ? 'off' : 'on'); } catch { /* storage unavailable */ }
      return !current;
    });
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

  // CSV of the stored trades (derived dividend cash excluded), downloaded through an object URL.
  const exportTradesCsv = useCallback(() => {
    const exportable = trades.filter((trade) => !trade.derived);
    if (!exportable.length) return notify('目前沒有可匯出的交易');
    const url = URL.createObjectURL(new Blob([tradesToCsv(exportable)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `optionflow-trades-${today()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    notify(`已匯出 ${exportable.length} 筆交易（CSV）`);
  }, [notify, trades]);

  const closeImport = useCallback(() => {
    setImportOpen(false);
    window.requestAnimationFrame(() => importTriggerRef.current?.focus());
  }, []);

  // After an import the list reloads from the server, as on first load, and dividend cash recalculates once.
  const handleImported = useCallback((count: number, updated = 0) => {
    void fetchTrades().catch((error) => notify(error instanceof Error ? error.message : '無法載入交易資料'));
    window.setTimeout(() => void refreshDividendCash(false), 0);
    notify(updated ? (count ? `已匯入 ${count} 筆、平倉 ${updated} 筆交易` : `已平倉 ${updated} 筆交易`) : `已匯入 ${count} 筆交易`);
  }, [fetchTrades, notify, refreshDividendCash]);

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

  // Underlying prices for open US option positions (IV, greeks, moneyness): one request per
  // symbol at most once a minute while the page is visible, and nothing without open options.
  const optionUnderlyingKey = useMemo(() => [...new Set(trades.flatMap((trade) => trade.status === 'open' && optionRightOf(trade) ? [underlyingSymbolOf(trade.ticker)] : []))].filter(Boolean).sort().join(','), [trades]);

  // Symbols of open stock and option positions, for the earnings calendar.
  const earningsSymbolKey = useMemo(() => [...new Set(trades.flatMap((trade) => trade.status === 'open' && !isCashTrade(trade) ? [priceSymbolFor(trade)] : []))]
    .filter((symbol) => /^[A-Z0-9.-]{1,15}$/.test(symbol)).sort().join(','), [trades]);

  useEffect(() => {
    if (!earningsEnabled || !earningsSymbolKey || yahooEarnings?.key === earningsSymbolKey) return;
    const controller = new AbortController();
    fetch(`/api/earnings?symbols=${encodeURIComponent(earningsSymbolKey)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { earnings?: Record<string, EarningsEvent>; failed?: string[]; error?: string };
        if (!response.ok || !payload.earnings) throw new Error(payload.error ?? '財報日暫時無法取得');
        if (!controller.signal.aborted) setYahooEarnings({ key: earningsSymbolKey, events: payload.earnings, failed: payload.failed ?? [] });
      })
      // Without Yahoo the card still lists the symbols and takes manual dates.
      .catch(() => { if (!controller.signal.aborted) setYahooEarnings({ key: earningsSymbolKey, events: {}, failed: earningsSymbolKey.split(',') }); });
    return () => controller.abort();
  }, [earningsEnabled, earningsSymbolKey, yahooEarnings?.key]);

  const noticeEarnings = useMemo(() => earningsEnabled && earningsSymbolKey
    ? { symbols: earningsSymbolKey.split(','), yahoo: yahooEarnings?.events ?? {}, manual: manualEarnings }
    : null, [earningsEnabled, earningsSymbolKey, manualEarnings, yahooEarnings?.events]);

  // SEC filings of the US symbols, for the "results are out" chip and the analysis dialog.
  const secSymbolKey = useMemo(() => earningsSymbolKey.split(',').filter((symbol) => symbol && !symbol.endsWith('.T')).join(','), [earningsSymbolKey]);
  useEffect(() => {
    if (!earningsEnabled || !secSymbolKey || secFilings?.key === secSymbolKey) return;
    const controller = new AbortController();
    fetch(`/api/filings?symbols=${encodeURIComponent(secSymbolKey)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { filings?: Record<string, CompanyFilings> };
        if (!controller.signal.aborted) setSecFilings({ key: secSymbolKey, filings: response.ok && payload.filings ? payload.filings : {} });
      })
      .catch(() => { if (!controller.signal.aborted) setSecFilings({ key: secSymbolKey, filings: {} }); });
    return () => controller.abort();
  }, [earningsEnabled, secFilings?.key, secSymbolKey]);

  const filingsFor = useCallback((symbol: string) => {
    const company = secFilings?.filings[symbol];
    return company && (company.earningsRelease || company.periodicReport) ? company : null;
  }, [secFilings]);

  const recentReleases = useMemo(() => {
    if (!earningsEnabled || !secFilings) return [];
    const today = zonedDateKey(zonedDate(Date.now(), 'America/New_York'));
    const earliest = addDaysToKey(today, -releaseNoticeDays);
    return Object.entries(secFilings.filings).flatMap(([symbol, company]) => {
      const filed = company.earningsRelease?.filed;
      return filed && filed >= earliest && filed <= today ? [{ symbol, filed }] : [];
    }).sort((a, b) => b.filed.localeCompare(a.filed));
  }, [earningsEnabled, secFilings]);

  // 通知中心 calendar (prototype): all known upcoming earnings of holdings, closures in the next 45
  // days, and a 財報解讀 card for the latest results of up to four holdings.
  const noticeCalendar = useMemo<NoticeCalendar | undefined>(() => {
    if (!notifyEnabled || noticeNow === null) return undefined;
    const usToday = zonedDateKey(zonedDate(noticeNow, 'America/New_York'));
    const closures = holidayNoticeEnabled ? [
      ...upcomingClosures('US', usToday, 45),
      ...upcomingClosures('JP', zonedDateKey(zonedDate(noticeNow, 'Asia/Tokyo')), 45),
    ].sort((a, b) => a.key.localeCompare(b.key) || a.market.localeCompare(b.market))
      .map((closure) => ({ key: closure.key, market: closure.market, label: closureLabel(closure), name: closure.name, early: closure.kind === 'early', daysAway: closure.daysAway })) : [];
    const earnings = noticeEarnings
      ? earningsReminders(mergeEarnings(noticeEarnings.symbols, noticeEarnings.yahoo, noticeEarnings.manual, noticeNow), noticeNow, 120)
        .map((entry) => ({ symbol: entry.symbol, date: entry.date, timing: entry.timing, estimate: entry.estimate, daysAway: entry.daysAway }))
        .sort((a, b) => a.daysAway - b.daysAway)
      : [];
    const digestFrom = addDaysToKey(usToday, -60);
    const digests = earningsEnabled && secFilings ? Object.entries(secFilings.filings).flatMap(([symbol, company]) => {
      const release = company.earningsRelease ?? company.periodicReport;
      if (!release || release.filed < digestFrom) return [];
      return [{ symbol, name: company.name, cik: company.cik, form: release.form, filed: release.filed, url: release.url, analysis: filingAnalyses[release.accession]?.text ?? null }];
    }).sort((a, b) => b.filed.localeCompare(a.filed)).slice(0, 4) : [];
    return { earnings, closures, digests, onAskAi: (symbol: string) => setFilingDialogSymbol(symbol) };
  }, [earningsEnabled, filingAnalyses, holidayNoticeEnabled, noticeEarnings, noticeNow, notifyEnabled, secFilings]);

  // Notification center: the header notice line (results, closures, earnings dates) plus options
  // expiring within a week and dividends paid or about to be paid.
  const noticeItems = useMemo<NoticeItem[]>(() => {
    if (!notifyEnabled || noticeNow === null) return [];
    const items: NoticeItem[] = [];
    const usToday = zonedDateKey(zonedDate(noticeNow, 'America/New_York'));
    const short = (key: string) => key.slice(5).replace('-', '/');
    for (const release of recentReleases) {
      items.push({ id: `FILED:${release.filed}:${release.symbol}`, kind: 'release', label: '財報已公布', text: release.symbol, when: `${short(release.filed)} 申報`, date: release.filed, action: { label: ' · 查看解讀', run: () => setFilingDialogSymbol(release.symbol) } });
    }
    if (holidayNoticeEnabled) {
      const closures = [
        ...upcomingClosures('US', usToday),
        ...upcomingClosures('JP', zonedDateKey(zonedDate(noticeNow, 'Asia/Tokyo'))),
      ];
      for (const closure of closures) items.push({ id: closureId(closure), kind: closure.kind === 'early' ? 'early' : 'closure', label: closureLabel(closure), text: `${closure.name}${closure.kind === 'early' ? ' · 13:00 ET' : ''}`, when: dayWhen(closure.key, closure.daysAway), date: closure.key });
    }
    if (noticeEarnings) {
      for (const reminder of earningsReminders(mergeEarnings(noticeEarnings.symbols, noticeEarnings.yahoo, noticeEarnings.manual, noticeNow), noticeNow)) {
        items.push({ id: earningsReminderId(reminder), kind: 'earnings', label: '財報', text: `${reminder.symbol}${earningsTimingLabel(reminder.timing) ? ` · ${earningsTimingLabel(reminder.timing)}` : ''}${reminder.estimate ? '（預估）' : ''}`, when: reminder.endDate ? `${short(reminder.date)}～${short(reminder.endDate)}` : dayWhen(reminder.date, reminder.daysAway), date: reminder.date });
      }
    }
    for (const trade of trades) {
      const right = trade.status === 'open' ? optionRightOf(trade) : null;
      const days = right && trade.expiryDate ? daysToExpiry(trade.expiryDate, usToday) : null;
      if (!right || days === null || days > 7 || !trade.expiryDate || trade.expiryDate < usToday) continue;
      items.push({ id: `EXP:${trade.expiryDate}:${trade.id}`, kind: 'expiry', label: '選擇權到期', text: `${underlyingSymbolOf(trade.ticker)} ${trade.strike ?? ''} ${right === 'call' ? 'Call' : 'Put'}`.replace(/\s+/g, ' ').trim(), when: dayWhen(trade.expiryDate, days), date: trade.expiryDate });
    }
    if (dividendSettings.enabled) {
      const soon = addDaysToKey(usToday, 7);
      const recent = addDaysToKey(usToday, -3);
      for (const event of dividendEvents) {
        const amount = `${event.ticker} · ${event.currency === 'JPY' ? '¥' : '$'}${event.net.toFixed(event.currency === 'JPY' ? 0 : 2)}`;
        if (!event.credited && event.payDate >= usToday && event.payDate <= soon) items.push({ id: `DIV:${event.payDate}:${event.eventKey}`, kind: 'dividend', label: '股息即將入帳', text: amount, when: dayWhen(event.payDate, calendarDaysBetween(usToday, event.payDate) ?? 0), date: event.payDate });
        else if (event.credited && event.payDate >= recent && event.payDate <= usToday) items.push({ id: `DIV:${event.payDate}:${event.eventKey}`, kind: 'dividend', label: '股息已入帳', text: amount, when: `${short(event.payDate)} 入帳`, date: event.payDate });
      }
    }
    return items;
  }, [dividendEvents, dividendSettings.enabled, holidayNoticeEnabled, noticeEarnings, noticeNow, notifyEnabled, recentReleases, trades]);

  const earningsRows = useMemo(() => {
    if (!noticeEarnings) return [];
    const now = Date.now();
    const merged = mergeEarnings(noticeEarnings.symbols, noticeEarnings.yahoo, noticeEarnings.manual, now);
    return noticeEarnings.symbols
      .map((symbol) => ({ symbol, entry: merged[symbol] as EarningsEntry | null, today: exchangeTodayKey(symbol, now) }))
      .sort((a, b) => (a.entry?.date ?? '9999').localeCompare(b.entry?.date ?? '9999') || a.symbol.localeCompare(b.symbol));
  }, [noticeEarnings]);

  const loadUnderlyingQuote = useCallback(async (symbol: string, signal?: AbortSignal) => {
    const fetchedAt = underlyingFetchedAtRef.current.get(symbol) ?? 0;
    // The refresh loop spaces requests 60 s apart; the second of slack absorbs timer jitter.
    if (Date.now() - fetchedAt < 59_000) return;
    underlyingFetchedAtRef.current.set(symbol, Date.now());
    try {
      const response = await fetch(`/api/quotes?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store', signal });
      const payload = await response.json() as { quote?: LiveQuote; error?: string };
      const quote = payload.quote;
      if (!response.ok || !quote || !Number.isFinite(quote.price) || quote.price <= 0) throw new Error(payload.error ?? '暫時無法取得標的報價');
      setUnderlyingQuotes((current) => ({ ...current, [symbol]: { price: quote.price, session: quote.session, marketTime: quote.marketTime, fetchedAt: Date.now() } }));
      setUnderlyingFailures((current) => {
        if (!current.has(symbol)) return current;
        const next = new Set(current);
        next.delete(symbol);
        return next;
      });
    } catch (error) {
      // An aborted request may retry right away; other failures wait a minute and show "—".
      if (error instanceof DOMException && error.name === 'AbortError') underlyingFetchedAtRef.current.delete(symbol);
      else setUnderlyingFailures((current) => current.has(symbol) ? current : new Set(current).add(symbol));
    }
  }, []);

  useEffect(() => {
    if (!optionUnderlyingKey) return;
    const symbols = optionUnderlyingKey.split(',');
    const controller = new AbortController();
    let timer = 0;
    const tick = () => {
      if (document.visibilityState === 'visible') symbols.forEach((symbol) => void loadUnderlyingQuote(symbol, controller.signal));
      timer = window.setTimeout(tick, 60_000);
    };
    timer = window.setTimeout(tick, 1_200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadUnderlyingQuote, optionUnderlyingKey]);

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
        const payload = await response.json() as { SPY?: number[]; BOXX?: number[]; keys?: string[]; warnings?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? '基準資料暫時無法取得');
        if (!controller.signal.aborted) {
          // A benchmark the server could not load comes back as zeros; treat it as missing instead.
          const unavailable = new Set(Array.isArray(payload.warnings) ? payload.warnings : []);
          const next: BenchmarkData = {
            SPY: unavailable.has('SPY') ? [] : payload.SPY ?? [],
            BOXX: unavailable.has('BOXX') ? [] : payload.BOXX ?? [],
            keys: Array.isArray(payload.keys) ? payload.keys : undefined,
          };
          benchmarkCacheRef.current.set(rangeMode, next);
          setBenchmarks({ mode: rangeMode, ...next });
        }
      })
      .catch(() => { if (!controller.signal.aborted) setBenchmarks({ mode: rangeMode, SPY: [], BOXX: [] }); })
      .finally(() => { if (!controller.signal.aborted) setBenchmarkLoading(false); });
    return () => controller.abort();
  }, [rangeMode]);

  // Daily closes for the time-weighted return model. The key changes only when the set of stock
  // tickers, the earliest purchase month or the local date changes, not on every quote refresh.
  const priceHistoryKey = useMemo(() => {
    const target = priceHistoryRequest(trades);
    return target ? `${target.symbols.join(',')}|${target.from}|${today()}` : '';
  }, [trades]);

  useEffect(() => {
    if (!priceHistoryKey) return;
    const cached = priceHistoryCacheRef.current.get(priceHistoryKey);
    if (cached) {
      setPriceHistory(cached);
      return;
    }
    const [symbols, from] = priceHistoryKey.split('|');
    const controller = new AbortController();
    fetch(`/api/price-history?symbols=${encodeURIComponent(symbols)}&from=${from}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { series?: PriceHistorySeries; error?: string };
        if (!response.ok || !payload.series || typeof payload.series !== 'object') throw new Error(payload.error ?? '歷史價格暫時無法取得');
        const next: PriceHistoryState = { key: priceHistoryKey, series: payload.series };
        priceHistoryCacheRef.current.set(priceHistoryKey, next);
        if (!controller.signal.aborted) setPriceHistory(next);
      })
      // Without history the chart keeps the linear-estimate fallback; nothing blocks the page.
      .catch(() => { if (!controller.signal.aborted) setPriceHistory({ key: priceHistoryKey, series: {} }); });
    return () => controller.abort();
  }, [priceHistoryKey]);

  const closeRocBreakdown = useCallback(() => {
    setRocBreakdownOpen(false);
    window.requestAnimationFrame(() => rocTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!rocBreakdownOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRocBreakdown();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeRocBreakdown, rocBreakdownOpen]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const cacheKey = `${macroRangeMode}:all`;
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
        const response = await fetch(`/api/benchmarks?mode=${macroRangeMode}&scope=markets&group=all${refreshParam}`, { signal: controller.signal });
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
  }, [macroRangeMode, macroRefreshKey]);

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
  }, []);

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

  const todayKey = today();
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
  // Option helpers in the editor: the underlying's latest quote (shared with the table's cache),
  // strike shortcuts around it, the short-put collateral and a live option summary.
  const editorOptionRight = editor && editorMarket === 'US' ? optionRightOf({ ...editor, market: editorMarket }) : null;
  const editorUnderlyingSymbol = editorOptionRight ? underlyingSymbolOf(editor?.ticker) : '';
  const editorUnderlyingQuote = editorUnderlyingSymbol ? underlyingQuotes[editorUnderlyingSymbol] ?? null : null;
  const editorOption = (() => {
    if (!editor || !editorOptionRight) return null;
    const quantity = Math.abs(editor.quantity) || 0;
    const strike = parseStrike(editor.strike);
    const direction: 1 | -1 = isShortTrade(editor) ? -1 : 1;
    // Premium per share net of fees: less credit for a seller, more cost for a buyer.
    const feesPerShare = quantity > 0 ? editor.fees / (100 * quantity) : 0;
    const netPremium = direction < 0 ? editor.entryPrice - feesPerShare : editor.entryPrice + feesPerShare;
    const breakeven = strike === null ? null : editorOptionRight === 'put' ? strike - netPremium : strike + netPremium;
    const maxProfit = direction < 0
      ? editor.entryPrice * 100 * quantity - editor.fees
      : editorOptionRight === 'put' && strike !== null ? (strike - editor.entryPrice) * 100 * quantity - editor.fees : null;
    const dte = daysToExpiry(editor.expiryDate, todayKey);
    const daysOpenToExpiry = calendarDaysBetween(editor.openDate, editor.expiryDate);
    const capital = capitalBase(editor);
    const annualIfWorthless = direction < 0 && daysOpenToExpiry !== null && daysOpenToExpiry >= 0 && capital.amount > 0
      ? maxProfit! / capital.amount * 365 / Math.max(1, daysOpenToExpiry)
      : null;
    const useCurrentPrice = editor.status === 'open' && editor.currentPrice !== null && editor.currentPrice > 0;
    const optionPrice = useCurrentPrice ? editor.currentPrice : editor.entryPrice > 0 ? editor.entryPrice : null;
    const analytics = strike !== null && dte !== null && editorUnderlyingQuote
      ? analyzeOptionPosition({ right: editorOptionRight, direction, quantity, strike, daysToExpiry: dte, optionPrice, underlyingPrice: editorUnderlyingQuote.price })
      : null;
    const autoCollateral = direction < 0 && editorOptionRight === 'put' && strike !== null && quantity > 0 ? Number((strike * 100 * quantity).toFixed(2)) : null;
    return { right: editorOptionRight, direction, strike, breakeven, maxProfit, dte, daysOpenToExpiry, capital, annualIfWorthless, optionPrice, useCurrentPrice, analytics, autoCollateral };
  })();
  useEffect(() => {
    if (!editorUnderlyingSymbol) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadUnderlyingQuote(editorUnderlyingSymbol, controller.signal), 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [editorUnderlyingSymbol, loadUnderlyingQuote]);
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

  // Dividends that may still be unpaid or were paid recently, for checking and editing pay dates.
  const recentDividendEvents = useMemo(() => {
    const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    return dividendEvents.filter((event) => event.net > 0 && (event.credited === false || event.date >= cutoff))
      .sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker)).slice(0, 20);
  }, [dividendEvents]);

  const derivedDividendTrades = useMemo<Trade[]>(() => {
    if (!dividendSettings.enabled) return [];
    // Only paid dividends are cash; each appears on the day it is credited.
    const creditDate = (event: DividendEvent) => dividendSettings.creditOn === 'ex' || !event.payDate ? event.date : event.payDate;
    return dividendEvents
      .filter((event) => event.net > 0 && event.credited !== false)
      .sort((a, b) => creditDate(b).localeCompare(creditDate(a)) || a.ticker.localeCompare(b.ticker))
      .map((event, index) => ({
        id: -910_000 - index,
        type: 'CASH',
        openDate: creditDate(event),
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
        notes: `${event.ticker} 股息 · 每股 ${nativeMoney(event.ticker, event.amountPerShare)} · ${quantityNumber.format(event.quantity)} 股 · 稅前 ${nativeMoney(event.ticker, event.gross)} · 預扣 ${nativeMoney(event.ticker, event.tax)}${dividendSettings.creditOn === 'ex' ? '' : ` · 除息 ${event.date} · 發放 ${event.payDate}（${paySourceLabels[event.paySource] ?? '預估'}）`}`,
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
  }, [dividendEvents, dividendSettings.creditOn, dividendSettings.enabled]);
  const portfolioTrades = useMemo(() => [...trades, ...derivedDividendTrades], [derivedDividendTrades, trades]);
  const enriched = useMemo(() => portfolioTrades.map((trade) => ({ trade, ...metrics(trade, usdJpyRate) })), [portfolioTrades, usdJpyRate]);
  const openTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'open'), [enriched]);
  const closedTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'closed'), [enriched]);
  const openPnl = openTrades.reduce((sum, item) => sum + item.pnl, 0);
  const trackedValue = openTrades.reduce((sum, item) => sum + item.marketValue, 0);
  const capitalAtRisk = openTrades.reduce((sum, item) => sum + investedCapitalUsd(item.trade, usdJpyRate), 0);
  const openReturnOnCapital = capitalAtRisk > 0 ? openPnl / capitalAtRisk : null;
  // Moneyness, implied volatility and position greeks of every open US option with a known underlying price.
  const optionRows = useMemo(() => {
    const rows = new Map<number, OptionRowAnalytics>();
    for (const trade of trades) {
      const right = optionRightOf(trade);
      if (!right) continue;
      const direction: 1 | -1 = isShortTrade(trade) ? -1 : 1;
      const strike = parseStrike(trade.strike);
      const open = trade.status === 'open';
      const dte = open ? daysToExpiry(trade.expiryDate, todayKey) : null;
      const symbol = underlyingSymbolOf(trade.ticker);
      const underlying = open && symbol ? underlyingQuotes[symbol]?.price ?? marketSnapshots[symbol]?.price ?? null : null;
      const analytics = open && strike !== null && dte !== null
        ? analyzeOptionPosition({ right, direction, quantity: trade.quantity, strike, daysToExpiry: dte, optionPrice: trade.currentPrice, underlyingPrice: underlying })
        : null;
      rows.set(trade.id, { right, direction, strike, dte, underlying, analytics });
    }
    return rows;
  }, [marketSnapshots, todayKey, trades, underlyingQuotes]);
  // Portfolio totals for the risk strip; null (strip hidden) without open option trades.
  const optionRisk = useMemo(() => {
    const items: OptionRiskItem[] = [];
    for (const trade of trades) {
      const row = trade.status === 'open' ? optionRows.get(trade.id) : undefined;
      if (!row) continue;
      items.push({ id: trade.id, ticker: trade.ticker || '—', right: row.right, direction: row.direction, strike: row.strike, expiryDate: trade.expiryDate, daysToExpiry: row.dte, capital: investedCapitalUsd(trade, usdJpyRate), analytics: row.analytics });
    }
    return items.length ? summarizeOptionRisk(items, capitalAtRisk) : null;
  }, [capitalAtRisk, optionRows, trades, usdJpyRate]);
  // 本年權利金 (from the prototype): premium received on options sold this calendar year (USD, before
  // buy-backs), and what the ones already closed this year actually kept.
  const yearPremium = useMemo(() => {
    const year = todayKey.slice(0, 4);
    let received = 0, count = 0, kept = 0, closed = 0;
    for (const item of enriched) {
      const trade = item.trade;
      if (!optionRightOf(trade) || !isShortTrade(trade) || trade.derived) continue;
      if (trade.openDate.startsWith(year)) { received += normalizedUsdAmount(trade, trade.entryPrice * OPTION_CONTRACT_SIZE * Math.abs(trade.quantity), usdJpyRate); count += 1; }
      if (trade.status === 'closed' && (trade.closeDate ?? '').startsWith(year)) { kept += item.pnl; closed += 1; }
    }
    return count || closed ? { received, count, kept, closed } : null;
  }, [enriched, todayKey, usdJpyRate]);
  const currentRocYear = Number(today().slice(0, 4));
  const annualRocSummary = useMemo(() => buildAnnualRocSummary(closedTrades, currentRocYear, usdJpyRate), [closedTrades, currentRocYear, usdJpyRate]);

  // What the AI assistant sees: the open positions and totals this page shows (no notes or names).
  const buildAssistantSnapshot = useCallback((): PortfolioSnapshot => {
    const round = (value: number, digits = 2) => Number(value.toFixed(digits));
    const positions = openTrades.map(({ trade, pnl, marketValue }): SnapshotPosition => {
      const right = optionRightOf(trade);
      const row = right ? optionRows.get(trade.id) : undefined;
      return {
        ticker: trade.ticker || (isCashTrade(trade) ? 'USD' : '—'),
        kind: isCashTrade(trade) ? 'cash' : right === 'put' ? 'put' : right === 'call' ? 'call' : isStockTrade(trade) || isYenTrade(trade) ? 'stock' : 'other',
        side: isShortTrade(trade) ? 'short' : 'long',
        quantity: trade.quantity,
        strike: right ? trade.strike : null,
        expiry: right ? trade.expiryDate : null,
        daysToExpiry: row?.dte ?? null,
        entryPrice: trade.entryPrice,
        currentPrice: trade.currentPrice,
        underlyingPrice: row?.underlying ?? null,
        marketValueUsd: round(marketValue),
        pnlUsd: round(pnl),
        currency: isYenTrade(trade) ? 'JPY' : 'USD',
      };
    });
    const year = currentRocYear;
    return {
      asOf: todayKey,
      usdJpy: usdJpyRate > 0 ? round(usdJpyRate, 3) : null,
      totals: { marketValueUsd: round(trackedValue), openPnlUsd: round(openPnl), capitalUsd: round(capitalAtRisk) },
      positions,
      closed: {
        count: closedTrades.length,
        realizedUsd: round(closedTrades.reduce((sum, item) => sum + item.pnl, 0)),
        yearRealizedUsd: round(closedTrades.filter((item) => item.trade.closeDate?.startsWith(String(year))).reduce((sum, item) => sum + item.pnl, 0)),
        year,
      },
      dividends: dividendSettings.enabled ? {
        usdNet: round(dividendCash.USD.net), jpyNet: round(dividendCash.JPY.net, 0),
        usdPending: round(dividendPending?.USD.net ?? 0), jpyPending: round(dividendPending?.JPY.net ?? 0, 0),
      } : null,
    };
  }, [capitalAtRisk, closedTrades, currentRocYear, dividendCash, dividendPending, dividendSettings.enabled, openPnl, openTrades, optionRows, todayKey, trackedValue, usdJpyRate]);

  const activePriceHistory = priceHistory && priceHistory.key === priceHistoryKey ? priceHistory : null;
  const priceHistoryPending = Boolean(priceHistoryKey) && !activePriceHistory;
  const returnAnalytics = useMemo(() => timeWeightedReturnSeries(trades, rangeMode, {
    todayKey: today(),
    usdJpyRate,
    prices: activePriceHistory?.series ?? null,
  }), [activePriceHistory, rangeMode, trades, usdJpyRate]);
  const returnSeries = returnAnalytics.series;
  // Benchmarks are matched to chart buckets by key, so a server/browser date difference cannot shift them.
  const activeBenchmarks = useMemo(() => {
    const source = benchmarks.mode === rangeMode ? benchmarks : null;
    const align = (values: number[]) => {
      if (!source || !values.length) return [];
      if (source.keys?.length === values.length) {
        const byKey = new Map(source.keys.map((key, index) => [key, values[index]]));
        return returnSeries.map((item) => byKey.get(item.key) ?? 0);
      }
      return returnSeries.map((_, index) => values[index] ?? 0);
    };
    return { SPY: align(source?.SPY ?? []), BOXX: align(source?.BOXX ?? []) };
  }, [benchmarks, rangeMode, returnSeries]);
  const estimatedReturnTickers = returnAnalytics.estimatedTickers;
  const returnEstimateNote = priceHistoryPending
    ? '（股價資料讀取中，暫以線性估算）'
    : estimatedReturnTickers.length
      ? `（估算：${estimatedReturnTickers.slice(0, 6).join('、')}${estimatedReturnTickers.length > 6 ? ` 等 ${estimatedReturnTickers.length} 檔` : ''}）`
      : '';
  // The chart and the figures above it start at the first period with money in the market: the
  // portfolio has no return before that, and compounding SPY over those periods made 相對 SPY meaningless.
  const perfStart = useMemo(() => {
    const first = returnSeries.findIndex((item) => item.capital > 0);
    return first < 0 ? 0 : Math.min(first, Math.max(0, returnSeries.length - 2));
  }, [returnSeries]);
  const perfLabels = useMemo(() => returnSeries.slice(perfStart).map((item) => perfLabel(rangeMode, item)), [perfStart, rangeMode, returnSeries]);
  const perfSeries = useMemo(() => ({ mine: returnSeries.slice(perfStart).map((item) => item.value), spy: activeBenchmarks.SPY.slice(perfStart), boxx: activeBenchmarks.BOXX.slice(perfStart) }), [activeBenchmarks, perfStart, returnSeries]);
  const spyCumulative = perfSeries.spy.length ? perfSeries.spy.reduce((growth, value) => growth * (1 + value), 1) - 1 : null;
  const returnWindowLabel = perfStart > 0 ? `${perfLabels[0]} 起` : rangeMode === 'day' ? '近 60 個交易日' : rangeMode === 'week' ? '近 52 週' : rangeMode === 'month' ? '近 36 個月' : '近 6 年';
  // Metrics leave out the stretch before the first position.
  const riskMetrics = useMemo(() => {
    const first = returnSeries.findIndex((item) => item.capital > 0);
    if (first < 0) return null;
    const rows = returnSeries.map((item, index) => ({ item, index })).filter(({ index }) => index >= first);
    if (rows.length < 2) return null;
    return computeRiskMetrics({
      labels: rows.map(({ item }) => perfLabel(rangeMode, item)),
      mine: rows.map(({ item }) => item.value),
      spy: rows.map(({ index }) => activeBenchmarks.SPY[index] ?? 0),
      boxx: rows.map(({ index }) => activeBenchmarks.BOXX[index] ?? 0),
    }, rangeMode);
  }, [activeBenchmarks, rangeMode, returnSeries]);
  // 月曆 needs every day since the first trade, so it is only computed while that view is open.
  const heatGrid = useMemo(() => {
    if (returnView !== 'heat') return [];
    const from = trades.reduce((earliest, trade) => trade.openDate && /^\d{4}-\d{2}-\d{2}$/.test(trade.openDate) && (!earliest || trade.openDate < earliest) ? trade.openDate : earliest, '');
    if (!from) return [];
    const daily = dailyTimeWeightedReturns(trades, { startDate: from, endDate: today(), usdJpyRate, prices: activePriceHistory?.series ?? null });
    return monthlyGrid(daily.days);
  }, [activePriceHistory, returnView, trades, usdJpyRate]);
  const rangeModeLabel = rangeMode === 'day' ? '日' : rangeMode === 'week' ? '週' : rangeMode === 'month' ? '月' : '年';
  const macroRangeModeLabel = macroRangeMode === 'day' ? '日' : macroRangeMode === 'week' ? '週' : macroRangeMode === 'month' ? '月' : '年';
  const macroTimeline = useMemo(() => rangeBuckets(macroRangeMode, today()), [macroRangeMode]);
  const activeMacroIds: BenchmarkMarket['id'][] = ['USDJPY', 'US10Y', 'US30Y', 'GOLD', 'OIL'];
  const activeMacroMarkets = macroMarkets.mode === macroRangeMode ? activeMacroIds.flatMap((id) => {
    const market = macroMarkets.markets.find((candidate) => candidate.id === id);
    return market ? [market] : [];
  }) : [];
  const usdJpyEstimated = !(usdJpyRate > 50 && usdJpyUpdatedAt);
  const macroUpdatedLabel = macroMarkets.updatedAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(macroMarkets.updatedAt)) : '等待更新';

  const currentAllocationDate = today();
  const allocationPresets = [
    { label: '目前', date: currentAllocationDate },
    { label: '1 個月', date: monthsBefore(currentAllocationDate, 1) },
    { label: '3 個月', date: monthsBefore(currentAllocationDate, 3) },
    { label: '1 年', date: monthsBefore(currentAllocationDate, 12) },
  ];
  const earliestAllocationDate = trades.reduce((earliest, trade) => !earliest || trade.openDate < earliest ? trade.openDate : earliest, '') || currentAllocationDate;
  // The donut follows the 色調 when one is on.
  const allocationColors = activeTone ? tonePalettes[activeTone][wafuTheme] : palettes[wafuTheme];
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
      items: top.map((item, index) => ({ ...item, share: total > 0 ? item.value / total : 0, color: allocationColors[index % allocationColors.length] })),
      total,
      tradeCount: current ? openTrades.length : allocationHistory?.date === allocationDate ? allocationHistory.tradeCount : 0,
      estimatedTickers: current ? [] : allocationHistory?.date === allocationDate ? allocationHistory.estimatedTickers : [],
    };
  }, [allocationColors, allocationDate, allocationHistory, currentAllocationDate, openTrades]);
  const allocation = allocationSnapshot.items as AllocationItem[];
  // 集中度提醒 (from the prototype): how much of the book sits in the three largest holdings.
  const concentration = useMemo(() => {
    const ranked = [...allocation].filter((item) => item.share > 0).sort((a, b) => b.share - a.share);
    if (ranked.length < 2) return null;
    const top3 = ranked.slice(0, 3).reduce((sum, item) => sum + item.share, 0);
    return { top3, top1: ranked[0].share, names: ranked.slice(0, 3).map((item) => item.label), level: top3 >= 0.75 ? 'high' as const : top3 >= 0.5 ? 'mid' as const : 'low' as const };
  }, [allocation]);
  // The quick sheet's 個股研究 opens the ticker in view, else the largest position.
  const researchTicker = drilledTicker ?? allocation.flatMap((item) => item.members).find((member) => member !== 'USD' && member !== 'JPY') ?? null;
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
      group.items.push(item);
      group.marketValue += item.marketValue;
      group.pnl += item.pnl;
      group.capital += investedCapitalUsd(item.trade, usdJpyRate);
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
  // The research drawer's header: holding, average cost and unrealised P&L of the ticker in view.
  // 個股研究 chip row (prototype): every current holding with its P&L % as in the 持倉 list (all of the
  // ticker's trades, like the drawer's header); the list itself is filtered to one ticker while the
  // drawer is up, so this groups the unfiltered trades. Stocks by value first, then cash, then options.
  const researchChips = useMemo(() => {
    const groups = new Map<string, { symbol: string; pnl: number; capital: number; value: number; stock: boolean; option: boolean; cash: boolean }>();
    for (const item of enriched) {
      const symbol = item.trade.ticker || 'OTHER';
      const group = groups.get(symbol) ?? { symbol, pnl: 0, capital: 0, value: 0, stock: false, option: false, cash: false };
      group.pnl += item.pnl;
      group.capital += investedCapitalUsd(item.trade, usdJpyRate);
      group.value += item.marketValue;
      if (item.trade.status === 'open') {
        if (isCashTrade(item.trade)) group.cash = true;
        else if (item.trade.type === 'SDI' || item.trade.event === 'STOCK') group.stock = true;
        else group.option = true;
      }
      groups.set(symbol, group);
    }
    const rank = { stock: 0, cash: 1, option: 2 } as const;
    return [...groups.values()]
      .filter((group) => group.symbol !== 'OTHER' && (group.stock || group.option || group.cash))
      .map((group): ResearchChip & { value: number } => ({
        symbol: group.symbol,
        kind: group.symbol === 'USD' || group.symbol === 'JPY' ? 'cash' : group.stock ? 'stock' : group.option ? 'option' : 'cash',
        roc: group.capital > 0 ? group.pnl / group.capital : 0,
        value: group.value,
      }))
      .sort((a, b) => rank[a.kind] - rank[b.kind] || b.value - a.value);
  }, [enriched, usdJpyRate]);
  const researchSymbols = useMemo(() => researchChips.filter((chip) => chip.kind === 'stock').map((chip) => chip.symbol), [researchChips]);
  const researchPosition = drilledTicker ? visualPositions.find((position) => position.ticker === drilledTicker) ?? null : null;
  const researchSummary = useMemo(() => {
    if (!drilledTicker || !researchPosition) return [];
    const parts: Array<{ text: string; tone?: 'positive' | 'negative' }> = [];
    if (researchPosition.stockQuantity > 0) parts.push({ text: `持有 ${researchPosition.stockQuantity} 股` });
    if (researchPosition.optionQuantity > 0) parts.push({ text: `選擇權 ${researchPosition.optionQuantity} 口` });
    parts.push({ text: `平均取得 ${nativeMoney(drilledTicker, researchPosition.entryPrice)}` });
    parts.push({ text: `未實現損益 ${researchPosition.pnl >= 0 ? '+' : '−'}${money.format(Math.abs(researchPosition.pnl))}（${signedPrecisePercent(researchPosition.roc)}）`, tone: researchPosition.pnl >= 0 ? 'positive' : 'negative' });
    return parts;
  }, [drilledTicker, researchPosition]);

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

  // 手動報價: the rows (options first, then manual stocks; auto stocks only on request) and the batch save.
  const manualQuoteRows = useMemo<ManualQuoteRow[]>(() => {
    if (!manualQuotesOpen) return [];
    return trades.filter((trade) => trade.status === 'open' && !trade.derived && !isCashTrade(trade) && trade.ticker).map((trade) => {
      const stock = trade.type === 'SDI' || trade.event === 'STOCK';
      const right = optionRightOf(trade);
      const option = optionRows.get(trade.id);
      const yen = isJapaneseTicker(trade.ticker);
      return {
        id: trade.id,
        ticker: trade.ticker!,
        label: stock ? '股票' : right ? `${right.toUpperCase()} ${trade.strike ?? ''}`.trim() : trade.event,
        sub: [trade.expiryDate ? `到期 ${trade.expiryDate}` : '', `成本 ${nativeMoney(trade.ticker, trade.entryPrice)}`, `${trade.quantity} ${stock ? '股' : '口'}`].filter(Boolean).join(' · '),
        current: trade.currentPrice,
        hint: option?.underlying ? `標的 ${nativeMoney(trade.ticker, option.underlying)}` : undefined,
        auto: stock && trade.quoteMode === 'auto',
        currency: yen ? '¥' as const : '$' as const,
      };
    }).sort((a, b) => Number(a.label === '股票') - Number(b.label === '股票') || a.ticker.localeCompare(b.ticker));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualQuotesOpen]);

  async function saveManualQuotes(changes: Array<{ id: number; price: number }>) {
    let saved = 0;
    for (const change of changes) {
      const trade = trades.find((item) => item.id === change.id);
      if (!trade) continue;
      try { await persistTrade({ ...trade, currentPrice: change.price, quoteMode: 'manual' }, 'PUT'); saved += 1; } catch { /* reported below */ }
    }
    notify(saved === changes.length ? `已更新 ${saved} 筆手動報價` : `已更新 ${saved} 筆，${changes.length - saved} 筆儲存失敗`);
    if (saved !== changes.length) throw new Error('partial');
    return saved;
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
      setResearchTab('technical');
    }
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

  // 估值 opens the DCF tab of a stock's research drawer (the open one, else the first holding).
  function openValuation(ticker?: string) {
    const symbol = ticker ?? researchSymbols[0];
    if (!symbol) return;
    openTickerDetails(symbol);
    setResearchTab('dcf');
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

  const customTradeColumns = !isDefaultTradeColumns(tradeColumnSet);
  const visibleTradeColumns = tradeColumns.filter((column) => tradeColumnSet.includes(column.id));
  const updateTradeColumns = useCallback((next: TradeColumnId[]) => {
    setTradeColumnSet(next);
    writeStoredTradeColumns(next);
  }, []);

  // 欄位 values for one visual position: options are summed or take the nearest / riskiest leg.
  function visualFieldValues(position: (typeof visualPositions)[number], openItems: typeof filteredTrades, snapshot: LiveQuote | undefined, price: number): Partial<Record<VisualFieldId, { text: string; tone?: 'positive' | 'negative'; range?: number; title?: string }>> {
    const values: Partial<Record<VisualFieldId, { text: string; tone?: 'positive' | 'negative'; range?: number; title?: string }>> = {};
    const signed = (value: number) => value >= 0 ? 'positive' as const : 'negative' as const;
    const firstOpen = openItems.reduce((earliest, item) => !earliest || item.trade.openDate < earliest ? item.trade.openDate : earliest, '');
    const held = firstOpen ? Math.max(1, calendarDaysBetween(firstOpen, todayKey) ?? 1) : null;
    if (held !== null) values.held = { text: `${held} 天` };
    if (held !== null && position.capital > 0) { const annual = position.roc * 365 / held; values.annual = { text: cappedAnnualized(annual), tone: signed(annual) }; }
    const high = snapshot?.yearHigh ?? null, low = snapshot?.yearLow ?? null;
    if (high !== null && low !== null && high > low) values.range = { text: `${nativeMoney(position.ticker, low)} – ${nativeMoney(position.ticker, high)}`, range: Math.max(0, Math.min(1, (price - low) / (high - low))) };
    let delta = 0, theta = 0, hasGreeks = false, dte: number | null = null, otm: number | null = null, assign: number | null = null;
    for (const { trade } of openItems) {
      const option = optionRows.get(trade.id);
      if (!option) {
        if (trade.type === 'SDI' || trade.event === 'STOCK') { delta += Math.abs(trade.quantity) * (trade.type.toLowerCase() === 'sell' ? -1 : 1); hasGreeks = true; }
        continue;
      }
      if (option.dte !== null && (dte === null || option.dte < dte)) dte = option.dte;
      const analytics = option.analytics;
      if (analytics?.positionDelta != null) { delta += analytics.positionDelta; hasGreeks = true; }
      if (analytics?.positionTheta != null) theta += analytics.positionTheta;
      if (analytics?.otmPercent != null && (otm === null || analytics.otmPercent < otm)) otm = analytics.otmPercent;
      if (analytics?.greeks && (assign === null || analytics.greeks.probabilityItm > assign)) assign = analytics.greeks.probabilityItm;
    }
    if (dte !== null) values.dte = { text: `${dte} 天` };
    if (hasGreeks) values.delta = { text: `${signedDecimal(delta)} 股` };
    if (theta) values.theta = { text: signedMoney(theta), tone: signed(theta) };
    if (otm !== null) values.moneyness = { text: signedPercent(otm), tone: signed(otm) };
    if (assign !== null) values.assign = { text: percent.format(assign) };
    const openCapital = openItems.reduce((sum, item) => sum + investedCapitalUsd(item.trade, usdJpyRate), 0);
    if (openCapital > 0 && capitalAtRisk > 0) values.capital = { text: percent.format(openCapital / capitalAtRisk) };
    return values;
  }

  // One details-table cell. The original eleven columns render exactly as before; the optional
  // columns show "—" wherever a value does not apply (stock, cash, closed or unpriced options).
  function renderTradeCell(columnId: TradeColumnId, { trade, pnl, roc, days }: (typeof filteredTrades)[number]) {
    const dividendSource = trade.event === 'DIVIDEND' ? trade.dividendSourceTicker : null;
    const cash = isCashTrade(trade);
    const option = optionRows.get(trade.id) ?? null;
    const analytics = option?.analytics ?? null;
    const tone = (value: number | null) => value === null || Number.isNaN(value) ? '' : value >= 0 ? ' positive' : ' negative';
    const optionGap = option && option.dte !== null
      ? option.strike === null ? '履約價無法解析（例如價差組合）' : option.underlying === null ? '等待標的報價' : !analytics?.greeks ? '目前權利金超出無套利範圍，無法反推 IV' : undefined
      : undefined;
    const metricCell = (text: string | null, className = '', title?: string) => <td key={columnId} className={`trade-metric-cell${className}`} title={text === null ? optionGap : title}>{text ?? '—'}</td>;
    switch (columnId) {
      case 'ticker': return <td key={columnId}>{dividendSource ? <span className="symbol-cell dividend-source-cell"><CompanyLogo ticker={dividendSource} compact /><span><strong>{dividendSource}</strong><small>{companyNames[dividendSource] ?? (isJapaneseTicker(dividendSource) ? '日本股票' : '股息發放公司')}</small></span></span> : isCashTrade(trade) ? <span className="symbol-cell"><CompanyLogo ticker={trade.ticker || 'USD'} compact /><strong>{trade.ticker || 'USD'}</strong></span> : <button type="button" className="symbol-cell symbol-cell-button" onClick={() => trade.ticker && openTickerDetails(trade.ticker)}><CompanyLogo ticker={trade.ticker || 'OTHER'} compact /><strong>{trade.ticker || '—'}</strong></button>}</td>;
      case 'strategy': return <td key={columnId}><strong className="strategy-name">{trade.event}</strong><span className="subtle">{dividendSource ? `${dividendSource} 發放 · 稅後入帳 ${trade.ticker}` : trade.derived ? '自動股息現金' : trade.type === 'CASH' ? 'Cash' : trade.type === 'SDI' ? 'Stock' : trade.type}</span></td>;
      case 'dates': return <td key={columnId} className={customTradeColumns ? 'trade-dates-cell' : undefined}><strong>{dateLabel(trade.openDate)}</strong><span className="subtle">Exp {dateLabel(trade.expiryDate)}</span></td>;
      case 'strike': return <td key={columnId}>{trade.strike || '—'}</td>;
      case 'quantity': return <td key={columnId}>{isCashTrade(trade) ? nativeMoney(trade.ticker, trade.quantity) : trade.quantity}</td>;
      case 'entry': return <td key={columnId}>{isCashTrade(trade) ? '—' : nativeMoney(trade.ticker, trade.entryPrice)}</td>;
      case 'current': return <td key={columnId}>{isCashTrade(trade) ? <span className="cash-table-status"><i />不需報價</span> : priceEditId === trade.id ? <div className="inline-price"><span>{isJapaneseTicker(trade.ticker) ? '¥' : '$'}</span><input autoFocus inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveInlinePrice(trade); if (event.key === 'Escape') setPriceEditId(null); }} /><button onClick={() => saveInlinePrice(trade)}>✓</button></div> : <button className="price-button" onClick={() => { setPriceEditId(trade.id); setPriceInput(String(trade.currentPrice ?? '')); }}><span className={trade.quoteMode === 'auto' ? 'live-dot' : 'manual-dot'} />{trade.currentPrice === null ? '設定' : nativeMoney(trade.ticker, trade.currentPrice)} <i>✎</i></button>}</td>;
      case 'pnl': return <td key={columnId} className={pnl >= 0 ? 'positive' : 'negative'}><strong>{money.format(pnl)}</strong></td>;
      case 'roc': return <td key={columnId} className={roc >= 0 ? 'positive' : 'negative'}>{percent.format(roc)}</td>;
      case 'status': return <td key={columnId}><span className={`status ${trade.status}`}><i />{trade.status === 'open' ? '未平倉' : '已平倉'}</span></td>;
      case 'actions': return <td key={columnId}>{trade.derived ? <span className="row-actions"><button className="row-action-button" onClick={() => openDividendAdjustment(trade)} aria-label={`調減 ${trade.dividendSourceTicker ?? '股息'}`}>調減</button><button className="row-action-button delete" onClick={() => setDeleteCandidate(trade)} aria-label={`刪除 ${trade.dividendSourceTicker ?? '股息'}`}>刪除</button></span> : <span className="row-actions"><button className="row-action-button" onClick={() => setEditor({ ...trade })} aria-label={`編輯 ${trade.ticker ?? '交易'}`}>編輯</button><button className="row-action-button delete" onClick={() => setDeleteCandidate(trade)} aria-label={`刪除 ${trade.ticker ?? '交易'}`}>刪除</button></span>}</td>;
      case 'dte': return metricCell(option?.dte === null || option?.dte === undefined ? null : `${option.dte} 天`, '', trade.expiryDate ?? undefined);
      case 'held': {
        const held = cash ? null : days > 0 ? days : Math.max(1, calendarDaysBetween(trade.openDate, trade.closeDate ?? todayKey) ?? 1);
        return <td key={columnId} className="trade-metric-cell">{held === null ? '—' : `${held} 天`}</td>;
      }
      case 'otm': return metricCell(analytics?.otmPercent == null ? null : signedPercent(analytics.otmPercent), tone(analytics?.otmPercent ?? null), option?.underlying ? `標的 ${money.format(option.underlying)}` : undefined);
      case 'annualRoc': {
        const annual = cash || !(days > 0) ? null : roc * 365 / days;
        return <td key={columnId} className={`trade-metric-cell${tone(annual)}`}>{cappedAnnualized(annual)}</td>;
      }
      case 'capitalBase': {
        if (cash) return <td key={columnId} className="trade-metric-cell">—</td>;
        const base = capitalBase(trade);
        return <td key={columnId} className="trade-metric-cell"><strong>{nativeMoney(trade.ticker, base.amount)}</strong><span className="subtle">{capitalBasisLabels[base.basis]}</span></td>;
      }
      case 'capitalShare': {
        const share = trade.status === 'open' && !cash && capitalAtRisk > 0 ? investedCapitalUsd(trade, usdJpyRate) / capitalAtRisk : null;
        return <td key={columnId} className="trade-metric-cell">{share === null ? '—' : percent.format(share)}</td>;
      }
      case 'delta': return metricCell(analytics?.positionDelta == null ? null : `${signedDecimal(analytics.positionDelta)} 股`, '', analytics?.greeks ? `每股 Delta ${analytics.greeks.delta.toFixed(3).replace('-', '−')}` : undefined);
      case 'theta': return metricCell(analytics?.positionTheta == null ? null : signedMoney(analytics.positionTheta), tone(analytics?.positionTheta ?? null));
      case 'vega': return metricCell(analytics?.positionVega == null ? null : signedMoney(analytics.positionVega));
      case 'iv': return metricCell(analytics?.impliedVol == null ? null : percent.format(analytics.impliedVol));
      case 'assignment': return metricCell(analytics?.greeks ? percent.format(analytics.greeks.probabilityItm) : null, '', option?.direction === 1 ? '買方：到期價內機率' : undefined);
    }
  }

  // Worked out in the browser (and every 30 s) so the pill never differs from the server's render.
  const [marketSession, setMarketSession] = useState<MarketSession>('closed');
  useEffect(() => {
    const update = () => setMarketSession(marketSessionAt(Date.now()));
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const imageBackgroundActive = backgroundMode === 'image' && Boolean(backgroundImage);
  const shellStyle = useMemo(() => imageBackgroundActive ? { '--custom-background': `url("${backgroundImage}")` } as CSSProperties : undefined, [backgroundImage, imageBackgroundActive]);
  const selectedStockTrades = useMemo(() => drilledTicker ? trades.filter((trade) => trade.ticker === drilledTicker && (trade.type === 'SDI' || trade.event === 'STOCK')) : [], [drilledTicker, trades]);
  // Side-navigation icon: the original glyph, or in a 和風 theme a line icon with the character's halo over the current item.
  const navGlyph = (name: WafuNavIconName, current: boolean) => <i className="wafu-nav-glyph"><NavIcon name={name} />{current && <span className="wafu-nav-halo" aria-hidden="true"><HaloIcon theme={wafuTheme} size={34} tilt={64} /></span>}</i>;

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
            <i className="brand-crest" aria-hidden="true"><svg viewBox="-1.3 -1.3 2.6 2.6">{wafuTheme === 'shigure'
              ? <g fill="none" strokeLinejoin="round" strokeLinecap="round"><path d={yukiwaOutline()} strokeWidth={0.08} /><path d={snowCrystal(0.44)} strokeWidth={0.06} /></g>
              : <g fill="none" strokeLinejoin="round" strokeLinecap="round"><path d={kikyoOutline()} strokeWidth={0.08} /><path d={kikyoInner()} strokeWidth={0.06} /></g>}</svg></i>
            <span>OPTIONFLOW</span>
          </a>
          <HeaderMarketCalendar />
        </div>
        {notifyEnabled && <div className="topbar-notice"><NotifyCenter theme={wafuTheme} items={noticeItems} openSignal={notifySignal} bar={notifyBar} calendar={noticeCalendar} /></div>}
        <div className="header-actions">
          <LanguageSwitcher />
          {wafuMedia.musicDock && <MusicDock theme={wafuTheme} />}
          <span className={`market-pill is-${marketSession}`}><span />{marketSession === 'open' ? '美股交易中' : marketSession === 'pre' ? '盤前' : marketSession === 'post' ? '盤後' : '非交易時段'}</span>
          <button className="secondary-button" type="button" onClick={() => refreshQuotes()} disabled={refreshing}>{refreshing ? '更新中…' : '↻ 更新報價'}</button>
          <button className="primary-button" type="button" onClick={() => setEditor(blankTrade())}>＋新增交易</button>
        </div>
      </header>
      {!notifyEnabled && <HolidayNotice enabled={holidayNoticeEnabled} earnings={noticeEarnings} releases={recentReleases} onOpenRelease={setFilingDialogSymbol} />}

      <div className="page-frame">
        <nav className="side-nav" aria-label="頁面切換">
          <button type="button" className={`settings-nav-button ${settingsOpen ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}>{navGlyph('settings', settingsOpen)}<span>設定</span></button>
          {([['overview', '總覽'], ['positions', '持倉'], ['returns', '收益']] as const).map(([section, label]) => <a key={section} href={`#${section}`} className={activeSection === section ? 'active' : ''} aria-current={activeSection === section ? 'page' : undefined} onClick={(event) => { event.preventDefault(); setActiveSection(section); window.history.replaceState(null, '', `#${section}`); document.getElementById(section)?.scrollIntoView({ behavior: 'auto', block: 'start' }); }}>{navGlyph(section, activeSection === section)}<span>{label}</span></a>)}
          <button type="button" className={`settings-nav-button ${activeSection === 'valuation' ? 'active' : ''}`} aria-current={activeSection === 'valuation' ? 'page' : undefined} onClick={() => openValuation(drilledTicker ?? undefined)}>{navGlyph('valuation', activeSection === 'valuation')}<span>估值</span></button>
          {assistantOn && <button type="button" className={`settings-nav-button wafu-nav-ai ${assistantOpen ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={assistantOpen} onClick={() => setAssistantOpen((open) => !open)}><i className="wafu-nav-glyph"><HaloIcon theme={wafuTheme} size={24} spin={assistantOpen} minStrokePx={1} /></i><span>AI</span></button>}
          <div className="background-control">
            <button type="button" className="background-trigger" disabled={backgroundSaving} onClick={() => backgroundInputRef.current?.click()} title={backgroundSaving ? '正在永久保存背景圖片' : backgroundImage ? '更換背景圖片' : '加入背景圖片'}>{navGlyph(backgroundSaving ? 'saving' : 'background', false)}<span>{backgroundSaving ? '保存中' : backgroundImage ? '換圖片' : '背景'}</span></button>
            {backgroundImage && <div className="background-mode-switch" aria-label="背景顯示方式"><button type="button" disabled={backgroundSaving} className={backgroundMode === 'default' ? 'active' : ''} aria-pressed={backgroundMode === 'default'} onClick={() => switchBackgroundMode('default')}>原始</button><button type="button" disabled={backgroundSaving} className={backgroundMode === 'image' ? 'active' : ''} aria-pressed={backgroundMode === 'image'} onClick={() => switchBackgroundMode('image')}>圖片</button></div>}
            <input ref={backgroundInputRef} className="visually-hidden" type="file" accept="image/*" disabled={backgroundSaving} onChange={handleBackgroundUpload} />
          </div>
        </nav>
        <div className="dashboard">
        <section className="hero" id="overview">
          <div className="wafu-hero-title"><EditableHeroTitle onNotify={notify} theme={wafuTheme} /><p className="wafu-hero-sub">{wafuTheme === 'shigure' ? '赤冬 · 雪夜的自家調配帳' : '作戰參謀的帳簿 · 百花繚亂'}</p></div>
          <LiveMarketClocks lastQuoteAt={lastQuoteAt} />
        </section>

        <section className="metric-grid" aria-label="投資組合摘要">
          <article className="metric-card featured"><p>追蹤市值</p><strong>{loading ? '—' : money.format(trackedValue)}</strong><span>{openTrades.length} 筆未平倉持倉</span></article>
          <article className="metric-card"><p>未實現損益</p><strong className={openPnl >= 0 ? 'positive' : 'negative'}>{loading ? '—' : money.format(openPnl)}</strong><span className={`metric-return ${openReturnOnCapital === null ? '' : openReturnOnCapital >= 0 ? 'positive' : 'negative'}`}>{loading ? '計算中…' : openReturnOnCapital === null ? 'ROIC —' : `ROIC ${openReturnOnCapital >= 0 ? '+' : ''}${percent.format(openReturnOnCapital)}`}</span></article>
          <article className="metric-card"><p>擔保／投入資本</p><strong>{loading ? '—' : money.format(capitalAtRisk)}</strong><span>股票採買入成本；賣方選擇權採擔保金或履約價名目</span></article>
          <article className={`metric-card metric-card-interactive ${rocBreakdownOpen ? 'is-open' : ''}`}>
            <p>本年度加權年化 ROC</p>
            <strong className={annualRocSummary.value === null ? '' : annualRocSummary.value >= 0 ? 'positive' : 'negative'}>{loading || annualRocSummary.value === null ? '—' : precisePercent.format(annualRocSummary.value)}</strong>
            <span>{currentRocYear} · {annualRocSummary.count} 筆有效平倉交易</span>
            <button
              ref={rocTriggerRef}
              type="button"
              className="metric-card-action"
              aria-haspopup="dialog"
              aria-expanded={rocBreakdownOpen}
              aria-label={`查看本年度加權年化 ROC 計算明細（${currentRocYear}，${annualRocSummary.count} 筆平倉交易）`}
              title="本年度已實現損益 ÷ 資金占用年數（投入資本 × 持有天數 ÷ 365）"
              onClick={() => setRocBreakdownOpen(true)}
            ><span>查看明細</span></button>
          </article>
        </section>

        {brokerHubEnabled && <Suspense fallback={<section className="broker-hub-loader" id="broker-hub" aria-busy="true"><span /><strong>正在開啟跨券商資產中樞…</strong></section>}>
          <BrokerHub initialWorkspace={brokerWorkspaceSeed} usdJpyRate={usdJpyRate} usdJpyEstimated={usdJpyEstimated} usdJpyUpdatedAt={usdJpyEstimated ? null : usdJpyUpdatedAt} onNotify={notify} />
        </Suspense>}

        <article className="panel return-panel wafu-perf-panel" id="returns" aria-busy={benchmarkLoading}>
          <div className="panel-heading">
            <div><p className="eyebrow">Return analytics</p><h2>收益分析</h2></div>
            <div className="wafu-perf-controls">
              <div className="segmented wafu-return-views" role="group" aria-label="收益圖表檢視">
                {([['cum', '累積'], ['period', '單期'], ['dd', '回撤'], ['heat', '月曆']] as const).map(([view, label]) => <button type="button" key={view} className={returnView === view ? 'selected' : ''} aria-pressed={returnView === view} onClick={() => setReturnView(view)}>{label}</button>)}
              </div>
              <div className="segmented" role="group" aria-label="收益率期間">
                {([['day', '日'], ['week', '週'], ['month', '月'], ['year', '年']] as const).map(([mode, label]) => <button type="button" key={mode} className={rangeMode === mode ? 'selected' : ''} aria-pressed={rangeMode === mode} onClick={() => setRangeMode(mode)}>{label}</button>)}
              </div>
            </div>
          </div>
          <div className="wafu-perf-summary">
            <div className="wafu-perf-big"><strong className={returnAnalytics.cumulative >= 0 ? 'positive' : 'negative'}>{signedPrecisePercent(returnAnalytics.cumulative)}</strong><span>{returnWindowLabel}累積報酬</span></div>
            <dl>
              <div><dt>相對 SPY</dt><dd className={spyCumulative === null ? '' : returnAnalytics.cumulative - spyCumulative >= 0 ? 'positive' : 'negative'}>{spyCumulative === null ? '—' : `${signedPrecisePercent(returnAnalytics.cumulative - spyCumulative)}`}</dd></div>
              <div><dt>最新一{rangeModeLabel}</dt><dd className={(returnSeries.at(-1)?.value ?? 0) >= 0 ? 'positive' : 'negative'}>{signedPrecisePercent(returnSeries.at(-1)?.value ?? 0)}</dd></div>
              <div><dt>最大回撤</dt><dd className={riskMetrics && riskMetrics.mdd < 0 ? 'negative' : ''}>{riskMetrics ? signedPrecisePercent(riskMetrics.mdd) : '—'}{riskMetrics?.mddAt && <small>{riskMetrics.mddAt}</small>}</dd></div>
            </dl>
            {returnView !== 'heat' && <div className="wafu-perf-legend" role="group" aria-label="顯示的序列">
              {(['mine', 'spy', 'boxx'] as const).filter((key) => returnView !== 'dd' || key !== 'boxx').map((key) => <button type="button" key={key} className={perfVisible[key] ? '' : 'is-off'} aria-pressed={perfVisible[key]} onClick={() => setPerfVisible((current) => ({ ...current, [key]: !current[key] }))}><i className={key === 'mine' ? 'portfolio-key' : key === 'spy' ? 'spy-key' : 'boxx-key'} />{perfNames[key]}</button>)}
            </div>}
          </div>
          <div className="wafu-perf-body">
            <div className="wafu-perf-main">
              {returnView === 'heat' ? <MonthlyHeatmap grid={heatGrid} loading={priceHistoryPending} />
                : <PerfChart mode={returnView} labels={perfLabels} series={perfSeries} visible={perfVisible} colors={perfColors} names={perfNames} />}
              <p className="return-method-note">時間加權報酬：每日損益 ÷ 當日占用資本；股票用 Yahoo 含息調整收盤，選擇權以進出場價線性估算{returnEstimateNote}</p>
            </div>
            <aside className="wafu-perf-side" aria-label="績效與風險指標">
              {riskMetrics ? <MetricsGrid m={riskMetrics} mode={rangeMode} /> : <p className="wafu-perf-empty"><b>績效與風險指標</b>開始交易後就會計算報酬、波動與回撤。</p>}
            </aside>
          </div>
        </article>

        <section className="content-grid wafu-pair-grid">
          <article className="panel allocation-panel">
            <div className="panel-heading"><div><p className="eyebrow">Holdings</p><h2>持倉配置</h2></div><div className="allocation-heading-actions"><div className="allocation-chart-switch" role="group" aria-label="持倉配置圖表類型"><button type="button" className={allocationChartMode === 'donut' ? 'active' : ''} aria-pressed={allocationChartMode === 'donut'} onClick={() => setAllocationChartMode('donut')}>圓餅圖</button><button type="button" className={allocationChartMode === 'bars' ? 'active' : ''} aria-pressed={allocationChartMode === 'bars'} onClick={() => setAllocationChartMode('bars')}>長條圖</button></div><span className="count-badge">{allocationSnapshot.tradeCount} positions</span></div></div>
            <div className="allocation-history-controls" aria-label="持倉配置歷史日期">
              <div>{allocationPresets.map((preset) => <button key={preset.label} className={allocationDate === preset.date ? 'active' : ''} onClick={() => selectAllocationDate(preset.date)}>{preset.label}</button>)}</div>
              <label><span>歷史日期</span><input type="date" min={earliestAllocationDate} max={currentAllocationDate} value={allocationDate} onChange={(event) => selectAllocationDate(event.target.value || currentAllocationDate)} /></label>
            </div>
            {concentration && <p className={`wafu-concentration is-${concentration.level}`} role="note">
              <i aria-hidden="true" />
              <span>前三大部位占 <b>{percent.format(concentration.top3)}</b>{concentration.level === 'high' ? '，集中度偏高' : concentration.level === 'mid' ? '，略為集中' : '，分散良好'}</span>
              <small>{concentration.names.join('、')} · 最大單一 {percent.format(concentration.top1)}</small>
            </p>}
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
          <article className="panel macro-panel" aria-labelledby="macro-market-title">
            <div className="panel-heading">
              <div><p className="eyebrow">Macro monitor</p><h2 id="macro-market-title">宏觀行情</h2></div>
              <div className="macro-market-actions"><div className="segmented macro-range-switch" role="group" aria-label="宏觀歷史期間">{([['day', '日'], ['week', '週'], ['month', '月'], ['year', '年']] as const).map(([mode, label]) => <button type="button" key={mode} className={macroRangeMode === mode ? 'selected' : ''} aria-pressed={macroRangeMode === mode} onClick={() => setMacroRangeMode(mode)}>{label}</button>)}</div><button type="button" className="macro-refresh-button" disabled={macroLoading} onClick={() => { macroRefreshRequestedRef.current = true; setMacroRefreshKey((current) => current + 1); }}>↻ 更新</button></div>
            </div>
            <p className="macro-panel-meta">美東 {macroUpdatedLabel} · 每 60 秒更新</p>
            {macroError && <p className="macro-market-error" role="status">{macroError}</p>}
            <div className={`macro-market-grid wafu-macro-grid ${macroLoading ? 'is-loading' : ''}`} aria-busy={macroLoading}>
              {activeMacroMarkets.map((market) => <MacroMarketCard key={market.id} market={market} startLabel={macroTimeline[0]?.label ?? ''} endLabel={macroTimeline.at(-1)?.label ?? ''} rangeLabel={macroRangeModeLabel} />)}
              {!activeMacroMarkets.length && Array.from({ length: 5 }, (_, item) => <article className="macro-market-card macro-market-placeholder" key={item}><span /><b /><i /></article>)}
              <SpreadCard />
            </div>
          </article>
        </section>

        {drilledTicker && <ResearchDrawer
          symbol={drilledTicker}
          company={researchPosition?.company ?? companyNames[drilledTicker] ?? ''}
          summary={researchSummary}
          tab={researchTab}
          onTab={setResearchTab}
          onClose={returnToPositionsOverview}
          chips={researchChips}
          onSymbol={(symbol) => { const keep = researchTab; openTickerDetails(symbol); setResearchTab(keep); }}
        >
          {researchTab === 'dcf'
            ? <Suspense fallback={<div className="technical-state"><span className="technical-spinner" />正在開啟 DCF 估值…</div>}><DcfCalculator key={drilledTicker} initialTicker={drilledTicker} onClose={() => setResearchTab('technical')} ai={researchAi} /></Suspense>
            : <StockTechnicalPanel
          view={researchTab}
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
          valuationOpen={false}
          ai={researchAi}
          onRangeChange={selectTechnicalRange}
          onCustomRangeApply={applyTechnicalCustomRange}
          onClose={returnToPositionsOverview}
          onOpenDcf={() => setResearchTab('dcf')}
          onAddLot={() => setEditor({ ...blankTrade(), type: 'SDI', ticker: drilledTicker, event: 'STOCK', quoteMode: 'auto' })}
          onSaveLot={saveStockLot}
          onEditLot={(trade) => setEditor({ ...trade })}
          onDeleteLot={(trade) => setDeleteCandidate(trade)}
        />}
        </ResearchDrawer>}

        <section className="panel positions-panel" id="positions">
          <div className="positions-toolbar">
            <div><p className="eyebrow">Active book</p><h2>交易與持倉</h2></div>
            <div className="toolbar-actions"><div className="view-switch" aria-label="持倉顯示方式"><button className={positionView === 'visual' ? 'active' : ''} onClick={() => (drilledTicker || allocationGroupSelection) ? returnToPositionsOverview() : setPositionView('visual')}>圖形持倉</button><button className={positionView === 'details' ? 'active' : ''} onClick={() => setPositionView('details')}>交易明細</button>{gainsTab && <button className={positionView === 'gains' ? 'active' : ''} onClick={() => setPositionView('gains')}>益損</button>}</div><label className="search"><span>⌕</span><input value={query} onChange={(event) => { setAllocationGroupSelection(null); setQuery(event.target.value); }} placeholder="搜尋 ticker、策略或備註" aria-label="搜尋交易" /></label><div className="toolbar-io"><button type="button" ref={importTriggerRef} className="toolbar-io-button" aria-haspopup="dialog" onClick={() => { void loadTradeImportDialog(); setImportOpen(true); }}>匯入</button><button type="button" className="toolbar-io-button" onClick={exportTradesCsv}>匯出 CSV</button><button type="button" className="toolbar-io-button" aria-haspopup="dialog" title="一次輸入無法自動報價的價格" onClick={() => setManualQuotesOpen(true)}>✎ 手動報價</button></div><button className="primary-button" onClick={() => setEditor(blankTrade())}>＋新增</button></div>
          </div>
          {drilledTicker && <div className="drilldown-bar"><button type="button" onClick={returnToPositionsOverview}>← 返回持倉總覽</button><span>正在查看 <strong>{drilledTicker}</strong> 的 {filteredTrades.length} 筆交易紀錄</span></div>}
          {allocationGroupSelection && !drilledTicker && <div className="drilldown-bar"><button type="button" onClick={returnToPositionsOverview}>← 返回持倉總覽</button><span>持倉配置已選擇 <strong>{allocationGroupSelection.label}</strong>：{allocationGroupSelection.members.join('、')}</span></div>}
          {positionView !== 'gains' && <div className="filter-row">{([['open', '未平倉'], ['closed', '已平倉'], ['options', '選擇權'], ['stock', '股票'], ['cash', '現金'], ['all', '全部']] as const).map(([mode, label]) => <button key={mode} className={filter === mode ? 'active' : ''} onClick={() => setFilter(mode)}>{label}<span>{mode === 'all' ? portfolioTrades.length : mode === 'open' ? openTrades.length : mode === 'closed' ? closedTrades.length : portfolioTrades.filter((trade) => mode === 'stock' ? trade.type === 'SDI' : mode === 'cash' ? isCashTrade(trade) : trade.type !== 'SDI' && !isCashTrade(trade)).length}</span></button>)}{positionView === 'details' && <TradeColumnPicker columns={tradeColumnSet} onChange={updateTradeColumns} />}{positionView === 'visual' && <VisualFieldPicker fields={visualFieldSet} onChange={updateVisualFields} />}</div>}
          {optionRisk && positionView !== 'gains' && <OptionRiskStrip risk={optionRisk} premium={yearPremium} />}
          {positionView === 'gains' ? <Suspense fallback={<div className="visual-empty">正在整理益損…</div>}><GainsLedger trades={portfolioTrades} usdJpyRate={usdJpyRate} today={todayKey} query={query} /></Suspense> : positionView === 'visual' ? <div className="visual-positions">
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
              const quantityParts = [position.stockQuantity > 0 ? `${quantityNumber.format(position.stockQuantity)} 股` : '', position.optionQuantity > 0 ? `${quantityNumber.format(position.optionQuantity)} 口` : ''].filter(Boolean);
              const positionStatus = cashPosition
                ? position.items.some((item) => item.trade.derived) ? '股息自動入帳' : '現金餘額'
                : autoPosition ? snapshot ? `API · ${quoteSessionLabel(snapshot.session)}` : failedQuoteTickers.has(position.ticker) ? 'API 無法取得' : 'API 待更新'
                  : position.items.some((item) => item.trade.type === 'SDI') ? '手動價格' : '權利金手動';
              const positionStatusClass = cashPosition ? 'cash' : autoPosition ? snapshot ? 'live' : failedQuoteTickers.has(position.ticker) ? 'error' : 'pending' : 'manual';
              const firstOpen = openPositionItems[0]?.trade ?? position.items[0]?.trade;
              const optionRight = firstOpen ? optionRightOf(firstOpen) : null;
              const hankoKind = cashPosition ? 'cash' : optionRight && position.stockQuantity === 0 ? 'option' : 'stock';
              const hanko = <HankoTile
                rank={index + 1}
                ticker={position.ticker}
                kind={hankoKind}
                market={cashPosition ? '現' : hankoKind === 'option' ? (optionRight === 'put' ? 'P' : 'C') : isJapaneseTicker(position.ticker) ? 'JP' : 'US'}
                label={cashPosition ? '現金' : hankoKind === 'option' ? `${(optionRight ?? '').toUpperCase()} ${firstOpen?.strike ?? ''}`.trim() : isJapaneseTicker(position.ticker) ? '日股' : '股票'}
              />;
              return <article className="visual-position-row" key={position.ticker}>
                <span className="position-rank">{String(index + 1).padStart(2, '0')}</span>
                {cashPosition ? <div className="visual-asset">{hanko}<span className="visual-asset-copy"><strong>{position.ticker}</strong><span>{position.company}</span><small>{position.items.length} 筆 · 持倉數量 {nativeMoney(position.ticker, position.cashQuantity)}</small><em className={`position-data-status ${positionStatusClass}`}><i />{positionStatus}</em></span></div> : <button type="button" className="visual-asset visual-asset-button" onClick={() => openTickerDetails(position.ticker)}>{hanko}<span className="visual-asset-copy"><strong>{position.ticker}</strong><span>{position.company}</span><small>{position.items.length} 筆 · 持倉數量 {quantityParts.join(' · ') || '0'} · {position.strategy}</small><em className={`position-data-status ${positionStatusClass}`}><i />{positionStatus}</em></span></button>}
                <div className="visual-value"><span>持倉市值</span><strong>{money.format(position.marketValue)}</strong></div>
                {cashPosition ? <div className="visual-price-flow cash-price-flow"><div><span>原幣現金</span><strong>{nativeMoney(position.ticker, position.cashQuantity)}</strong></div><div><span>組合換算</span><strong>{money.format(position.marketValue)}</strong></div></div> : <div className="visual-price-flow"><div><span>{position.items.every((item) => item.trade.type === 'SDI' || item.trade.event === 'STOCK') ? '股票均價' : '成交均價'}</span><strong>{nativeMoney(position.ticker, position.entryPrice)}</strong></div><div><span>{currentPriceLabel}</span><strong>{nativeMoney(position.ticker, regularDisplayPrice)}</strong>{extendedDisplayPrice !== null && <small className={`after-hours-price ${extendedDisplayPrice >= regularDisplayPrice ? 'is-up' : 'is-down'}`}><em>{extendedSession === 'pre' ? '盤前' : '盤後'}</em>{nativeMoney(position.ticker, extendedDisplayPrice)}</small>}</div></div>}
                {cashPosition ? <div className="visual-market-move neutral cash-market-move"><span className="cash-balance-icon">◎</span><div><span>資料來源</span><strong>不需報價</strong><small>{position.items.some((item) => item.trade.derived) ? '含稅後股息自動現金' : '手動現金餘額'}</small></div></div> : <div className={`visual-market-move ${marketChangePercent === null ? 'neutral' : marketChangePercent >= 0 ? 'positive' : 'negative'}`}><PriceSparkline ticker={position.ticker} values={snapshot?.sparkline ?? []} changePercent={marketChangePercent} /><div><span>{marketMoveLabel}</span><strong>{marketChangePercent === null ? '等待報價' : `${marketChangePercent >= 0 ? '+' : ''}${precisePercent.format(marketChangePercent)}`}</strong><small>{marketChange === null ? '—' : `${nativeMoney(position.ticker, marketDisplayPrice)} · ${marketChange >= 0 ? '+' : ''}${nativeMoney(position.ticker, marketChange)}`}</small></div></div>}
                <div className={`visual-gain ${cashPosition ? 'neutral' : position.pnl >= 0 ? 'positive' : 'negative'}`}><strong>{cashPosition ? money.format(0) : `${position.pnl >= 0 ? '+' : ''}${money.format(position.pnl)}`}</strong><span>{cashPosition ? '現金部位' : `${position.roc >= 0 ? '▲' : '▼'} ${percent.format(Math.abs(position.roc))}`}</span></div>
                <div className="visual-weight"><div><span>組合占比</span><strong>{percent.format(position.share)}</strong></div><b><i style={{ width: `${Math.max(2, Math.min(100, position.share * 100))}%` }} /></b></div>
                {!cashPosition && visualFieldSet.length > 0 && <VisualFieldStrip fields={visualFieldSet} values={visualFieldValues(position, openPositionItems, snapshot, regularDisplayPrice)} />}
              </article>;
            })}
          </div> : <div className="table-wrap">
            <table className={customTradeColumns ? 'trade-table-custom' : undefined}>
              <thead><tr>{visibleTradeColumns.map((column) => <th key={column.id} title={column.description}>{column.label}</th>)}</tr></thead>
              <tbody>
                {loading && <tr><td colSpan={visibleTradeColumns.length} className="empty-state">正在載入你的交易紀錄…</td></tr>}
                {!loading && !filteredTrades.length && <tr><td colSpan={visibleTradeColumns.length} className="empty-state">沒有符合目前篩選條件的交易。</td></tr>}
                {filteredTrades.map((item) => <tr key={item.trade.id}>{visibleTradeColumns.map((column) => renderTradeCell(column.id, item))}</tr>)}
              </tbody>
            </table>
          </div>}
          {positionView !== 'gains' && <footer className="table-footer"><span><i className="live-dot" />股票 API 報價</span><span><i className="manual-dot" />手動價格</span><span><i className="cash-dot" />現金／稅後股息</span><p>現金不呼叫股票報價；股息依持有期間、除息事件與設定的外國投資人預扣稅率試算。</p></footer>}
        </section>
        </div>
      </div>

      {filingDialogSymbol && secFilings?.filings[filingDialogSymbol] && <FilingAnalysisDialog
        symbol={filingDialogSymbol}
        company={secFilings.filings[filingDialogSymbol]}
        status={aiStatus}
        keys={aiKeys}
        defaultProvider={defaultAiProvider}
        openAiModel={openAiModel}
        claudeModel={claudeModel}
        questions={analysisQuestions}
        analyses={filingAnalyses}
        onSave={saveFilingAnalysis}
        onUsed={refreshQuota}
        usageTier={openAiTier}
        onClose={() => setFilingDialogSymbol(null)}
      />}

      {settingsOpen && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <aside className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><div><p className="eyebrow">Workspace controls</p><h2 id="settings-title"><HaloIcon theme={wafuTheme} size={26} minStrokePx={1} />設定</h2></div><button type="button" className="settings-close" onClick={() => setSettingsOpen(false)} aria-label="關閉設定">×</button></header>
          <div className="settings-tabs" role="tablist" aria-label="設定分類">
            {settingsTabs.map(([tab, label]) => <button key={tab} type="button" role="tab" id={`settings-tab-${tab}`} aria-selected={settingsTab === tab} aria-controls="settings-tabpanel" className={settingsTab === tab ? 'on' : ''} onClick={() => setSettingsTab(tab)}>{label}</button>)}
          </div>
          <div className="settings-body" id="settings-tabpanel" role="tabpanel" aria-labelledby={`settings-tab-${settingsTab}`} key={settingsTab}>
            {settingsTab === 'look' && <>
            <WafuThemeCard preference={wafuPreference} onChange={updateWafuPreference} intro={wafuIntro} onIntroChange={updateWafuIntro} liteAuto={introLiteAuto} onLiteAutoChange={updateIntroLiteAuto} onPreviewIntro={previewIntro} />
            <section className={`settings-feature-card ${toneSetting !== 'off' ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">燈</span><div><p>Warm tone</p><h3>色調</h3></div><span className="settings-feature-status">{toneChoices.find(([value]) => value === toneSetting)?.[1] ?? '現行'}</span></div>
              <p>在桔梗與時雨之上換成柔和暖色：燈籠是暖色夜晚，和紙是白天的紙本帳簿。暖色自動會在 06:00–18:00 用和紙、其餘時間用燈籠。只換顏色與質感，版面與功能不變。</p>
              <div className="wafu-intro-row">
                <span id="tone-label">色調</span>
                <div className="wafu-intro-choices" role="radiogroup" aria-labelledby="tone-label">
                  {toneChoices.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={toneSetting === value} className={toneSetting === value ? 'active' : ''} onClick={() => updateTone(value)}>{label}</button>)}
                </div>
              </div>
            </section>
            <section className={`settings-feature-card home-bar-settings-card ${bottomNav !== 'off' ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">帖</span><div><p>Bottom navigation</p><h3>底部導覽</h3></div><span className="settings-feature-status">{bottomNav === 'guide' ? '引導條' : bottomNav === 'menu' ? '選單列' : '已關閉'}</span></div>
              <p>引導條：畫面下方一條細線，左右滑切換區塊、點一下回頂部、往上滑或長按開啟快捷面板（新增交易、匯入、AI、個股研究、通知、設定、音樂）；鍵盤可用 ← → 與 Enter。選單列：手機上把總覽、持倉、收益、AI、設定、更多放在底部，直接點選。</p>
              <div className="wafu-intro-row bottom-nav-row">
                <span id="bottom-nav-label">樣式</span>
                <div className="wafu-intro-choices" role="radiogroup" aria-labelledby="bottom-nav-label">
                  {([['guide', '引導條（預設）'], ['menu', '選單列（手機）'], ['off', '關閉']] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={bottomNav === value} className={bottomNav === value ? 'active' : ''} onClick={() => updateBottomNav(value)}>{label}</button>)}
                </div>
              </div>
              <div className="app-install-hint">
                <b>安裝成手機 App</b>
                <span>iPhone／iPad：用 Safari 開啟 → 分享 → 加入主畫面。Android：Chrome 選單 → 安裝應用程式（或加到主畫面）。安裝後全螢幕開啟，資料與網頁版相同。</span>
                {installPrompt && <button type="button" onClick={() => { void installPrompt.prompt().finally(() => setInstallPrompt(null)); }}>安裝 App</button>}
              </div>
            </section>
            </>}
            {settingsTab === 'sound' && <>
            <WafuMediaCard theme={wafuTheme} />
            </>}
            {settingsTab === 'ai' && <>
            <AiSettingsCard enabled={aiEnabled} onEnabledChange={updateAiEnabled} status={aiStatus} keys={aiKeys} onKeysChange={updateAiKeys} defaultProvider={defaultAiProvider} onDefaultProviderChange={updateDefaultAiProvider} openAiModel={openAiModel} onOpenAiModelChange={updateOpenAiModel} claudeModel={claudeModel} onClaudeModelChange={updateClaudeModel} usageTier={openAiTier} onUsageTierChange={updateOpenAiTier} questions={analysisQuestions} onQuestionsChange={updateAnalysisQuestions} />
            <section className={`settings-feature-card assistant-settings-card ${assistantPrefs.enabled ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">談</span><div><p>AI assistant</p><h3>AI 助理</h3></div><span className="settings-feature-status">{assistantPrefs.enabled ? '已開啟' : '已關閉'}</span></div>
              <p>側欄的「AI」可以問關於自己持倉的問題：到期、風險、損益。送出時附上持倉摘要（代號、數量、價格與總額，不含備註），使用「AI 設定」中的金鑰與模型；只提供分析，不會更動交易。</p>
              <div className="wafu-intro-row assistant-voice-row">
                <span id="assistant-voice-label">口吻</span>
                <div className="wafu-intro-choices" role="radiogroup" aria-labelledby="assistant-voice-label">
                  <button type="button" role="radio" aria-checked={assistantPrefs.voice === 'character'} className={assistantPrefs.voice === 'character' ? 'active' : ''} onClick={() => updateAssistantPrefs({ voice: 'character' })}>角色（桔梗／時雨）</button>
                  <button type="button" role="radio" aria-checked={assistantPrefs.voice === 'neutral'} className={assistantPrefs.voice === 'neutral' ? 'active' : ''} onClick={() => updateAssistantPrefs({ voice: 'neutral' })}>中性</button>
                </div>
              </div>
              <div className="settings-feature-actions">
                <span>關閉後側欄不顯示 AI，也不載入這部分的程式。</span>
                <button type="button" className={`settings-toggle ${assistantPrefs.enabled ? 'is-on' : ''}`} role="switch" aria-checked={assistantPrefs.enabled} onClick={() => updateAssistantPrefs({ enabled: !assistantPrefs.enabled })}><i /><b>{assistantPrefs.enabled ? '開啟' : '關閉'}</b></button>
              </div>
            </section>
            </>}
            {settingsTab === 'modules' && <>
            <section className={`settings-feature-card notify-settings-card ${notifyEnabled ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">報</span><div><p>Notifications</p><h3>通知中心</h3></div><span className="settings-feature-status">{notifyEnabled ? '已開啟' : '已關閉'}</span></div>
              <p>頂欄的通知集中顯示財報公布、財報日、美日休市、7 天內到期的選擇權與股息入帳，可逐則關閉或全部標為已讀。</p>
              <div className="settings-feature-actions">
                <span>關閉後改回頁首的提示列，不另外計算通知。</span>
                <button type="button" className={`settings-toggle ${notifyEnabled ? 'is-on' : ''}`} role="switch" aria-checked={notifyEnabled} onClick={toggleNotifyCenter}><i /><b>{notifyEnabled ? '開啟' : '關閉'}</b></button>
              </div>
              {notifyEnabled && <div className="settings-feature-actions">
                <span>頂欄中央的通知條（寬螢幕）；關閉後只留右側的鈴鐺。</span>
                <button type="button" className={`settings-toggle ${notifyBar ? 'is-on' : ''}`} role="switch" aria-checked={notifyBar} aria-label="頂欄通知條" onClick={toggleNotifyBar}><i /><b>{notifyBar ? '開啟' : '關閉'}</b></button>
              </div>}
            </section>
            <section className={`settings-feature-card ${gainsTab ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">益</span><div><p>Gains &amp; losses</p><h3>益損分頁</h3></div><span className="settings-feature-status">{gainsTab ? '已開啟' : '已關閉'}</span></div>
              <p>在「交易與持倉」加上益損分頁：今年、去年的已實現損益與未實現損益，分短期與長期，可展開到每檔與每筆交易，並可列印或下載 CSV。</p>
              <div className="settings-feature-actions">
                <span>關閉後只隱藏分頁，不影響其他計算。</span>
                <button type="button" className={`settings-toggle ${gainsTab ? 'is-on' : ''}`} role="switch" aria-checked={gainsTab} aria-label="益損分頁" onClick={toggleGainsTab}><i /><b>{gainsTab ? '開啟' : '關閉'}</b></button>
              </div>
            </section>
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
              <div className="dividend-credit-on" role="radiogroup" aria-label="股息入帳日">
                <span>入帳日</span>
                {(['pay', 'ex'] as const).map((option) => <button key={option} type="button" role="radio" aria-checked={dividendSettings.creditOn === option} className={dividendSettings.creditOn === option ? 'active' : ''} disabled={dividendSaving} onClick={() => { if (dividendSettings.creditOn !== option) void persistDividendSettings({ ...dividendSettings, creditOn: option }); }}>{option === 'pay' ? '發放日' : '除息日'}</button>)}
                <small>{dividendSettings.creditOn === 'pay' ? '公司實際付款那天才加入現金；股數以除息日前一天收盤時的持股計算。' : '在除息日就加入現金（舊做法）。'}</small>
              </div>
              {dividendSettings.enabled && dividendSettings.creditOn === 'pay' && dividendPending && (dividendPending.USD.count > 0 || dividendPending.JPY.count > 0) && <p className="dividend-pending-total">待入帳：{[dividendPending.USD.count ? `USD ${money.format(dividendPending.USD.net)}（${dividendPending.USD.count} 筆）` : '', dividendPending.JPY.count ? `JPY ${yenMoney.format(dividendPending.JPY.net)}（${dividendPending.JPY.count} 筆）` : ''].filter(Boolean).join(' · ')}</p>}
              {dividendSettings.enabled && dividendSettings.creditOn === 'pay' && recentDividendEvents.length > 0 && <div className="dividend-pay-list" role="table" aria-label="近期股息發放日">
                {recentDividendEvents.map((event) => <div className="dividend-pay-row" role="row" key={event.eventKey}>
                  <strong role="cell">{event.ticker}</strong>
                  <span role="cell">除息 {event.date}</span>
                  <span role="cell" className="dividend-pay-date">
                    <input type="date" min={event.date} value={event.payDate} disabled={dividendSaving} aria-label={`${event.ticker} ${event.date} 發放日`} onChange={(change) => { if (change.target.value && change.target.value !== event.payDate) void saveDividendPayDate(event.eventKey, change.target.value); }} />
                    <small className={`pay-source is-${event.paySource}`}>{paySourceLabels[event.paySource]}</small>
                    {event.paySource === 'manual' && <button type="button" disabled={dividendSaving} onClick={() => void saveDividendPayDate(event.eventKey, '')} aria-label={`${event.ticker} ${event.date} 發放日改回自動`}>自動</button>}
                  </span>
                  <span role="cell" className={event.credited ? 'is-credited' : 'is-pending'}>{nativeMoney(event.ticker, event.net)} · {event.credited ? '已入帳' : '待入帳'}</span>
                </div>)}
              </div>}
              {dividendError && <p className="dividend-settings-error">{dividendError}</p>}
              <div className="settings-feature-actions dividend-settings-actions"><span>{dividendUpdatedAt ? `最近計算 ${new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(dividendUpdatedAt))}` : '開啟後會依現有股票持倉自動試算；僅供追蹤，不是稅務建議。'}</span><div>{dividendAdjustmentCount > 0 && <button type="button" className="dividend-save-button restore" disabled={dividendSaving} onClick={resetDividendAdjustments}>還原 {dividendAdjustmentCount} 筆調整</button>}<button type="button" className="dividend-save-button" disabled={dividendSaving} onClick={() => persistDividendSettings(dividendSettings)}>{dividendSaving ? '保存中…' : '保存稅率'}</button><button type="button" className={`settings-toggle ${dividendSettings.enabled ? 'is-on' : ''}`} role="switch" aria-checked={dividendSettings.enabled} disabled={dividendSaving} onClick={() => persistDividendSettings({ ...dividendSettings, enabled: !dividendSettings.enabled })}><i /><b>{dividendSettings.enabled ? '開啟' : '關閉'}</b></button></div></div>
            </section>
            <section className={`settings-feature-card holiday-notice-settings-card ${holidayNoticeEnabled ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon holiday" aria-hidden="true">休</span><div><p>Market calendar</p><h3>美日休市預告</h3></div><span className="settings-feature-status">{holidayNoticeEnabled ? '已開啟' : '已關閉'}</span></div>
              <p>未來 7 天內有美股或日股休市、或美股提前收盤（13:00 ET）時，在頁首下方顯示一行提示。</p>
              <div className="settings-feature-actions">
                <span>按提示右側的 × 只會隱藏目前這幾天；設定保存在這個瀏覽器。</span>
                <button type="button" className={`settings-toggle ${holidayNoticeEnabled ? 'is-on' : ''}`} role="switch" aria-checked={holidayNoticeEnabled} onClick={toggleHolidayNotice}><i /><b>{holidayNoticeEnabled ? '開啟' : '關閉'}</b></button>
              </div>
            </section>
            <section className={`settings-feature-card earnings-settings-card ${earningsEnabled ? 'is-enabled' : ''}`}>
              <div className="settings-feature-heading"><span className="settings-feature-icon earnings" aria-hidden="true">決</span><div><p>Earnings calendar</p><h3>持倉財報日曆與提醒</h3></div><span className="settings-feature-status">{earningsEnabled ? (earningsSymbolKey && yahooEarnings?.key !== earningsSymbolKey ? '讀取中' : '已開啟') : '已關閉'}</span></div>
              <p>列出未平倉股票與選擇權標的的下一次財報日；財報前 7 天起在頁首下方提醒。日期來自 Yahoo Finance，查不到時可自行填入。</p>
              {earningsEnabled && <div className="earnings-table" role="table" aria-label="持倉財報日">
                {!earningsRows.length && <p className="earnings-empty">目前沒有未平倉的股票或選擇權。</p>}
                {earningsRows.map(({ symbol, entry, today }) => {
                  const failed = yahooEarnings?.key === earningsSymbolKey && yahooEarnings.failed.includes(symbol);
                  const source = entry?.source === 'manual' ? '手動' : entry ? (entry.estimate ? 'Yahoo 預估' : 'Yahoo') : failed ? '無法連線' : symbol.endsWith('.T') ? '日股不支援' : '未取得';
                  return <div className="earnings-row" role="row" key={symbol}>
                    <strong role="cell">{symbol}</strong>
                    <span role="cell" className={entry ? '' : 'is-missing'}>{entry ? `${entry.date}${entry.endDate ? ` ～ ${entry.endDate}` : ''}${earningsTimingLabel(entry.timing) ? ` · ${earningsTimingLabel(entry.timing)}` : ''}` : '—'}</span>
                    <small role="cell">{source}</small>
                    <span role="cell" className="earnings-manual">
                      <input type="date" min={today} value={manualEarnings[symbol] ?? ''} aria-label={`手動財報日 ${symbol}`} onChange={(event) => setManualEarningsDate(symbol, event.target.value || null)} />
                      {manualEarnings[symbol] && <button type="button" onClick={() => setManualEarningsDate(symbol, null)} aria-label={`清除手動財報日 ${symbol}`}>×</button>}
                    </span>
                    {aiEnabled && (filingsFor(symbol) || (aiStatus?.state === 'ok' && (aiProviderReady('anthropic') || aiProviderReady('openai')))) && <span role="cell" className="earnings-ai-actions">
                      {filingsFor(symbol) && <button type="button" className="is-filing" onClick={() => setFilingDialogSymbol(symbol)} aria-label={`財報解讀 ${symbol}`}>財報解讀</button>}
                      {aiStatus?.state === 'ok' && (['openai', 'anthropic'] as const).filter((provider) => aiProviderReady(provider)).map((provider) => {
                        const lookup = aiLookups[`${provider}:${symbol}`];
                        const name = provider === 'anthropic' ? 'Claude' : 'ChatGPT';
                        return <button type="button" key={provider} disabled={lookup?.loading || (provider === 'openai' && !(openAiModel.trim() || (aiStatus?.state === 'ok' && aiStatus.openAiModel))) || (provider === 'openai' && aiStatus?.state === 'ok' && Boolean(aiStatus.quota) && !freeQuotaOpen(aiStatus.quota))} title={provider === 'openai' && aiStatus?.state === 'ok' ? freeQuotaLine(aiStatus.quota) : undefined} onClick={() => lookupEarningsWithAi(symbol, provider)} aria-label={`用 ${name} 查 ${symbol} 財報日`}>{lookup?.loading ? `${name} 查詢中…` : `${name} 查`}</button>;
                      })}
                    </span>}
                    {(['anthropic', 'openai'] as const).map((provider) => {
                      const id = `${provider}:${symbol}`;
                      const lookup = aiLookups[id];
                      if (!lookup || lookup.loading) return null;
                      const name = provider === 'anthropic' ? 'Claude' : 'ChatGPT';
                      const suggestion = lookup.suggestion;
                      return <div className="earnings-ai-suggestion" key={id}>
                        {lookup.error ? <p className="is-error">{name}：{lookup.error}</p> : suggestion && <>
                          <p><b>{name} 建議</b>{suggestion.date ? `${suggestion.date}${earningsTimingLabel(suggestion.timing) ? ` · ${earningsTimingLabel(suggestion.timing)}` : ''}${suggestion.confirmed ? '（公司已公布）' : '（未經公司確認）'}` : '找不到日期'}{suggestion.note ? ` — ${suggestion.note}` : ''}</p>
                          {suggestion.sources.length > 0 && <ul>{suggestion.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a></li>)}</ul>}
                        </>}
                        <div>
                          {suggestion?.date && suggestion.date >= today && <button type="button" className="apply" onClick={() => { setManualEarningsDate(symbol, suggestion.date); dismissAiLookup(id); }}>套用</button>}
                          <button type="button" onClick={() => dismissAiLookup(id)}>略過</button>
                        </div>
                      </div>;
                    })}
                  </div>;
                })}
              </div>}
              {earningsEnabled && <p className="earnings-ai-hint">{aiStatus?.state === 'error' ? `AI 查詢：${aiStatus.message}` : '金鑰、ChatGPT 模型與財報解讀問題在下方「AI 設定」。'}</p>}
              <div className="settings-feature-actions">
                <span>手動日期優先於 Yahoo，過了那天會自動改回 Yahoo 的日期；手動日期與開關保存在這個瀏覽器。</span>
                <button type="button" className={`settings-toggle ${earningsEnabled ? 'is-on' : ''}`} role="switch" aria-checked={earningsEnabled} aria-label="持倉財報日曆與提醒" onClick={toggleEarnings}><i /><b>{earningsEnabled ? '開啟' : '關閉'}</b></button>
              </div>
            </section>
            </>}
            {settingsTab === 'data' && <>
            <section className="settings-feature-card data-settings-card is-enabled">
              <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">帳</span><div><p>Trades data</p><h3>匯入與匯出</h3></div><span className="settings-feature-status">{trades.length} 筆</span></div>
              <p>讀取 CSV（券商成交紀錄或自製表格），或用 AI 辨識券商 App 的截圖與一句話紀錄後匯入；也可把全部交易匯出成 CSV 備份。交易資料存在本站的資料庫。</p>
              <div className="settings-data-actions">
                <button type="button" className="primary-button" onClick={() => { setSettingsOpen(false); void loadTradeImportDialog(); setImportOpen(true); }}>⇪ 匯入 CSV／截圖</button>
                <button type="button" className="secondary-button" onClick={exportTradesCsv}>匯出 CSV</button>
              </div>
            </section>
            <p className="settings-disclaimer"><i>i</i><span>目前為手動聚合與試算工具，不會登入券商、讀取券商帳密或送出真實訂單。</span></p>
            </>}
          </div>
        </aside>
      </div>}

      {manualQuotesOpen && <ManualQuotes rows={manualQuoteRows} onSave={saveManualQuotes} onClose={() => setManualQuotesOpen(false)} />}
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
                  {editorMarket === 'US' && <div className="strategy-shortcuts" role="group" aria-label="選擇權快速策略"><span>快速策略</span>{([['Sell', 'PUT', '賣 PUT'], ['Sell', 'CALL', '賣 CALL'], ['Buy', 'PUT', '買 PUT'], ['Buy', 'CALL', '買 CALL']] as const).map(([type, event, text]) => {
                    const selected = editor.type === type && editor.event === event;
                    return <button type="button" key={text} className={`${type === 'Sell' ? 'is-sell' : 'is-buy'} ${selected ? 'active' : ''}`} aria-pressed={selected} onClick={() => setEditor((current) => current ? { ...current, type, event, ticker: current.ticker === 'USD' || current.ticker === 'JPY' ? '' : current.ticker, quoteMode: 'manual' } : current)}>{text}</button>;
                  })}</div>}
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
                  {editorOption && <div className="strike-chip-row">
                    <span className="strike-chip-label" aria-live="polite">{editorUnderlyingQuote ? <>履約價快選<b>{`${editorUnderlyingSymbol} ${quoteSessionLabel(editorUnderlyingQuote.session)} ${money.format(editorUnderlyingQuote.price)}`}</b></> : editorUnderlyingSymbol ? underlyingFailures.has(editorUnderlyingSymbol) ? `暫時無法取得 ${editorUnderlyingSymbol} 報價，請直接輸入履約價` : `正在讀取 ${editorUnderlyingSymbol} 報價…` : '輸入 Ticker 後會顯示現價附近的履約價'}</span>
                    {editorUnderlyingQuote && <div className="strike-chips" role="group" aria-label="現價附近的履約價">{strikeChoices(editorUnderlyingQuote.price).map(({ strike, offset }) => {
                      const selected = editorOption.strike === strike;
                      const outOfTheMoney = editorOption.right === 'put' ? offset < 0 : offset > 0;
                      return <button type="button" key={strike} className={`${outOfTheMoney ? 'is-otm' : ''} ${selected ? 'active' : ''}`} aria-pressed={selected} title={`${offset === 0 ? '價平' : `現價 ${signedPercent(offset)}`}${outOfTheMoney ? '（價外）' : ''}`} onClick={() => setEditor((current) => current ? { ...current, strike: String(strike) } : current)}>{quantityNumber.format(strike)}<small>{offset === 0 ? 'ATM' : signedPercent(offset)}</small></button>;
                    })}</div>}
                  </div>}
                </section>

                <section className="editor-section">
                  <div className="editor-section-heading"><span>02</span><div><h3>{editor.type === 'CASH' ? '現金餘額' : '合約期間'}</h3><p>{editor.type === 'CASH' ? '記錄日期與目前可用現金；之後可隨時編輯或刪除。' : '設定日期與口數；填入平倉日會自動切換狀態。'}</p></div></div>
                  <div className="form-grid date-fields">
                    <DatePicker label="開倉日" kind="open" required value={editor.openDate} todayKey={todayKey} market={editorMarket} onChange={(value) => setEditor((current) => current ? { ...current, openDate: value } : current)} />
                    {editor.type !== 'CASH' && <DatePicker label="到期日" kind="expiry" value={editor.expiryDate ?? ''} todayKey={todayKey} market={editorMarket} referenceDate={editor.openDate} onChange={(value) => setEditor((current) => current ? { ...current, expiryDate: value || null } : current)} />}
                    {editor.type !== 'CASH' && <DatePicker label="平倉日" kind="close" value={editor.closeDate ?? ''} todayKey={todayKey} market={editorMarket} min={editor.openDate} expiryDate={editor.expiryDate} onChange={(value) => setEditor((current) => current ? { ...current, closeDate: value || null, status: value ? 'closed' : 'open' } : current)} />}
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
                  {editorOption?.autoCollateral != null && <div className="collateral-helper">
                    <span>{`賣出 PUT 擔保：履約價 ${quantityNumber.format(editorOption.strike ?? 0)} × 100 × ${quantityNumber.format(Math.abs(editor.quantity))} 口 = `}<b>{money.format(editorOption.autoCollateral)}</b></span>
                    {editor.collateral === editorOption.autoCollateral
                      ? <em>已套用</em>
                      : <button type="button" onClick={() => { const collateral = editorOption.autoCollateral!; setEditor((current) => current ? { ...current, collateral } : current); }}>自動填入擔保</button>}
                  </div>}
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
                  {editorOption && <div className="option-summary">
                    <p className="eyebrow">Option analytics</p>
                    <dl>
                      <div><dt>損益兩平</dt><dd title="履約價 ∓ 每股權利金（已計入手續費）">{editorOption.breakeven === null ? '—' : money.format(editorOption.breakeven)}</dd></div>
                      <div><dt>最大獲利</dt><dd className={editorOption.maxProfit === null ? '' : editorOption.maxProfit >= 0 ? 'positive' : 'negative'} title={editorOption.direction < 0 ? '權利金 × 100 × 口數 − 手續費' : undefined}>{editorOption.maxProfit === null ? editorOption.right === 'call' ? '無上限' : '—' : money.format(editorOption.maxProfit)}</dd></div>
                      {editorOption.direction < 0 && <div><dt>若到期歸零的年化報酬</dt><dd className={editorOption.annualIfWorthless === null ? '' : editorOption.annualIfWorthless >= 0 ? 'positive' : 'negative'} title={editorOption.daysOpenToExpiry === null ? '需要到期日' : `最大獲利 ÷ ${capitalBasisLabels[editorOption.capital.basis]} ${money.format(editorOption.capital.amount)} × 365 ÷ ${Math.max(1, editorOption.daysOpenToExpiry)} 天（開倉至到期）`}>{cappedAnnualized(editorOption.annualIfWorthless)}</dd></div>}
                      <div><dt>到期天數（DTE）</dt><dd>{editorOption.dte === null ? '未填到期日' : `${editorOption.dte} 天`}</dd></div>
                      <div><dt>隱含波動率</dt><dd>{editorOption.analytics?.impliedVol == null ? '—' : percent.format(editorOption.analytics.impliedVol)}</dd></div>
                      <div><dt>Delta</dt><dd>{editorOption.analytics?.greeks && editorOption.analytics.positionDelta !== null ? `${editorOption.analytics.greeks.delta.toFixed(2).replace('-', '−')} · ${signedDecimal(editorOption.analytics.positionDelta)} 股` : '—'}</dd></div>
                    </dl>
                    <p className="option-summary-note">{!editorUnderlyingQuote
                      ? '取得標的報價後顯示隱含波動率與 Delta。'
                      : editorOption.strike === null || editorOption.dte === null
                        ? '填入單一履約價與到期日後計算隱含波動率與 Delta。'
                        : `依${editorOption.useCurrentPrice ? '目前價格' : '成交價'} ${editorOption.optionPrice === null ? '—' : money.format(editorOption.optionPrice)} 與標的 ${money.format(editorUnderlyingQuote.price)} 以 Black–Scholes（r = 4.3%）反推。`}</p>
                  </div>}
                  <p className="summary-tip"><i>✓</i> 所有欄位可隨時回來修改，儲存後會同步更新圖表與持倉配置。</p>
                </div>
              </aside>
            </div>
            <footer className="editor-actions">{editor.id > 0 && <button type="button" className="editor-delete-button" onClick={() => setDeleteCandidate(editor)}>刪除交易</button>}<p><span>●</span> 資料會安全儲存並立即更新儀表板</p><button type="button" className="cancel-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button save-button" disabled={saving || editorQuoteLoading}>{saving ? '儲存中…' : editorQuoteLoading ? '取得報價中…' : '儲存交易'}</button></footer>
          </form>
        </section>
      </div>}
      {rocBreakdownOpen && <RocBreakdownDialog summary={annualRocSummary} onClose={closeRocBreakdown} />}
      {importOpen && <Suspense fallback={null}><TradeImportDialog existingTrades={trades} onClose={closeImport} onImported={handleImported} ai={aiEnabled ? importAi : undefined} /></Suspense>}
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
      <WafuBackdrop theme={wafuTheme} paused={Boolean(intro)} />
      {bottomNav === 'guide' && <GuideBar
        theme={wafuTheme}
        sections={guideSections}
        current={activeSection}
        onGo={(id) => { if (id === 'valuation') openValuation(drilledTicker ?? undefined); else if (id === 'overview' || id === 'positions' || id === 'returns') goToSection(id); }}
        actions={[
          { id: 'add', label: '新增交易', icon: '＋', run: () => setEditor(blankTrade()) },
          { id: 'import', label: '匯入 CSV／截圖', icon: '⇪', run: () => { void loadTradeImportDialog(); setImportOpen(true); } },
          ...(assistantOn ? [{ id: 'ai', label: 'AI 助手', icon: '✦', run: () => setAssistantOpen(true) }] : []),
          ...(researchTicker ? [{ id: 'research', label: '個股研究', icon: '◎', run: () => openTickerDetails(researchTicker) }] : []),
          ...(notifyEnabled ? [{ id: 'notify', label: '通知與休市', icon: '◔', run: () => setNotifySignal((value) => value + 1) }] : []),
          { id: 'settings', label: '設定', icon: '⚙', run: () => setSettingsOpen(true) },
        ]}
      />}
      {homeBarEnabled && <HomeBar
        theme={wafuTheme}
        active={activeSection}
        settingsOpen={settingsOpen}
        assistant={assistantOn ? { open: assistantOpen, toggle: () => setAssistantOpen((open) => !open) } : null}
        onSection={goToSection}
        onSettings={() => setSettingsOpen(true)}
        onValuation={() => openValuation(drilledTicker ?? undefined)}
        background={{ label: backgroundSaving ? '保存中' : backgroundImage ? '換背景圖片' : '背景圖片', busy: backgroundSaving, pick: () => backgroundInputRef.current?.click() }}
      />}
      {assistantOpen && assistantOn && <Suspense fallback={null}><AssistantPanel theme={wafuTheme} voice={assistantPrefs.voice} ai={importAi} snapshot={buildAssistantSnapshot} onClose={closeAssistant} /></Suspense>}
      {intro && <WafuOpening key={`${intro.theme}-${String(intro.reduced)}`} theme={intro.theme} reduced={intro.reduced} ready={!loading} onDone={finishIntro} onReveal={revealAfterIntro} />}
    </main>
  );
}
