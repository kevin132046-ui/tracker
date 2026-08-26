'use client';

import type { ChangeEvent, CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
};

type RangeMode = 'day' | 'week' | 'month' | 'year';
type FilterMode = 'all' | 'open' | 'closed' | 'options' | 'stock';
type PositionViewMode = 'visual' | 'details';
type AllocationChartMode = 'donut' | 'bars';
type SymbolSuggestion = { symbol: string; name: string; exchange: string; type: string };
type LiveQuote = { ticker: string; price: number; marketTime: number | null; session: 'regular' | 'extended'; currency: string; previousClose: number | null; change: number | null; changePercent: number | null; sparkline: number[] };
type AllocationHistory = {
  date: string;
  positions: Array<{ label: string; value: number; tradeCount: number; estimated: boolean }>;
  total: number;
  tradeCount: number;
  estimatedTickers: string[];
};
type TechnicalRange = '3mo' | '6mo' | '1y';
type TechnicalPoint = {
  date: string;
  close: number;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};
type TechnicalData = {
  symbol: string;
  range: TechnicalRange;
  points: TechnicalPoint[];
  latestPrice: number;
  change: number;
  changePercent: number;
  updatedAt: string;
};
type BenchmarkMarket = {
  id: 'USDJPY' | 'US10Y' | 'US30Y';
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
type BackgroundMode = 'default' | 'image';

const palette = ['#2f6fd5', '#248fa8', '#6c5dd3', '#188f70', '#b9781f', '#c75267'];
const companyNames: Record<string, string> = {
  AAPL: 'Apple', AMZN: 'Amazon', BOXX: 'Alpha Architect', GOOGL: 'Alphabet', KO: 'Coca-Cola',
  CNC: 'Centene', META: 'Meta Platforms', MSFT: 'Microsoft', NVDA: 'NVIDIA', SPGI: 'S&P Global', SPY: 'SPDR S&P 500',
  TRV: 'The Travelers Companies', TSLA: 'Tesla', TTWO: 'Take-Two Interactive', V: 'Visa',
  '7203.T': 'Toyota Motor', '6758.T': 'Sony Group', '9984.T': 'SoftBank Group', '6861.T': 'Keyence',
  '8306.T': 'Mitsubishi UFJ Financial Group', '8035.T': 'Tokyo Electron', '9983.T': 'Fast Retailing', '7974.T': 'Nintendo',
};
const panelRatioKey = 'optionflow-analytics-panel-ratio';
const backgroundImageKey = 'optionflow-custom-background';
const backgroundModeKey = 'optionflow-background-mode';
const backgroundPendingKey = 'optionflow-pending-background';
const backgroundPendingModeKey = 'optionflow-pending-background-mode';
const usdJpyRateKey = 'optionflow-usdjpy-rate';
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
const percent = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });
const precisePercent = new Intl.NumberFormat('zh-TW', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`)) : '—';
const clockFormatter = (timeZone: string) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const easternClockFormatter = clockFormatter('America/New_York');
const japanClockFormatter = clockFormatter('Asia/Tokyo');
const easternZoneFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
const easternZoneName = (timestamp: number) => easternZoneFormatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName')?.value ?? 'ET';
const isJapaneseTicker = (ticker: string | null | undefined) => Boolean(ticker?.toUpperCase().endsWith('.T'));
const nativeMoney = (ticker: string | null | undefined, value: number) => isJapaneseTicker(ticker) ? yenMoney.format(value) : money.format(value);
const normalizeTickerForMarket = (ticker: string | null | undefined, market: 'US' | 'JP') => {
  const normalized = String(ticker ?? '').trim().toUpperCase();
  return market === 'JP' && /^\d{4}$/.test(normalized) ? `${normalized}.T` : normalized;
};
const normalizedUsdAmount = (trade: Trade, value: number, usdJpyRate: number) => (trade.market === 'JP' || isJapaneseTicker(trade.ticker)) && usdJpyRate > 0 ? value / usdJpyRate : value;

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
  const current = trade.currentPrice;
  if (current === null) return { pnl: 0, days: 0, roc: 0, annualRoc: 0, marketValue: 0 };
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
  const annualRoc = roc * (365 / days);
  const nativeMarketValue = stock ? current * trade.quantity : Math.max(trade.collateral, current * trade.quantity * 100);
  const marketValue = normalizedUsdAmount(trade, nativeMarketValue, usdJpyRate);
  return { pnl, days, roc, annualRoc, marketValue };
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
  return <span className={`company-logo ${compact ? 'compact' : ''}`} aria-hidden="true">
    <span>{ticker.slice(0, compact ? 1 : 2)}</span>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      key={ticker}
      src={`/api/logo?ticker=${encodeURIComponent(ticker)}&v=5`}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={(event) => { event.currentTarget.hidden = false; }}
      onError={(event) => { event.currentTarget.hidden = true; }}
    />
  </span>;
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
  const change = market.change === null ? '等待更新' : `${market.change >= 0 ? '+' : ''}${formatter.format(market.change)} · ${market.changePercent === null ? '—' : `${market.changePercent >= 0 ? '+' : ''}${precisePercent.format(market.changePercent)}`}`;
  const gradientId = `macro-fill-${market.id}`;
  return <article className={`macro-market-card ${direction}`}>
    <header><div><span>{market.id === 'USDJPY' ? 'FX' : 'UST'}</span><div><h4>{market.label}</h4><small>{market.unit}</small></div></div><b>{market.symbol}</b></header>
    <div className="macro-market-quote"><strong>{latest}</strong><span>{change}</span></div>
    <div className="macro-history-chart">
      {points ? <svg viewBox="0 0 100 54" preserveAspectRatio="none" role="img" aria-label={`${market.label}${rangeLabel}價格走勢`}><defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".2"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs><line x1="0" x2="100" y1="50" y2="50"/><polygon points={`0,50 ${points} 100,50`} fill={`url(#${gradientId})`}/><polyline points={points}/></svg> : <span>暫時沒有歷史資料</span>}
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

function chartBounds(values: Array<number | null>, includeZero = false) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!valid.length) return { min: 0, max: 1 };
  let min = Math.min(...valid, ...(includeZero ? [0] : []));
  let max = Math.max(...valid, ...(includeZero ? [0] : []));
  const padding = (max - min || Math.abs(max) * .04 || 1) * .1;
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

function lastIndicator(values: Array<number | null>) {
  return values.findLast((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

const StockTechnicalPanel = memo(function StockTechnicalPanel({ symbol, range, data, loading, error, stockTrades, lotSavingId, onRangeChange, onClose, onAddLot, onSaveLot, onEditLot, onDeleteLot }: {
  symbol: string;
  range: TechnicalRange;
  data: TechnicalData | null;
  loading: boolean;
  error: string;
  stockTrades: Trade[];
  lotSavingId: number | null;
  onRangeChange: (range: TechnicalRange) => void;
  onClose: () => void;
  onAddLot: () => void;
  onSaveLot: (trade: Trade, openDate: string, entryPrice: number) => void;
  onEditLot: (trade: Trade) => void;
  onDeleteLot: (trade: Trade) => void;
}) {
  const activeData = data?.symbol === symbol && data.range === range ? data : null;
  const points = activeData?.points ?? [];
  const closes = points.map((point) => point.close);
  const rsi = points.map((point) => point.rsi);
  const macd = points.map((point) => point.macd);
  const signal = points.map((point) => point.signal);
  const histogram = points.map((point) => point.histogram);
  const priceBounds = chartBounds(closes);
  const macdBounds = chartBounds([...macd, ...signal, ...histogram], true);
  const dateIndexes = points.length ? [...new Set([0, Math.round((points.length - 1) * .25), Math.round((points.length - 1) * .5), Math.round((points.length - 1) * .75), points.length - 1])] : [];
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

  return <section className="panel stock-analysis-panel" id="stock-analysis" aria-live="polite">
    <header className="technical-header">
      <div className="technical-title"><CompanyLogo ticker={symbol} /><div><p className="eyebrow">Technical view</p><h2>{symbol} 股票走勢</h2><span>日線價格 · RSI 14 · MACD 12/26/9</span></div></div>
      {activeData && <div className="technical-quote"><span>最新收盤</span><strong>{priceMoney(activeData.latestPrice)}</strong><b className={activeData.change >= 0 ? 'positive' : 'negative'}>{activeData.change >= 0 ? '+' : ''}{priceMoney(activeData.change)} · {percent.format(activeData.changePercent)}</b></div>}
      <div className="technical-actions"><div className="segmented" aria-label="技術走勢期間">{([['3mo', '3月'], ['6mo', '6月'], ['1y', '1年']] as const).map(([value, label]) => <button key={value} className={range === value ? 'selected' : ''} onClick={() => onRangeChange(value)}>{label}</button>)}</div><button type="button" className="technical-close" onClick={onClose}>返回持倉總覽</button></div>
    </header>
    {loading && !activeData && <div className="technical-state"><span className="technical-spinner" />正在讀取 {symbol} 日線資料…</div>}
    {!loading && error && <div className="technical-state error">{error}</div>}
    {activeData && <div className={`technical-grid ${loading ? 'is-refreshing' : ''}`}>
      <article className="technical-card price-card">
        <div className="technical-card-heading"><div><span>Price trend</span><h3>價格走勢</h3></div><p><strong>{priceMoney(Math.max(...closes))}</strong>期間高點</p></div>
        <div className="technical-chart large"><span className="technical-axis top">{priceMoney(priceBounds.max)}</span><span className="technical-axis bottom">{priceMoney(priceBounds.min)}</span><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${symbol} 日線價格走勢`}><defs><linearGradient id={`price-fill-${symbol}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f73ed" stopOpacity=".25"/><stop offset="100%" stopColor="#2f73ed" stopOpacity="0"/></linearGradient></defs><line x1="0" x2="100" y1="93" y2="93" className="technical-grid-line"/><polygon points={`0,93 ${technicalPoints(closes, priceBounds.min, priceBounds.max)} 100,93`} fill={`url(#price-fill-${symbol})`}/><polyline points={technicalPoints(closes, priceBounds.min, priceBounds.max)} className="technical-price-line"/></svg></div>
        <div className="technical-dates">{dateIndexes.map((index) => <span key={points[index].date}>{new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(new Date(`${points[index].date}T00:00:00Z`))}</span>)}</div>
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
          return <rect key={points[index].date} x={x - Math.max(.2, 38 / histogram.length)} y={Math.min(y, zero)} width={Math.max(.4, 76 / histogram.length)} height={Math.max(.45, Math.abs(zero - y))} className={value >= 0 ? 'macd-bar positive-bar' : 'macd-bar negative-bar'} />;
        })}<polyline points={technicalPoints(macd, macdBounds.min, macdBounds.max)} className="technical-macd-line"/><polyline points={technicalPoints(signal, macdBounds.min, macdBounds.max)} className="technical-signal-line"/></svg></div>
        <div className="macd-legend"><span><i className="macd-key"/>MACD</span><span><i className="signal-key"/>Signal</span><span><i className="histogram-key"/>Histogram</span></div>
      </article>
    </div>}
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
    <footer className="technical-note">技術指標依交易所每日調整收盤價計算，僅供持倉追蹤，不構成投資建議。</footer>
  </section>;
}, (previous, next) => previous.symbol === next.symbol
  && previous.range === next.range
  && previous.data === next.data
  && previous.loading === next.loading
  && previous.error === next.error
  && previous.stockTrades === next.stockTrades
  && previous.lotSavingId === next.lotSavingId);

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lotSavingId, setLotSavingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [macroRangeMode, setMacroRangeMode] = useState<RangeMode>('month');
  const [allocationChartMode, setAllocationChartMode] = useState<AllocationChartMode>('donut');
  const [allocationGroupSelection, setAllocationGroupSelection] = useState<{ label: string; members: string[] } | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [positionView, setPositionView] = useState<PositionViewMode>('visual');
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<'overview' | 'positions' | 'returns'>('overview');
  const [editor, setEditor] = useState<Trade | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Trade | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [priceEditId, setPriceEditId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [toast, setToast] = useState('');
  const [lastQuoteAt, setLastQuoteAt] = useState<string | null>(null);
  const [marketSnapshots, setMarketSnapshots] = useState<Record<string, LiveQuote>>({});
  const [usdJpyRate, setUsdJpyRate] = useState(initialUsdJpyRate);
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
  const macroCacheRef = useRef(new Map<RangeMode, { markets: BenchmarkMarket[]; updatedAt: string; fetchedAt: number }>());
  const technicalCacheRef = useRef(new Map<string, TechnicalData>());
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
      const payload = await response.json() as { quotes?: LiveQuote[]; failed?: number; updatedAt?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? '報價更新失敗');
      const quotes = payload.quotes ?? [];
      const marketTimes = quotes.flatMap((quote) => typeof quote.marketTime === 'number' ? [quote.marketTime] : []);
      setMarketSnapshots((current) => ({ ...current, ...Object.fromEntries(quotes.map((quote) => [quote.ticker, quote])) }));
      setLastQuoteAt(marketTimes.length ? new Date(Math.max(...marketTimes) * 1000).toISOString() : payload.updatedAt ?? new Date().toISOString());
      await fetchTrades();
      if (announce) notify(`已更新 ${quotes.length} 個股票報價${payload.failed ? `，${payload.failed} 個暫時無法取得` : ''}`);
    } catch (error) {
      if (announce) notify(error instanceof Error ? error.message : '報價更新失敗');
    } finally {
      quoteRefreshInFlightRef.current = false;
      if (announce) setRefreshing(false);
    }
  }, [fetchTrades, notify]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      fetchTrades().then(() => refreshQuotes(false)).catch((error) => { setLoading(false); notify(error.message); });
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshQuotes(false);
    }, 60_000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, [fetchTrades, notify, refreshQuotes]);

  useEffect(() => {
    const cached = benchmarkCacheRef.current.get(rangeMode);
    if (cached) {
      setBenchmarks({ mode: rangeMode, ...cached });
      setBenchmarkLoading(false);
      return;
    }
    const controller = new AbortController();
    setBenchmarkLoading(true);
    fetch(`/api/benchmarks?mode=${rangeMode}&scope=benchmarks`, { cache: 'no-store', signal: controller.signal })
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
    const cached = macroCacheRef.current.get(macroRangeMode);
    if (cached) setMacroMarkets({ mode: macroRangeMode, markets: cached.markets, updatedAt: cached.updatedAt });
    else setMacroLoading(true);
    const loadMarkets = async (quiet = false) => {
      if (inFlight) return;
      inFlight = true;
      if (!quiet) setMacroLoading(true);
      try {
        const response = await fetch(`/api/benchmarks?mode=${macroRangeMode}&scope=markets&_=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { markets?: BenchmarkMarket[]; updatedAt?: string; warnings?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? '宏觀行情暫時無法取得');
        if (controller.signal.aborted) return;
        const updatedAt = payload.updatedAt ?? new Date().toISOString();
        const nextMarkets = payload.markets ?? [];
        const fxRate = nextMarkets.find((market) => market.id === 'USDJPY')?.latest;
        if (typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 50) {
          setUsdJpyRate(fxRate);
          window.localStorage.setItem(usdJpyRateKey, String(fxRate));
        }
        macroCacheRef.current.set(macroRangeMode, { markets: nextMarkets, updatedAt, fetchedAt: Date.now() });
        setMacroMarkets({ mode: macroRangeMode, markets: nextMarkets, updatedAt });
        setMacroError(payload.warnings?.length ? '部分資料源暫時無法更新，系統會自動重試' : '');
      } catch (error) {
        if (!controller.signal.aborted) setMacroError(error instanceof Error ? error.message : '宏觀行情暫時無法取得');
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setMacroLoading(false);
      }
    };
    void loadMarkets(Boolean(cached));
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMarkets(true); }, 60_000);
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
      if (visible?.target.id === 'overview' || visible?.target.id === 'positions' || visible?.target.id === 'returns') setActiveSection(visible.target.id);
    }, { rootMargin: '-22% 0px -58% 0px', threshold: [0, .15, .4, .7] });
    ['overview', 'positions', 'returns'].forEach((id) => {
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

  const editorMarket: 'US' | 'JP' = editor?.market ?? (isJapaneseTicker(editor?.ticker) ? 'JP' : 'US');
  const editorCurrencySymbol = editorMarket === 'JP' ? '¥' : '$';
  const tickerQuery = editor?.ticker?.trim() ?? '';
  const editorAutoQuoteTicker = editor?.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto'
    ? normalizeTickerForMarket(tickerQuery, editorMarket)
    : '';
  const editorDisplayTicker = normalizeTickerForMarket(tickerQuery, editorMarket);
  const editorPriceMoney = (value: number) => editorMarket === 'JP' ? yenMoney.format(value) : money.format(value);
  const editorPreviewTrade = editor ? { ...editor, ticker: editorDisplayTicker, market: editorMarket } : null;
  const editorPreviewMetrics = editorPreviewTrade ? metrics(editorPreviewTrade, usdJpyRate) : null;
  useEffect(() => {
    if (!symbolFocused || !tickerQuery) {
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
  }, [editorMarket, tickerQuery, symbolFocused]);

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
    const cacheKey = `${drilledTicker}:${technicalRange}`;
    const cached = technicalCacheRef.current.get(cacheKey);
    if (cached) {
      setTechnicalData(cached);
      setTechnicalError('');
      setTechnicalLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/technical?symbol=${encodeURIComponent(drilledTicker)}&range=${technicalRange}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as TechnicalData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? '技術指標暫時無法取得');
        if (!controller.signal.aborted) {
          technicalCacheRef.current.set(cacheKey, payload);
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
  }, [drilledTicker, technicalRange]);

  const selectSymbol = useCallback((suggestion: SymbolSuggestion) => {
    setEditor((current) => current ? { ...current, ticker: suggestion.symbol, market: isJapaneseTicker(suggestion.symbol) ? 'JP' : 'US' } : current);
    setSymbolSuggestions([]);
    setSymbolFocused(false);
  }, []);

  const enriched = useMemo(() => trades.map((trade) => ({ trade, ...metrics(trade, usdJpyRate) })), [trades, usdJpyRate]);
  const openTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'open'), [enriched]);
  const closedTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'closed'), [enriched]);
  const openPnl = openTrades.reduce((sum, item) => sum + item.pnl, 0);
  const trackedValue = openTrades.reduce((sum, item) => sum + item.marketValue, 0);
  const capitalAtRisk = openTrades.reduce((sum, item) => sum + normalizedUsdAmount(item.trade, item.trade.collateral, usdJpyRate), 0);
  const annualRocItems = enriched.filter((item) => item.trade.collateral > 0 && Number.isFinite(item.annualRoc));
  const averageAnnualRoc = annualRocItems.length ? annualRocItems.reduce((sum, item) => sum + item.annualRoc, 0) / annualRocItems.length : 0;

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
  const activeMacroMarkets = macroMarkets.mode === macroRangeMode ? macroMarkets.markets : [];
  const macroUpdatedLabel = macroMarkets.updatedAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(macroMarkets.updatedAt)) : '等待更新';
  const chartDateStep = Math.max(1, Math.ceil((returnSeries.length - 1) / 5));

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
    const top = sorted.slice(0, 5).map((item) => ({ ...item, members: [item.label] }));
    if (sorted.length > 5) {
      top.push(sorted.slice(5).reduce((other, item) => ({
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
  const allocation = allocationSnapshot.items;
  let gradientStart = 0;
  const pieGradient = allocation.length ? `conic-gradient(${allocation.map((item) => {
    const start = gradientStart;
    gradientStart += item.share * 100;
    return `${item.color} ${start}% ${gradientStart}%`;
  }).join(', ')})` : '#e8eef7';
  let labelStart = 0;
  const donutLabels = allocation.map((item) => {
    const midpoint = labelStart + item.share / 2;
    labelStart += item.share;
    const angle = midpoint * Math.PI * 2 - Math.PI / 2;
    const isCompact = item.share < 0.04;
    const radius = isCompact ? 0.49 : 0.39;
    return {
      ...item,
      isCompact,
      position: {
        left: `${50 + Math.cos(angle) * radius * 100}%`,
        top: `${50 + Math.sin(angle) * radius * 100}%`,
        '--segment-color': item.color,
      } as CSSProperties,
    };
  });

  const filteredTrades = useMemo(() => enriched.filter((item) => {
    const matchesQuery = !query || `${item.trade.ticker} ${item.trade.event} ${item.trade.notes}`.toLowerCase().includes(query.toLowerCase());
    const matchesAllocationGroup = !allocationGroupSelection || allocationGroupSelection.members.includes((item.trade.ticker || 'OTHER').toUpperCase());
    const matchesFilter = filter === 'all' ||
      (filter === 'open' && item.trade.status === 'open') ||
      (filter === 'closed' && item.trade.status === 'closed') ||
      (filter === 'options' && item.trade.type !== 'SDI') ||
      (filter === 'stock' && item.trade.type === 'SDI');
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
      strategies: Set<string>;
    }>();
    for (const item of filteredTrades) {
      const ticker = item.trade.ticker || 'OTHER';
      const group = groups.get(ticker) ?? {
        ticker, items: [], marketValue: 0, pnl: 0, capital: 0, entryWeighted: 0,
        currentWeighted: 0, priceWeight: 0, strategies: new Set<string>(),
      };
      const units = Math.max(.0001, Math.abs(item.trade.quantity));
      const multiplier = item.trade.type === 'SDI' || item.trade.event === 'STOCK' ? 1 : 100;
      group.items.push(item);
      group.marketValue += item.marketValue;
      group.pnl += item.pnl;
      group.capital += normalizedUsdAmount(item.trade, item.trade.collateral || Math.abs(item.trade.entryPrice * item.trade.quantity * multiplier), usdJpyRate);
      group.entryWeighted += item.trade.entryPrice * units;
      group.currentWeighted += (item.trade.currentPrice ?? item.trade.entryPrice) * units;
      group.priceWeight += units;
      group.strategies.add(item.trade.event);
      groups.set(ticker, group);
    }
    const grouped = [...groups.values()].sort((a, b) => b.marketValue - a.marketValue);
    const total = grouped.reduce((sum, item) => sum + Math.max(0, item.marketValue), 0) || 1;
    return grouped.map((group) => ({
      ...group,
      company: companyNames[group.ticker] ?? (isJapaneseTicker(group.ticker) ? '日本股票持倉' : '美股／ETF 持倉'),
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
    setSaving(true);
    try {
      const preparedTrade: Trade = {
        ...editor,
        ticker: normalizeTickerForMarket(editor.ticker, editorMarket),
        market: editorMarket,
        type: editorMarket === 'JP' ? 'SDI' : editor.type,
        event: editorMarket === 'JP' ? 'STOCK' : editor.event,
        quoteMode: editor.quoteMode,
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

  async function deleteTrade() {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      const response = await fetch('/api/trades', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deleteCandidate.id }),
      });
      const payload = await response.json() as { deletedId?: number; error?: string };
      if (!response.ok || payload.deletedId !== deleteCandidate.id) throw new Error(payload.error ?? '刪除失敗');
      setTrades((current) => current.filter((trade) => trade.id !== deleteCandidate.id));
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
    setAllocationLoading(date !== currentDate && !cached);
    if (date === currentDate) setAllocationHistory(null);
    else if (cached) setAllocationHistory(cached);
  }

  function openTickerDetails(ticker: string) {
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
    window.requestAnimationFrame(() => document.getElementById('stock-analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function selectTechnicalRange(range: TechnicalRange) {
    if (range === technicalRange) return;
    setTechnicalRange(range);
    setTechnicalLoading(true);
    setTechnicalError('');
  }

  function returnToPositionsOverview() {
    setAllocationGroupSelection(null);
    setDrilledTicker(null);
    setQuery('');
    setPositionView('visual');
    setTechnicalData(null);
    setTechnicalLoading(false);
    setTechnicalError('');
    window.requestAnimationFrame(() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function selectAllocationItem(item: { label: string; members: string[] }) {
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
    window.requestAnimationFrame(() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function selectDonutSegment(event: ReactMouseEvent<HTMLDivElement>) {
    if (allocationLoading || !allocation.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const radius = Math.hypot(x, y);
    if (radius < bounds.width * 0.28 || radius > bounds.width * 0.52) return;
    const position = ((Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    let end = 0;
    const selected = allocation.find((item) => {
      end += item.share;
      return position <= end;
    });
    if (selected) selectAllocationItem(selected);
  }

  const marketOpen = (() => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const day = parts.find((part) => part.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const clock = hour * 60 + minute;
    return !['Sat', 'Sun'].includes(day) && clock >= 570 && clock < 960;
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
        <a className="brand" href="#top" aria-label="OptionFlow 首頁">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/optionflow-logo.jpg" alt="" width="40" height="40" />
          <span>OPTIONFLOW</span>
        </a>
        <div className="header-actions">
          <span className={`market-pill ${marketOpen ? 'is-open' : ''}`}><span />{marketOpen ? '美股交易中' : '非交易時段'}</span>
          <button className="secondary-button" type="button" onClick={() => refreshQuotes()} disabled={refreshing}>{refreshing ? '更新中…' : '↻ 更新報價'}</button>
          <button className="primary-button" type="button" onClick={() => setEditor(blankTrade())}>＋新增交易</button>
        </div>
      </header>

      <div className="page-frame">
        <nav className="side-nav" aria-label="頁面切換">
          {([['overview', '總覽', '⌂'], ['positions', '持倉', '▦'], ['returns', '收益', '⌁']] as const).map(([section, label, icon]) => <a key={section} href={`#${section}`} className={activeSection === section ? 'active' : ''} aria-current={activeSection === section ? 'page' : undefined} onClick={() => setActiveSection(section)}><i>{icon}</i><span>{label}</span></a>)}
          <div className="background-control">
            <button type="button" className="background-trigger" disabled={backgroundSaving} onClick={() => backgroundInputRef.current?.click()} title={backgroundSaving ? '正在永久保存背景圖片' : backgroundImage ? '更換背景圖片' : '加入背景圖片'}><i>{backgroundSaving ? '◌' : '▧'}</i><span>{backgroundSaving ? '保存中' : backgroundImage ? '換圖片' : '背景'}</span></button>
            {backgroundImage && <div className="background-mode-switch" aria-label="背景顯示方式"><button type="button" disabled={backgroundSaving} className={backgroundMode === 'default' ? 'active' : ''} aria-pressed={backgroundMode === 'default'} onClick={() => switchBackgroundMode('default')}>原始</button><button type="button" disabled={backgroundSaving} className={backgroundMode === 'image' ? 'active' : ''} aria-pressed={backgroundMode === 'image'} onClick={() => switchBackgroundMode('image')}>圖片</button></div>}
            <input ref={backgroundInputRef} className="visually-hidden" type="file" accept="image/*" disabled={backgroundSaving} onChange={handleBackgroundUpload} />
          </div>
        </nav>
        <div className="dashboard">
        <section className="hero" id="overview">
          <div><p className="eyebrow">Portfolio command center</p><h1>桐生<span>桔梗</span></h1></div>
          <LiveMarketClocks lastQuoteAt={lastQuoteAt} />
        </section>

        <section className="metric-grid" aria-label="投資組合摘要">
          <article className="metric-card featured"><p>追蹤市值</p><strong>{loading ? '—' : money.format(trackedValue)}</strong><span>{openTrades.length} 筆未平倉持倉</span></article>
          <article className="metric-card"><p>未實現損益</p><strong className={openPnl >= 0 ? 'positive' : 'negative'}>{loading ? '—' : money.format(openPnl)}</strong><span>{openPnl >= 0 ? '目前高於成本' : '目前低於成本'}</span></article>
          <article className="metric-card"><p>擔保／投入資本</p><strong>{loading ? '—' : money.format(capitalAtRisk)}</strong><span>依 Collateral 欄位統計</span></article>
          <article className="metric-card"><p>平均年化 ROC</p><strong className={averageAnnualRoc >= 0 ? 'positive' : 'negative'}>{loading ? '—' : percent.format(averageAnnualRoc)}</strong><span>{closedTrades.length} 筆已完成交易</span></article>
        </section>

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
            </div>
            <div className="chart-dates">{returnSeries.map((item, index) => <span key={item.key} className={index !== 0 && index !== returnSeries.length - 1 && index % chartDateStep !== 0 ? 'hide-small-label' : ''}>{item.label}</span>)}</div>
            <section className="macro-market-section" aria-labelledby="macro-market-title">
              <div className="macro-market-heading"><div><p className="eyebrow">Macro price monitor</p><h3 id="macro-market-title">匯率與美債價格波動</h3></div><div className="macro-market-actions"><div className="segmented macro-range-switch" role="group" aria-label="宏觀歷史期間">{([['day', '日'], ['week', '週'], ['month', '月'], ['year', '年']] as const).map(([mode, label]) => <button type="button" key={mode} className={macroRangeMode === mode ? 'selected' : ''} aria-pressed={macroRangeMode === mode} onClick={() => setMacroRangeMode(mode)}>{label}</button>)}</div><button type="button" className="macro-refresh-button" disabled={macroLoading} onClick={() => setMacroRefreshKey((current) => current + 1)}>↻ 更新</button><span>美東 {macroUpdatedLabel} · 每 60 秒</span></div></div>
              {macroError && <p className="macro-market-error" role="status">{macroError}</p>}
              <div className={`macro-market-grid ${macroLoading ? 'is-loading' : ''}`} aria-busy={macroLoading}>
                {activeMacroMarkets.map((market) => <MacroMarketCard key={market.id} market={market} startLabel={macroTimeline[0]?.label ?? ''} endLabel={macroTimeline.at(-1)?.label ?? ''} rangeLabel={macroRangeModeLabel} />)}
                {!activeMacroMarkets.length && [0, 1, 2].map((item) => <article className="macro-market-card macro-market-placeholder" key={item}><span /><b /><i /></article>)}
              </div>
              <p className="macro-market-note">行情每 60 秒重新檢查；10 年與 30 年美債以 CBOT 連續近月期貨價格作為代理，換月時可能出現跳點。</p>
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
              <div className={`donut ${allocationLoading ? 'is-loading' : ''} ${allocation.length ? 'has-items' : ''}`} style={{ background: pieGradient }} role="img" aria-label={`${allocationDate} 按標的計算的持倉圓餅圖；點擊區塊可查看下方股票；${allocation.map((item) => `${item.label} ${percent.format(item.share)}`).join('、')}`} onClick={selectDonutSegment}>
                {!allocationLoading && donutLabels.map((item) => <b className={`donut-segment-label ${item.isCompact ? 'is-compact' : ''}`} key={item.label} style={item.position} aria-hidden="true">{percent.format(item.share)}</b>)}
                <span className="donut-center"><strong>{allocationLoading ? '讀取中…' : money.format(allocationSnapshot.total)}</strong><small>{allocationDate === currentAllocationDate ? '目前曝險' : allocationDate}</small></span>
              </div>
              <div className="legend">
                {allocationLoading && <p className="allocation-empty">正在讀取歷史持倉…</p>}
                {!allocationLoading && !allocation.length && <p className="allocation-empty">這個日期沒有持倉紀錄</p>}
                {!allocationLoading && allocation.map((item) => <button type="button" className={`allocation-legend-item ${(drilledTicker === item.label || allocationGroupSelection?.label === item.label) ? 'is-selected' : ''}`} key={item.label} onClick={() => selectAllocationItem(item)} aria-label={`查看 ${item.label}，${money.format(item.value)}，占 ${percent.format(item.share)}`}><i style={{ background: item.color }} /><span>{item.label}</span><b>{money.format(item.value)}</b><strong>{percent.format(item.share)}</strong></button>)}
              </div>
            </div> : <div className={`allocation-bars ${allocationLoading ? 'is-loading' : ''}`} role="list" aria-busy={allocationLoading} aria-label={`${allocationDate} 按標的計算的持倉長條圖`}>
              {allocationLoading && <p className="allocation-empty" role="status">正在讀取歷史持倉…</p>}
              {!allocationLoading && !allocation.length && <p className="allocation-empty">這個日期沒有持倉紀錄</p>}
              {!allocationLoading && allocation.map((item) => <button type="button" className={`allocation-bar-row ${(drilledTicker === item.label || allocationGroupSelection?.label === item.label) ? 'is-selected' : ''}`} role="listitem" key={item.label} onClick={() => selectAllocationItem(item)} aria-label={`查看 ${item.label}，${money.format(item.value)}，占 ${percent.format(item.share)}`}><div><span><i style={{ background: item.color }} />{item.label}</span><b>{money.format(item.value)}</b><strong>{percent.format(item.share)}</strong></div><span className="allocation-bar-track" aria-hidden="true"><i style={{ width: `${item.share > 0 ? Math.max(1.5, Math.min(100, item.share * 100)) : 0}%`, background: item.color }} /></span></button>)}
            </div>}
            <p className="panel-note">{allocationDate === currentAllocationDate
              ? '股票按目前價格、選擇權按擔保金計算；價格變動後自動重算。'
              : `股票使用所選日期以前最近一個交易日的收盤價，選擇權按當時擔保金計算${allocationSnapshot.estimatedTickers.length ? `；${allocationSnapshot.estimatedTickers.join('、')} 因缺少歷史報價而以成交價估算` : ''}。`}</p>
          </article>
        </section>

        {drilledTicker && <StockTechnicalPanel
          symbol={drilledTicker}
          range={technicalRange}
          data={technicalData}
          loading={technicalLoading}
          error={technicalError}
          stockTrades={selectedStockTrades}
          lotSavingId={lotSavingId}
          onRangeChange={selectTechnicalRange}
          onClose={returnToPositionsOverview}
          onAddLot={() => setEditor({ ...blankTrade(), type: 'SDI', ticker: drilledTicker, event: 'STOCK', quoteMode: 'auto', currentPrice: technicalData?.symbol === drilledTicker ? technicalData.latestPrice : 0 })}
          onSaveLot={saveStockLot}
          onEditLot={(trade) => setEditor({ ...trade })}
          onDeleteLot={(trade) => setDeleteCandidate(trade)}
        />}

        <section className="panel positions-panel" id="positions">
          <div className="positions-toolbar">
            <div><p className="eyebrow">Active book</p><h2>交易與持倉</h2></div>
            <div className="toolbar-actions"><div className="view-switch" aria-label="持倉顯示方式"><button className={positionView === 'visual' ? 'active' : ''} onClick={() => (drilledTicker || allocationGroupSelection) ? returnToPositionsOverview() : setPositionView('visual')}>圖形持倉</button><button className={positionView === 'details' ? 'active' : ''} onClick={() => setPositionView('details')}>交易明細</button></div><label className="search"><span>⌕</span><input value={query} onChange={(event) => { setAllocationGroupSelection(null); setQuery(event.target.value); }} placeholder="搜尋 ticker、策略或備註" aria-label="搜尋交易" /></label><button className="primary-button" onClick={() => setEditor(blankTrade())}>＋新增</button></div>
          </div>
          {drilledTicker && <div className="drilldown-bar"><button type="button" onClick={returnToPositionsOverview}>← 返回持倉總覽</button><span>正在查看 <strong>{drilledTicker}</strong> 的 {filteredTrades.length} 筆交易紀錄</span></div>}
          {allocationGroupSelection && !drilledTicker && <div className="drilldown-bar"><button type="button" onClick={returnToPositionsOverview}>← 返回持倉總覽</button><span>持倉配置已選擇 <strong>{allocationGroupSelection.label}</strong>：{allocationGroupSelection.members.join('、')}</span></div>}
          <div className="filter-row">{([['open', '未平倉'], ['closed', '已平倉'], ['options', '選擇權'], ['stock', '股票'], ['all', '全部']] as const).map(([mode, label]) => <button key={mode} className={filter === mode ? 'active' : ''} onClick={() => setFilter(mode)}>{label}<span>{mode === 'all' ? trades.length : mode === 'open' ? openTrades.length : mode === 'closed' ? closedTrades.length : trades.filter((trade) => mode === 'stock' ? trade.type === 'SDI' : trade.type !== 'SDI').length}</span></button>)}</div>
          {positionView === 'visual' ? <div className="visual-positions">
            <div className="visual-head"><span>#</span><span>標的／公司</span><span>持倉市值</span><span>成本均價／現價</span><span>標的價格波動／今日漲跌</span><span>損益／報酬率</span><span>組合占比</span></div>
            {!loading && !visualPositions.length && <div className="visual-empty">沒有符合目前篩選條件的持倉。</div>}
            {loading && <div className="visual-empty">正在整理圖形化持倉…</div>}
            {!loading && visualPositions.map((position, index) => {
              const snapshot = marketSnapshots[position.ticker];
              const dailyChange = snapshot?.changePercent ?? null;
              return <article className="visual-position-row" key={position.ticker}>
                <span className="position-rank">{String(index + 1).padStart(2, '0')}</span>
                <button type="button" className="visual-asset visual-asset-button" onClick={() => openTickerDetails(position.ticker)}><CompanyLogo ticker={position.ticker} /><span className="visual-asset-copy"><strong>{position.ticker}</strong><span>{position.company}</span><small>{position.items.length} 筆 · {position.strategy}</small></span></button>
                <div className="visual-value"><span>持倉市值</span><strong>{money.format(position.marketValue)}</strong></div>
                <div className="visual-price-flow"><div><span>{position.items.every((item) => item.trade.type === 'SDI' || item.trade.event === 'STOCK') ? '股票均價' : '成交均價'}</span><strong>{nativeMoney(position.ticker, position.entryPrice)}</strong></div><div><span>目前價格</span><strong>{nativeMoney(position.ticker, position.currentPrice)}</strong></div></div>
                <div className={`visual-market-move ${dailyChange === null ? 'neutral' : dailyChange >= 0 ? 'positive' : 'negative'}`}><PriceSparkline ticker={position.ticker} values={snapshot?.sparkline ?? []} changePercent={dailyChange} /><div><span>標的今日漲跌</span><strong>{dailyChange === null ? '等待報價' : `${dailyChange >= 0 ? '+' : ''}${precisePercent.format(dailyChange)}`}</strong><small>{snapshot?.change === null || snapshot?.change === undefined ? '—' : `${nativeMoney(position.ticker, snapshot.price)} · ${snapshot.change >= 0 ? '+' : ''}${nativeMoney(position.ticker, snapshot.change)}`}</small></div></div>
                <div className={`visual-gain ${position.pnl >= 0 ? 'positive' : 'negative'}`}><strong>{position.pnl >= 0 ? '+' : ''}{money.format(position.pnl)}</strong><span>{position.roc >= 0 ? '▲' : '▼'} {percent.format(Math.abs(position.roc))}</span></div>
                <div className="visual-weight"><div><span>組合占比</span><strong>{percent.format(position.share)}</strong></div><b><i style={{ width: `${Math.max(2, Math.min(100, position.share * 100))}%` }} /></b></div>
              </article>;
            })}
          </div> : <div className="table-wrap">
            <table>
              <thead><tr><th>標的</th><th>交易／策略</th><th>開倉／到期</th><th>履約價</th><th>數量</th><th>買入／成交價</th><th>目前價格</th><th>損益</th><th>ROC</th><th>狀態</th><th>操作</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="empty-state">正在載入你的交易紀錄…</td></tr>}
                {!loading && !filteredTrades.length && <tr><td colSpan={11} className="empty-state">沒有符合目前篩選條件的交易。</td></tr>}
                {filteredTrades.map(({ trade, pnl, roc }) => <tr key={trade.id}>
                  <td><button type="button" className="symbol-cell symbol-cell-button" onClick={() => trade.ticker && openTickerDetails(trade.ticker)}><CompanyLogo ticker={trade.ticker || 'OTHER'} compact /><strong>{trade.ticker || '—'}</strong></button></td>
                  <td><strong className="strategy-name">{trade.event}</strong><span className="subtle">{trade.type === 'SDI' ? 'Stock' : trade.type}</span></td>
                  <td><strong>{dateLabel(trade.openDate)}</strong><span className="subtle">Exp {dateLabel(trade.expiryDate)}</span></td>
                  <td>{trade.strike || '—'}</td><td>{trade.quantity}</td><td>{nativeMoney(trade.ticker, trade.entryPrice)}</td>
                  <td>{priceEditId === trade.id ? <div className="inline-price"><span>{isJapaneseTicker(trade.ticker) ? '¥' : '$'}</span><input autoFocus inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveInlinePrice(trade); if (event.key === 'Escape') setPriceEditId(null); }} /><button onClick={() => saveInlinePrice(trade)}>✓</button></div> : <button className="price-button" onClick={() => { setPriceEditId(trade.id); setPriceInput(String(trade.currentPrice ?? '')); }}><span className={trade.quoteMode === 'auto' ? 'live-dot' : 'manual-dot'} />{trade.currentPrice === null ? '設定' : nativeMoney(trade.ticker, trade.currentPrice)} <i>✎</i></button>}</td>
                  <td className={pnl >= 0 ? 'positive' : 'negative'}><strong>{money.format(pnl)}</strong></td>
                  <td className={roc >= 0 ? 'positive' : 'negative'}>{percent.format(roc)}</td>
                  <td><span className={`status ${trade.status}`}><i />{trade.status === 'open' ? '未平倉' : '已平倉'}</span></td>
                  <td><span className="row-actions"><button className="row-action-button" onClick={() => setEditor({ ...trade })} aria-label={`編輯 ${trade.ticker ?? '交易'}`}>編輯</button><button className="row-action-button delete" onClick={() => setDeleteCandidate(trade)} aria-label={`刪除 ${trade.ticker ?? '交易'}`}>刪除</button></span></td>
                </tr>)}
              </tbody>
            </table>
          </div>}
          <footer className="table-footer"><span><i className="live-dot" />股票自動報價</span><span><i className="manual-dot" />手動價格</span><p>選擇權工作簿沒有 OCC 合約代碼，因此權利金保留手動更新；股票報價可能依來源或交易所延遲。</p></footer>
        </section>
        </div>
      </div>

      {editor && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <section className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-editor-title">
          <header><div><p className="eyebrow">Trade workspace</p><div className="editor-title-row"><h2 id="trade-editor-title">{editor.id ? '編輯交易' : '新增交易'}</h2><span>{editor.id ? `#${editor.id}` : 'New position'}</span></div></div><button className="close-button" onClick={() => setEditor(null)} aria-label="關閉">×</button></header>
          <form onSubmit={saveEditor}>
            <div className="editor-layout">
              <div className="editor-fields">
                <section className="editor-section">
                  <div className="editor-section-heading"><span>01</span><div><h3>交易設定</h3><p>先選擇交易方向，再搜尋標的與策略。</p></div></div>
                  <fieldset className="choice-field editor-market-switch"><legend>股票市場</legend><div className="market-choice">
                    <button type="button" className={editorMarket === 'US' ? 'active' : ''} onClick={() => { setEditor({ ...editor, market: 'US', ticker: isJapaneseTicker(editor.ticker) ? '' : editor.ticker }); setSymbolSuggestions([]); setEditorQuote(null); }}>美國</button>
                    <button type="button" className={editorMarket === 'JP' ? 'active' : ''} onClick={() => { setEditor({ ...editor, market: 'JP', ticker: isJapaneseTicker(editor.ticker) ? editor.ticker : '', type: 'SDI', event: 'STOCK', quoteMode: 'auto' }); setSymbolSuggestions([]); setEditorQuote(null); }}>日本</button>
                  </div><small>{editorMarket === 'JP' ? '支援東京證券交易所 4 位股票代碼，價格以日圓顯示。' : '支援美股、ETF 與選擇權交易。'}</small></fieldset>
                  <fieldset className="choice-field"><legend>交易類型</legend><div className="trade-type-picker">
                    {([
                      ['Sell', '賣方', '收取權利金'],
                      ['Buy', '買方', '支付權利金'],
                      ['Ass', '指派', '承接標的'],
                      ['SDI', '股票', '現股持倉'],
                    ] as const).map(([type, label, description]) => <button key={type} type="button" disabled={editorMarket === 'JP' && type !== 'SDI'} className={editor.type === type ? 'active' : ''} onClick={() => setEditor({ ...editor, type, event: type === 'SDI' ? 'STOCK' : editor.event, quoteMode: type === 'SDI' ? 'auto' : 'manual' })}><i>{type === 'Sell' ? '↓' : type === 'Buy' ? '↑' : type === 'Ass' ? '↳' : '◇'}</i><span><strong>{label}</strong><small>{description}</small></span></button>)}
                  </div></fieldset>
                  <div className="form-grid">
                    <label className="ticker-search-field">Ticker
                      <span className="ticker-input-shell">
                        <input
                          required
                          value={editor.ticker ?? ''}
                          onChange={(event) => setEditor({ ...editor, ticker: event.target.value.toUpperCase() })}
                          onFocus={() => setSymbolFocused(true)}
                          onBlur={() => window.setTimeout(() => { setSymbolFocused(false); setEditor((current) => current ? { ...current, ticker: normalizeTickerForMarket(current.ticker, current.market ?? (isJapaneseTicker(current.ticker) ? 'JP' : 'US')) } : current); }, 120)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowDown' && symbolSuggestions.length) { event.preventDefault(); setActiveSymbolIndex((current) => (current + 1) % symbolSuggestions.length); }
                            if (event.key === 'ArrowUp' && symbolSuggestions.length) { event.preventDefault(); setActiveSymbolIndex((current) => (current - 1 + symbolSuggestions.length) % symbolSuggestions.length); }
                            if (event.key === 'Enter' && symbolSuggestions[activeSymbolIndex]) { event.preventDefault(); selectSymbol(symbolSuggestions[activeSymbolIndex]); }
                            if (event.key === 'Escape') { setSymbolSuggestions([]); setSymbolFocused(false); }
                          }}
                          placeholder={editorMarket === 'JP' ? '輸入 7203 或 Toyota…' : '輸入 MS 搜尋 MSFT…'}
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
                    <label>策略／事件<input required value={editor.event} onChange={(event) => setEditor({ ...editor, event: event.target.value.toUpperCase() })} placeholder="PUT / CALL / STOCK" /></label>
                    <label>履約價／組合<input value={editor.strike ?? ''} onChange={(event) => setEditor({ ...editor, strike: event.target.value })} placeholder="70 或 185/180" /></label>
                  </div>
                </section>

                <section className="editor-section">
                  <div className="editor-section-heading"><span>02</span><div><h3>合約期間</h3><p>設定日期與口數；填入平倉日會自動切換狀態。</p></div></div>
                  <div className="form-grid date-fields">
                    <label>開倉日<input required type="date" value={editor.openDate} onChange={(event) => setEditor({ ...editor, openDate: event.target.value })} /></label>
                    <label>到期日<input type="date" value={editor.expiryDate ?? ''} onChange={(event) => setEditor({ ...editor, expiryDate: event.target.value || null })} /></label>
                    <label>平倉日<input type="date" value={editor.closeDate ?? ''} onChange={(event) => setEditor({ ...editor, closeDate: event.target.value || null, status: event.target.value ? 'closed' : 'open' })} /></label>
                    <label>數量<input min="0" step="0.01" type="number" value={editor.quantity} onChange={(event) => setEditor({ ...editor, quantity: Number(event.target.value) })} /></label>
                  </div>
                </section>

                <section className="editor-section">
                  <div className="editor-section-heading"><span>03</span><div><h3>價格與風險</h3><p>輸入價格、費用與投入資本，損益會立即重算。</p></div></div>
                  <div className="form-grid price-fields">
                    <label>成本／成交價<div className="money-input"><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" value={editor.entryPrice} onChange={(event) => setEditor({ ...editor, entryPrice: Number(event.target.value) })} /></div></label>
                    <label><span className="field-label-row"><span>持倉／平倉價</span>{editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto' && <small>自動填入</small>}</span><div className={`money-input ${editorQuoteLoading ? 'is-quote-loading' : ''}`} aria-busy={editorQuoteLoading}><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" readOnly={editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto'} value={editor.currentPrice ?? ''} onChange={(event) => setEditor({ ...editor, currentPrice: event.target.value === '' ? null : Number(event.target.value) })} />{editorQuoteLoading && <i className="quote-price-spinner" aria-label="正在取得報價" />}</div>{editor.type === 'SDI' && editor.status === 'open' && editor.quoteMode === 'auto' && <span className={`auto-quote-status ${editorQuoteError ? 'error' : ''}`} aria-live="polite">{editorQuoteLoading ? '正在取得最新可用報價…' : editorQuoteError ? <>{editorQuoteError}<button type="button" onClick={() => setEditorQuoteRetry((current) => current + 1)}>重試</button></> : editorQuote?.ticker === editorAutoQuoteTicker ? `${editorQuote.session === 'extended' ? '盤前／盤後' : '正常交易時段'} ${nativeMoney(editorAutoQuoteTicker, editorQuote.price)} 已填入` : '輸入 Ticker 後會自動填入'}</span>}</label>
                    <label>手續費<div className="money-input"><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" value={editor.fees} onChange={(event) => setEditor({ ...editor, fees: Number(event.target.value) })} /></div></label>
                    <label>擔保／投入資本<div className="money-input"><span>{editorCurrencySymbol}</span><input min="0" step="0.01" type="number" value={editor.collateral} onChange={(event) => setEditor({ ...editor, collateral: Number(event.target.value) })} /></div></label>
                  </div>
                  <div className="editor-choice-row">
                    {editor.type === 'SDI' && <fieldset className="choice-field compact-choice"><legend>報價方式</legend><div><button type="button" disabled={editor.status === 'closed'} className={editor.quoteMode === 'auto' ? 'active' : ''} onClick={() => { setEditor({ ...editor, quoteMode: 'auto' }); setEditorQuoteRetry((current) => current + 1); }}>自動更新</button><button type="button" className={editor.quoteMode === 'manual' ? 'active' : ''} onClick={() => setEditor({ ...editor, quoteMode: 'manual' })}>手動輸入</button></div></fieldset>}
                    <fieldset className="choice-field compact-choice"><legend>持倉狀態</legend><div><button type="button" className={editor.status === 'open' ? 'active' : ''} onClick={() => setEditor({ ...editor, status: 'open', closeDate: null })}>未平倉</button><button type="button" className={editor.status === 'closed' ? 'active' : ''} onClick={() => setEditor({ ...editor, status: 'closed', quoteMode: editor.type === 'SDI' ? 'manual' : editor.quoteMode })}>已平倉</button></div></fieldset>
                  </div>
                  <label className="notes-field">備註<textarea rows={3} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="記錄交易想法、催化劑或檢討…" /></label>
                </section>
              </div>
              <aside className="editor-summary">
                <div className="summary-sticky">
                  <p className="eyebrow">Live preview</p><h3>交易預覽</h3>
                  <div className="summary-symbol"><span>{editorDisplayTicker?.slice(0, 1) || '—'}</span><div><strong>{editorDisplayTicker || '尚未選擇標的'}</strong><small>{editorMarket === 'JP' ? '日本 · ' : '美國 · '}{editor.event || '選擇策略'}</small></div></div>
                  <div className="summary-price-pair"><div><span>買入／成交價</span><strong>{editorPriceMoney(editor.entryPrice)}</strong></div><div><span>目前價格</span><strong>{editor.currentPrice === null ? '尚未設定' : editorPriceMoney(editor.currentPrice)}</strong></div></div>
                  <div className="summary-result"><span>即時計算損益（USD）</span><strong className={(editorPreviewMetrics?.pnl ?? 0) >= 0 ? 'positive' : 'negative'}>{money.format(editorPreviewMetrics?.pnl ?? 0)}</strong></div>
                  <dl><div><dt>ROC</dt><dd className={(editorPreviewMetrics?.roc ?? 0) >= 0 ? 'positive' : 'negative'}>{percent.format(editorPreviewMetrics?.roc ?? 0)}</dd></div><div><dt>持有天數</dt><dd>{editorPreviewMetrics?.days || 0} 天</dd></div><div><dt>狀態</dt><dd>{editor.status === 'open' ? '未平倉' : '已平倉'}</dd></div><div><dt>報價</dt><dd>{editorQuoteLoading ? '讀取中…' : editor.quoteMode === 'auto' && editorQuote?.ticker === editorAutoQuoteTicker ? `${editorQuote.session === 'extended' ? '延長時段' : '正常時段'} ${nativeMoney(editorAutoQuoteTicker, editorQuote.price)}` : editor.quoteMode === 'auto' ? '自動更新' : '手動價格'}</dd></div></dl>
                  <p className="summary-tip"><i>✓</i> 所有欄位可隨時回來修改，儲存後會同步更新圖表與持倉配置。</p>
                </div>
              </aside>
            </div>
            <footer className="editor-actions">{editor.id > 0 && <button type="button" className="editor-delete-button" onClick={() => setDeleteCandidate(editor)}>刪除交易</button>}<p><span>●</span> 資料會安全儲存並立即更新儀表板</p><button type="button" className="cancel-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button save-button" disabled={saving || editorQuoteLoading}>{saving ? '儲存中…' : editorQuoteLoading ? '取得報價中…' : '儲存交易'}</button></footer>
          </form>
        </section>
      </div>}
      {deleteCandidate && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!deleting && event.target === event.currentTarget) setDeleteCandidate(null); }}>
        <section className="delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-copy">
          <span className="delete-confirm-icon" aria-hidden="true">!</span>
          <p className="eyebrow">Permanent action</p>
          <h2 id="delete-confirm-title">刪除這筆交易紀錄？</h2>
          <p id="delete-confirm-copy">刪除後會立即從持倉、損益與收益圖表中移除，這個動作無法復原。</p>
          <div className="delete-trade-summary"><strong>{deleteCandidate.ticker || '未命名標的'}</strong><span>{deleteCandidate.event} · {dateLabel(deleteCandidate.openDate)} · {nativeMoney(deleteCandidate.ticker, deleteCandidate.entryPrice)}</span></div>
          <footer><button type="button" className="cancel-button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>保留紀錄</button><button type="button" className="confirm-delete-button" disabled={deleting} onClick={deleteTrade}>{deleting ? '刪除中…' : '永久刪除'}</button></footer>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
