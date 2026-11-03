'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EarningsInsight } from '@/lib/earnings-insight';
import { hasInsight, parseEarningsInsight } from '@/lib/earnings-insight';
import type { FuturesCurve, IndexQuote, RatioPoint, RegimeId, RegimeReading } from '@/lib/market-regime';
import { classifyRegime, eventRatio, frontSpread, gaugePosition, indexSymbols, ratioZone } from '@/lib/market-regime';
import { fmtLevel, fmtRatio, loadMarketRegime, regimeNames, regimeTone, shortDate, useMarketRegime, useSeen } from './MarketRegimeTile';

/*
 * 市場定調 panel: today's reading of the five rules (lib/market-regime.ts), the ratio gauge, the VIX
 * index and futures term structures, and 基本面參考 (Yardeni links, FactSet's weekly figures). Colours
 * come from the theme's --wa-* tokens, so every theme and tone follows; NASA's extras are in wafu-nasa.css.
 */
const minus = '−';
const signed = (value: number, digits = 1) => `${value > 0 ? '+' : value < 0 ? minus : ''}${Math.abs(value).toFixed(digits)}%`;
const circled = ['', '①', '②', '③', '④', '⑤'] as const;
const zoneNames = ['平靜', '偏緊', '倒掛', '恐慌'] as const;
const zoneRanges = ['< 0.90', '0.90–1.00', '1.00–1.10', '≥ 1.10'] as const;

const advice: Record<RegimeId, string> = {
  0: '比率已在 1.0 以上，但還不符合 ③（VIX 快速衝破 25）或 ④（連續三週）；留意倒掛會不會持續、VIX 會不會急升。',
  1: '維持正常倉位；保護便宜，適合買遠期價外 put，或把部分成長股利潤換成高品質大型公司。',
  2: '倉位不動也可以，少做重倉／滿倉追高。',
  3: '降低高 Beta、垃圾債、小型股持倉。',
  4: '以標普至少 5–10% 修正預期管理倉位；下跌途中抄底要慎重，等止跌形態與關鍵價位測試。',
  5: '恐慌消退、價格止跌，適合分批加倉。',
};
const ruleText: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'VIX < 16 且比率 < 0.90：維持正常倉位；保護便宜，適合買遠期價外 put，或把部分成長股利潤換成高品質大型公司。',
  2: 'VIX 16–22 且比率 0.90–1.00：倉位不動也可以，少做重倉／滿倉追高。',
  3: '比率剛過 1.0，且 VIX 快速衝破 25：降低高 Beta、垃圾債、小型股持倉。',
  4: '比率 > 1.0 持續三週以上：以標普至少 5–10% 修正預期管理倉位；下跌途中抄底要慎重，等止跌形態與關鍵價位測試。',
  5: '比率從 1.1 以上回到 1.0 以下：恐慌消退、價格止跌，適合分批加倉。',
};

type Check = { ok: boolean | null; text: ReactNode };

function ruleChecks(reading: RegimeReading, beta: number | null): Record<1 | 2 | 3 | 4 | 5, Check[]> {
  const { conditions: c } = reading;
  const vix = <>VIX {fmtLevel(reading.vix)}</>;
  const ratio = <>比率 {fmtRatio(reading.ratio)}</>;
  return {
    1: [{ ok: c.vixCalm, text: vix }, { ok: c.ratioCalm, text: ratio }],
    2: [{ ok: c.vixNormal, text: vix }, { ok: c.ratioNormal, text: ratio }],
    3: [
      { ok: c.crossed, text: c.crossed ? '比率剛過 1.0' : reading.ratio > 1 ? '比率過 1.0 已超過 5 天' : '比率未過 1.0' },
      { ok: c.vixSpike, text: c.vixSpike ? 'VIX 快速衝破 25' : reading.vix >= 25 ? 'VIX 在 25 以上，但不是一週內急升' : 'VIX 未破 25' },
      ...(beta !== null && Number.isFinite(beta) ? [{ ok: null, text: <>組合 Beta {beta.toFixed(2)}</> }] : []),
    ],
    4: [{ ok: c.longInversion, text: <>連續 {reading.streak} 天（需 ≥ 15）</> }],
    5: [
      { ok: c.hadPanic, text: <>近 30 天最高 {fmtRatio(reading.max30)}（需 ≥ 1.10）</> },
      { ok: c.backBelow, text: c.backBelow ? '比率在 1.0 以下' : '比率仍在 1.0 以上' },
    ],
  };
}

/** Round axis steps covering lo..hi: the tightest fit among 3–5 steps of 1, 2, 2.5 or 5 × 10ⁿ. */
function niceTicks(lo: number, hi: number) {
  const span = Math.max(hi - lo, 0.2);
  let best: { lo: number; hi: number; ticks: number[] } | null = null;
  for (const count of [3, 4, 5]) {
    const raw = span / count;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * power).find((value) => value >= raw) ?? raw;
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    if (best && max - min >= best.hi - best.lo - step * 1e-6) continue;
    const ticks: number[] = [];
    for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
    best = { lo: min, hi: max, ticks };
  }
  return best ?? { lo, hi, ticks: [lo, hi] };
}

type ChartPoint = { label: string; value: number; title: string; shown?: boolean };

/** The width of an element, followed as it resizes (null until measured). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * A term-structure line: points evenly spaced, optional dashed earlier curve and dashed reference level.
 * Drawn at the box's own width so the labels keep their size on a phone.
 */
function TermChart({ points, previous, reference, label }: { points: ChartPoint[]; previous?: Array<number | null>; reference?: { value: number; text: string }; label: string }) {
  const [box, measured] = useWidth<HTMLDivElement>();
  const width = Math.max(280, Math.min(760, measured ?? 560));
  const height = width < 420 ? 210 : 236;
  const left = 46;
  const right = 22;
  const top = 26;
  const bottom = height - 40;
  const values = [...points.map((point) => point.value), ...(previous ?? []).flatMap((value) => value ?? []), ...(reference ? [reference.value] : [])];
  const axis = niceTicks(Math.min(...values), Math.max(...values));
  const x = (index: number) => left + 14 + (points.length > 1 ? index * ((width - left - right - 28) / (points.length - 1)) : 0);
  const y = (value: number) => bottom - ((value - axis.lo) / (axis.hi - axis.lo || 1)) * (bottom - top);
  const path = (series: Array<number | null>) => series.reduce<string>((d, value, index) => value === null ? d : `${d}${d ? ' L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`, '');
  const decimals = axis.hi - axis.lo < 3 ? 1 : 0;
  const labelStep = points.length > 2 && x(1) - x(0) < 34 ? 2 : 1;
  return <div ref={box} className="wafu-regime-chart-box"><svg className="wafu-regime-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <g className="rg-grid">{axis.ticks.map((tick) => <line key={tick} x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />)}</g>
    <g className="rg-axis" textAnchor="end">{axis.ticks.map((tick) => <text key={tick} x={left - 8} y={y(tick) + 4}>{tick.toFixed(decimals)}</text>)}</g>
    {reference && <g className="rg-ref"><line x1={left} x2={width - right} y1={y(reference.value)} y2={y(reference.value)} /><text x={width - right - 2} y={y(reference.value) - 6} textAnchor="end">{reference.text}</text></g>}
    {previous && <path className="rg-prev" d={path(previous)} />}
    <path className="rg-line" d={path(points.map((point) => point.value))} />
    {points.map((point, index) => {
      const above = index === 0 || index === points.length - 1 || point.value >= Math.min(points[index - 1].value, points[index + 1].value);
      return <g key={point.label + index} className="rg-point">
        <circle cx={x(index)} cy={y(point.value)} r={4} />
        <circle className="rg-hit" cx={x(index)} cy={y(point.value)} r={14}><title>{point.title}</title></circle>
        {point.shown !== false && <text className="rg-value" x={x(index)} y={y(point.value) + (above ? -11 : 19)} textAnchor="middle">{point.value.toFixed(2)}</text>}
      </g>;
    })}
    {/* Every other month label when they would crowd (nine contracts on a phone). */}
    <g className="rg-axis" textAnchor="middle">{points.map((point, index) => index === points.length - 1 || (index % labelStep === 0 && !(labelStep > 1 && index === points.length - 2)) ? <text key={point.label + index} x={x(index)} y={height - 12}>{point.label}</text> : null)}</g>
  </svg></div>;
}

/** The ratio over about six months, with the 1.0 line. */
function RatioSpark({ history }: { history: readonly RatioPoint[] }) {
  if (history.length < 2) return <span className="wafu-regime-spark-empty">歷史資料不足</span>;
  const width = 240;
  const height = 44;
  const lo = Math.min(0.8, ...history.map((point) => point.ratio));
  const hi = Math.max(1.1, ...history.map((point) => point.ratio));
  const x = (index: number) => 2 + (index / (history.length - 1)) * (width - 4);
  const y = (value: number) => height - 3 - ((value - lo) / (hi - lo)) * (height - 6);
  const d = history.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.ratio).toFixed(1)}`).join(' ');
  const last = history.at(-1)!;
  return <svg className="wafu-regime-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`VIX ÷ VIX3M，${shortDate(history[0].date)} 到 ${shortDate(last.date)}，最高 ${fmtRatio(Math.max(...history.map((point) => point.ratio)))}`}>
    <line className="rg-one" x1={0} x2={width} y1={y(1)} y2={y(1)} vectorEffect="non-scaling-stroke" />
    <path className="rg-line" d={d} vectorEffect="non-scaling-stroke" />
  </svg>;
}

/* ---------- 基本面參考 ---------- */

const insightStorageKey = 'optionflow-earnings-insight';
type InsightState = { status: 'idle' | 'loading' | 'ready' | 'error'; insight: EarningsInsight | null; url: string | null; stale: boolean };

function storedInsight(): { insight: EarningsInsight; url: string } | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(insightStorageKey) ?? 'null') as { insight?: EarningsInsight; url?: string } | null;
    return saved?.insight && typeof saved.url === 'string' && typeof saved.insight.file === 'string' ? { insight: saved.insight, url: saved.url } : null;
  } catch {
    return null;
  }
}

/** FactSet's latest weekly figures: read from the PDF once per issue and kept in this browser. */
function useEarningsInsight(active: boolean) {
  const [state, setState] = useState<InsightState>({ status: 'idle', insight: null, url: null, stale: false });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const update = (next: Partial<InsightState>) => { if (!cancelled) setState((current) => ({ ...current, ...next })); };
    void (async () => {
      await Promise.resolve();
      const stored = storedInsight();
      update(stored ? { status: 'ready', insight: stored.insight, url: stored.url, stale: true } : { status: 'loading' });
      try {
        const response = await fetch('/api/earnings-insight');
        if (!response.ok) throw new Error(String(response.status));
        const latest = await response.json() as { file: string; url: string };
        if (stored?.insight.file === latest.file) { update({ url: latest.url, stale: false }); return; }
        const pdf = await fetch(`/api/earnings-insight?file=${encodeURIComponent(latest.file)}`);
        if (!pdf.ok) throw new Error(String(pdf.status));
        const { readPdfText } = await import('@/lib/pdf-table');
        const insight = parseEarningsInsight(latest.file, await readPdfText(await pdf.arrayBuffer(), 20));
        if (!hasInsight(insight)) throw new Error('No figures found.');
        try { window.localStorage.setItem(insightStorageKey, JSON.stringify({ insight, url: latest.url })); } catch { /* storage unavailable */ }
        update({ status: 'ready', insight, url: latest.url, stale: false });
      } catch {
        update(stored ? { stale: true } : { status: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [active]);
  return state;
}

const yardeni = [
  { href: 'https://yardeni.com/charts/us-stock-market/stock-market-forward-metrics/sp-500-forward-revenues-earnings-margins', title: 'S&P 500 前瞻營收、盈餘、利潤率', charts: [['3', '營業 EPS：前瞻與實際'], ['7', 'EPS 預估（每週分析師共識）'], ['9', '前瞻與年度營業利潤率']] },
  { href: 'https://yardeni.com/charts/yardeni-university/in-10-charts/sp-msci-forward-earnings', title: 'S&P／MSCI 前瞻盈餘', charts: [['1', 'S&P 500 營業 EPS（逐年共識預估）'], ['6', '前瞻盈餘：S&P 500、S&P 493 與七巨頭']] },
] as const;

function Metric({ label, value, sub, tone }: { label: ReactNode; value: string; sub?: ReactNode; tone?: 'positive' | 'negative' }) {
  return <div className="wafu-regime-metric"><span>{label}</span><strong className={tone}>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

function Fundamentals({ active }: { active: boolean }) {
  const { status, insight, url, stale } = useEarningsInsight(active);
  const quarter = insight?.quarter?.split(' ')[0];
  const date = insight?.date;
  return <section className="wafu-regime-fund" aria-labelledby="wafu-regime-fund-title">
    <div className="wafu-regime-subhead"><h3 id="wafu-regime-fund-title">基本面參考</h3><span>看盈餘預估有沒有跟著走弱</span></div>
    <div className="wafu-regime-fund-grid">
      {yardeni.map((source) => <article key={source.href} className="wafu-regime-card">
        <span className="wafu-regime-src">Yardeni Research</span>
        <b>{source.title}</b>
        <ul>{source.charts.map(([number, title]) => <li key={number}><i>{number}</i><span>{title}</span></li>)}</ul>
        <a className="wafu-regime-go-link" href={source.href} target="_blank" rel="noreferrer">打開圖表 ↗</a>
      </article>)}
      <article className="wafu-regime-card is-factset" aria-busy={status === 'loading'}>
        <span className="wafu-regime-src">{`FactSet Earnings Insight${date ? ` · ${date.replaceAll('-', '/')}` : ''}${stale && insight && status === 'ready' ? ' · 上一期' : ''}`}</span>
        {insight ? <div className="wafu-regime-metrics">
          {insight.forwardPe !== null && <Metric label="前瞻 12 個月本益比" value={insight.forwardPe.toFixed(1)} sub={insight.pe5y !== null && insight.pe10y !== null ? `5 年均 ${insight.pe5y.toFixed(1)} · 10 年均 ${insight.pe10y.toFixed(1)}` : undefined} />}
          {insight.calendarGrowth[0] && <Metric label={`${insight.calendarGrowth[0].year} EPS 成長預估`} value={signed(insight.calendarGrowth[0].growth)} tone={insight.calendarGrowth[0].growth >= 0 ? 'positive' : 'negative'} sub={insight.calendarGrowth[1] ? `${insight.calendarGrowth[1].year} 預估 ${signed(insight.calendarGrowth[1].growth)}` : undefined} />}
          {insight.beatPct !== null && quarter && <Metric label={`${quarter} 盈餘優於預期`} value={`${insight.beatPct}%`} sub={insight.reportedPct !== null ? `已公布 ${insight.reportedPct}% 公司` : undefined} />}
          {insight.epsGrowth !== null && quarter && <Metric label={`${quarter} ${insight.growthKind === 'estimated' ? '預估 EPS 成長' : '綜合 EPS 成長'}`} value={signed(insight.epsGrowth)} tone={insight.epsGrowth >= 0 ? 'positive' : 'negative'} sub={insight.revenueGrowth !== null ? `營收 ${signed(insight.revenueGrowth)}` : undefined} />}
          {insight.guidanceNegative !== null && insight.guidancePositive !== null && <Metric label={`${insight.guidanceQuarter?.split(' ')[0] ?? ''} EPS 財測`} value={`${insight.guidanceNegative} / ${insight.guidancePositive}`} sub="負面 / 正面 家數" />}
        </div> : <p className="wafu-regime-wait">{status === 'error' ? '這週的報告暫時讀不到，請直接打開 PDF。' : '正在讀取本週 FactSet 報告…'}</p>}
        <a className="wafu-regime-go-link" href={url ?? 'https://www.factset.com/earningsinsight'} target="_blank" rel="noreferrer">打開最新一期 PDF ↗</a>
      </article>
    </div>
    <p className="wafu-regime-note">Yardeni 的條款不允許轉貼或嵌入圖表，所以這裡只放連結和要看的圖號。FactSet 的數字每週從最新一期 PDF 自動讀出。</p>
  </section>;
}

/* ---------- The panel ---------- */

function indexNote(quotes: readonly IndexQuote[]) {
  const level = (symbol: string) => quotes.find((quote) => quote.symbol === symbol)?.price ?? null;
  const [nine, vix, three, six, year] = ['VIX9D', 'VIX', 'VIX3M', 'VIX6M', 'VIX1Y'].map(level);
  const parts: string[] = [];
  if (nine !== null && vix !== null) parts.push(nine > vix ? '九天高於一個月：近端有事件壓力' : '九天低於一個月：近端沒有特別的事件壓力');
  if (vix !== null && three !== null) {
    const curve = [vix, three, six, year].filter((value): value is number => value !== null);
    const rising = curve.every((value, index) => index === 0 || value >= curve[index - 1]);
    parts.push(three < vix ? '一個月高於三個月：期限結構倒掛' : rising ? '一個月以後一路往上，仍是正價差' : '三個月高於一個月，仍是正價差');
  }
  return parts.map((part) => `${part}。`).join('');
}

/** "2 ÷ 1 − 1 = −2.6%：近月倒掛。之後逐月往上。" as separate text, so each phrase can be translated. */
function futuresNote(curve: FuturesCurve | null) {
  const spread = frontSpread(curve);
  if (!curve || spread === null) return null;
  const points = curve.points;
  const later = points.length > 2 && points.at(-1)!.price > points[1].price;
  return <>2 ÷ 1 − 1 = {signed(spread * 100)}{spread < 0 ? '：近月倒掛。' : '：近月正價差。'}{later && '之後逐月往上。'}</>;
}

const monthLabel = (expiry: string) => `${Number(expiry.slice(5, 7))}月`;

export default function MarketRegime({ beta = null }: { beta?: number | null }) {
  const [ref, seen] = useSeen<HTMLElement>();
  const { data, loading, failed } = useMarketRegime(seen);
  const reading = useMemo(() => data ? classifyRegime(data.ratioHistory) : null, [data]);
  const nine = data ? eventRatio(data.quotes) : null;
  const spread = data ? frontSpread(data.futures) : null;
  const heading = <div className="panel-heading">
    <div>
      <p className="eyebrow">Market regime · VIX term structure</p>
      <h2>市場定調</h2>
      <p className="wafu-regime-lede">用它定調風險和倉位，不能當唯一的買賣觸發條件。</p>
    </div>
    <div className="wafu-regime-tags">
      {data?.asOf && <span className="wafu-regime-tag is-mono">{`${shortDate(data.asOf)} ${data.intraday ? '盤中 · 延遲約 15 分鐘' : '收盤'} · Cboe`}</span>}
      <span className="wafu-regime-tag">比率 = VIX ÷ VIX3M</span>
    </div>
  </div>;

  if (!reading || !data) {
    return <article ref={ref} className="panel wafu-regime-panel" id="market-regime" aria-busy={loading || !failed}>
      {heading}
      <div className="wafu-regime-empty">
        {failed ? <><span>暫時讀不到 Cboe 的 VIX 資料。</span><button type="button" onClick={() => loadMarketRegime(true)}>重新讀取</button></> : <span>正在讀取 VIX 期限結構…</span>}
      </div>
    </article>;
  }

  const checks = ruleChecks(reading, beta);
  const current = reading.id;
  const zone = ratioZone(reading.ratio);
  const futures = data.futures;
  const previousByExpiry = new Map(data.futuresPrev?.points.map((point) => [point.expiry, point.price]) ?? []);
  const vixQuote = data.quotes.find((quote) => quote.symbol === 'VIX');
  const indexPoints: ChartPoint[] = indexSymbols.flatMap((symbol) => {
    const quote = data.quotes.find((item) => item.symbol === symbol);
    return quote ? [{ label: symbol, value: quote.price, title: `${symbol} ${fmtLevel(quote.price)}${quote.prevClose ? `（前收 ${fmtLevel(quote.prevClose)}）` : ''}` }] : [];
  });
  const futuresPoints: ChartPoint[] = futures?.points.map((point, index, all) => ({ label: monthLabel(point.expiry), value: point.price, title: `${point.symbol} · ${point.expiry} 到期 · ${point.price.toFixed(2)}`, shown: index < 2 || index === all.length - 1 })) ?? [];
  const max6m = Math.max(...data.ratioHistory.map((point) => point.ratio));

  return <article ref={ref} className={`panel wafu-regime-panel regime-${current} tone-${regimeTone[current]}`} id="market-regime" aria-busy={loading}>
    {heading}

    <section className="wafu-regime-now" aria-label="目前定調">
      <div className="wafu-regime-now-main">
        <div className="wafu-regime-now-head">
          <span className="wafu-regime-badge is-large" aria-hidden="true">{current || '!'}</span>
          <div><span>目前定調</span><strong>{current ? `${circled[current]} ` : ''}{regimeNames[current]}</strong></div>
        </div>
        <p className="wafu-regime-advice">{advice[current]}</p>
        <div className="wafu-regime-chips">
          {current >= 1 && checks[current as 1 | 2 | 3 | 4 | 5].filter((check) => check.ok).map((check, index) => <span key={index} className="wafu-regime-chip"><i className="is-yes">✓</i>{check.text}</span>)}
          {reading.elevated && <span className="wafu-regime-chip is-warn">VIX 高於 22，偏高</span>}
          {nine !== null && nine > 1 && <span className="wafu-regime-chip is-warn">事件提醒：VIX9D ÷ VIX {nine.toFixed(2)}，短期壓力偏高</span>}
          {reading.shortHistory && <span className="wafu-regime-chip">歷史資料不足 30 天，④⑤ 僅供參考</span>}
        </div>
      </div>
      <div className="wafu-regime-gauge-wrap">
        <div className="wafu-regime-gauge-head"><span>VIX ÷ VIX3M</span><strong>{fmtRatio(reading.ratio)}</strong></div>
        <div className="wafu-regime-gauge" role="img" aria-label={`比率 ${fmtRatio(reading.ratio)}，在「${zoneNames[zone]}」區`}>
          {zoneNames.map((name, index) => <span key={name} className={`z${index + 1} ${index === zone ? 'is-current' : ''}`} />)}
          <b style={{ left: `${gaugePosition(reading.ratio) * 100}%` }} />
        </div>
        <div className="wafu-regime-gauge-scale">{zoneNames.map((name, index) => <span key={name} className={index === zone ? 'is-current' : ''}><i>{zoneRanges[index]}</i> {name}</span>)}</div>
        <span className="wafu-regime-gauge-foot">比率 &gt; 1.0 連續天數：{reading.streak} 天 · 近 30 天最高：{fmtRatio(reading.max30)}</span>
      </div>
    </section>

    <ol className="wafu-regime-rules" aria-label="五條規則">
      {([1, 2, 3, 4, 5] as const).map((id) => <li key={id} className={`wafu-regime-rule ${current === id ? 'is-current' : ''}`} aria-current={current === id ? 'true' : undefined}>
        <b>{circled[id]} {regimeNames[id]}{current === id && <em> · 目前</em>}</b>
        <p>{ruleText[id]}</p>
        <div className="wafu-regime-checks">{checks[id].map((check, index) => <span key={index} className={check.ok ? 'is-yes' : check.ok === null ? 'is-info' : ''}>{check.ok === null ? '·' : check.ok ? '✓' : '✗'} {check.text}</span>)}</div>
      </li>)}
    </ol>

    <div className="wafu-regime-charts">
      <section className="wafu-regime-card">
        <div className="wafu-regime-card-head"><b>VIX 指數期限結構</b><span>9 天 → 1 年</span></div>
        {indexPoints.length >= 2 ? <TermChart points={indexPoints} label={`VIX 指數期限結構：${indexPoints.map((point) => `${point.label} ${fmtLevel(point.value)}`).join('、')}`} /> : <p className="wafu-regime-wait">指數報價暫時不完整。</p>}
        <p className="wafu-regime-note">{indexNote(data.quotes)}</p>
      </section>
      <section className="wafu-regime-card">
        <div className="wafu-regime-card-head"><b>VIX 期貨期限結構</b><span>{futures ? `${shortDate(futures.date)} 結算${data.futuresPrev ? ` · 虛線 ${shortDate(data.futuresPrev.date)}` : ''}` : '暫無結算資料'}</span></div>
        {futuresPoints.length >= 2 ? <TermChart
          points={futuresPoints}
          previous={futures?.points.map((point) => previousByExpiry.get(point.expiry) ?? null)}
          reference={vixQuote ? { value: vixQuote.price, text: `VIX ${fmtLevel(vixQuote.price)}` } : undefined}
          label={`VIX 期貨結算曲線：${futuresPoints.map((point) => `${point.label} ${point.value.toFixed(2)}`).join('、')}`}
        /> : <p className="wafu-regime-wait">期貨結算暫時讀不到。</p>}
        <p className="wafu-regime-note">{futuresNote(futures)}</p>
      </section>
    </div>

    <div className="wafu-regime-stats">
      <Metric label="VIX ÷ VIX3M" value={fmtRatio(reading.ratio)} sub={`影片的「比率」· ${zoneNames[zone]}`} tone={zone >= 2 ? 'negative' : undefined} />
      <Metric label="VIX9D ÷ VIX" value={nine === null ? '—' : fmtRatio(nine)} sub="> 1：近端事件壓力" tone={nine !== null && nine > 1 ? 'negative' : undefined} />
      <Metric label="近月期貨價差（2 ÷ 1 − 1）" value={spread === null ? '—' : signed(spread * 100)} sub="負值＝近月倒掛" tone={spread !== null && spread < 0 ? 'negative' : undefined} />
      <div className="wafu-regime-metric is-spark"><span>比率近 6 個月</span><RatioSpark history={data.ratioHistory} /><small>{`最高 ${fmtRatio(max6m)} · 虛線為 1.0`}</small></div>
    </div>

    <Fundamentals active={seen} />

    <p className="wafu-regime-note is-foot">資料：Cboe 延遲報價（約 15 分鐘）與 VX 期貨每日結算；每日收盤後更新。只是定調參考，不是買賣建議。</p>
  </article>;
}
