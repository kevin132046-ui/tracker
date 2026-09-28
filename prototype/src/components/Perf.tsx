import { useEffect, useMemo, useRef, useState } from "react";
import { cumulative, drawdowns, monthlyGrid, type Bucket, type Key, type Metrics, type Period } from "@/lib/perf";
import { niceTicks, type Lang } from "@/lib/wa";

export type PerfMode = "cum" | "period" | "dd" | "heat";

const fmtP = (v: number, dp = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`;
const fmtN = (v: number, dp = 2) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(260, Math.round(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function PerfChart({ mode, data, colors, labels, visible, lang }: {
  mode: Exclude<PerfMode, "heat">;
  data: Bucket[];
  colors: Record<Key, string>;
  labels: Record<Key, string>;
  visible: Record<Key, boolean>;
  lang: Lang;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // 比例：寬高約 2.3:1，並限制在舒適的高度區間
  const h = Math.round(Math.min(340, Math.max(230, w * 0.43)));
  const pad = { l: 48, r: 14, t: 16, b: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const n = data.length;

  const series = useMemo(() => {
    if (mode === "cum") return cumulative(data).map((p) => ({ label: p.label, mine: p.mine, spy: p.spy, boxx: p.boxx }));
    if (mode === "dd") return drawdowns(data).map((p) => ({ label: p.label, mine: p.mine, spy: p.spy, boxx: 0 }));
    return data.map((b) => ({ label: b.label, mine: b.mine, spy: b.spy, boxx: b.boxx }));
  }, [mode, data]);

  const keys: Key[] = mode === "dd" ? (["spy", "mine"] as Key[]) : (["spy", "boxx", "mine"] as Key[]);
  const shown = keys.filter((k) => visible[k]);
  const vals = series.flatMap((p) => shown.map((k) => p[k]));
  const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals) * 100, Math.max(0, ...vals, mode === "dd" ? 0 : 0.001) * 100, 4);
  const y = (v: number) => pad.t + (1 - (v * 100 - lo) / (hi - lo || 1)) * ih;
  const slot = iw / Math.max(1, n);
  const x = (i: number) => (mode === "period" ? pad.l + slot * (i + 0.5) : pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
  const line = (k: Key) => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 70))));
  const last = n - 1;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = mode === "period" ? Math.floor(px / (rect.width / n)) : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hv = hover != null ? series[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max(x(hover), pad.l + 80), w - 90) : 0;
  const mddIdx = mode === "dd" ? series.reduce((bi, p, i) => (p.mine < series[bi].mine ? i : bi), 0) : -1;

  return (
    <div className="chart perf-chart" ref={ref}>
      <svg key={`${mode}-${n}-${data[0]?.key}`} className="anim" width={w} height={h} role="img" aria-label={mode === "cum" ? "累積報酬走勢" : mode === "dd" ? "回撤走勢" : "單期報酬長條圖"}>
        <defs>
          <linearGradient id="perfFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={colors.mine} stopOpacity={0.3} />
            <stop offset="100%" stopColor={colors.mine} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="ddFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--down)" stopOpacity={0.05} />
            <stop offset="100%" stopColor="var(--down)" stopOpacity={0.4} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v / 100)} y2={y(v / 100)} className={v === 0 ? "grid zero" : "grid"} />
            <text x={pad.l - 8} y={y(v / 100)} className="axis" textAnchor="end" dominantBaseline="middle">
              {v > 0 ? "+" : ""}{Number.isInteger(v) ? v : v.toFixed(1)}%
            </text>
          </g>
        ))}
        {series.map((p, i) =>
          (i % every === 0 && last - i >= every * 0.7) || i === last ? (
            <text key={i} x={x(i)} y={h - 8} className="axis" textAnchor={mode === "period" ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"}>{p.label}</text>
          ) : null,
        )}

        {mode === "period" && series.map((p, i) => {
          const bw = Math.max(1.5, slot * (visible.spy ? 0.46 : 0.62));
          const sw = Math.max(1, slot * 0.2);
          const cx = x(i);
          const on = hover === i;
          return (
            <g key={i} opacity={hover != null && !on ? 0.55 : 1}>
              {visible.mine && <rect className={`bar ${p.mine >= 0 ? "pos" : "neg"}`} style={{ animationDelay: `${Math.min(420, i * 9)}ms` }} x={cx - (visible.spy ? bw * 0.72 : bw / 2)} width={bw} y={Math.min(y(p.mine), y(0))} height={Math.max(1, Math.abs(y(p.mine) - y(0)))} rx={Math.min(2, bw / 3)} fill={p.mine >= 0 ? "var(--up)" : "var(--down)"} />}
              {visible.spy && <rect className={`bar ${p.spy >= 0 ? "pos" : "neg"}`} style={{ animationDelay: `${Math.min(420, i * 9 + 60)}ms` }} x={cx + bw * 0.34} width={sw} y={Math.min(y(p.spy), y(0))} height={Math.max(1, Math.abs(y(p.spy) - y(0)))} fill={colors.spy} opacity={0.65} />}
            </g>
          );
        })}
        {mode === "period" && visible.boxx && <path d={line("boxx")} fill="none" stroke={colors.boxx} strokeWidth={1.3} strokeDasharray="2 4" />}

        {mode === "cum" && (
          <>
            {visible.mine && <path className="area-in" d={`${line("mine")} L${x(last)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#perfFade)" />}
            {visible.spy && <path d={line("spy")} pathLength={1} className="line draw" stroke={colors.spy} strokeWidth={1.4} opacity={0.8} />}
            {visible.boxx && <path d={line("boxx")} className="line fade-in" stroke={colors.boxx} strokeWidth={1.4} strokeDasharray="2 4" />}
            {visible.mine && <path d={line("mine")} pathLength={1} className="line line-main draw" stroke={colors.mine} strokeWidth={2.2} />}
            {visible.mine && (
              <g transform={`translate(${x(last)} ${y(series[last].mine)})`} className="endpoint pop-in" style={{ color: colors.mine }}>
                <circle r={9} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="10 2.5" />
                <circle r={3.6} fill="currentColor" />
              </g>
            )}
          </>
        )}

        {mode === "dd" && (
          <>
            {visible.mine && <path className="area-in" d={`${line("mine")} L${x(last)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="url(#ddFade)" />}
            {visible.spy && <path d={line("spy")} className="line fade-in" stroke={colors.spy} strokeWidth={1.3} strokeDasharray="4 3" opacity={0.8} />}
            {visible.mine && <path d={line("mine")} pathLength={1} className="line draw" stroke="var(--down)" strokeWidth={1.8} />}
            {visible.mine && mddIdx >= 0 && (
              <g transform={`translate(${x(mddIdx)} ${y(series[mddIdx].mine)})`}>
                <circle r={4} fill="var(--down)" stroke="var(--bg)" strokeWidth={1.5} />
                <text x={mddIdx > n * 0.7 ? -8 : 8} y={14} textAnchor={mddIdx > n * 0.7 ? "end" : "start"} className="axis mdd-label">
                  {lang === "ja" ? "最大DD" : "最大回撤"} {fmtP(series[mddIdx].mine)}
                </text>
              </g>
            )}
          </>
        )}

        {hover != null && mode !== "period" && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} className="crosshair" />
            {shown.map((k) => <circle key={k} cx={x(hover)} cy={y(series[hover][k])} r={k === "mine" ? 4 : 3} fill={mode === "dd" && k === "mine" ? "var(--down)" : colors[k]} stroke="var(--bg)" strokeWidth={1.5} />)}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ cursor: "crosshair" }} />
      </svg>
      {hv && (
        <div className="tip" style={{ left: tipLeft, top: 4 }}>
          <b>{hv.label}</b>
          {shown.slice().reverse().map((k) => (
            <span key={k}><i style={{ background: mode === "dd" && k === "mine" ? "var(--down)" : colors[k] }} />{labels[k]}<em className={hv[k] >= 0 ? "up" : "down"}>{fmtP(hv[k], 2)}</em></span>
          ))}
          {mode !== "dd" && visible.mine && visible.spy && (
            <span className="tip-excess">{lang === "ja" ? "超過" : "超額"}<em className={hv.mine - hv.spy >= 0 ? "up" : "down"}>{fmtP(hv.mine - hv.spy, 2)}</em></span>
          )}
        </div>
      )}
    </div>
  );
}

export function MonthlyHeatmap({ lang }: { lang: Lang }) {
  const grid = useMemo(() => monthlyGrid(), []);
  const maxAbs = Math.max(...grid.flatMap((g) => g.cells.filter((c): c is number => c != null).map(Math.abs)), 0.01);
  const shade = (v: number | null) => {
    if (v == null) return undefined;
    const k = Math.round(10 + (Math.abs(v) / maxAbs) * 70);
    return { background: `color-mix(in srgb, ${v >= 0 ? "var(--up)" : "var(--down)"} ${k}%, transparent)` };
  };
  const months = lang === "ja" ? ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"] : ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  return (
    <div className="heat-wrap">
      <table className="heat">
        <thead>
          <tr><th />{months.map((m) => <th key={m}>{m}</th>)}<th>{lang === "ja" ? "年間" : "全年"}</th><th>vs SPY</th></tr>
        </thead>
        <tbody>
          {grid.map((g) => (
            <tr key={g.year}>
              <th>{g.year}</th>
              {g.cells.map((c, i) => (
                <td key={i} style={shade(c)} title={c == null ? "" : `${g.year}/${i + 1}：${fmtP(c, 2)}`}>{c == null ? "" : (c * 100).toFixed(1)}</td>
              ))}
              <td className={`heat-total ${g.total >= 0 ? "up" : "down"}`}>{fmtP(g.total)}</td>
              <td className={`heat-total ${g.total - g.spy >= 0 ? "up" : "down"}`}>{fmtP(g.total - g.spy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Tone = "good" | "mid" | "weak" | "none";
interface Cell { key: string; label: string; value: string; sub?: string; tone: Tone; def: string }

export function MetricsGrid({ m, period, lang }: { m: Metrics; period: Period; lang: Lang }) {
  const [more, setMore] = useState(false);
  const ja = lang === "ja";
  const unit = { day: ja ? "日" : "日", week: ja ? "週" : "週", month: ja ? "月" : "月", year: ja ? "年" : "年" }[period];
  const t3 = (v: number, good: number, mid: number, higherBetter = true): Tone =>
    higherBetter ? (v >= good ? "good" : v >= mid ? "mid" : "weak") : v <= good ? "good" : v <= mid ? "mid" : "weak";
  const primary: Cell[] = [
    { key: "cum", label: ja ? "累積リターン" : "累積報酬", value: fmtP(m.cum), sub: `SPY ${fmtP(m.cumSpy)}`, tone: m.cum >= m.cumSpy ? "good" : "weak", def: "期間內各期報酬複利相乘的總報酬" },
    { key: "cagr", label: ja ? "年率リターン" : "年化報酬", value: fmtP(m.cagr), sub: `SPY ${fmtP(m.cagrSpy)}`, tone: m.cagr >= m.cagrSpy ? "good" : "mid", def: "把期間報酬換算成每年等值（CAGR）" },
    { key: "vol", label: ja ? "年率ボラ" : "年化波動", value: fmtP(m.vol).replace("+", ""), sub: `SPY ${fmtP(m.volSpy).replace("+", "")}`, tone: m.vol <= m.volSpy * 1.15 ? "mid" : "weak", def: "單期報酬標準差 × √(每年期數)，越高代表淨值起伏越大" },
    { key: "sharpe", label: "Sharpe", value: fmtN(m.sharpe), sub: `SPY ${fmtN(m.sharpeSpy)}`, tone: t3(m.sharpe, 1, 0.5), def: "(報酬 − 無風險利率) ÷ 波動；無風險利率以 BOXX 代替。1 以上算好" },
    { key: "sortino", label: "Sortino", value: fmtN(m.sortino), sub: `SPY ${fmtN(m.sortinoSpy)}`, tone: t3(m.sortino, 1.4, 0.7), def: "只把下跌波動當成風險的 Sharpe" },
    { key: "mdd", label: ja ? "最大DD" : "最大回撤", value: fmtP(m.mdd), sub: `${m.mddAt} · SPY ${fmtP(m.mddSpy)}`, tone: t3(m.mdd, -0.1, -0.2), def: "淨值從歷史高點跌到低點的最大幅度" },
    { key: "beta", label: "Beta", value: fmtN(m.beta), sub: ja ? "対 SPY" : "對 SPY", tone: "none", def: "對大盤的敏感度：1.2 代表 SPY 漲跌 1%，組合平均漲跌 1.2%" },
    { key: "alpha", label: ja ? "アルファ" : "Alpha（年化）", value: fmtP(m.alpha), sub: ja ? "Jensen α" : "Jensen α", tone: m.alpha >= 0 ? "good" : "weak", def: "扣掉 Beta 帶來的報酬後，每年多賺或少賺的部分" },
  ];
  const extra: Cell[] = [
    { key: "calmar", label: "Calmar", value: fmtN(m.calmar), sub: ja ? "年率 ÷ |最大DD|" : "年化 ÷ |最大回撤|", tone: t3(m.calmar, 1, 0.5), def: "年化報酬 ÷ 最大回撤絕對值，衡量承擔回撤換來的報酬" },
    { key: "corr", label: ja ? "相関係数" : "相關係數", value: fmtN(m.corr), sub: "−1 ~ 1", tone: "none", def: "與 SPY 同步的程度，越接近 1 越像大盤" },
    { key: "te", label: ja ? "トラッキングエラー" : "追蹤誤差", value: fmtP(m.te).replace("+", ""), sub: ja ? "年率" : "年化", tone: "none", def: "組合與 SPY 報酬差的年化波動" },
    { key: "ir", label: ja ? "情報レシオ" : "資訊比率", value: fmtN(m.ir), sub: ja ? "超過 ÷ TE" : "超額 ÷ 追蹤誤差", tone: t3(m.ir, 0.5, 0), def: "年化超額報酬 ÷ 追蹤誤差，0.5 以上算穩定地贏大盤" },
    { key: "up", label: ja ? "上昇捕捉率" : "上行捕獲", value: `${(m.upCap * 100).toFixed(0)}%`, sub: ja ? "SPY 上昇時" : "SPY 上漲期間", tone: m.upCap >= 1 ? "good" : "mid", def: "SPY 上漲的期間，組合平均吃到 SPY 漲幅的比例" },
    { key: "down", label: ja ? "下落捕捉率" : "下行捕獲", value: `${(m.downCap * 100).toFixed(0)}%`, sub: ja ? "低いほど良い" : "越低越好", tone: m.downCap <= 1 ? "good" : "weak", def: "SPY 下跌的期間，組合平均承受 SPY 跌幅的比例" },
    { key: "win", label: ja ? "勝率" : "勝率", value: `${(m.win * 100).toFixed(0)}%`, sub: `${ja ? "SPY 超え" : "勝 SPY"} ${(m.beat * 100).toFixed(0)}%`, tone: t3(m.win, 0.55, 0.45), def: `報酬為正的${unit}數占比；以及報酬高於 SPY 的${unit}數占比` },
    { key: "payoff", label: ja ? "ペイオフ比" : "盈虧比", value: fmtN(m.payoff), sub: ja ? "平均勝 ÷ 平均負" : "平均賺 ÷ 平均賠", tone: t3(m.payoff, 1.2, 0.9), def: "獲利期平均報酬 ÷ 虧損期平均虧損" },
    { key: "var", label: "VaR 95%", value: fmtP(m.var95, 2), sub: `${ja ? "1" : "單"}${unit}`, tone: "none", def: `歷史最差 5% 的${unit}報酬門檻` },
    { key: "cvar", label: "CVaR 95%", value: fmtP(m.cvar95, 2), sub: ja ? "テール平均" : "尾端平均", tone: "none", def: `最差 5% 的${unit}報酬平均（預期尾端損失）` },
    { key: "best", label: ja ? "最高期間" : `最佳${unit}`, value: fmtP(m.best.v), sub: m.best.label, tone: "good", def: "期間內單期最高報酬" },
    { key: "worst", label: ja ? "最低期間" : `最差${unit}`, value: fmtP(m.worst.v), sub: m.worst.label, tone: "weak", def: "期間內單期最低報酬" },
  ];
  const cells = more ? [...primary, ...extra] : primary;
  return (
    <section className="kpis" aria-label={ja ? "パフォーマンス指標" : "績效與風險指標"}>
      <div className="kpis-head">
        <h3>{ja ? "パフォーマンス指標" : "績效與風險指標"}</h3>
        <span className="muted small">{ja ? `${m.n} ${unit}のリターンで計算 · 無リスク金利＝BOXX` : `以 ${m.n} 個${unit}報酬計算 · 無風險利率以 BOXX 代替`}</span>
        <button type="button" className="chip-btn" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? (ja ? "閉じる" : "收合") : (ja ? "詳細指標 +12" : "更多指標 +12")}</button>
      </div>
      <div className="kpi-grid">
        {cells.map((c) => (
          <div key={c.key} className={`kpi tone-${c.tone}`} title={c.def}>
            <span className="kpi-label">{c.label}</span>
            <strong>{c.value}</strong>
            {c.sub && <small>{c.sub}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}
