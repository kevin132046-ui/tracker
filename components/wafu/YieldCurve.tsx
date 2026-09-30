'use client';

import { useEffect, useState } from 'react';

type CurvePoint = { id: string; tenor: string; label: string; latest: number | null; change: number | null };

/**
 * 殖利率曲線 (from the prototype): the Treasury curve from 3 months to 30 years as a small line, with
 * the 30Y−10Y and 10Y−3M spreads (an inverted curve reads negative). Refreshes every 5 minutes.
 */
export default function YieldCurve() {
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
  const yieldOf = (id: string) => known.find((point) => point.id === id)?.latest ?? null;
  const spread = (a: string, b: string) => { const x = yieldOf(a), y = yieldOf(b); return x === null || y === null ? null : x - y; };
  const longSpread = spread('US30Y', 'US10Y');
  const termSpread = spread('US10Y', 'US3M');
  const bp = (value: number | null) => value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.round(Math.abs(value) * 100)} bp`;

  // Tenors placed by maturity on a square-root scale so the short end is not crushed.
  const years: Record<string, number> = { US3M: 0.25, US5Y: 5, US10Y: 10, US30Y: 30 };
  const x = (id: string) => 8 + (Math.sqrt(years[id] ?? 0) - Math.sqrt(0.25)) / (Math.sqrt(30) - Math.sqrt(0.25)) * 184;
  const lo = Math.min(...known.map((point) => point.latest)), hi = Math.max(...known.map((point) => point.latest));
  const pad = Math.max(0.15, (hi - lo) * 0.25);
  const y = (value: number) => 50 - ((value - (lo - pad)) / ((hi + pad) - (lo - pad) || 1)) * 40;
  const path = known.map((point, index) => `${index ? 'L' : 'M'}${x(point.id).toFixed(1)} ${y(point.latest).toFixed(1)}`).join(' ');
  const inverted = termSpread !== null && termSpread < 0;

  return <article className={`wafu-curve ${inverted ? 'is-inverted' : ''}`} aria-label="美國公債殖利率曲線">
    <header>
      <div><h4>殖利率曲線</h4><small>美國公債 · 3 個月至 30 年</small></div>
      <dl>
        <div><dt>30Y − 10Y</dt><dd>{bp(longSpread)}</dd></div>
        <div className={inverted ? 'negative' : ''}><dt>10Y − 3M</dt><dd>{bp(termSpread)}{inverted && <em>倒掛</em>}</dd></div>
      </dl>
    </header>
    {known.length >= 2 ? <svg viewBox="0 0 200 64" role="img" aria-label={known.map((point) => `${point.tenor} ${point.latest.toFixed(2)}%`).join('，')}>
      <path d={`${path} L${x(known.at(-1)!.id).toFixed(1)} 54 L${x(known[0].id).toFixed(1)} 54 Z`} className="wafu-curve-area" />
      <path d={path} className="wafu-curve-line" />
      {known.map((point) => <g key={point.id}>
        <circle cx={x(point.id)} cy={y(point.latest)} r={2.4} />
        <text x={x(point.id)} y={y(point.latest) - 5} textAnchor="middle">{point.latest.toFixed(2)}</text>
        <text x={x(point.id)} y={62} textAnchor="middle" className="tenor">{point.tenor}</text>
      </g>)}
    </svg> : <p className="wafu-curve-empty">{failed || points ? '暫時沒有殖利率資料' : '讀取殖利率…'}</p>}
  </article>;
}
