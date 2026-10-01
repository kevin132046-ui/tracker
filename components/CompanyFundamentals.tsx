'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './CompanyFundamentals.module.css';
import type { AiEntryContext } from '@/components/AiTradeEntry';
import type { AiCompanyInfo } from '@/lib/company-ai';
import { askCompanyAi, cachedCompanyAi, companyAiProviderName } from '@/lib/company-ai';
import type { AiProvider } from '@/lib/earnings';

type Metrics = Record<string, number | string | null>;
type HistoryPoint = { date: string; value: number };
type HistoryPeriod = 'quarterly' | 'annual';
type ChartKind = 'bar' | 'line';
type HistoryMetricKey =
  | 'freeCashFlow'
  | 'adjustedFreeCashFlow'
  | 'operatingCashFlow'
  | 'capitalExpenditure'
  | 'stockBasedCompensation'
  | 'stockBasedCompensationImpact'
  | 'revenue'
  | 'netIncome'
  | 'operatingIncome'
  | 'profitMargin'
  | 'operatingMargin'
  | 'cash'
  | 'debt'
  | 'netCash';
type HistorySeries = Partial<Record<HistoryMetricKey, HistoryPoint[]>>;
type CompanyPayload = {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  instrumentType: string;
  updatedAt: string;
  metrics: Metrics;
  history?: Partial<Record<HistoryPeriod, HistorySeries>>;
  /** Present when the figures came from an AI web search instead of the market-data source. */
  ai?: AiCompanyInfo;
  error?: string;
};
type MetricConfig = { label: string; caption: string; format: 'amount' | 'percent'; color: string; defaultChart: ChartKind };

const historyMetricConfig: Record<HistoryMetricKey, MetricConfig> = {
  freeCashFlow: { label: '自由現金流', caption: '營運現金流扣除資本支出', format: 'amount', color: 'var(--wa-accent)', defaultChart: 'bar' },
  adjustedFreeCashFlow: { label: 'SBC 調整後自由現金流', caption: '自由現金流扣除股票薪酬', format: 'amount', color: 'var(--wa-up)', defaultChart: 'bar' },
  operatingCashFlow: { label: '營運現金流', caption: '本業產生的現金', format: 'amount', color: '#6fc3d0', defaultChart: 'bar' },
  capitalExpenditure: { label: '資本支出', caption: '設備與長期資產投資', format: 'amount', color: 'var(--wa-gold)', defaultChart: 'bar' },
  stockBasedCompensation: { label: '股票薪酬', caption: 'SBC 認列金額', format: 'amount', color: 'var(--wa-accent-2)', defaultChart: 'bar' },
  stockBasedCompensationImpact: { label: 'SBC 對 FCF 影響', caption: '股票薪酬占自由現金流比重', format: 'percent', color: 'var(--wa-down)', defaultChart: 'line' },
  revenue: { label: '營收', caption: '公司銷售收入', format: 'amount', color: 'var(--wa-accent)', defaultChart: 'bar' },
  netIncome: { label: '淨利', caption: '稅後損益', format: 'amount', color: 'var(--wa-up)', defaultChart: 'bar' },
  operatingIncome: { label: '營業利益', caption: '本業營運損益', format: 'amount', color: '#6fc3d0', defaultChart: 'bar' },
  profitMargin: { label: '淨利率', caption: '淨利占營收比重', format: 'percent', color: 'var(--wa-accent-2)', defaultChart: 'line' },
  operatingMargin: { label: '營業利益率', caption: '營業利益占營收比重', format: 'percent', color: 'var(--wa-accent)', defaultChart: 'line' },
  cash: { label: '現金與短期投資', caption: '期末流動性部位', format: 'amount', color: 'var(--wa-up)', defaultChart: 'bar' },
  debt: { label: '總負債', caption: '期末有息負債', format: 'amount', color: 'var(--wa-gold)', defaultChart: 'bar' },
  netCash: { label: '淨現金／（淨負債）', caption: '現金與短期投資扣除總負債', format: 'amount', color: 'var(--wa-accent)', defaultChart: 'bar' },
};

const percent = (value: unknown) => typeof value === 'number' ? `${value >= 0 ? '' : '−'}${Math.abs(value * 100).toFixed(2)}%` : '—';
const multiple = (value: unknown) => typeof value === 'number' ? `${value.toFixed(2)}×` : '—';
const amount = (value: unknown, currency: string) => {
  if (typeof value !== 'number') return '—';
  const abs = Math.abs(value);
  const units = currency === 'JPY' ? [['兆', 1e12], ['億', 1e8]] : [['T', 1e12], ['B', 1e9], ['M', 1e6]];
  const unit = units.find(([, divisor]) => abs >= Number(divisor));
  const symbol = currency === 'JPY' ? '¥' : '$';
  return unit ? `${value < 0 ? '−' : ''}${symbol}${(abs / Number(unit[1])).toFixed(abs / Number(unit[1]) >= 100 ? 1 : 2)}${unit[0]}` : `${value < 0 ? '−' : ''}${symbol}${abs.toLocaleString()}`;
};
const formatHistoryValue = (value: number, config: MetricConfig, currency: string) => config.format === 'percent' ? percent(value) : amount(value, currency);
const periodLabel = (date: string, period: HistoryPeriod) => {
  const [year, month] = date.split('-').map(Number);
  if (!year) return date || '—';
  return period === 'annual' ? String(year) : `${year} Q${Math.max(1, Math.ceil((month || 1) / 3))}`;
};

function MetricRow({
  label,
  value,
  tone,
  historyKey,
  selected,
  onPreview,
  onSelect,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
  historyKey?: HistoryMetricKey;
  selected?: boolean;
  onPreview?: (metric: HistoryMetricKey | null) => void;
  onSelect?: (metric: HistoryMetricKey) => void;
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const clearLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    pressOrigin.current = null;
  };
  const content = <><span>{label}{historyKey && <small>歷史</small>}</span><strong className={tone ? styles[tone] : ''}>{value}</strong></>;
  if (!historyKey || !onPreview || !onSelect) return <div className={styles.row}>{content}</div>;
  return <button
    type="button"
    className={`${styles.row} ${styles.metricButton} ${selected ? styles.metricSelected : ''}`}
    aria-pressed={selected}
    aria-controls="fundamental-history-chart"
    aria-label={`${label} ${value}，查看季度與年度歷史`}
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') onPreview(historyKey); }}
    onPointerLeave={(event) => { clearLongPress(); if (event.pointerType === 'mouse') onPreview(null); }}
    onFocus={() => onPreview(historyKey)}
    onBlur={() => onPreview(null)}
    onClick={() => onSelect(historyKey)}
    onPointerDown={(event) => {
      if (event.pointerType === 'mouse') return;
      pressOrigin.current = { x: event.clientX, y: event.clientY };
      longPressTimer.current = setTimeout(() => onSelect(historyKey), 450);
    }}
    onPointerMove={(event) => {
      const origin = pressOrigin.current;
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) clearLongPress();
    }}
    onPointerUp={clearLongPress}
    onPointerCancel={clearLongPress}
  >{content}</button>;
}

function HistoryChart({
  series,
  config,
  secondarySeries = [],
  secondaryConfig = null,
  period,
  chartKind,
  currency,
}: {
  series: HistoryPoint[];
  config: MetricConfig;
  secondarySeries?: HistoryPoint[];
  secondaryConfig?: MetricConfig | null;
  period: HistoryPeriod;
  chartKind: ChartKind;
  currency: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const geometry = useMemo(() => {
    const width = 880;
    const height = 286;
    const left = 82;
    const right = 24;
    const top = 24;
    const bottom = 48;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = [...series, ...secondarySeries].map((point) => point.value);
    let minimum = Math.min(0, ...values);
    let maximum = Math.max(0, ...values);
    if (minimum === maximum) {
      const spread = Math.abs(minimum) || 1;
      minimum -= spread * .5;
      maximum += spread * .5;
    } else {
      const padding = (maximum - minimum) * .1;
      if (minimum < 0) minimum -= padding;
      if (maximum > 0) maximum += padding;
    }
    const range = maximum - minimum || 1;
    const xStep = series.length ? plotWidth / series.length : plotWidth;
    const x = (index: number) => left + xStep * (index + .5);
    const y = (value: number) => top + ((maximum - value) / range) * plotHeight;
    const ticks = Array.from({ length: 5 }, (_, index) => maximum - (range * index) / 4);
    const linePath = series.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ');
    const secondaryXStep = secondarySeries.length ? plotWidth / secondarySeries.length : plotWidth;
    const secondaryX = (index: number) => left + secondaryXStep * (index + .5);
    const secondaryPath = secondarySeries.map((point, index) => `${index ? 'L' : 'M'} ${secondaryX(index).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ');
    return { width, height, left, right, top, bottom, plotWidth, plotHeight, xStep, x, y, ticks, linePath, secondaryPath };
  }, [secondarySeries, series]);

  if (!series.length) return <div className={styles.chartEmpty}><strong>這個期間暫無可用歷史資料</strong><span>資料缺值會保留空白，不會以 0 代替。</span></div>;

  const activePoint = activeIndex === null ? null : series[activeIndex];
  const activeSecondaryPoint = activePoint ? secondarySeries.find((point) => point.date === activePoint.date) ?? null : null;
  const activeX = activeIndex === null ? 0 : geometry.x(activeIndex);
  const activeY = activePoint ? geometry.y(activePoint.value) : 0;
  const tooltipX = Math.min(geometry.width - 200, Math.max(geometry.left, activeX - 88));
  const tooltipY = Math.max(6, activeY - (activeSecondaryPoint ? 74 : 58));
  const barWidth = Math.min(62, geometry.xStep * .58);

  return <div className={styles.chartViewport}>
    {secondaryConfig && secondarySeries.length > 0 && <div className={styles.overlayLegend}><span><i style={{ background: config.color }} />{config.label}</span><span><i style={{ background: secondaryConfig.color }} />{secondaryConfig.label}</span></div>}
    <svg className={styles.chartSvg} viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label={`${config.label}${period === 'quarterly' ? '季度' : '年度'}歷史${chartKind === 'bar' ? '長條' : '折線'}圖`}>
      {geometry.ticks.map((tick, index) => {
        const y = geometry.top + (geometry.plotHeight * index) / 4;
        return <g key={`${tick}-${index}`}><line x1={geometry.left} x2={geometry.width - geometry.right} y1={y} y2={y} className={styles.gridLine} /><text x={geometry.left - 12} y={y + 4} textAnchor="end" className={styles.axisLabel}>{formatHistoryValue(tick, config, currency)}</text></g>;
      })}
      <line x1={geometry.left} x2={geometry.width - geometry.right} y1={geometry.y(0)} y2={geometry.y(0)} className={styles.zeroLine} />
      {chartKind === 'bar' ? series.map((point, index) => {
        const zeroY = geometry.y(0);
        const valueY = geometry.y(point.value);
        const y = Math.min(zeroY, valueY);
        const height = Math.max(2, Math.abs(zeroY - valueY));
        return <rect key={point.date} x={geometry.x(index) - barWidth / 2} y={y} width={barWidth} height={height} rx="7" className={`${styles.chartBar} ${point.value < 0 ? styles.chartBarNegative : ''} ${activeIndex === index ? styles.chartBarActive : ''}`} style={point.value >= 0 ? { fill: config.color } : undefined} />;
      }) : <>
        <path d={geometry.linePath} className={styles.chartLine} style={{ stroke: config.color }} />
        {series.map((point, index) => <circle key={point.date} cx={geometry.x(index)} cy={geometry.y(point.value)} r={activeIndex === index ? 6 : 4} className={styles.chartPoint} style={{ stroke: config.color }} />)}
      </>}
      {secondaryConfig && secondarySeries.length > 0 && <><path d={geometry.secondaryPath} className={`${styles.chartLine} ${styles.overlayLine}`} style={{ stroke: secondaryConfig.color }} />{secondarySeries.map((point, index) => <circle key={`overlay-${point.date}`} cx={geometry.left + (geometry.plotWidth / secondarySeries.length) * (index + .5)} cy={geometry.y(point.value)} r="3.5" className={`${styles.chartPoint} ${styles.overlayPoint}`} style={{ stroke: secondaryConfig.color }} />)}</>}
      {series.map((point, index) => <text key={`label-${point.date}`} x={geometry.x(index)} y={geometry.height - 17} textAnchor="middle" className={styles.dateLabel}>{periodLabel(point.date, period)}</text>)}
      {activePoint && <g pointerEvents="none">
        <line x1={activeX} x2={activeX} y1={geometry.top} y2={geometry.height - geometry.bottom} className={styles.guideLine} />
        <rect x={tooltipX} y={tooltipY} width="176" height={activeSecondaryPoint ? 61 : 45} rx="9" className={styles.tooltipBox} />
        <text x={tooltipX + 12} y={tooltipY + 17} className={styles.tooltipDate}>{periodLabel(activePoint.date, period)}</text>
        <text x={tooltipX + 12} y={tooltipY + 35} className={styles.tooltipValue}>{formatHistoryValue(activePoint.value, config, currency)}</text>
        {activeSecondaryPoint && secondaryConfig && <text x={tooltipX + 12} y={tooltipY + 51} className={styles.tooltipSecondary}>{secondaryConfig.label} {formatHistoryValue(activeSecondaryPoint.value, secondaryConfig, currency)}</text>}
      </g>}
      {series.map((point, index) => <rect
        key={`zone-${point.date}`}
        className={styles.chartHitZone}
        x={geometry.left + geometry.xStep * index}
        y={geometry.top}
        width={geometry.xStep}
        height={geometry.plotHeight}
        fill="transparent"
        tabIndex={0}
        role="button"
        aria-label={`${periodLabel(point.date, period)}，${config.label} ${formatHistoryValue(point.value, config, currency)}`}
        onPointerEnter={() => setActiveIndex(index)}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse') event.preventDefault();
          setActiveIndex(index);
        }}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex(index)}
        onBlur={() => setActiveIndex(null)}
      />)}
    </svg>
  </div>;
}

export default function CompanyFundamentals({ symbol, valuationOpen, onOpenDcf, onReturn, ai = null }: {
  symbol: string;
  valuationOpen: boolean;
  onOpenDcf: () => void;
  onReturn: () => void;
  /** AI settings; when set and the market data fails, ChatGPT or Claude can look the figures up. */
  ai?: AiEntryContext | null;
}) {
  const [data, setData] = useState<CompanyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedMetric, setSelectedMetric] = useState<HistoryMetricKey>('freeCashFlow');
  const [hoveredMetric, setHoveredMetric] = useState<HistoryMetricKey | null>(null);
  const [period, setPeriod] = useState<HistoryPeriod>('quarterly');
  const [chartKind, setChartKind] = useState<ChartKind>('bar');
  const [overlayMetric, setOverlayMetric] = useState<HistoryMetricKey | null>(null);
  const [aiAsk, setAiAsk] = useState<{ provider: AiProvider; loading: boolean; error: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CompanyPayload;
        if (!response.ok) throw new Error(payload.error ?? '公司資料暫時無法取得');
        setData(payload);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // An AI lookup made earlier in this visit (here or in the DCF tab) stands in for the failed source.
        const earlier = cachedCompanyAi(symbol);
        if (earlier) { setData(earlier); setPeriod('annual'); return; }
        setError(reason instanceof Error ? reason.message : '公司資料暫時無法取得');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry, symbol]);

  const retryLoad = () => { setLoading(true); setError(''); setAiAsk(null); setRetry((value) => value + 1); };
  const askAi = async (provider: AiProvider) => {
    if (!ai || aiAsk?.loading) return;
    setAiAsk({ provider, loading: true, error: '' });
    try {
      const company = await askCompanyAi(symbol, ai, provider);
      setData(company);
      setError('');
      // AI answers carry yearly history only.
      setPeriod('annual');
      setAiAsk(null);
    } catch (reason) {
      setAiAsk({ provider, loading: false, error: reason instanceof Error ? reason.message : '查詢失敗，請稍後再試。' });
    }
  };
  const aiInfo = data?.ai ?? null;
  const selectMetric = useCallback((metric: HistoryMetricKey) => {
    setSelectedMetric(metric);
    setHoveredMetric(null);
    setOverlayMetric(null);
    setChartKind(historyMetricConfig[metric].defaultChart);
  }, []);

  const metrics = data?.metrics ?? {};
  const currency = data?.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD');
  const netCash = metrics.netCash;
  const activeMetric = hoveredMetric ?? selectedMetric;
  const activeConfig = historyMetricConfig[activeMetric];
  const activeSeries = data?.history?.[period]?.[activeMetric] ?? [];
  const overlayOptions = (Object.keys(historyMetricConfig) as HistoryMetricKey[]).filter((key) => key !== activeMetric && historyMetricConfig[key].format === activeConfig.format && (data?.history?.[period]?.[key]?.length ?? 0) > 0);
  const activeOverlayMetric = overlayMetric && overlayOptions.includes(overlayMetric) ? overlayMetric : null;
  const overlayConfig = activeOverlayMetric ? historyMetricConfig[activeOverlayMetric] : null;
  const overlaySeries = activeOverlayMetric ? data?.history?.[period]?.[activeOverlayMetric] ?? [] : [];
  const latestPoint = activeSeries.at(-1);
  const interactive = (key: HistoryMetricKey) => ({
    historyKey: key,
    selected: selectedMetric === key,
    onPreview: setHoveredMetric,
    onSelect: selectMetric,
  });

  return <section className={styles.section} aria-labelledby="company-fundamentals-title">
    <header className={styles.header}><div><p>Company fundamentals</p><h3 id="company-fundamentals-title">公司資訊與財務品質</h3><span>{data ? `${data.name} · ${data.exchange || data.currency}` : `載入 ${symbol} 的估值、現金流與資產負債資料`}</span></div><div className={styles.headerActions}><button type="button" className={valuationOpen ? styles.activeAction : ''} aria-pressed={valuationOpen} onClick={onOpenDcf}>{valuationOpen ? `關閉 ${symbol} DCF 估值` : `開啟 ${symbol} DCF 估值`}</button><button type="button" className={styles.returnButton} onClick={onReturn}>返回持倉總覽</button></div></header>
    {loading && <div className={styles.loading} role="status"><i />正在整理最新可用公司資料…</div>}
    {aiAsk?.loading && <div className={styles.loading} role="status"><i />正在用 {companyAiProviderName(aiAsk.provider)} 上網查詢 {symbol} 的最新財報與股價…（約 20–60 秒）</div>}
    {!loading && error && !aiAsk?.loading && <div className={styles.error}>
      <span>{error}</span>
      <div className={styles.errorActions}>
        <button type="button" onClick={retryLoad}>重新載入</button>
        {ai && <button type="button" className={styles.aiButton} onClick={() => void askAi('openai')}>✦ 用 ChatGPT 查詢</button>}
        {ai && <button type="button" className={styles.aiAlt} onClick={() => void askAi('anthropic')}>改用 Claude</button>}
      </div>
      <small>{ai ? 'AI 會上網搜尋這家公司最新的財報與股價（約 20–60 秒），結果標示「AI 查詢・請核對」。' : '在「設定 → AI 設定」開啟 AI 後，可改用 ChatGPT 上網查詢。'}</small>
      {aiAsk?.error && <small className={styles.aiError} role="alert">{aiAsk.error}</small>}
    </div>}
    {!loading && aiInfo && <div className={styles.aiBanner} role="note">
      <b>AI 查詢・請核對</b>
      <span>{companyAiProviderName(aiInfo.provider)} {aiInfo.model}{aiInfo.asOf ? ` · 財報截至 ${aiInfo.asOf}` : ''}{aiInfo.priceDate ? ` · 股價 ${aiInfo.priceDate}` : ''}</span>
      {aiInfo.note && <span>{aiInfo.note}</span>}
      {aiInfo.sources.length > 0 && <span className={styles.aiSources}>來源：{aiInfo.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title || `來源 ${index + 1}`}</a>)}</span>}
      <button type="button" onClick={retryLoad}>重試一般資料來源</button>
    </div>}
    {!loading && data && <>
      <div className={styles.grid}>
        <article><h4>Valuation <span>估值</span></h4><div className={styles.metrics}><MetricRow label="市值" value={amount(metrics.marketCap, currency)} /><MetricRow label="P/E（TTM）" value={multiple(metrics.trailingPe)} /><MetricRow label="P/E（Forward）" value={multiple(metrics.forwardPe)} /><MetricRow label="Price / Sales" value={multiple(metrics.priceToSales)} /><MetricRow label="EV / EBITDA" value={multiple(metrics.evToEbitda)} /><MetricRow label="Price / Book" value={multiple(metrics.priceToBook)} /></div></article>
        <article><h4>Cash Flow <span>現金流</span></h4><div className={styles.metrics}><MetricRow label="最近季度自由現金流" value={amount(metrics.quarterlyFreeCashFlow, currency)} {...interactive('freeCashFlow')} /><MetricRow label="自由現金流（TTM）" value={amount(metrics.freeCashFlow, currency)} /><MetricRow label="FCF Yield" value={percent(metrics.freeCashFlowYield)} /><MetricRow label="SBC 調整後 FCF" value={amount(metrics.adjustedFreeCashFlow, currency)} {...interactive('adjustedFreeCashFlow')} /><MetricRow label="SBC 調整後 FCF Yield" value={percent(metrics.adjustedFreeCashFlowYield)} /><MetricRow label="SBC 對 FCF 影響" value={percent(metrics.stockBasedCompensationImpact)} tone={typeof metrics.stockBasedCompensationImpact === 'number' && metrics.stockBasedCompensationImpact < 0 ? 'negative' : undefined} {...interactive('stockBasedCompensationImpact')} /></div></article>
        <article><h4>Margins &amp; Growth <span>利潤與成長</span></h4><div className={styles.metrics}><MetricRow label="淨利率" value={percent(metrics.profitMargin)} {...interactive('profitMargin')} /><MetricRow label="營業利益率" value={percent(metrics.operatingMargin)} {...interactive('operatingMargin')} /><MetricRow label="季度獲利 YoY" value={percent(metrics.quarterlyEarningsGrowth)} tone={typeof metrics.quarterlyEarningsGrowth === 'number' ? metrics.quarterlyEarningsGrowth >= 0 ? 'positive' : 'negative' : undefined} {...interactive('netIncome')} /><MetricRow label="季度營收 YoY" value={percent(metrics.quarterlyRevenueGrowth)} tone={typeof metrics.quarterlyRevenueGrowth === 'number' ? metrics.quarterlyRevenueGrowth >= 0 ? 'positive' : 'negative' : undefined} {...interactive('revenue')} /></div></article>
        <article><h4>Balance <span>資產負債</span></h4><div className={styles.metrics}><MetricRow label="現金與短期投資" value={amount(metrics.cash, currency)} {...interactive('cash')} /><MetricRow label="總負債" value={amount(metrics.debt, currency)} {...interactive('debt')} /><MetricRow label="淨現金／（淨負債）" value={amount(netCash, currency)} tone={typeof netCash === 'number' ? netCash >= 0 ? 'positive' : 'negative' : undefined} {...interactive('netCash')} /></div></article>
        <article className={styles.dividend}><h4>Dividend <span>股息</span></h4><div className={styles.metrics}><MetricRow label="股息殖利率" value={percent(metrics.dividendYield)} /><MetricRow label="配息率" value={percent(metrics.payoutRatio)} /><MetricRow label="最近除息日" value={typeof metrics.latestDividendDate === 'string' ? metrics.latestDividendDate : '—'} /><MetricRow label="最近每股股息" value={typeof metrics.latestDividendAmount === 'number' ? new Intl.NumberFormat(currency === 'JPY' ? 'ja-JP' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 4 }).format(metrics.latestDividendAmount) : '—'} /></div></article>
        <section className={styles.historyPanel} id="fundamental-history-chart" role="region" aria-labelledby="fundamental-history-title">
        <div className={styles.historyHeader}>
          <div><p>Historical metric</p><h4 id="fundamental-history-title">{activeConfig.label}歷史</h4><span>{hoveredMetric ? '目前為滑入預覽；點擊可固定這項指標。' : `${activeConfig.caption}；滑入、點擊或長按上方帶有「歷史」標記的指標即可切換。`}</span></div>
          <div className={styles.historySummary}><span>{latestPoint ? periodLabel(latestPoint.date, period) : period === 'quarterly' ? '季度資料' : '年度資料'}</span><strong>{latestPoint ? formatHistoryValue(latestPoint.value, activeConfig, currency) : '—'}</strong></div>
          <div className={styles.historyControls} aria-label="歷史圖表控制">
            <div className={styles.segmented} aria-label="資料期間"><button type="button" aria-pressed={period === 'quarterly'} onClick={() => setPeriod('quarterly')}>季</button><button type="button" aria-pressed={period === 'annual'} onClick={() => setPeriod('annual')}>年</button></div>
            <div className={styles.segmented} aria-label="圖表形式"><button type="button" aria-pressed={chartKind === 'bar'} onClick={() => setChartKind('bar')}>長條</button><button type="button" aria-pressed={chartKind === 'line'} onClick={() => setChartKind('line')}>折線</button></div>
            <label className={styles.overlayControl}><span>疊圖</span><select value={activeOverlayMetric ?? ''} onChange={(event) => setOverlayMetric(event.target.value ? event.target.value as HistoryMetricKey : null)}><option value="">不疊加</option>{overlayOptions.map((key) => <option key={key} value={key}>{historyMetricConfig[key].label}</option>)}</select></label>
          </div>
        </div>
        <HistoryChart key={`${activeMetric}-${activeOverlayMetric ?? 'none'}-${period}-${chartKind}`} series={activeSeries} config={activeConfig} secondarySeries={overlaySeries} secondaryConfig={overlayConfig} period={period} chartKind={chartKind} currency={currency} />
        <span className={styles.srOnly} aria-live="polite">{activeConfig.label}，{latestPoint ? `${periodLabel(latestPoint.date, period)} ${formatHistoryValue(latestPoint.value, activeConfig, currency)}` : '目前沒有可用歷史資料'}</span>
        </section>
      </div>
    </>}
    <footer>{aiInfo ? '這份資料由 AI 上網查詢整理，可能有誤或過時，請以公司財報為準；' : '財務資料來自交易所行情與公開財務時間序列；'}缺值以「—」顯示，不以 0 代替。更新時間 {data ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.updatedAt)) : '—'}。</footer>
  </section>;
}
