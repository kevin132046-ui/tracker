import type { DailyReturn, RangeMode } from '@/lib/performance';

/**
 * 績效與風險指標 (from the prototype): computed from the site's time-weighted period returns against
 * SPY, with BOXX standing in for the risk-free rate. Each input array is one return per period.
 */
export type PeriodReturns = { labels: string[]; mine: number[]; spy: number[]; boxx: number[] };

export type RiskMetrics = {
  cum: number; cumSpy: number;
  cagr: number; cagrSpy: number;
  vol: number; volSpy: number;
  sharpe: number; sharpeSpy: number;
  sortino: number; sortinoSpy: number;
  mdd: number; mddSpy: number; mddAt: string;
  calmar: number;
  beta: number; alpha: number; corr: number;
  te: number; ir: number;
  upCap: number; downCap: number;
  win: number; beat: number; payoff: number;
  var95: number; cvar95: number;
  best: { label: string; v: number }; worst: { label: string; v: number };
  n: number;
  hasSpy: boolean;
};

export const periodsPerYear: Record<RangeMode, number> = { day: 252, week: 52, month: 12, year: 1 };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const sd = (values: number[]) => {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length - 1));
};
const compound = (values: number[]) => values.reduce((growth, value) => growth * (1 + value), 1) - 1;

export function cumulativeOf(values: number[]) {
  let growth = 1;
  return values.map((value) => { growth *= 1 + value; return growth - 1; });
}

export function drawdownOf(values: number[]) {
  let wealth = 1, peak = 1;
  return values.map((value) => { wealth *= 1 + value; peak = Math.max(peak, wealth); return wealth / peak - 1; });
}

export function computeRiskMetrics({ labels, mine: r, spy: s, boxx: rf }: PeriodReturns, mode: RangeMode): RiskMetrics {
  const f = periodsPerYear[mode];
  const n = r.length;
  const hasSpy = s.some((value) => value !== 0);
  const ex = r.map((value, index) => value - (rf[index] ?? 0));
  const exS = s.map((value, index) => value - (rf[index] ?? 0));
  const cum = compound(r), cumSpy = compound(s);
  const years = n / f;
  const annual = (total: number) => years > 0 && 1 + total > 0 ? Math.pow(1 + total, 1 / years) - 1 : 0;
  const downside = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / Math.max(1, values.length));
  // NaN when a figure is undefined (no downside, no drawdown, no losing period); the grid shows —.
  const ratio = (values: number[], risk: number) => risk ? (mean(values) / risk) * Math.sqrt(f) : NaN;
  const dd = drawdownOf(r), ddS = drawdownOf(s);
  let mdd = 0, mddAt = '';
  dd.forEach((value, index) => { if (value < mdd) { mdd = value; mddAt = labels[index] ?? ''; } });
  const mddSpy = Math.min(0, ...ddS);
  const cagr = annual(cum);
  const mr = mean(r), ms = mean(s);
  const cov = r.reduce((sum, value, index) => sum + (value - mr) * ((s[index] ?? 0) - ms), 0) / Math.max(1, n - 1);
  const varS = sd(s) ** 2;
  const beta = varS ? cov / varS : 0;
  const active = r.map((value, index) => value - (s[index] ?? 0));
  const te = sd(active) * Math.sqrt(f);
  const up = s.flatMap((value, index) => value > 0 ? [index] : []);
  const down = s.flatMap((value, index) => value < 0 ? [index] : []);
  const capture = (indices: number[]) => indices.length ? mean(indices.map((index) => r[index])) / (mean(indices.map((index) => s[index])) || 1) : 0;
  const wins = r.filter((value) => value > 0), losses = r.filter((value) => value < 0);
  const sorted = [...r].sort((a, b) => a - b);
  const tail = Math.max(1, Math.floor(n * 0.05));
  let bi = 0, wi = 0;
  r.forEach((value, index) => { if (value > r[bi]) bi = index; if (value < r[wi]) wi = index; });
  return {
    cum, cumSpy, cagr, cagrSpy: annual(cumSpy),
    vol: sd(r) * Math.sqrt(f), volSpy: sd(s) * Math.sqrt(f),
    sharpe: ratio(ex, sd(ex)), sharpeSpy: ratio(exS, sd(exS)),
    sortino: ratio(ex, downside(ex)), sortinoSpy: ratio(exS, downside(exS)),
    mdd, mddSpy, mddAt,
    calmar: mdd ? cagr / Math.abs(mdd) : NaN,
    beta, alpha: (mean(ex) - beta * mean(exS)) * f,
    corr: sd(r) && sd(s) ? cov / (sd(r) * sd(s)) : 0,
    te, ir: te ? (mean(active) * f) / te : 0,
    upCap: capture(up), downCap: capture(down),
    win: n ? wins.length / n : 0,
    beat: n ? active.filter((value) => value > 0).length / n : 0,
    payoff: losses.length && wins.length ? mean(wins) / Math.abs(mean(losses)) : NaN,
    var95: sorted[tail - 1] ?? 0,
    cvar95: mean(sorted.slice(0, tail)),
    best: { label: labels[bi] ?? '', v: r[bi] ?? 0 },
    worst: { label: labels[wi] ?? '', v: r[wi] ?? 0 },
    n, hasSpy,
  };
}

/** 月曆 heatmap: every month since the first trade, compounded from the daily time-weighted returns. */
export function monthlyGrid(days: ReadonlyArray<DailyReturn>) {
  const months = new Map<string, { growth: number; active: boolean }>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) ?? { growth: 1, active: false };
    month.growth *= 1 + day.value;
    month.active ||= day.capital > 0;
    months.set(key, month);
  }
  const years = [...new Set([...months.keys()].map((key) => key.slice(0, 4)))].sort();
  return years.map((year) => {
    const cells: Array<number | null> = Array.from({ length: 12 }, () => null);
    let total = 1;
    for (let month = 0; month < 12; month += 1) {
      const entry = months.get(`${year}-${String(month + 1).padStart(2, '0')}`);
      if (!entry?.active) continue;
      cells[month] = entry.growth - 1;
      total *= entry.growth;
    }
    return { year, cells, total: total - 1 };
  }).filter((row) => row.cells.some((cell) => cell !== null));
}
