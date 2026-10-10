'use client';

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DailyBook, PriceBar } from '@/lib/performance';
import type { CurvePoint, CurveWindow, EquityCurve, StatTrade, TradeStats } from '@/lib/six-metrics';
import { bigOptionProfit, bigStockReturn, closedTrades, equityCurve, netEquity, tradeStats, windowStart } from '@/lib/six-metrics';

type Flow = { kind: 'deposit' | 'withdrawal'; amount: number; currency: 'USD' | 'JPY' };
type ChartView = 'equity' | 'drawdown' | 'monthly';
type Tone = 'good' | 'mid' | 'weak' | 'none';

const minus = '−';
const centsFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const signedMoney = (value: number, cents = true) => `${value > 0.005 ? '+' : value < -0.005 ? minus : ''}$${(cents ? centsFormat : wholeFormat).format(Math.abs(value))}`;
const money = (value: number) => `${value < -0.5 ? minus : ''}$${wholeFormat.format(Math.abs(value))}`;
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPercent = (value: number, digits = 1) => {
  const text = Math.abs(value * 100).toFixed(digits);
  return `${Number(text) === 0 ? '' : value > 0 ? '+' : minus}${text}%`;
};
const pointsLabel = (value: number) => `${value >= 0 ? '+' : minus}${Math.abs(value * 100).toFixed(1)} 百分點`;
const dateLabel = (date: string) => `${Number(date.slice(0, 4))}/${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
/** "2026/1/8 → 3/30": the year once when both dates share it. */
const dateRange = (from: string, to: string) => `${dateLabel(from)} → ${from.slice(0, 4) === to.slice(0, 4) ? `${Number(to.slice(5, 7))}/${Number(to.slice(8, 10))}` : dateLabel(to)}`;
const compactMoney = (value: number) => {
  const size = Math.abs(value);
  const text = size >= 1000 ? `${Number((size / 1000).toFixed(size >= 10_000 ? 0 : 1))}K` : wholeFormat.format(size);
  return `${value < 0 ? minus : ''}$${text}`;
};

const windows: ReadonlyArray<readonly [CurveWindow, string]> = [['all', '全部'], ['year', '近一年'], ['ytd', '今年以來']];
const views: ReadonlyArray<readonly [ChartView, string]> = [['equity', '淨值曲線'], ['drawdown', '回撤曲線'], ['monthly', '逐月']];

function Card({ index, label, value, chip, tone, help, children }: { index: number; label: string; value: string; chip?: string; tone: Tone; help: string; children?: ReactNode }) {
  return <div className={`wafu-six-card tone-${tone}`} title={help}>
    <span className="wafu-six-label"><i aria-hidden="true">{index}</i>{label}</span>
    <strong>{value}{chip && <small>{chip}</small>}</strong>
    {children}
  </div>;
}

/** Round axis steps covering lo..hi: the tightest fit among 3–6 steps of 1, 2, 2.5 or 5 × 10ⁿ. */
function niceTicks(lo: number, hi: number) {
  const span = Math.max(hi - lo, 1e-9);
  let best: { lo: number; hi: number; ticks: number[] } | null = null;
  for (const count of [3, 4, 5, 6]) {
    const raw = span / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * power).find((value) => value >= raw) ?? raw;
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    if (best && max - min >= best.hi - best.lo - step * 1e-6) continue;
    const ticks: number[] = [];
    for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
    best = { lo: min, hi: max, ticks };
  }
  return best ?? { lo, hi, ticks: [lo, hi] };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * 淨值曲線 (cumulative P&L, green above zero and red below, the deepest fall marked) or 回撤 (the
 * time-weighted drawdown under zero with SPY's as a dashed line). One point per trading day; a
 * crosshair and a paper tooltip follow the pointer, and the arrow keys move it when focused.
 */
function SixChart({ curve, view, colors }: { curve: EquityCurve; view: 'equity' | 'drawdown'; colors: { line: string; drawdown: string; spy: string } }) {
  const uid = useId().replace(/:/g, '');
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => view === 'equity' ? curve.points : curve.points.filter((point) => point.dd !== null), [curve, view]);
  const count = data.length;
  if (count < 2) return <div className="wafu-perf-chart is-empty" ref={ref}><p>{view === 'drawdown' ? '時間加權報酬還沒有足夠的天數' : '還沒有可計算的期間'}</p></div>;

  const height = Math.round(Math.min(320, Math.max(220, width * 0.42)));
  const pad = { l: view === 'equity' ? 54 : 44, r: 16, t: 18, b: 26 };
  const innerWidth = width - pad.l - pad.r;
  const innerHeight = height - pad.t - pad.b;
  const value = (point: CurvePoint) => view === 'equity' ? point.cum : point.dd ?? 0;
  const values = data.map(value);
  const spyValues = view === 'drawdown' ? data.map((point) => point.spyDd) : [];
  const allValues = [...values, ...spyValues.flatMap((item) => item === null ? [] : [item])];
  const scale = view === 'equity' ? 1 : 100;
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...allValues) * scale, Math.max(0, ...allValues, view === 'drawdown' ? 0 : 1) * scale);
  const x = (index: number) => pad.l + (count === 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth);
  const y = (amount: number) => pad.t + (1 - (amount * scale - lo) / (hi - lo || 1)) * innerHeight;
  const zero = y(0);
  const line = (series: Array<number | null>) => {
    let path = '';
    let open = false;
    series.forEach((amount, index) => {
      if (amount === null) { open = false; return; }
      path += `${open ? 'L' : 'M'}${x(index).toFixed(1)} ${y(amount).toFixed(1)}`;
      open = true;
    });
    return path;
  };
  const mainPath = line(values);
  const area = `${mainPath} L${x(count - 1).toFixed(1)} ${zero.toFixed(1)} L${x(0).toFixed(1)} ${zero.toFixed(1)} Z`;

  // Month ticks, thinned to keep labels apart.
  const monthStarts = data.flatMap((point, index) => index === 0 || point.date.slice(0, 7) !== data[index - 1].date.slice(0, 7) ? [index] : []);
  const every = Math.max(1, Math.ceil(monthStarts.length / Math.max(2, Math.floor(innerWidth / 64))));
  const monthTicks = monthStarts.filter((_, position) => position % every === 0);
  // A short first month (the data starts late in it) would crowd the next label: drop the first.
  if (monthTicks.length > 1) {
    const gap = x(monthTicks[1]) - x(monthTicks[0]);
    const usual = monthTicks.length > 2 ? x(monthTicks[2]) - x(monthTicks[1]) : 0;
    if (gap < 56 || gap < usual * 0.75) monthTicks.shift();
  }
  const tickAnchor = (index: number) => x(index) - pad.l < 24 ? 'start' : width - pad.r - x(index) < 24 ? 'end' : 'middle';

  // The deepest fall: a ring at its peak and at its trough.
  const extreme = view === 'equity' ? curve.usd.max : curve.nav?.max ?? null;
  const peakIndex = extreme ? data.findIndex((point) => point.date === extreme.peak) : -1;
  const troughIndex = extreme ? data.findIndex((point) => point.date === extreme.trough) : -1;
  const extremeLabel = extreme ? (view === 'equity' ? `最大回撤 ${signedMoney(extreme.depth, false)}` : `最大回撤 ${signedPercent(extreme.depth)}`) : '';
  const labelLeft = troughIndex > count * 0.62;

  const indexAt = (clientX: number, rect: DOMRect) => Math.max(0, Math.min(count - 1, Math.round(((clientX - rect.left) / rect.width) * (count - 1))));
  const onMove = (event: ReactPointerEvent<SVGRectElement>) => setHover(indexAt(event.clientX, event.currentTarget.getBoundingClientRect()));
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 20 : 1;
    const next = event.key === 'ArrowLeft' ? (hover ?? count) - step : event.key === 'ArrowRight' ? (hover ?? -1) + step : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setHover(Math.max(0, Math.min(count - 1, next)));
  };
  const point = hover === null ? null : data[hover];
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover), pad.l + 84), width - 96);
  const tickText = (tick: number) => view === 'equity' ? compactMoney(tick) : `${tick > 0 ? '+' : tick < 0 ? minus : ''}${Math.abs(tick).toFixed(Number.isInteger(tick) ? 0 : 1)}%`;
  const label = view === 'equity' ? '累積損益走勢' : '時間加權回撤走勢，與 SPY 比較';

  return <div className="wafu-perf-chart wafu-six-chart" ref={ref} tabIndex={0} role="group" aria-label={`${label}；用左右方向鍵逐日查看`} onKeyDown={onKey} onBlur={() => setHover(null)}>
    <svg width={width} height={height} role="img" aria-label={label}>
      <defs>
        <clipPath id={`${uid}-above`}><rect x={0} y={0} width={width} height={Math.max(0, zero)} /></clipPath>
        <clipPath id={`${uid}-below`}><rect x={0} y={zero} width={width} height={Math.max(0, height - zero)} /></clipPath>
      </defs>
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad.l} x2={width - pad.r} y1={y(tick / scale)} y2={y(tick / scale)} className={tick === 0 ? 'six-grid zero' : 'six-grid'} />
        <text x={pad.l - 8} y={y(tick / scale)} className="axis" textAnchor="end" dominantBaseline="middle">{tickText(tick)}</text>
      </g>)}
      {monthTicks.map((index) => <text key={index} x={x(index)} y={height - 7} className="axis" textAnchor={tickAnchor(index)}>{`${data[index].date.slice(0, 4)}/${Number(data[index].date.slice(5, 7))}`}</text>)}

      {view === 'equity' ? <>
        <path d={area} fill="var(--wa-up)" opacity={0.14} clipPath={`url(#${uid}-above)`} />
        <path d={area} fill="var(--wa-down)" opacity={0.16} clipPath={`url(#${uid}-below)`} />
        <path d={mainPath} fill="none" stroke={colors.line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </> : <>
        <path d={area} fill={colors.drawdown} opacity={0.16} />
        <path d={line(spyValues)} fill="none" stroke={colors.spy} strokeWidth={1.5} strokeDasharray="5 4" strokeLinecap="round" opacity={0.9} />
        <path d={mainPath} fill="none" stroke={colors.drawdown} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </>}

      {peakIndex >= 0 && troughIndex >= 0 && <g className="six-extreme">
        <line x1={x(troughIndex)} x2={x(troughIndex)} y1={y(values[peakIndex])} y2={y(values[troughIndex])} />
        {view === 'equity' && <circle cx={x(peakIndex)} cy={y(values[peakIndex])} r={4} fill={colors.line} stroke="var(--wa-bg)" strokeWidth={2} />}
        <circle cx={x(troughIndex)} cy={y(values[troughIndex])} r={4.5} fill={view === 'equity' ? 'var(--wa-down)' : colors.drawdown} stroke="var(--wa-bg)" strokeWidth={2} />
        <text x={x(troughIndex) + (labelLeft ? -9 : 9)} y={Math.min(height - pad.b - 6, y(values[troughIndex]) + 16)} textAnchor={labelLeft ? 'end' : 'start'} className="six-note">{extremeLabel}</text>
      </g>}
      {view === 'equity' && <g>
        <circle cx={x(count - 1)} cy={y(values[count - 1])} r={4} fill={colors.line} stroke="var(--wa-bg)" strokeWidth={2} />
        <text x={x(count - 1) - 8} y={y(values[count - 1]) - 10} textAnchor="end" className="six-note">{signedMoney(values[count - 1], false)}</text>
      </g>}

      {point && hover !== null && <g>
        <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} className="crosshair" />
        {view === 'drawdown' && point.spyDd !== null && <circle cx={x(hover)} cy={y(point.spyDd)} r={3.5} fill={colors.spy} stroke="var(--wa-bg)" strokeWidth={2} />}
        <circle cx={x(hover)} cy={y(values[hover])} r={4.5} fill={view === 'equity' ? colors.line : colors.drawdown} stroke="var(--wa-bg)" strokeWidth={2} />
      </g>}
      <rect x={pad.l} y={pad.t} width={Math.max(0, innerWidth)} height={Math.max(0, innerHeight)} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHover(null); }} style={{ cursor: 'crosshair' }} />
    </svg>
    {point && <div className="wafu-perf-tip" style={{ left: tipLeft }} aria-live="polite">
      <b>{dateLabel(point.date)}</b>
      {view === 'equity' ? <>
        <span><i className="key" style={{ background: colors.line }} />累積損益<em className={point.cum >= 0 ? 'positive' : 'negative'}>{signedMoney(point.cum)}</em></span>
        <span>當日損益<em className={point.pnl >= 0 ? 'positive' : 'negative'}>{signedMoney(point.pnl)}</em></span>
        <span>距最高點<em className={point.ddUsd < -0.005 ? 'negative' : ''}>{signedMoney(point.ddUsd)}</em></span>
      </> : <>
        <span><i className="key" style={{ background: colors.drawdown }} />帳戶回撤<em className={(point.dd ?? 0) < 0 ? 'negative' : ''}>{signedPercent(point.dd ?? 0, 2)}</em></span>
        <span><i className="key dashed" style={{ color: colors.spy }} />SPY 回撤<em className={(point.spyDd ?? 0) < 0 ? 'negative' : ''}>{point.spyDd === null ? '—' : signedPercent(point.spyDd, 2)}</em></span>
        <span>距最高點<em className={point.ddUsd < -0.005 ? 'negative' : ''}>{signedMoney(point.ddUsd)}</em></span>
      </>}
    </div>}
  </div>;
}

type MonthRow = { month: string; pnl: number; cum: number; twr: number | null; spy: number | null; dd: number | null };

/** 逐月: each month's P&L, the running total, the time-weighted return beside SPY's, and the drawdown at month end. */
function monthRows(curve: EquityCurve): MonthRow[] {
  const rows: Array<MonthRow & { navBase: number; spyBase: number }> = [];
  const series = curve.points;
  // The first point is the window's baseline; each month grows from the previous month's last close.
  for (let index = 1; index < series.length; index += 1) {
    const point = series[index];
    const month = point.date.slice(0, 7);
    let row = rows[rows.length - 1];
    if (!row || row.month !== month) {
      const previous = series[index - 1];
      row = { month, pnl: 0, cum: 0, twr: null, spy: null, dd: null, navBase: previous.nav ?? 1, spyBase: previous.spy ?? 1 };
      rows.push(row);
    }
    row.pnl += point.pnl;
    row.cum = point.cum;
    row.dd = point.dd;
    row.twr = point.nav === null ? null : point.nav / row.navBase - 1;
    row.spy = point.spy === null ? null : point.spy / row.spyBase - 1;
  }
  return rows.map(({ month, pnl, cum, twr, spy, dd }) => ({ month, pnl, cum, twr, spy, dd })).reverse();
}

function MonthTable({ curve }: { curve: EquityCurve }) {
  const rows = useMemo(() => monthRows(curve), [curve]);
  if (!rows.length) return <p className="wafu-heat-empty">還沒有可計算的月份</p>;
  const tone = (value: number | null) => value === null || Math.abs(value) < 1e-9 ? '' : value > 0 ? 'positive' : 'negative';
  return <div className="wafu-six-table-wrap">
    <table className="wafu-six-table">
      <thead><tr><th scope="col">月份</th><th scope="col">損益</th><th scope="col">累積損益</th><th scope="col">月報酬</th><th scope="col">SPY 月報酬</th><th scope="col">月底回撤</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.month}>
        <th scope="row">{`${row.month.slice(0, 4)}/${Number(row.month.slice(5, 7))}`}</th>
        <td className={tone(row.pnl)}>{signedMoney(row.pnl, false)}</td>
        <td className={tone(row.cum)}>{signedMoney(row.cum, false)}</td>
        <td className={tone(row.twr)}>{row.twr === null ? '—' : signedPercent(row.twr)}</td>
        <td className={tone(row.spy)}>{row.spy === null ? '—' : signedPercent(row.spy)}</td>
        <td className={row.dd !== null && row.dd < -0.0005 ? 'negative' : ''}>{row.dd === null ? '—' : signedPercent(row.dd)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/**
 * 六項指標: 平均獲利, 平均虧損, 兩平勝率, 大賺比例 (closed trades, stocks and options apart), 淨值 and
 * 回撤水位 (the daily book), over 全部／近一年／今年以來, with the 淨值曲線, 回撤 and 逐月 views below.
 */
export default function SixMetrics({ trades, book, spy, cashFlows, usdJpyRate, todayKey, loading = false, pending, colors, onVisible }: {
  trades: ReadonlyArray<StatTrade>;
  book: DailyBook;
  spy: ReadonlyArray<PriceBar> | null;
  /** 存提款紀錄; null until loaded. */
  cashFlows: ReadonlyArray<Flow> | null;
  usdJpyRate: number;
  todayKey: string;
  /** Trades are still loading. */
  loading?: boolean;
  /** Daily closes are still loading (the figures use straight-line estimates until then). */
  pending: boolean;
  colors: { line: string; drawdown: string; spy: string };
  /** Called once when the panel first scrolls into view. */
  onVisible?: () => void;
}) {
  const [range, setRange] = useState<CurveWindow>('all');
  const [view, setView] = useState<ChartView>('equity');
  const panelRef = useRef<HTMLElement>(null);
  const visibleRef = useRef(onVisible);
  useEffect(() => { visibleRef.current = onVisible; }, [onVisible]);
  useEffect(() => {
    const element = panelRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      visibleRef.current?.();
    }, { rootMargin: '200px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const from = windowStart(range, todayKey);
  const stock = useMemo(() => tradeStats(closedTrades(trades, 'stock', usdJpyRate, from), 'stock'), [from, trades, usdJpyRate]);
  const option = useMemo(() => tradeStats(closedTrades(trades, 'option', usdJpyRate, from), 'option'), [from, trades, usdJpyRate]);
  const curve = useMemo(() => equityCurve(book, spy, range, todayKey), [book, spy, range, todayKey]);
  const equity = useMemo(() => netEquity(trades, book, cashFlows, usdJpyRate), [book, cashFlows, trades, usdJpyRate]);

  if (!book.days.length && !stock.count && !option.count) {
    return <article className="panel wafu-six-panel" id="six-metrics" ref={panelRef}>
      <div className="panel-heading"><div><p className="eyebrow">Six metrics</p><h2>六項指標</h2></div></div>
      <p className="wafu-perf-empty"><b>六項指標</b>{loading ? '正在讀取交易紀錄…' : '平倉第一筆交易後，就會算出平均獲利、平均虧損、兩平勝率、大賺比例、淨值與回撤水位。'}</p>
    </article>;
  }

  const tradeTone = (stats: TradeStats): Tone => stats.margin === null ? 'none' : stats.margin >= 0.1 ? 'good' : stats.margin >= 0 ? 'mid' : 'weak';
  const nav = curve?.nav ?? null;
  const usd = curve?.usd ?? null;
  const current = nav ? nav.current : null;
  const span = curve && curve.points.length > 1 ? `${dateLabel(curve.points[1].date)} – ${dateLabel(curve.points[curve.points.length - 1].date)}` : '';

  return <article className={`panel wafu-six-panel ${pending ? 'is-pending' : ''}`} id="six-metrics" ref={panelRef} aria-busy={pending}>
    <div className="panel-heading">
      <div><p className="eyebrow">Six metrics</p><h2>六項指標</h2></div>
      <div className="segmented" role="group" aria-label="指標期間">
        {windows.map(([key, label]) => <button type="button" key={key} className={range === key ? 'selected' : ''} aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}
      </div>
    </div>
    <p className="wafu-six-sub">
      <span>已平倉：個股 {stock.count} 筆 · 選擇權 {option.count} 筆</span>
      {span && <span>{span}</span>}
      {pending && <span className="wafu-six-pending">股價資料讀取中，數字暫為估算</span>}
    </p>

    <div className="wafu-six-grid">
      <Card index={1} label="平均獲利" tone="none" value={stock.avgWin === null ? '—' : signedMoney(stock.avgWin)} chip={stock.avgWinPct === null ? undefined : signedPercent(stock.avgWinPct)}
        help="賺錢的已平倉交易平均賺多少。個股以每個 FIFO 批次為一筆（不含 BOXX），百分比是相對成本；選擇權以一開一平為一筆。">
        <p>選擇權 <b>{option.avgWin === null ? '—' : signedMoney(option.avgWin)}</b></p>
        <p className="foot">獲利交易 {stock.wins} 筆 · 選擇權 {option.wins} 筆</p>
      </Card>
      <Card index={2} label="平均虧損" tone="none" value={stock.avgLoss === null ? '—' : signedMoney(stock.avgLoss)} chip={stock.avgLossPct === null ? undefined : signedPercent(stock.avgLossPct)}
        help="賠錢的已平倉交易平均賠多少。賺賠比＝平均獲利 ÷ |平均虧損|。">
        <p>選擇權 <b>{option.avgLoss === null ? '—' : signedMoney(option.avgLoss)}</b></p>
        <p className="foot">賺賠比 {stock.payoff === null ? '—' : `${stock.payoff.toFixed(2)}×`} · 選擇權 {option.payoff === null ? '—' : `${option.payoff.toFixed(1)}×`}</p>
      </Card>
      <Card index={3} label="兩平勝率" tone={tradeTone(stock)} value={stock.breakEven === null ? '—' : percent(stock.breakEven)}
        help="勝率至少要這麼高，平均獲利才抵得過平均虧損：|平均虧損| ÷（平均獲利＋|平均虧損|）。實際勝率高出越多，安全邊際越大。">
        {stock.breakEven !== null && stock.winRate !== null && <div className="wafu-six-gauge" aria-hidden="true">
          <i style={{ width: `${Math.min(100, stock.winRate * 100)}%` }} />
          <b style={{ left: `${Math.min(100, stock.breakEven * 100)}%` }} />
        </div>}
        <p>實際勝率 <b>{stock.winRate === null ? '—' : percent(stock.winRate)}</b>{stock.margin !== null && <> · 安全邊際 <b>{pointsLabel(stock.margin)}</b></>}</p>
        <p className="foot">選擇權 {option.breakEven === null ? '—' : percent(option.breakEven)} → 實際勝率 {option.winRate === null ? '—' : percent(option.winRate)}</p>
      </Card>
      <Card index={4} label="大賺比例" tone="none" value={stock.bigShare === null ? '—' : percent(stock.bigShare)}
        help={`大賺：個股漲幅 ≥ ${percent(bigStockReturn, 0)}、選擇權獲利 ≥ $${bigOptionProfit}。看少數交易貢獻了多少獲利。`}>
        {stock.bigProfitShare !== null && <div className="wafu-six-bars" aria-hidden="true">
          <span><i style={{ width: `${(stock.bigShare ?? 0) * 100}%` }} /></span>
          <span className="profit"><i style={{ width: `${Math.min(100, stock.bigProfitShare * 100)}%` }} /></span>
        </div>}
        <p>貢獻獲利 <b>{stock.bigProfitShare === null ? '—' : percent(stock.bigProfitShare)}</b> · 漲幅 ≥ {percent(bigStockReturn, 0)}：{stock.big} 筆</p>
        <p className="foot">選擇權 {option.bigShare === null ? '—' : percent(option.bigShare)} · 貢獻獲利 {option.bigProfitShare === null ? '—' : percent(option.bigProfitShare)}（≥ ${bigOptionProfit}）</p>
      </Card>
      <Card index={5} label="淨值" tone="none" value={money(equity.marketValue)}
        help="持倉市值＝未平倉股票（含 BOXX）×現價，不含現金。累積損益＝每日估值加總（含稅前股息）。有存提款紀錄時，估計帳戶淨值＝淨投入＋累積損益。">
        <p>個股 <b>{money(equity.stockValue)}</b> · BOXX 等 <b>{money(equity.cashLikeValue)}</b>{Math.abs(equity.optionValue) > 0.5 && <> · 選擇權 <b>{signedMoney(equity.optionValue, false)}</b></>}</p>
        <p>累積損益 <b className={equity.cumulativePnl >= 0 ? 'positive' : 'negative'}>{signedMoney(equity.cumulativePnl, false)}</b>{equity.dividends > 0.5 && <> · 含稅前股息 {money(equity.dividends)}</>}</p>
        {range !== 'all' && usd && <p>期間損益 <b className={usd.total >= 0 ? 'positive' : 'negative'}>{signedMoney(usd.total, false)}</b></p>}
        {equity.netDeposits !== null && equity.estimatedEquity !== null && <p className="foot">淨投入 {money(equity.netDeposits)} → 估計帳戶淨值 {money(equity.estimatedEquity)}</p>}
      </Card>
      <Card index={6} label="回撤水位" tone={current === null ? 'none' : current > -0.05 ? 'good' : current > -0.15 ? 'mid' : 'weak'}
        value={current === null ? '—' : signedPercent(current)} chip={current !== null && current > -0.0005 ? '在高點' : undefined}
        help="時間加權淨值離最高點跌了多少；資本＝個股市值＋max（BOXX, 賣權擔保金）。金額回撤看累積損益離最高點多遠。">
        <p>最大回撤 <b className={nav?.max ? 'negative' : ''}>{nav?.max ? signedPercent(nav.max.depth) : '—'}</b>{nav?.max && <>（{dateRange(nav.max.peak, nav.max.trough)}；{nav.max.recovered ? `回到高點 ${dateLabel(nav.max.recovered)}` : '尚未回到高點'}）</>}</p>
        <p>金額最大回撤 <b>{usd?.max ? signedMoney(usd.max.depth, false) : '—'}</b>{usd?.max && <>（{dateRange(usd.max.peak, usd.max.trough)}）</>}</p>
        <p className="foot">SPY 同期最大回撤 {curve?.spy?.max ? signedPercent(curve.spy.max.depth) : '—'}{curve?.twrStart && <> · 起算日 {dateLabel(curve.twrStart)}</>}</p>
      </Card>
    </div>

    <div className="wafu-six-chart-head">
      <div className="segmented" role="group" aria-label="圖表檢視">
        {views.map(([key, label]) => <button type="button" key={key} className={view === key ? 'selected' : ''} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
      </div>
      {view === 'drawdown' && <div className="wafu-six-legend">
        <span><i style={{ background: colors.drawdown }} />帳戶（時間加權）</span>
        <span><i className="dashed" style={{ color: colors.spy }} />SPY（含息）</span>
      </div>}
      {view === 'equity' && curve && <span className="wafu-six-legend-note">累積損益（美元），含已實現、未實現與股息</span>}
    </div>
    {curve ? (view === 'monthly' ? <MonthTable curve={curve} /> : <SixChart curve={curve} view={view} colors={colors} />) : <p className="wafu-heat-empty">還沒有可計算的期間</p>}
    <p className="return-method-note">
      交易統計：已平倉的個股 FIFO 批次（不含 BOXX）與選擇權交易；大賺＝個股報酬 ≥ 20%、選擇權獲利 ≥ $100。淨值與回撤：每個交易日以收盤估值，股價還原分割與分拆、含股息，選擇權以內含價值＋時間價值（隨 √剩餘天數 遞減）估值；時間加權報酬的資本＝個股市值＋max（BOXX, 賣權擔保金）。回撤百分比從資本第一次達到最高的 10% 起算，避免初期小部位放大百分比。
    </p>
  </article>;
}
