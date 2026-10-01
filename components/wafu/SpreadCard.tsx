'use client';

import { useEffect, useState } from 'react';

type CurvePoint = { id: string; tenor: string; label: string; latest: number | null; change: number | null };

/**
 * 30Y − 10Y 利差 card of the 宏觀行情 panel (from the prototype): the long-end spread in basis points
 * with its daily change, the 10Y − 3M spread (an inverted curve reads negative), and a small Treasury
 * curve from 3 months to 30 years. Refreshes every 5 minutes.
 */
export default function SpreadCard() {
  const [points, setPoints] = useState<CurvePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/api/benchmarks?scope=curve')
      .then((response) => response.ok ? response.json() as Promise<{ points?: CurvePoint[] }> : Promise.reject(new Error(String(response.status))))
      .then((payload) => { if (!cancelled) { setPoints(payload.points ?? []); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 300_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const known = (points ?? []).filter((point): point is CurvePoint & { latest: number } => point.latest !== null);
  const pointOf = (id: string) => known.find((point) => point.id === id) ?? null;
  const spread = (a: string, b: string) => { const x = pointOf(a), y = pointOf(b); return x && y ? x.latest - y.latest : null; };
  const longSpread = spread('US30Y', 'US10Y');
  const termSpread = spread('US10Y', 'US3M');
  const p30 = pointOf('US30Y'), p10 = pointOf('US10Y');
  const longChange = p30?.change != null && p10?.change != null ? p30.change - p10.change : null;
  const bp = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.round(Math.abs(value) * 100)}`;
  const inverted = termSpread !== null && termSpread < 0;
  const direction = longChange === null || Math.round(longChange * 100) === 0 ? 'neutral' : longChange > 0 ? 'positive' : 'negative';

  // Tenors placed by maturity on a square-root scale so the short end is not crushed.
  const years: Record<string, number> = { US3M: 0.25, US5Y: 5, US10Y: 10, US30Y: 30 };
  const x = (id: string) => 6 + (Math.sqrt(years[id] ?? 0) - Math.sqrt(0.25)) / (Math.sqrt(30) - Math.sqrt(0.25)) * 88;
  const lo = Math.min(...known.map((point) => point.latest)), hi = Math.max(...known.map((point) => point.latest));
  const pad = Math.max(0.15, (hi - lo) * 0.25);
  const y = (value: number) => 38 - ((value - (lo - pad)) / ((hi + pad) - (lo - pad) || 1)) * 32;
  const path = known.map((point, index) => `${index ? 'L' : 'M'}${x(point.id).toFixed(1)} ${y(point.latest).toFixed(1)}`).join(' ');

  return <article className={`macro-market-card wafu-spread-card ${direction} ${inverted ? 'is-inverted' : ''}`} aria-label="美債 30 年減 10 年利差">
    <header><div><span>UST</span><div><h4>30Y − 10Y 利差</h4><small>基點（bp）</small></div></div><b>SPREAD</b></header>
    <div className="macro-market-quote"><strong>{bp(longSpread)}<small> bp</small></strong><span>{longChange === null ? (failed ? '暫無資料' : '等待更新') : <><b aria-hidden="true">{longChange > 0 ? '▲' : longChange < 0 ? '▼' : '•'}</b><em>{bp(longChange)} bp</em></>}</span></div>
    <div className="macro-history-chart">
      {known.length >= 2 ? <>
        <svg viewBox="0 0 100 54" preserveAspectRatio="none" role="img" aria-label={known.map((point) => `${point.tenor} ${point.latest.toFixed(2)}%`).join('，')}>
          <path d={`${path} L${x(known.at(-1)!.id).toFixed(1)} 44 L${x(known[0].id).toFixed(1)} 44 Z`} className="wafu-spread-area" />
          <path d={path} className="wafu-spread-line" />
        </svg>
        {known.map((point) => <i key={point.id} className="wafu-spread-dot" style={{ left: `${x(point.id)}%`, top: `${y(point.latest) / 54 * 100}%` }} aria-hidden="true" />)}
        {known.map((point) => <small key={point.id} className="wafu-spread-tenor" style={{ left: `${x(point.id)}%` }} aria-hidden="true">{point.tenor}</small>)}
      </> : <span>{failed || points ? '暫時沒有殖利率資料' : '讀取殖利率…'}</span>}
    </div>
    <footer><span>10Y − 3M <b className={inverted ? 'negative' : ''}>{bp(termSpread)} bp{inverted ? ' · 倒掛' : ''}</b></span><span>3M → 30Y</span></footer>
  </article>;
}
