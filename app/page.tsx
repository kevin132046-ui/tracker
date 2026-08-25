'use client';

import type { ChangeEvent, CSSProperties } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

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
  sourceRow?: number | null;
};

type RangeMode = 'week' | 'month' | 'year';
type FilterMode = 'all' | 'open' | 'closed' | 'options' | 'stock';
type SymbolSuggestion = { symbol: string; name: string; exchange: string; type: string };

const palette = ['#2f73ed', '#3cc7df', '#7768e8', '#22b58b', '#f0a33a', '#e66878'];
const panelRatioKey = 'optionflow-analytics-panel-ratio';
const backgroundImageKey = 'optionflow-custom-background';
const clampPanelRatio = (value: number) => Math.min(72, Math.max(46, value));
const initialPanelRatio = () => {
  if (typeof window === 'undefined') return 60;
  const savedRatio = Number(window.localStorage.getItem(panelRatioKey));
  return Number.isFinite(savedRatio) && savedRatio > 0 ? clampPanelRatio(savedRatio) : 60;
};
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`)) : '—';

function blankTrade(): Trade {
  return {
    id: 0, type: 'Sell', openDate: today(), expiryDate: null, closeDate: null,
    ticker: '', event: 'PUT', strike: '', quantity: 1, entryPrice: 0,
    currentPrice: 0, fees: 0, collateral: 0, notes: '', status: 'open', quoteMode: 'manual',
  };
}

function metrics(trade: Trade) {
  const current = trade.currentPrice;
  if (current === null) return { pnl: 0, days: 0, roc: 0, annualRoc: 0, marketValue: 0 };
  const stock = trade.type === 'SDI' || trade.event === 'STOCK';
  const multiplier = stock ? 1 : 100;
  const direction = trade.type.toLowerCase() === 'sell' ? -1 : 1;
  const pnl = (current - trade.entryPrice) * trade.quantity * multiplier * direction - trade.fees;
  const end = new Date(`${trade.closeDate ?? today()}T00:00:00Z`).getTime();
  const start = new Date(`${trade.openDate}T00:00:00Z`).getTime();
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  const roc = trade.collateral > 0 ? pnl / trade.collateral : 0;
  const annualRoc = roc * (365 / days);
  const marketValue = stock ? current * trade.quantity : Math.max(trade.collateral, current * trade.quantity * 100);
  return { pnl, days, roc, annualRoc, marketValue };
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function buildReturnSeries(trades: Trade[], mode: RangeMode) {
  const now = new Date(`${today()}T00:00:00Z`);
  const buckets: Array<{ key: string; label: string; pnl: number; capital: number }> = [];
  if (mode === 'week') {
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
    const key = mode === 'week'
      ? startOfWeek(activityDate).toISOString().slice(0, 10)
      : mode === 'month' ? activityDate.toISOString().slice(0, 7) : String(activityDate.getUTCFullYear());
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) {
      bucket.pnl += metrics(trade).pnl;
      bucket.capital += trade.collateral || metrics(trade).marketValue;
    }
  }
  return buckets.map((bucket) => ({ ...bucket, value: bucket.capital > 0 ? bucket.pnl / bucket.capital : 0 }));
}

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<'overview' | 'positions' | 'returns'>('overview');
  const [editor, setEditor] = useState<Trade | null>(null);
  const [priceEditId, setPriceEditId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [toast, setToast] = useState('');
  const [lastQuoteAt, setLastQuoteAt] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<{ SPY: number[]; BOXX: number[] }>({ SPY: [], BOXX: [] });
  const [symbolSuggestions, setSymbolSuggestions] = useState<SymbolSuggestion[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolFocused, setSymbolFocused] = useState(false);
  const [activeSymbolIndex, setActiveSymbolIndex] = useState(0);
  const [panelRatio, setPanelRatio] = useState(initialPanelRatio);
  const [resizingPanels, setResizingPanels] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState('');
  const contentGridRef = useRef<HTMLElement>(null);
  const panelRatioRef = useRef(panelRatio);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  const handleBackgroundUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return notify('請選擇圖片檔案');
    const reader = new FileReader();
    reader.onload = () => {
      const source = typeof reader.result === 'string' ? reader.result : '';
      if (!source) return notify('無法讀取這張圖片');
      const preview = new window.Image();
      preview.onload = () => {
        const maxEdge = 1920;
        const scale = Math.min(1, maxEdge / Math.max(preview.naturalWidth, preview.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(preview.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(preview.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return notify('目前瀏覽器無法處理背景圖片');
        context.drawImage(preview, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', .82);
        try {
          window.localStorage.setItem(backgroundImageKey, compressed);
          setBackgroundImage(compressed);
          notify('背景圖片已套用並保存');
        } catch {
          notify('圖片仍然太大，請改用較小的圖片');
        }
      };
      preview.onerror = () => notify('無法解析這張圖片');
      preview.src = source;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, [notify]);

  const clearBackground = useCallback(() => {
    window.localStorage.removeItem(backgroundImageKey);
    setBackgroundImage('');
    notify('已還原白色背景');
  }, [notify]);

  const fetchTrades = useCallback(async () => {
    const response = await fetch('/api/trades', { cache: 'no-store' });
    const payload = await response.json() as { trades?: Trade[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? '無法載入交易資料');
    setTrades(payload.trades ?? []);
    setLoading(false);
  }, []);

  const refreshQuotes = useCallback(async (announce = true) => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/quotes', { method: 'POST' });
      const payload = await response.json() as { quotes?: unknown[]; failed?: number; updatedAt?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? '報價更新失敗');
      setLastQuoteAt(payload.updatedAt ?? new Date().toISOString());
      await fetchTrades();
      if (announce) notify(`已更新 ${payload.quotes?.length ?? 0} 個股票報價${payload.failed ? `，${payload.failed} 個暫時無法取得` : ''}`);
    } catch (error) {
      if (announce) notify(error instanceof Error ? error.message : '報價更新失敗');
    } finally {
      setRefreshing(false);
    }
  }, [fetchTrades, notify]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      fetchTrades().then(() => refreshQuotes(false)).catch((error) => { setLoading(false); notify(error.message); });
    }, 0);
    const timer = window.setInterval(() => refreshQuotes(false), 60_000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, [fetchTrades, notify, refreshQuotes]);

  useEffect(() => {
    let active = true;
    fetch(`/api/benchmarks?mode=${rangeMode}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { SPY?: number[]; BOXX?: number[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? '基準資料暫時無法取得');
        if (active) setBenchmarks({ SPY: payload.SPY ?? [], BOXX: payload.BOXX ?? [] });
      })
      .catch(() => { if (active) setBenchmarks({ SPY: [], BOXX: [] }); });
    return () => { active = false; };
  }, [rangeMode]);

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
    const restoreBackground = window.setTimeout(() => setBackgroundImage(window.localStorage.getItem(backgroundImageKey) ?? ''), 0);
    return () => window.clearTimeout(restoreBackground);
  }, []);

  const updatePanelRatio = useCallback((clientX: number) => {
    const bounds = contentGridRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const nextRatio = clampPanelRatio(((clientX - bounds.left) / bounds.width) * 100);
    panelRatioRef.current = nextRatio;
    setPanelRatio(nextRatio);
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

  const tickerQuery = editor?.ticker?.trim() ?? '';
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
        const response = await fetch(`/api/symbols?q=${encodeURIComponent(tickerQuery)}`, { signal: controller.signal });
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
  }, [tickerQuery, symbolFocused]);

  const selectSymbol = useCallback((suggestion: SymbolSuggestion) => {
    setEditor((current) => current ? { ...current, ticker: suggestion.symbol } : current);
    setSymbolSuggestions([]);
    setSymbolFocused(false);
  }, []);

  const enriched = useMemo(() => trades.map((trade) => ({ trade, ...metrics(trade) })), [trades]);
  const openTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'open'), [enriched]);
  const closedTrades = useMemo(() => enriched.filter((item) => item.trade.status === 'closed'), [enriched]);
  const openPnl = openTrades.reduce((sum, item) => sum + item.pnl, 0);
  const trackedValue = openTrades.reduce((sum, item) => sum + item.marketValue, 0);
  const capitalAtRisk = openTrades.reduce((sum, item) => sum + item.trade.collateral, 0);
  const annualRocItems = enriched.filter((item) => item.trade.collateral > 0 && Number.isFinite(item.annualRoc));
  const averageAnnualRoc = annualRocItems.length ? annualRocItems.reduce((sum, item) => sum + item.annualRoc, 0) / annualRocItems.length : 0;

  const returnSeries = useMemo(() => buildReturnSeries(trades, rangeMode), [trades, rangeMode]);
  const maxAbsReturn = Math.max(.01, ...returnSeries.map((item) => Math.abs(item.value)), ...benchmarks.SPY.map(Math.abs), ...benchmarks.BOXX.map(Math.abs));
  const pointsFor = (values: number[]) => values.map((value, index) => {
    const x = returnSeries.length === 1 ? 50 : (index / (returnSeries.length - 1)) * 100;
    const y = 50 - (value / maxAbsReturn) * 38;
    return `${x},${y}`;
  }).join(' ');
  const chartPoints = pointsFor(returnSeries.map((item) => item.value));
  const spyPoints = pointsFor(benchmarks.SPY);
  const boxxPoints = pointsFor(benchmarks.BOXX);

  const allocation = useMemo(() => {
    const groups = new Map<string, number>();
    for (const item of openTrades) {
      const ticker = item.trade.ticker || 'Other';
      groups.set(ticker, (groups.get(ticker) ?? 0) + item.marketValue);
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const other = sorted.slice(5).reduce((sum, item) => sum + item[1], 0);
    if (other) top.push(['其他', other]);
    const total = top.reduce((sum, item) => sum + item[1], 0) || 1;
    return top.map(([label, value], index) => ({ label, value, share: value / total, color: palette[index % palette.length] }));
  }, [openTrades]);
  let gradientStart = 0;
  const pieGradient = allocation.length ? `conic-gradient(${allocation.map((item) => {
    const start = gradientStart;
    gradientStart += item.share * 100;
    return `${item.color} ${start}% ${gradientStart}%`;
  }).join(', ')})` : '#e8eef7';

  const filteredTrades = useMemo(() => enriched.filter((item) => {
    const matchesQuery = !query || `${item.trade.ticker} ${item.trade.event} ${item.trade.notes}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === 'all' ||
      (filter === 'open' && item.trade.status === 'open') ||
      (filter === 'closed' && item.trade.status === 'closed') ||
      (filter === 'options' && item.trade.type !== 'SDI') ||
      (filter === 'stock' && item.trade.type === 'SDI');
    return matchesQuery && matchesFilter;
  }), [enriched, filter, query]);

  async function persistTrade(trade: Trade, method: 'POST' | 'PUT') {
    const response = await fetch('/api/trades', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
    const payload = await response.json() as { trade?: Trade; error?: string };
    if (!response.ok || !payload.trade) throw new Error(payload.error ?? '儲存失敗');
    setTrades((current) => method === 'POST' ? [payload.trade!, ...current] : current.map((item) => item.id === payload.trade!.id ? payload.trade! : item));
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      await persistTrade(editor, editor.id ? 'PUT' : 'POST');
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

  const marketOpen = (() => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const day = parts.find((part) => part.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const clock = hour * 60 + minute;
    return !['Sat', 'Sun'].includes(day) && clock >= 570 && clock < 960;
  })();
  const contentGridStyle = { '--return-panel-ratio': `${panelRatio}%` } as CSSProperties;
  const shellStyle = backgroundImage ? { '--custom-background': `url("${backgroundImage}")` } as CSSProperties : undefined;

  return (
    <main className={`shell ${backgroundImage ? 'has-custom-background' : ''}`} id="top" style={shellStyle}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="OptionFlow 首頁"><Image className="brand-logo" src="/optionflow-logo.jpg" alt="" width={40} height={40} priority /><span>OPTIONFLOW</span></a>
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
            <button type="button" className="background-trigger" onClick={() => backgroundInputRef.current?.click()} title={backgroundImage ? '更換背景圖片' : '加入背景圖片'}><i>▧</i><span>{backgroundImage ? '換背景' : '背景'}</span></button>
            {backgroundImage && <button type="button" className="background-clear" onClick={clearBackground} aria-label="移除背景圖片">×</button>}
            <input ref={backgroundInputRef} className="visually-hidden" type="file" accept="image/*" onChange={handleBackgroundUpload} />
          </div>
        </nav>
        <div className="dashboard">
        <section className="hero" id="overview">
          <div><p className="eyebrow">Portfolio command center</p><h1>反者<span>道之動</span></h1><p className="hero-copy">原始 Excel 欄位與計算邏輯已完整轉換。持倉可編輯、資料會保存，股票報價每 60 秒取得最新可用價格。</p></div>
          <div className="as-of"><span>美東報價時間</span><strong>{lastQuoteAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).format(new Date(lastQuoteAt)) : '等待首次更新'}</strong></div>
        </section>

        <section className="metric-grid" aria-label="投資組合摘要">
          <article className="metric-card featured"><p>追蹤市值</p><strong>{loading ? '—' : money.format(trackedValue)}</strong><span>{openTrades.length} 筆未平倉持倉</span></article>
          <article className="metric-card"><p>未實現損益</p><strong className={openPnl >= 0 ? 'positive' : 'negative'}>{loading ? '—' : money.format(openPnl)}</strong><span>{openPnl >= 0 ? '目前高於成本' : '目前低於成本'}</span></article>
          <article className="metric-card"><p>擔保／投入資本</p><strong>{loading ? '—' : money.format(capitalAtRisk)}</strong><span>依 Collateral 欄位統計</span></article>
          <article className="metric-card"><p>平均年化 ROC</p><strong className={averageAnnualRoc >= 0 ? 'positive' : 'negative'}>{loading ? '—' : percent.format(averageAnnualRoc)}</strong><span>{closedTrades.length} 筆已完成交易</span></article>
        </section>

        <section ref={contentGridRef} className={`content-grid ${resizingPanels ? 'is-resizing' : ''}`} style={contentGridStyle}>
          <article className="panel return-panel" id="returns">
            <div className="panel-heading">
              <div><p className="eyebrow">Return analytics</p><h2>{rangeMode === 'week' ? '週' : rangeMode === 'month' ? '月' : '年'}收益率</h2></div>
              <div className="segmented" aria-label="收益率期間">
                {([['week', '週'], ['month', '月'], ['year', '年']] as const).map(([mode, label]) => <button key={mode} className={rangeMode === mode ? 'selected' : ''} onClick={() => setRangeMode(mode)}>{label}</button>)}
              </div>
            </div>
            <div className="return-summary"><strong>{percent.format(returnSeries.at(-1)?.value ?? 0)}</strong><span>最近一期報酬率</span><div className="benchmark-legend"><span><i className="portfolio-key" />我的組合</span><span><i className="spy-key" />SPY</span><span><i className="boxx-key" />BOXX</span></div></div>
            <div className="chart-shell">
              <div className="axis-label top">+{percent.format(maxAbsReturn)}</div><div className="axis-label middle">0%</div><div className="axis-label bottom">−{percent.format(maxAbsReturn)}</div>
              <svg className="return-chart" viewBox="0 0 100 100" role="img" aria-label="週月年收益率折線圖" preserveAspectRatio="none">
                <defs><linearGradient id="returnFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2f73ed" stopOpacity=".24"/><stop offset="100%" stopColor="#2f73ed" stopOpacity="0"/></linearGradient></defs>
                <line x1="0" x2="100" y1="50" y2="50" className="zero-line" />
                {chartPoints && <><polygon points={`0,50 ${chartPoints} 100,50`} fill="url(#returnFade)" /><polyline points={chartPoints} className="return-line portfolio-line" /></>}
                {spyPoints && <polyline points={spyPoints} className="return-line spy-line" />}
                {boxxPoints && <polyline points={boxxPoints} className="return-line boxx-line" />}
              </svg>
              <div className="return-markers" aria-hidden="true">{returnSeries.map((item, index) => {
                const x = returnSeries.length === 1 ? 50 : (index / (returnSeries.length - 1)) * 100;
                const y = 50 - (item.value / maxAbsReturn) * 38;
                return <span key={item.key} className={item.value >= 0 ? 'point-positive' : 'point-negative'} style={{ left: `${x}%`, top: `${y}%` }} title={`${item.label}: ${percent.format(item.value)}`} />;
              })}</div>
            </div>
            <div className="chart-dates">{returnSeries.map((item, index) => <span key={item.key} className={index % Math.ceil(returnSeries.length / 6) ? 'hide-small-label' : ''}>{item.label}</span>)}</div>
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
            <div className="panel-heading"><div><p className="eyebrow">Holdings</p><h2>持倉配置</h2></div><span className="count-badge">{openTrades.length} positions</span></div>
            <div className="allocation-content">
              <div className="donut" style={{ background: pieGradient }} aria-label="按標的計算的持倉圓餅圖"><span><strong>{money.format(trackedValue)}</strong>曝險</span></div>
              <div className="legend">{allocation.map((item) => <p key={item.label}><i style={{ background: item.color }} />{item.label}<strong>{percent.format(item.share)}</strong></p>)}</div>
            </div>
            <p className="panel-note">股票按現值、選擇權按擔保金計算；價格變動後自動重算。</p>
          </article>
        </section>

        <section className="panel positions-panel" id="positions">
          <div className="positions-toolbar">
            <div><p className="eyebrow">Active book</p><h2>交易與持倉</h2></div>
            <div className="toolbar-actions"><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋 ticker、策略或備註" aria-label="搜尋交易" /></label><button className="primary-button" onClick={() => setEditor(blankTrade())}>＋新增</button></div>
          </div>
          <div className="filter-row">{([['all', '全部'], ['open', '未平倉'], ['closed', '已平倉'], ['options', '選擇權'], ['stock', '股票']] as const).map(([mode, label]) => <button key={mode} className={filter === mode ? 'active' : ''} onClick={() => setFilter(mode)}>{label}<span>{mode === 'all' ? trades.length : mode === 'open' ? openTrades.length : mode === 'closed' ? closedTrades.length : trades.filter((trade) => mode === 'stock' ? trade.type === 'SDI' : trade.type !== 'SDI').length}</span></button>)}</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>標的</th><th>交易／策略</th><th>開倉／到期</th><th>履約價</th><th>數量</th><th>買入／成交價</th><th>目前價格</th><th>損益</th><th>ROC</th><th>狀態</th><th /></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="empty-state">正在載入你的交易紀錄…</td></tr>}
                {!loading && !filteredTrades.length && <tr><td colSpan={11} className="empty-state">沒有符合目前篩選條件的交易。</td></tr>}
                {filteredTrades.map(({ trade, pnl, roc }) => <tr key={trade.id}>
                  <td><span className="symbol-cell"><span className="symbol">{trade.ticker?.slice(0, 1) ?? '—'}</span><strong>{trade.ticker || '—'}</strong></span></td>
                  <td><strong className="strategy-name">{trade.event}</strong><span className="subtle">{trade.type === 'SDI' ? 'Stock' : trade.type}</span></td>
                  <td><strong>{dateLabel(trade.openDate)}</strong><span className="subtle">Exp {dateLabel(trade.expiryDate)}</span></td>
                  <td>{trade.strike || '—'}</td><td>{trade.quantity}</td><td>{money.format(trade.entryPrice)}</td>
                  <td>{priceEditId === trade.id ? <div className="inline-price"><span>$</span><input autoFocus inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveInlinePrice(trade); if (event.key === 'Escape') setPriceEditId(null); }} /><button onClick={() => saveInlinePrice(trade)}>✓</button></div> : <button className="price-button" onClick={() => { setPriceEditId(trade.id); setPriceInput(String(trade.currentPrice ?? '')); }}><span className={trade.quoteMode === 'auto' ? 'live-dot' : 'manual-dot'} />{trade.currentPrice === null ? '設定' : money.format(trade.currentPrice)} <i>✎</i></button>}</td>
                  <td className={pnl >= 0 ? 'positive' : 'negative'}><strong>{money.format(pnl)}</strong></td>
                  <td className={roc >= 0 ? 'positive' : 'negative'}>{percent.format(roc)}</td>
                  <td><span className={`status ${trade.status}`}><i />{trade.status === 'open' ? '未平倉' : '已平倉'}</span></td>
                  <td><button className="icon-button" onClick={() => setEditor({ ...trade })} aria-label={`編輯 ${trade.ticker ?? '交易'}`}>•••</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
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
                  <fieldset className="choice-field"><legend>交易類型</legend><div className="trade-type-picker">
                    {([
                      ['Sell', '賣方', '收取權利金'],
                      ['Buy', '買方', '支付權利金'],
                      ['Ass', '指派', '承接標的'],
                      ['SDI', '股票', '現股持倉'],
                    ] as const).map(([type, label, description]) => <button key={type} type="button" className={editor.type === type ? 'active' : ''} onClick={() => setEditor({ ...editor, type, event: type === 'SDI' ? 'STOCK' : editor.event, quoteMode: type === 'SDI' ? 'auto' : 'manual' })}><i>{type === 'Sell' ? '↓' : type === 'Buy' ? '↑' : type === 'Ass' ? '↳' : '◇'}</i><span><strong>{label}</strong><small>{description}</small></span></button>)}
                  </div></fieldset>
                  <div className="form-grid">
                    <label className="ticker-search-field">Ticker
                      <span className="ticker-input-shell">
                        <input
                          required
                          value={editor.ticker ?? ''}
                          onChange={(event) => setEditor({ ...editor, ticker: event.target.value.toUpperCase() })}
                          onFocus={() => setSymbolFocused(true)}
                          onBlur={() => window.setTimeout(() => setSymbolFocused(false), 120)}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowDown' && symbolSuggestions.length) { event.preventDefault(); setActiveSymbolIndex((current) => (current + 1) % symbolSuggestions.length); }
                            if (event.key === 'ArrowUp' && symbolSuggestions.length) { event.preventDefault(); setActiveSymbolIndex((current) => (current - 1 + symbolSuggestions.length) % symbolSuggestions.length); }
                            if (event.key === 'Enter' && symbolSuggestions[activeSymbolIndex]) { event.preventDefault(); selectSymbol(symbolSuggestions[activeSymbolIndex]); }
                            if (event.key === 'Escape') { setSymbolSuggestions([]); setSymbolFocused(false); }
                          }}
                          placeholder="輸入 MS 搜尋 MSFT…"
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
                        {symbolLoading && !symbolSuggestions.length && <span className="symbol-loading-copy">正在搜尋美股代號…</span>}
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
                    <label>成本／成交價<div className="money-input"><span>$</span><input min="0" step="0.01" type="number" value={editor.entryPrice} onChange={(event) => setEditor({ ...editor, entryPrice: Number(event.target.value) })} /></div></label>
                    <label>持倉／平倉價<div className="money-input"><span>$</span><input min="0" step="0.01" type="number" value={editor.currentPrice ?? ''} onChange={(event) => setEditor({ ...editor, currentPrice: event.target.value === '' ? null : Number(event.target.value) })} /></div></label>
                    <label>手續費<div className="money-input"><span>$</span><input min="0" step="0.01" type="number" value={editor.fees} onChange={(event) => setEditor({ ...editor, fees: Number(event.target.value) })} /></div></label>
                    <label>擔保／投入資本<div className="money-input"><span>$</span><input min="0" step="0.01" type="number" value={editor.collateral} onChange={(event) => setEditor({ ...editor, collateral: Number(event.target.value) })} /></div></label>
                  </div>
                  <div className="editor-choice-row">
                    {editor.type === 'SDI' && <fieldset className="choice-field compact-choice"><legend>報價方式</legend><div><button type="button" className={editor.quoteMode === 'auto' ? 'active' : ''} onClick={() => setEditor({ ...editor, quoteMode: 'auto' })}>自動更新</button><button type="button" className={editor.quoteMode === 'manual' ? 'active' : ''} onClick={() => setEditor({ ...editor, quoteMode: 'manual' })}>手動輸入</button></div></fieldset>}
                    <fieldset className="choice-field compact-choice"><legend>持倉狀態</legend><div><button type="button" className={editor.status === 'open' ? 'active' : ''} onClick={() => setEditor({ ...editor, status: 'open', closeDate: null })}>未平倉</button><button type="button" className={editor.status === 'closed' ? 'active' : ''} onClick={() => setEditor({ ...editor, status: 'closed' })}>已平倉</button></div></fieldset>
                  </div>
                  <label className="notes-field">備註<textarea rows={3} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="記錄交易想法、催化劑或檢討…" /></label>
                </section>
              </div>
              <aside className="editor-summary">
                <div className="summary-sticky">
                  <p className="eyebrow">Live preview</p><h3>交易預覽</h3>
                  <div className="summary-symbol"><span>{editor.ticker?.slice(0, 1) || '—'}</span><div><strong>{editor.ticker || '尚未選擇標的'}</strong><small>{editor.event || '選擇策略'}</small></div></div>
                  <div className="summary-price-pair"><div><span>買入／成交價</span><strong>{money.format(editor.entryPrice)}</strong></div><i>→</i><div><span>目前價格</span><strong>{editor.currentPrice === null ? '尚未設定' : money.format(editor.currentPrice)}</strong></div></div>
                  <div className="summary-result"><span>即時計算損益</span><strong className={metrics(editor).pnl >= 0 ? 'positive' : 'negative'}>{money.format(metrics(editor).pnl)}</strong></div>
                  <dl><div><dt>ROC</dt><dd className={metrics(editor).roc >= 0 ? 'positive' : 'negative'}>{percent.format(metrics(editor).roc)}</dd></div><div><dt>持有天數</dt><dd>{metrics(editor).days || 0} 天</dd></div><div><dt>狀態</dt><dd>{editor.status === 'open' ? '未平倉' : '已平倉'}</dd></div><div><dt>報價</dt><dd>{editor.quoteMode === 'auto' ? '自動更新' : '手動價格'}</dd></div></dl>
                  <p className="summary-tip"><i>✓</i> 所有欄位可隨時回來修改，儲存後會同步更新圖表與持倉配置。</p>
                </div>
              </aside>
            </div>
            <footer className="editor-actions"><p><span>●</span> 資料會安全儲存並立即更新儀表板</p><button type="button" className="cancel-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button save-button" disabled={saving}>{saving ? '儲存中…' : '儲存交易'}</button></footer>
          </form>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
