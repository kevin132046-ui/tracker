'use client';

import { useEffect, useState } from 'react';
import type { QuarterRow } from '@/lib/filings';

export type DigestSource = {
  symbol: string;
  name: string;
  cik: string;
  form: string;
  filed: string;
  url: string;
  /** Text of a saved AI analysis of this filing, if any. */
  analysis: string | null;
};

const figuresCache = new Map<string, Promise<QuarterRow[]>>();
const loadFigures = (cik: string) => {
  let pending = figuresCache.get(cik);
  if (!pending) {
    pending = fetch(`/api/filings/figures?cik=${encodeURIComponent(cik)}`)
      .then((response) => response.ok ? response.json() as Promise<{ figures?: QuarterRow[] }> : { figures: [] })
      .then((payload) => payload.figures ?? [])
      .catch(() => []);
    figuresCache.set(cik, pending);
  }
  return pending;
};

const money = (value: number) => {
  const abs = Math.abs(value);
  const text = abs >= 1e9 ? `$${(abs / 1e9).toFixed(abs >= 1e11 ? 0 : 1)}B` : abs >= 1e6 ? `$${(abs / 1e6).toFixed(0)}M` : `$${abs.toFixed(0)}`;
  return value < 0 ? `−${text}` : text;
};
// No percentage from a zero or negative base (a loss turning into a profit is not a percent change).
const change = (now: number | null | undefined, then: number | null | undefined) => now == null || then == null || then <= 0 ? null : now / then - 1;
const pct = (value: number | null) => value === null ? null : `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(0)}%`;
const pp = (value: number | null) => value === null ? null : `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(1)}pt`;
const quarterLabel = (end: string) => { const [y, m] = end.split('-').map(Number); return `${y} 年 ${m} 月底止季度`; };

/** Bullet points from a saved analysis (lines starting with -, •, * or a number), plain text. */
function points(text: string | null) {
  if (!text) return [];
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => /^([-•*]|\d+[.)、])\s+/.test(line))
    .map((line) => line.replace(/^([-•*]|\d+[.)、])\s+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * 財報解讀 (from the prototype): one company's latest results as tiles (revenue, diluted EPS, gross
 * margin with year-on-year and quarter-on-quarter change, from SEC XBRL), the key points of the saved
 * AI analysis if there is one, and a button to have the AI read the filing.
 */
export default function FilingDigest({ source, onAskAi }: { source: DigestSource; onAskAi: () => void }) {
  const [figures, setFigures] = useState<QuarterRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadFigures(source.cik).then((rows) => { if (alive) setFigures(rows); });
    return () => { alive = false; };
  }, [source.cik]);

  const rows = figures ?? [];
  const latest = rows.at(-1) ?? null;
  const previous = rows.at(-2) ?? null;
  const yearAgo = rows.length >= 5 ? rows.at(-5) ?? null : null;
  const tiles = latest ? [
    latest.revenue && { key: 'rev', label: '營收', value: money(latest.revenue.value), sub: [pct(change(latest.revenue.value, previous?.revenue?.value)) && `季 ${pct(change(latest.revenue.value, previous?.revenue?.value))}`, pct(change(latest.revenue.value, yearAgo?.revenue?.value)) && `年 ${pct(change(latest.revenue.value, yearAgo?.revenue?.value))}`].filter(Boolean).join(' | '), good: (change(latest.revenue.value, yearAgo?.revenue?.value) ?? 0) > 0 },
    latest.epsDiluted && { key: 'eps', label: 'EPS（稀釋）', value: `$${latest.epsDiluted.value.toFixed(2)}`, sub: pct(change(latest.epsDiluted.value, yearAgo?.epsDiluted?.value)) ? `年 ${pct(change(latest.epsDiluted.value, yearAgo?.epsDiluted?.value))}` : '', good: (change(latest.epsDiluted.value, yearAgo?.epsDiluted?.value) ?? 0) > 0 },
    latest.grossMargin !== null && { key: 'gm', label: '毛利率', value: `${(latest.grossMargin * 100).toFixed(1)}%`, sub: yearAgo?.grossMargin != null ? `較去年 ${pp(latest.grossMargin - yearAgo.grossMargin)}` : '', good: yearAgo?.grossMargin != null && latest.grossMargin >= yearAgo.grossMargin },
  ].filter((tile): tile is { key: string; label: string; value: string; sub: string; good: boolean } => Boolean(tile)) : [];
  const bullets = points(source.analysis);

  return <article className="ntc-ana">
    <header>
      <b>{source.name} {latest ? quarterLabel(latest.end) : ''} 財報解讀</b>
      <small>{source.filed} · <a href={source.url} target="_blank" rel="noopener noreferrer">SEC {source.form} ↗</a></small>
    </header>
    {figures === null ? <p className="ntc-loading">讀取 SEC 財報數字…</p>
      : tiles.length ? <div className="ntc-metrics">{tiles.map((tile) => <div key={tile.key} className={tile.good ? 'good' : ''}><span>{tile.label}</span><b>{tile.value}</b>{tile.sub && <small>{tile.sub}</small>}</div>)}</div>
        : <p className="ntc-loading">SEC 尚未提供這一季的結構化數字。</p>}
    {bullets.length > 0 && <ul className="ntc-points">{bullets.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    {!bullets.length && <p className="ntc-hint">還沒有 AI 解讀：按下方按鈕，AI 會讀取 8-K 新聞稿與 10-Q 整理重點與論述。</p>}
    <button type="button" className="ntc-ask" onClick={onAskAi}>✦ {source.analysis ? '查看 AI 解讀與追問' : '請 AI 深入解讀'}</button>
  </article>;
}
