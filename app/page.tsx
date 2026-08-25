'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

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

const palette = ['#2f73ed', '#3cc7df', '#7768e8', '#22b58b', '#f0a33a', '#e66878'];
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
  const [editor, setEditor] = useState<Trade | null>(null);
  const [priceEditId, setPriceEditId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [toast, setToast] = useState('');
  const [lastQuoteAt, setLastQuoteAt] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<{ SPY: number[]; BOXX: number[] }>({ SPY: [], BOXX: [] });

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

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
    fetchTrades().then(() => refreshQuotes(false)).catch((error) => { setLoading(false); notify(error.message); });
    const timer = window.setInterval(() => refreshQuotes(false), 60_000);
    return () => window.clearInterval(timer);
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

  const enriched = useMemo(() => trades.map((trade) => ({ trade, ...metrics(trade) })), [trades]);
  const openTrades = enriched.filter((item) => item.trade.status === 'open');
  const closedTrades = enriched.filter((item) => item.trade.status === 'closed');
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

  return (
    <main className="shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="OptionFlow 首頁"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>OPTIONFLOW</span></a>
        <nav className="nav" aria-label="主要導覽"><a className="active" href="#overview">總覽</a><a href="#positions">持倉</a><a href="#returns">收益</a></nav>
        <div className="header-actions">
          <span className={`market-pill ${marketOpen ? 'is-open' : ''}`}><span />{marketOpen ? '美股交易中' : '非交易時段'}</span>
          <button className="secondary-button" type="button" onClick={() => refreshQuotes()} disabled={refreshing}>{refreshing ? '更新中…' : '↻ 更新報價'}</button>
          <button className="primary-button" type="button" onClick={() => setEditor(blankTrade())}>＋新增交易</button>
        </div>
      </header>

      <div className="dashboard">
        <section className="hero" id="overview">
          <div><p className="eyebrow">Portfolio command center</p><h1>把每一筆選擇權，<span>看得更清楚。</span></h1><p className="hero-copy">原始 Excel 欄位與計算邏輯已完整轉換。持倉可編輯、資料會保存，股票報價每 60 秒取得最新可用價格。</p></div>
          <div className="as-of"><span>Latest quote</span><strong>{lastQuoteAt ? new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(lastQuoteAt)) : '等待首次更新'}</strong></div>
        </section>

        <section className="metric-grid" aria-label="投資組合摘要">
          <article className="metric-card featured"><p>追蹤市值</p><strong>{loading ? '—' : money.format(trackedValue)}</strong><span>{openTrades.length} 筆未平倉持倉</span></article>
          <article className="metric-card"><p>未實現損益</p><strong className={openPnl >= 0 ? 'positive' : 'negative'}>{loading ? '—' : money.format(openPnl)}</strong><span>{openPnl >= 0 ? '目前高於成本' : '目前低於成本'}</span></article>
          <article className="metric-card"><p>擔保／投入資本</p><strong>{loading ? '—' : money.format(capitalAtRisk)}</strong><span>依 Collateral 欄位統計</span></article>
          <article className="metric-card"><p>平均年化 ROC</p><strong className={averageAnnualRoc >= 0 ? 'positive' : 'negative'}>{loading ? '—' : percent.format(averageAnnualRoc)}</strong><span>{closedTrades.length} 筆已完成交易</span></article>
        </section>

        <section className="content-grid">
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
                {returnSeries.map((item, index) => {
                  const x = returnSeries.length === 1 ? 50 : (index / (returnSeries.length - 1)) * 100;
                  const y = 50 - (item.value / maxAbsReturn) * 38;
                  return <circle key={item.key} cx={x} cy={y} r="1.35" className={item.value >= 0 ? 'point-positive' : 'point-negative'}><title>{`${item.label}: ${percent.format(item.value)}`}</title></circle>;
                })}
              </svg>
            </div>
            <div className="chart-dates">{returnSeries.map((item, index) => <span key={item.key} className={index % Math.ceil(returnSeries.length / 6) ? 'hide-small-label' : ''}>{item.label}</span>)}</div>
          </article>

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
              <thead><tr><th>標的</th><th>交易／策略</th><th>開倉／到期</th><th>履約價</th><th>數量</th><th>成本價</th><th>持倉價格</th><th>損益</th><th>ROC</th><th>狀態</th><th /></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="empty-state">正在載入你的交易紀錄…</td></tr>}
                {!loading && !filteredTrades.length && <tr><td colSpan={11} className="empty-state">沒有符合目前篩選條件的交易。</td></tr>}
                {filteredTrades.map(({ trade, pnl, roc }) => <tr key={trade.id}>
                  <td><span className="symbol">{trade.ticker?.slice(0, 1) ?? '—'}</span><strong>{trade.ticker || '—'}</strong></td>
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

      {editor && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
        <section className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-editor-title">
          <header><div><p className="eyebrow">Trade editor</p><h2 id="trade-editor-title">{editor.id ? '編輯交易' : '新增交易'}</h2></div><button className="close-button" onClick={() => setEditor(null)} aria-label="關閉">×</button></header>
          <form onSubmit={saveEditor}>
            <div className="form-grid">
              <label>交易類型<select value={editor.type} onChange={(event) => { const type = event.target.value; setEditor({ ...editor, type, event: type === 'SDI' ? 'STOCK' : editor.event, quoteMode: type === 'SDI' ? 'auto' : 'manual' }); }}><option value="Sell">Sell</option><option value="Buy">Buy</option><option value="Ass">Assigned</option><option value="SDI">Stock / SDI</option></select></label>
              <label>Ticker<input required value={editor.ticker ?? ''} onChange={(event) => setEditor({ ...editor, ticker: event.target.value.toUpperCase() })} placeholder="例如 KO" /></label>
              <label>策略／事件<input required value={editor.event} onChange={(event) => setEditor({ ...editor, event: event.target.value.toUpperCase() })} placeholder="PUT / CALL / STOCK" /></label>
              <label>履約價／組合<input value={editor.strike ?? ''} onChange={(event) => setEditor({ ...editor, strike: event.target.value })} placeholder="70 或 185/180" /></label>
              <label>開倉日<input required type="date" value={editor.openDate} onChange={(event) => setEditor({ ...editor, openDate: event.target.value })} /></label>
              <label>到期日<input type="date" value={editor.expiryDate ?? ''} onChange={(event) => setEditor({ ...editor, expiryDate: event.target.value || null })} /></label>
              <label>平倉日<input type="date" value={editor.closeDate ?? ''} onChange={(event) => setEditor({ ...editor, closeDate: event.target.value || null, status: event.target.value ? 'closed' : 'open' })} /></label>
              <label>數量<input min="0" step="0.01" type="number" value={editor.quantity} onChange={(event) => setEditor({ ...editor, quantity: Number(event.target.value) })} /></label>
              <label>成本／成交價<input min="0" step="0.01" type="number" value={editor.entryPrice} onChange={(event) => setEditor({ ...editor, entryPrice: Number(event.target.value) })} /></label>
              <label>持倉／平倉價<input min="0" step="0.01" type="number" value={editor.currentPrice ?? ''} onChange={(event) => setEditor({ ...editor, currentPrice: event.target.value === '' ? null : Number(event.target.value) })} /></label>
              <label>手續費<input min="0" step="0.01" type="number" value={editor.fees} onChange={(event) => setEditor({ ...editor, fees: Number(event.target.value) })} /></label>
              <label>擔保／投入資本<input min="0" step="0.01" type="number" value={editor.collateral} onChange={(event) => setEditor({ ...editor, collateral: Number(event.target.value) })} /></label>
              {editor.type === 'SDI' && <label>報價方式<select value={editor.quoteMode} onChange={(event) => setEditor({ ...editor, quoteMode: event.target.value as 'auto' | 'manual' })}><option value="auto">每 60 秒自動更新</option><option value="manual">手動輸入</option></select></label>}
              <label>狀態<select value={editor.status} onChange={(event) => setEditor({ ...editor, status: event.target.value as 'open' | 'closed' })}><option value="open">未平倉</option><option value="closed">已平倉</option></select></label>
              <label className="wide">備註<textarea rows={3} value={editor.notes} onChange={(event) => setEditor({ ...editor, notes: event.target.value })} placeholder="交易想法、檢討、催化劑…" /></label>
            </div>
            <div className="form-preview"><span>即時計算</span><strong className={metrics(editor).pnl >= 0 ? 'positive' : 'negative'}>{money.format(metrics(editor).pnl)}</strong><span>ROC {percent.format(metrics(editor).roc)} · {metrics(editor).days || 0} days</span></div>
            <footer><button type="button" className="cancel-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button save-button" disabled={saving}>{saving ? '儲存中…' : '儲存交易'}</button></footer>
          </form>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
