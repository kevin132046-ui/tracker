'use client';

import { useState } from 'react';
import type { RangeMode } from '@/lib/performance';
import type { RiskMetrics, monthlyGrid } from '@/lib/wafu/metrics';

const fmtP = (v: number, dp = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(dp)}%`;
const fmtA = (v: number, dp = 1) => `${Math.abs(v * 100).toFixed(dp)}%`;
const fmtN = (v: number, dp = 2) => Number.isFinite(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}` : '—';

type Tone = 'good' | 'mid' | 'weak' | 'none';
type Cell = { key: string; label: string; value: string; sub?: string; tone: Tone; def: string };

/** 績效與風險指標: 8 core figures, 12 more on request (from the prototype). */
export function MetricsGrid({ m, mode }: { m: RiskMetrics; mode: RangeMode }) {
  const [more, setMore] = useState(false);
  const unit = { day: '日', week: '週', month: '月', year: '年' }[mode];
  const spy = (text: string) => m.hasSpy ? `SPY ${text}` : 'SPY —';
  const t3 = (v: number, good: number, mid: number): Tone => !Number.isFinite(v) ? 'none' : v >= good ? 'good' : v >= mid ? 'mid' : 'weak';
  const primary: Cell[] = [
    { key: 'cum', label: '累積報酬', value: fmtP(m.cum), sub: spy(fmtP(m.cumSpy)), tone: !m.hasSpy ? 'none' : m.cum >= m.cumSpy ? 'good' : 'weak', def: '期間內各期報酬複利相乘的總報酬' },
    { key: 'cagr', label: '年化報酬', value: fmtP(m.cagr), sub: spy(fmtP(m.cagrSpy)), tone: !m.hasSpy ? 'none' : m.cagr >= m.cagrSpy ? 'good' : 'mid', def: '把期間報酬換算成每年等值（CAGR）' },
    { key: 'vol', label: '年化波動', value: fmtA(m.vol), sub: spy(fmtA(m.volSpy)), tone: !m.hasSpy ? 'none' : m.vol <= m.volSpy * 1.15 ? 'mid' : 'weak', def: '單期報酬標準差 × √(每年期數)，越高代表淨值起伏越大' },
    { key: 'sharpe', label: 'Sharpe', value: fmtN(m.sharpe), sub: spy(fmtN(m.sharpeSpy)), tone: t3(m.sharpe, 1, 0.5), def: '(報酬 − 無風險利率) ÷ 波動；無風險利率以 BOXX 代替。1 以上算好' },
    { key: 'sortino', label: 'Sortino', value: fmtN(m.sortino), sub: spy(fmtN(m.sortinoSpy)), tone: t3(m.sortino, 1.4, 0.7), def: '只把下跌波動當成風險的 Sharpe' },
    { key: 'mdd', label: '最大回撤', value: fmtP(m.mdd), sub: `${m.mddAt || '—'} · ${spy(fmtP(m.mddSpy))}`, tone: t3(m.mdd, -0.1, -0.2), def: '淨值從歷史高點跌到低點的最大幅度' },
    { key: 'beta', label: 'Beta', value: m.hasSpy ? fmtN(m.beta) : '—', sub: '對 SPY', tone: 'none', def: '對大盤的敏感度：1.2 代表 SPY 漲跌 1%，組合平均漲跌 1.2%' },
    { key: 'alpha', label: 'Alpha（年化）', value: m.hasSpy ? fmtP(m.alpha) : '—', sub: 'Jensen α', tone: !m.hasSpy ? 'none' : m.alpha >= 0 ? 'good' : 'weak', def: '扣掉 Beta 帶來的報酬後，每年多賺或少賺的部分' },
  ];
  const extra: Cell[] = [
    { key: 'calmar', label: 'Calmar', value: fmtN(m.calmar), sub: '年化 ÷ |最大回撤|', tone: t3(m.calmar, 1, 0.5), def: '年化報酬 ÷ 最大回撤絕對值，衡量承擔回撤換來的報酬' },
    { key: 'corr', label: '相關係數', value: m.hasSpy ? fmtN(m.corr) : '—', sub: '−1 ~ 1', tone: 'none', def: '與 SPY 同步的程度，越接近 1 越像大盤' },
    { key: 'te', label: '追蹤誤差', value: m.hasSpy ? fmtA(m.te) : '—', sub: '年化', tone: 'none', def: '組合與 SPY 報酬差的年化波動' },
    { key: 'ir', label: '資訊比率', value: m.hasSpy ? fmtN(m.ir) : '—', sub: '超額 ÷ 追蹤誤差', tone: m.hasSpy ? t3(m.ir, 0.5, 0) : 'none', def: '年化超額報酬 ÷ 追蹤誤差，0.5 以上算穩定地贏大盤' },
    { key: 'up', label: '上行捕獲', value: m.hasSpy ? `${(m.upCap * 100).toFixed(0)}%` : '—', sub: 'SPY 上漲期間', tone: !m.hasSpy ? 'none' : m.upCap >= 1 ? 'good' : 'mid', def: 'SPY 上漲的期間，組合平均吃到 SPY 漲幅的比例' },
    { key: 'down', label: '下行捕獲', value: m.hasSpy ? `${(m.downCap * 100).toFixed(0)}%` : '—', sub: '越低越好', tone: !m.hasSpy ? 'none' : m.downCap <= 1 ? 'good' : 'weak', def: 'SPY 下跌的期間，組合平均承受 SPY 跌幅的比例' },
    { key: 'win', label: '勝率', value: `${(m.win * 100).toFixed(0)}%`, sub: m.hasSpy ? `勝 SPY ${(m.beat * 100).toFixed(0)}%` : undefined, tone: t3(m.win, 0.55, 0.45), def: `報酬為正的${unit}數占比；以及報酬高於 SPY 的${unit}數占比` },
    { key: 'payoff', label: '盈虧比', value: fmtN(m.payoff), sub: '平均賺 ÷ 平均賠', tone: t3(m.payoff, 1.2, 0.9), def: '獲利期平均報酬 ÷ 虧損期平均虧損' },
    { key: 'var', label: 'VaR 95%', value: fmtP(m.var95, 2), sub: `單${unit}`, tone: 'none', def: `歷史最差 5% 的${unit}報酬門檻` },
    { key: 'cvar', label: 'CVaR 95%', value: fmtP(m.cvar95, 2), sub: '尾端平均', tone: 'none', def: `最差 5% 的${unit}報酬平均（預期尾端損失）` },
    { key: 'best', label: `最佳${unit}`, value: fmtP(m.best.v), sub: m.best.label, tone: 'good', def: '期間內單期最高報酬' },
    { key: 'worst', label: `最差${unit}`, value: fmtP(m.worst.v), sub: m.worst.label, tone: 'weak', def: '期間內單期最低報酬' },
  ];
  const cells = more ? [...primary, ...extra] : primary;
  return <section className="wafu-kpis" aria-label="績效與風險指標">
    <div className="wafu-kpis-head">
      <h3>績效與風險指標</h3>
      <span>以 {m.n} 個{unit}報酬計算 · 無風險利率以 BOXX 代替{m.n < 8 ? ' · 期數少，僅供參考' : ''}</span>
      <button type="button" aria-expanded={more} onClick={() => setMore((value) => !value)}>{more ? '收合' : '更多指標 +12'}</button>
    </div>
    <div className="wafu-kpi-grid">
      {cells.map((cell) => <div key={cell.key} className={`wafu-kpi tone-${cell.tone}`} title={cell.def}>
        <span>{cell.label}</span>
        <strong>{cell.value}</strong>
        {cell.sub && <small>{cell.sub}</small>}
      </div>)}
    </div>
  </section>;
}

const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 月曆: year × month returns since the first trade. */
export function MonthlyHeatmap({ grid, loading }: { grid: ReturnType<typeof monthlyGrid>; loading?: boolean }) {
  if (!grid.length) return <p className="wafu-heat-empty">{loading ? '正在讀取歷史價格…' : '還沒有可計算的月份'}</p>;
  const maxAbs = Math.max(0.01, ...grid.flatMap((row) => row.cells.flatMap((cell) => cell === null ? [] : [Math.abs(cell)])));
  const shade = (value: number | null) => value === null ? undefined : { background: `color-mix(in srgb, ${value >= 0 ? 'var(--wa-up, #7fc8a0)' : 'var(--wa-down, #e0808a)'} ${Math.round(10 + (Math.abs(value) / maxAbs) * 62)}%, transparent)` };
  return <div className="wafu-heat-wrap">
    <table className="wafu-heat">
      <thead><tr><th />{monthNames.map((name) => <th key={name}>{name}</th>)}<th>全年</th></tr></thead>
      <tbody>{grid.map((row) => <tr key={row.year}>
        <th>{row.year}</th>
        {row.cells.map((cell, index) => <td key={index} style={shade(cell)} title={cell === null ? '' : `${row.year}/${index + 1}：${fmtP(cell, 2)}`}>{cell === null ? '' : (cell * 100).toFixed(1)}</td>)}
        <td className={`wafu-heat-total ${row.total >= 0 ? 'positive' : 'negative'}`}>{fmtP(row.total)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
