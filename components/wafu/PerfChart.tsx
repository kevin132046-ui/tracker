'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cumulativeOf, drawdownOf } from '@/lib/wafu/metrics';

export type SeriesKey = 'mine' | 'spy' | 'boxx';
export type PerfChartMode = 'cum' | 'period' | 'dd';

const fmtP = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(dp)}%`;

/** Round axis ticks (in %) covering lo..hi with about `count` steps. */
function niceTicks(lo: number, hi: number, count = 4) {
  const span = Math.max(hi - lo, 0.5);
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= raw) ?? raw;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo: min, hi: max, ticks };
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

/** A smooth path through the points that never overshoots them (monotone cubic, Fritsch–Carlson). */
function smoothPath(points: ReadonlyArray<readonly [number, number]>) {
  const count = points.length;
  if (!count) return '';
  const f = (v: number) => v.toFixed(1);
  if (count < 3) return points.map(([px, py], i) => `${i ? 'L' : 'M'}${f(px)} ${f(py)}`).join(' ');
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    dx.push(points[i + 1][0] - points[i][0] || 1e-6);
    slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
  }
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === count - 1) return slope[count - 2];
    const a = slope[i - 1], b = slope[i];
    if (a * b <= 0) return 0;
    return 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / a + (dx[i] + 2 * dx[i - 1]) / b);
  });
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < count - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1], third = dx[i] / 3;
    d += ` C${f(x0 + third)} ${f(y0 + tangent[i] * third)} ${f(x1 - third)} ${f(y1 - tangent[i + 1] * third)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

/**
 * 收益分析 chart: 累積 (growth lines from a 0% start, the portfolio's area green above zero and red
 * below), 單期 (the portfolio's bars beside thin SPY bars, BOXX dotted) or 回撤 (drawdown below zero
 * with the deepest point marked). Lines are smoothed without overshooting; each line ends in a value
 * tag; a crosshair and a paper tooltip show every series and the excess over SPY.
 */
export default function PerfChart({ mode, labels, series, visible, colors, names, ddColor = 'var(--wa-down)' }: {
  mode: PerfChartMode;
  labels: string[];
  /** One return per period for each series. */
  series: Record<SeriesKey, number[]>;
  visible: Record<SeriesKey, boolean>;
  colors: Record<SeriesKey, string>;
  names: Record<SeriesKey, string>;
  /** The portfolio's drawdown colour (red unless a colour was chosen for it). */
  ddColor?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = Math.round(Math.min(340, Math.max(230, w * 0.43)));
  // Growth and drawdown lines start from a 0% point before the first period.
  const fromZero = mode !== 'period';
  const pad = { l: 48, r: fromZero ? 70 : 14, t: 16, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const n = labels.length;
  const shownLabels = useMemo(() => fromZero && labels.length ? ['起點', ...labels] : labels, [fromZero, labels]);
  const m = shownLabels.length;

  const shownSeries = useMemo(() => {
    const start = (values: number[]) => values.length ? [0, ...values] : values;
    if (mode === 'cum') return { mine: start(cumulativeOf(series.mine)), spy: start(cumulativeOf(series.spy)), boxx: start(cumulativeOf(series.boxx)) };
    if (mode === 'dd') return { mine: start(drawdownOf(series.mine)), spy: start(drawdownOf(series.spy)), boxx: start(series.boxx.map(() => 0)) };
    return series;
  }, [mode, series]);
  const keys: SeriesKey[] = mode === 'dd' ? ['spy', 'mine'] : ['spy', 'boxx', 'mine'];
  const shown = keys.filter((key) => visible[key] && shownSeries[key].length === m);
  const values = shown.flatMap((key) => shownSeries[key]);
  const { lo, hi, ticks } = niceTicks(Math.min(mode === 'dd' ? -0.01 : 0, ...values) * 100, Math.max(0, ...values, mode === 'dd' ? 0 : 0.001) * 100, 4);
  const y = (v: number) => pad.t + (1 - (v * 100 - lo) / (hi - lo || 1)) * ih;
  const slot = iw / Math.max(1, m);
  const x = (i: number) => (mode === 'period' ? pad.l + slot * (i + 0.5) : pad.l + (m === 1 ? iw / 2 : (i / (m - 1)) * iw));
  const line = (key: SeriesKey) => mode === 'period'
    ? shownSeries[key].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
    : smoothPath(shownSeries[key].map((v, i) => [x(i), y(v)] as const));
  const every = Math.max(1, Math.ceil(m / Math.max(3, Math.floor(iw / 70))));
  const last = m - 1;
  const mddIndex = mode === 'dd' && m ? shownSeries.mine.reduce((best, v, i) => (v < shownSeries.mine[best] ? i : best), 0) : -1;
  const lineColor = (key: SeriesKey) => mode === 'dd' && key === 'mine' ? ddColor : colors[key];

  // End tags, spread apart so they never overlap.
  const tags = (() => {
    if (!fromZero || !m) return [];
    const placed = shown.filter((key) => mode !== 'dd' || key === 'mine' || key === 'spy')
      .map((key) => ({ key, value: shownSeries[key][last], at: y(shownSeries[key][last]) }))
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < placed.length; i++) placed[i].at = Math.max(placed[i].at, placed[i - 1].at + 26);
    const overflow = placed.length ? placed[placed.length - 1].at - (h - pad.b - 6) : 0;
    if (overflow > 0) placed.forEach((tag) => { tag.at -= overflow; });
    return placed;
  })();

  if (!n) return <div className="wafu-perf-chart is-empty" ref={ref}><p>還沒有可計算的期間</p></div>;

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = mode === 'period' ? Math.floor(px / (rect.width / m)) : Math.round((px / rect.width) * (m - 1));
    setHover(Math.max(0, Math.min(m - 1, i)));
  };
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), pad.l + 80), w - 90) : 0;
  const zeroY = y(0);
  const area = (key: SeriesKey) => `${line(key)} L${x(last).toFixed(1)} ${zeroY.toFixed(1)} L${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  return <div className="wafu-perf-chart" ref={ref}>
    <svg width={w} height={h} role="img" aria-label={mode === 'cum' ? '累積報酬走勢' : mode === 'dd' ? '回撤走勢' : '單期報酬長條圖'}>
      <defs>
        <linearGradient id={`${uid}-up`} x1="0" x2="0" y1={pad.t} y2={zeroY} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="var(--wa-up)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--wa-up)" stopOpacity={0.02} /></linearGradient>
        <linearGradient id={`${uid}-down`} x1="0" x2="0" y1={zeroY} y2={h - pad.b} gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="var(--wa-down)" stopOpacity={0.03} /><stop offset="100%" stopColor="var(--wa-down)" stopOpacity={0.3} /></linearGradient>
        <linearGradient id={`${uid}-dd`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={ddColor} stopOpacity={0.04} /><stop offset="100%" stopColor={ddColor} stopOpacity={0.36} /></linearGradient>
        <clipPath id={`${uid}-above`}><rect x={0} y={0} width={w} height={Math.max(0, zeroY)} /></clipPath>
        <clipPath id={`${uid}-below`}><rect x={0} y={zeroY} width={w} height={Math.max(0, h - zeroY)} /></clipPath>
      </defs>
      {ticks.map((v) => <g key={v}>
        <line x1={pad.l} x2={w - pad.r} y1={y(v / 100)} y2={y(v / 100)} className={v === 0 ? 'grid zero' : 'grid'} />
        <text x={pad.l - 8} y={y(v / 100)} className="axis" textAnchor="end" dominantBaseline="middle">{v > 0 ? '+' : ''}{Number.isInteger(v) ? v : v.toFixed(1)}%</text>
      </g>)}
      {shownLabels.map((label, i) => (i % every === 0 && last - i >= every * 0.7) || i === last
        ? <text key={i} x={x(i)} y={h - 8} className="axis" textAnchor={mode === 'period' ? 'middle' : i === 0 ? 'start' : i === last ? 'end' : 'middle'}>{label}</text> : null)}

      {mode === 'period' && shownLabels.map((_, i) => {
        const mine = shownSeries.mine[i] ?? 0, spy = shownSeries.spy[i] ?? 0;
        const bw = Math.max(1.5, slot * (visible.spy ? 0.46 : 0.62));
        const sw = Math.max(1, slot * 0.2);
        const cx = x(i);
        return <g key={i} opacity={hover !== null && hover !== i ? 0.55 : 1}>
          {visible.mine && <rect x={cx - (visible.spy ? bw * 0.72 : bw / 2)} width={bw} y={Math.min(y(mine), y(0))} height={Math.max(1, Math.abs(y(mine) - y(0)))} rx={Math.min(2, bw / 3)} fill={mine >= 0 ? 'var(--wa-up)' : 'var(--wa-down)'} />}
          {visible.spy && <rect x={cx + bw * 0.34} width={sw} y={Math.min(y(spy), y(0))} height={Math.max(1, Math.abs(y(spy) - y(0)))} fill={colors.spy} opacity={0.65} />}
        </g>;
      })}
      {mode === 'period' && visible.boxx && <path d={line('boxx')} fill="none" stroke={colors.boxx} strokeWidth={1.3} strokeDasharray="2 4" />}

      {mode === 'cum' && <>
        {visible.mine && <>
          <path d={area('mine')} fill={`url(#${uid}-up)`} clipPath={`url(#${uid}-above)`} />
          <path d={area('mine')} fill={`url(#${uid}-down)`} clipPath={`url(#${uid}-below)`} />
        </>}
        {visible.spy && <path d={line('spy')} fill="none" stroke={colors.spy} strokeWidth={1.4} strokeLinecap="round" opacity={0.85} />}
        {visible.boxx && <path d={line('boxx')} fill="none" stroke={colors.boxx} strokeWidth={1.4} strokeDasharray="2 4" strokeLinecap="round" />}
        {visible.mine && <path d={line('mine')} fill="none" stroke={colors.mine} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />}
        {visible.mine && <g transform={`translate(${x(last)} ${y(shownSeries.mine[last])})`} style={{ color: colors.mine }}>
          <circle r={9} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="10 2.5" className="wafu-perf-end" />
          <circle r={3.6} fill="currentColor" />
        </g>}
      </>}

      {mode === 'dd' && <>
        {visible.mine && <path d={area('mine')} fill={`url(#${uid}-dd)`} />}
        {visible.spy && <path d={line('spy')} fill="none" stroke={colors.spy} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.85} />}
        {visible.mine && <path d={line('mine')} fill="none" stroke={ddColor} strokeWidth={2} strokeLinejoin="round" />}
        {visible.mine && mddIndex >= 0 && shownSeries.mine[mddIndex] < 0 && <g transform={`translate(${x(mddIndex)} ${y(shownSeries.mine[mddIndex])})`}>
          <circle r={4} fill={ddColor} stroke="var(--wa-bg)" strokeWidth={1.5} />
          <text x={mddIndex > m * 0.7 ? -8 : 8} y={14} textAnchor={mddIndex > m * 0.7 ? 'end' : 'start'} className="axis mdd" style={{ fill: ddColor }}>最大回撤 {fmtP(shownSeries.mine[mddIndex])}</text>
        </g>}
      </>}

      {tags.map((tag) => <g key={tag.key} className="wafu-perf-tag" transform={`translate(${x(last) + 12} ${tag.at})`}>
        <text y={-1} className="value" style={{ fill: lineColor(tag.key) }}>{fmtP(tag.value)}</text>
        <text y={11} className="name">{names[tag.key]}</text>
      </g>)}

      {hover !== null && mode !== 'period' && <g>
        <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} className="crosshair" />
        {shown.map((key) => <circle key={key} cx={x(hover)} cy={y(shownSeries[key][hover])} r={key === 'mine' ? 4 : 3} fill={lineColor(key)} stroke="var(--wa-bg)" strokeWidth={1.5} />)}
      </g>}
      <rect x={pad.l} y={pad.t} width={Math.max(0, iw)} height={Math.max(0, ih)} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
    </svg>
    {hover !== null && <div className="wafu-perf-tip" style={{ left: tipLeft }}>
      <b>{shownLabels[hover]}</b>
      {shown.slice().reverse().map((key) => <span key={key}><i style={{ background: lineColor(key) }} />{names[key]}<em className={shownSeries[key][hover] >= 0 ? 'positive' : 'negative'}>{fmtP(shownSeries[key][hover], 2)}</em></span>)}
      {mode !== 'dd' && shown.includes('mine') && shown.includes('spy') && <span className="excess">超額<em className={shownSeries.mine[hover] - shownSeries.spy[hover] >= 0 ? 'positive' : 'negative'}>{fmtP(shownSeries.mine[hover] - shownSeries.spy[hover], 2)}</em></span>}
    </div>}
  </div>;
}
