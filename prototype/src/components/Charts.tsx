import { useEffect, useMemo, useRef, useState } from "react";
import type { ReturnPoint } from "@/lib/data";
import { niceTicks, pct, usd } from "@/lib/wa";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(260, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type SeriesKey = "mine" | "spy" | "boxx";

export function ReturnChart({
  data, colors, labels, visible,
}: {
  data: ReturnPoint[];
  colors: Record<SeriesKey, string>;
  labels: Record<SeriesKey, string>;
  visible: Record<SeriesKey, boolean>;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = w < 520 ? 210 : 250;
  const pad = { l: 44, r: 16, t: 14, b: 28 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const keys = (["spy", "boxx", "mine"] as SeriesKey[]).filter((k) => visible[k]);
  const all = data.flatMap((d) => keys.map((k) => d[k]));
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const x = (i: number) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * ih;

  const path = (k: SeriesKey) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d[k]).toFixed(1)}`).join(" ");
  const area = `${path("mine")} L${x(data.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;

  const every = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(iw / 64))));
  const last = data.length - 1;
  const hi2 = hover ?? null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px / rect.width) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const tipLeft = hi2 != null ? Math.min(Math.max(x(hi2), pad.l + 70), w - 80) : 0;

  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={h} role="img" aria-label="收益率折線圖：我的組合、SPY、BOXX">
        <defs>
          <linearGradient id="mineFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={colors.mine} stopOpacity={0.28} />
            <stop offset="100%" stopColor={colors.mine} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "grid zero" : "grid"} />
            <text x={pad.l - 8} y={y(v)} className="axis" textAnchor="end" dominantBaseline="middle">
              {v > 0 ? "+" : ""}{Number.isInteger(v) ? v : v.toFixed(1)}%
            </text>
          </g>
        ))}
        {data.map((d, i) =>
          (i % every === 0 && last - i >= every * 0.75) || i === last ? (
            <text key={i} x={x(i)} y={h - 8} className="axis" textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>
              {d.label}
            </text>
          ) : null,
        )}
        {visible.mine && <path d={area} fill="url(#mineFade)" />}
        {visible.spy && <path d={path("spy")} className="line" stroke={colors.spy} strokeWidth={1.4} opacity={0.75} />}
        {visible.boxx && <path d={path("boxx")} className="line" stroke={colors.boxx} strokeWidth={1.4} strokeDasharray="2 4" />}
        {visible.mine && <path d={path("mine")} className="line line-main" stroke={colors.mine} strokeWidth={2.2} />}

        {visible.mine && (
          <g transform={`translate(${x(last)} ${y(data[last].mine)})`} className="endpoint" style={{ color: colors.mine }}>
            <circle r={9} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="10 2.5" opacity={0.8} />
            <circle r={3.6} fill="currentColor" />
          </g>
        )}

        {hi2 != null && (
          <g>
            <line x1={x(hi2)} x2={x(hi2)} y1={pad.t} y2={h - pad.b} className="crosshair" />
            {keys.map((k) => (
              <circle key={k} cx={x(hi2)} cy={y(data[hi2][k])} r={k === "mine" ? 4 : 3} fill={colors[k]} stroke="var(--bg)" strokeWidth={1.5} />
            ))}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ cursor: "crosshair" }} />
      </svg>
      {hi2 != null && (
        <div className="tip" style={{ left: tipLeft, top: 6 }}>
          <b>{data[hi2].label}</b>
          {(["mine", "spy", "boxx"] as SeriesKey[]).filter((k) => visible[k]).map((k) => (
            <span key={k}><i style={{ background: colors[k] }} />{labels[k]}<em className={data[hi2][k] >= 0 ? "up" : "down"}>{pct(data[hi2][k])}</em></span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Slice { key: string; label: string; value: number; color: string }

export function Donut({ slices, total, centerLabel, onHover, active }: {
  slices: Slice[]; total: number; centerLabel: string; onHover: (k: string | null) => void; active: string | null;
}) {
  const R = 84, r = 60;
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const gap = slices.length > 1 ? 0.012 : 0;
  const arcs = slices.map((s) => {
    const a0 = (acc / sum) * Math.PI * 2 + gap;
    acc += s.value;
    const a1 = (acc / sum) * Math.PI * 2 - gap;
    return { ...s, a0, a1 };
  });
  const arc = (a0: number, a1: number, ro: number, ri: number) => {
    const p = (a: number, rr: number) => `${(Math.sin(a) * rr).toFixed(2)} ${(-Math.cos(a) * rr).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(a0, ro)} A${ro} ${ro} 0 ${large} 1 ${p(a1, ro)} L${p(a1, ri)} A${ri} ${ri} 0 ${large} 0 ${p(a0, ri)} Z`;
  };
  const act = slices.find((s) => s.key === active);
  return (
    <div className="donut">
      <svg viewBox="-100 -100 200 200" role="group" aria-label="持倉配置圓環圖">
        <circle r={(R + r) / 2} fill="none" stroke="var(--line)" strokeWidth={R - r} />
        {arcs.map((s) => (
          <path
            key={s.key}
            d={arc(s.a0, s.a1, active === s.key ? R + 5 : R, r)}
            fill={s.color}
            opacity={active && active !== s.key ? 0.35 : 1}
            onPointerEnter={() => onHover(s.key)}
            onPointerLeave={() => onHover(null)}
            tabIndex={0}
            onFocus={() => onHover(s.key)}
            onBlur={() => onHover(null)}
            aria-label={`${s.label} ${((s.value / sum) * 100).toFixed(1)}%`}
            className="donut-seg"
          />
        ))}
        <circle r={r - 7} fill="none" stroke="var(--line)" strokeWidth={0.8} strokeDasharray="3 3" />
      </svg>
      <div className="donut-center">
        {act ? (
          <>
            <small>{act.label}</small>
            <strong>{((act.value / sum) * 100).toFixed(1)}%</strong>
            <small>{usd(act.value)}</small>
          </>
        ) : (
          <>
            <strong>{usd(total)}</strong>
            <small>{centerLabel}</small>
          </>
        )}
      </div>
    </div>
  );
}

export function Bars({ slices, onHover, active }: { slices: Slice[]; onHover: (k: string | null) => void; active: string | null }) {
  const max = Math.max(...slices.map((s) => s.value), 1);
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="hbars" role="list">
      {slices.map((s) => (
        <div key={s.key} role="listitem" className={`hbar${active === s.key ? " on" : ""}`} onPointerEnter={() => onHover(s.key)} onPointerLeave={() => onHover(null)}>
          <span className="hbar-label">{s.label}</span>
          <span className="hbar-track"><i style={{ width: `${(s.value / max) * 100}%`, background: s.color }} /></span>
          <span className="hbar-val">{((s.value / sum) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  const w = 120;
  const { min, max } = useMemo(() => ({ min: Math.min(...data), max: Math.max(...data) }), [data]);
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const id = useMemo(() => "sp" + Math.random().toString(36).slice(2, 8), []);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
