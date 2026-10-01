'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * 收益分析 chart (from the prototype): 累積 (growth lines with the portfolio's area and end point),
 * 單期 (the portfolio's bars beside thin SPY bars, BOXX dotted) or 回撤 (drawdown below zero with the
 * deepest point marked), with a crosshair and a tooltip showing every series and the excess over SPY.
 */
export default function PerfChart({ mode, labels, series, visible, colors, names }: {
  mode: PerfChartMode;
  labels: string[];
  /** One return per period for each series. */
  series: Record<SeriesKey, number[]>;
  visible: Record<SeriesKey, boolean>;
  colors: Record<SeriesKey, string>;
  names: Record<SeriesKey, string>;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = Math.round(Math.min(340, Math.max(230, w * 0.43)));
  const pad = { l: 48, r: 14, t: 16, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const n = labels.length;

  const shownSeries = useMemo(() => {
    if (mode === 'cum') return { mine: cumulativeOf(series.mine), spy: cumulativeOf(series.spy), boxx: cumulativeOf(series.boxx) };
    if (mode === 'dd') return { mine: drawdownOf(series.mine), spy: drawdownOf(series.spy), boxx: series.boxx.map(() => 0) };
    return series;
  }, [mode, series]);
  const keys: SeriesKey[] = mode === 'dd' ? ['spy', 'mine'] : ['spy', 'boxx', 'mine'];
  const shown = keys.filter((key) => visible[key] && shownSeries[key].length === n);
  const values = shown.flatMap((key) => shownSeries[key]);
  const { lo, hi, ticks } = niceTicks(Math.min(mode === 'dd' ? -0.01 : 0, ...values) * 100, Math.max(0, ...values, mode === 'dd' ? 0 : 0.001) * 100, 4);
  const y = (v: number) => pad.t + (1 - (v * 100 - lo) / (hi - lo || 1)) * ih;
  const slot = iw / Math.max(1, n);
  const x = (i: number) => (mode === 'period' ? pad.l + slot * (i + 0.5) : pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
  const line = (key: SeriesKey) => shownSeries[key].map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 70))));
  const last = n - 1;
  const mddIndex = mode === 'dd' && n ? shownSeries.mine.reduce((best, v, i) => (v < shownSeries.mine[best] ? i : best), 0) : -1;

  if (!n) return <div className="wafu-perf-chart is-empty" ref={ref}><p>還沒有可計算的期間</p></div>;

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const i = mode === 'period' ? Math.floor(px / (rect.width / n)) : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), pad.l + 80), w - 90) : 0;
  const ddColor = 'var(--wa-down)';

  return <div className="wafu-perf-chart" ref={ref}>
    <svg width={w} height={h} role="img" aria-label={mode === 'cum' ? '累積報酬走勢' : mode === 'dd' ? '回撤走勢' : '單期報酬長條圖'}>
      <defs>
        <linearGradient id="wafu-perf-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={colors.mine} stopOpacity={0.3} /><stop offset="100%" stopColor={colors.mine} stopOpacity={0} /></linearGradient>
        <linearGradient id="wafu-dd-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--wa-down)" stopOpacity={0.05} /><stop offset="100%" stopColor="var(--wa-down)" stopOpacity={0.4} /></linearGradient>
      </defs>
      {ticks.map((v) => <g key={v}>
        <line x1={pad.l} x2={w - pad.r} y1={y(v / 100)} y2={y(v / 100)} className={v === 0 ? 'grid zero' : 'grid'} />
        <text x={pad.l - 8} y={y(v / 100)} className="axis" textAnchor="end" dominantBaseline="middle">{v > 0 ? '+' : ''}{Number.isInteger(v) ? v : v.toFixed(1)}%</text>
      </g>)}
      {labels.map((label, i) => (i % every === 0 && last - i >= every * 0.7) || i === last
        ? <text key={i} x={x(i)} y={h - 8} className="axis" textAnchor={mode === 'period' ? 'middle' : i === 0 ? 'start' : i === last ? 'end' : 'middle'}>{label}</text> : null)}

      {mode === 'period' && labels.map((_, i) => {
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
        {visible.mine && <path d={`${line('mine')} L${x(last)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#wafu-perf-fade)" />}
        {visible.spy && <path d={line('spy')} fill="none" stroke={colors.spy} strokeWidth={1.4} opacity={0.8} />}
        {visible.boxx && <path d={line('boxx')} fill="none" stroke={colors.boxx} strokeWidth={1.4} strokeDasharray="2 4" />}
        {visible.mine && <path d={line('mine')} fill="none" stroke={colors.mine} strokeWidth={2.2} strokeLinejoin="round" />}
        {visible.mine && <g transform={`translate(${x(last)} ${y(shownSeries.mine[last])})`} style={{ color: colors.mine }}>
          <circle r={9} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="10 2.5" className="wafu-perf-end" />
          <circle r={3.6} fill="currentColor" />
        </g>}
      </>}

      {mode === 'dd' && <>
        {visible.mine && <path d={`${line('mine')} L${x(last)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#wafu-dd-fade)" />}
        {visible.spy && <path d={line('spy')} fill="none" stroke={colors.spy} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.8} />}
        {visible.mine && <path d={line('mine')} fill="none" stroke={ddColor} strokeWidth={1.8} />}
        {visible.mine && mddIndex >= 0 && shownSeries.mine[mddIndex] < 0 && <g transform={`translate(${x(mddIndex)} ${y(shownSeries.mine[mddIndex])})`}>
          <circle r={4} fill={ddColor} stroke="var(--wa-bg)" strokeWidth={1.5} />
          <text x={mddIndex > n * 0.7 ? -8 : 8} y={14} textAnchor={mddIndex > n * 0.7 ? 'end' : 'start'} className="axis mdd">最大回撤 {fmtP(shownSeries.mine[mddIndex])}</text>
        </g>}
      </>}

      {hover !== null && mode !== 'period' && <g>
        <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} className="crosshair" />
        {shown.map((key) => <circle key={key} cx={x(hover)} cy={y(shownSeries[key][hover])} r={key === 'mine' ? 4 : 3} fill={mode === 'dd' && key === 'mine' ? ddColor : colors[key]} stroke="var(--wa-bg)" strokeWidth={1.5} />)}
      </g>}
      <rect x={pad.l} y={pad.t} width={Math.max(0, iw)} height={Math.max(0, ih)} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
    </svg>
    {hover !== null && <div className="wafu-perf-tip" style={{ left: tipLeft }}>
      <b>{labels[hover]}</b>
      {shown.slice().reverse().map((key) => <span key={key}><i style={{ background: mode === 'dd' && key === 'mine' ? ddColor : colors[key] }} />{names[key]}<em className={shownSeries[key][hover] >= 0 ? 'positive' : 'negative'}>{fmtP(shownSeries[key][hover], 2)}</em></span>)}
      {mode !== 'dd' && shown.includes('mine') && shown.includes('spy') && <span className="excess">超額<em className={shownSeries.mine[hover] - shownSeries.spy[hover] >= 0 ? 'positive' : 'negative'}>{fmtP(shownSeries.mine[hover] - shownSeries.spy[hover], 2)}</em></span>}
    </div>}
  </div>;
}
