// 績效引擎：示範用日報酬 → 各週期報酬、累積淨值、回撤與交易員常用指標
import { seeded } from "./wa";

export type Period = "day" | "week" | "month" | "year";
export type Key = "mine" | "spy" | "boxx";
export interface Bucket { key: string; label: string; mine: number; spy: number; boxx: number } // 單期報酬（小數）

const PER_YEAR: Record<Period, number> = { day: 252, week: 52, month: 12, year: 1 };
export const periodsPerYear = (p: Period) => PER_YEAR[p];

interface Daily { date: string; mine: number; spy: number; boxx: number }

let cache: Daily[] | null = null;

/** 產生 2022-01-03 起至最近交易日的示範日報酬（組合 β≈1.1、少量 α） */
export function dailySeries(now = new Date()): Daily[] {
  if (cache) return cache;
  const rnd = seeded(20260927);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out: Daily[] = [];
  const d = new Date(Date.UTC(2022, 0, 3));
  const end = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let regime = 0;
  while (d.getTime() <= end) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      if (rnd() < 0.01) regime = rnd() < 0.5 ? 1 : 0; // 偶爾進入高波動期
      const vol = regime ? 0.017 : 0.0095;
      const fat = rnd() < 0.03 ? 2.6 : 1;
      const spy = 0.00042 + gauss() * vol * fat;
      const mine = 0.00009 + 1.08 * spy + gauss() * 0.0066;
      const boxx = 0.046 / 252 + gauss() * 0.00006;
      out.push({ date: d.toISOString().slice(0, 10), mine, spy, boxx });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  cache = out;
  return out;
}

const weekKey = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
};

function compound(rows: Daily[], keyOf: (r: Daily) => string, labelOf: (k: string) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const k = keyOf(r);
    let b = map.get(k);
    if (!b) { b = { key: k, label: labelOf(k), mine: 0, spy: 0, boxx: 0 }; map.set(k, b); }
    b.mine = (1 + b.mine) * (1 + r.mine) - 1;
    b.spy = (1 + b.spy) * (1 + r.spy) - 1;
    b.boxx = (1 + b.boxx) * (1 + r.boxx) - 1;
  }
  return [...map.values()];
}

export function buckets(period: Period, now = new Date()): Bucket[] {
  const rows = dailySeries(now);
  if (period === "day") {
    return rows.slice(-60).map((r) => ({ key: r.date, label: `${+r.date.slice(5, 7)}/${+r.date.slice(8)}`, mine: r.mine, spy: r.spy, boxx: r.boxx }));
  }
  if (period === "week") return compound(rows, (r) => weekKey(r.date), (k) => `${+k.slice(5, 7)}/${+k.slice(8)}`).slice(-52);
  if (period === "month") return compound(rows, (r) => r.date.slice(0, 7), (k) => `${k.slice(2, 4)}/${k.slice(5)}`).slice(-36);
  return compound(rows, (r) => r.date.slice(0, 4), (k) => k);
}

/** 月報酬熱力圖：年 × 月 */
export function monthlyGrid(now = new Date()) {
  const months = compound(dailySeries(now), (r) => r.date.slice(0, 7), (k) => k);
  const years = [...new Set(months.map((m) => m.key.slice(0, 4)))];
  return years.map((y) => {
    const cells: (number | null)[] = Array.from({ length: 12 }, () => null);
    let total = 1, spy = 1;
    for (const m of months.filter((m) => m.key.startsWith(y))) {
      cells[+m.key.slice(5) - 1] = m.mine;
      total *= 1 + m.mine;
      spy *= 1 + m.spy;
    }
    return { year: y, cells, total: total - 1, spy: spy - 1 };
  });
}

export function cumulative(bs: Bucket[]) {
  const acc = { mine: 1, spy: 1, boxx: 1 };
  return bs.map((b) => {
    acc.mine *= 1 + b.mine; acc.spy *= 1 + b.spy; acc.boxx *= 1 + b.boxx;
    return { label: b.label, key: b.key, mine: acc.mine - 1, spy: acc.spy - 1, boxx: acc.boxx - 1 };
  });
}

export function drawdowns(bs: Bucket[]) {
  let wm = 1, ws = 1, pm = 1, ps = 1;
  return bs.map((b) => {
    wm *= 1 + b.mine; ws *= 1 + b.spy;
    pm = Math.max(pm, wm); ps = Math.max(ps, ws);
    return { label: b.label, key: b.key, mine: wm / pm - 1, spy: ws / ps - 1 };
  });
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1));
};

export interface Metrics {
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
}

/** 以單期報酬計算；rf 用 BOXX（近似短期國庫券） */
export function computeMetrics(bs: Bucket[], period: Period): Metrics {
  const f = PER_YEAR[period];
  const r = bs.map((b) => b.mine), s = bs.map((b) => b.spy), rf = bs.map((b) => b.boxx);
  const n = r.length;
  const ex = r.map((v, i) => v - rf[i]);
  const exS = s.map((v, i) => v - rf[i]);
  const cum = r.reduce((a, v) => a * (1 + v), 1) - 1;
  const cumSpy = s.reduce((a, v) => a * (1 + v), 1) - 1;
  const years = n / f;
  const cagr = years > 0 ? Math.pow(1 + cum, 1 / years) - 1 : 0;
  const cagrSpy = years > 0 ? Math.pow(1 + cumSpy, 1 / years) - 1 : 0;
  const vol = sd(r) * Math.sqrt(f), volSpy = sd(s) * Math.sqrt(f);
  const sharpe = sd(ex) ? (mean(ex) / sd(ex)) * Math.sqrt(f) : 0;
  const sharpeSpy = sd(exS) ? (mean(exS) / sd(exS)) * Math.sqrt(f) : 0;
  const dd = (a: number[]) => Math.sqrt(a.reduce((acc, v) => acc + Math.min(0, v) ** 2, 0) / Math.max(1, a.length));
  const sortino = dd(ex) ? (mean(ex) / dd(ex)) * Math.sqrt(f) : 0;
  const sortinoSpy = dd(exS) ? (mean(exS) / dd(exS)) * Math.sqrt(f) : 0;
  const d = drawdowns(bs);
  let mdd = 0, mddSpy = 0, mddAt = "";
  for (const p of d) { if (p.mine < mdd) { mdd = p.mine; mddAt = p.label; } mddSpy = Math.min(mddSpy, p.spy); }
  const calmar = mdd ? cagr / Math.abs(mdd) : 0;
  const ms = mean(s), mr = mean(r);
  const cov = r.reduce((a, v, i) => a + (v - mr) * (s[i] - ms), 0) / Math.max(1, n - 1);
  const varS = sd(s) ** 2;
  const beta = varS ? cov / varS : 0;
  const alpha = (mean(ex) - beta * mean(exS)) * f;
  const corr = sd(r) && sd(s) ? cov / (sd(r) * sd(s)) : 0;
  const act = r.map((v, i) => v - s[i]);
  const te = sd(act) * Math.sqrt(f);
  const ir = te ? (mean(act) * f) / te : 0;
  const upIdx = s.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const dnIdx = s.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0);
  const upCap = upIdx.length ? mean(upIdx.map((i) => r[i])) / mean(upIdx.map((i) => s[i])) : 0;
  const downCap = dnIdx.length ? mean(dnIdx.map((i) => r[i])) / mean(dnIdx.map((i) => s[i])) : 0;
  const wins = r.filter((v) => v > 0), losses = r.filter((v) => v < 0);
  const win = n ? wins.length / n : 0;
  const beat = n ? act.filter((v) => v > 0).length / n : 0;
  const payoff = losses.length && wins.length ? mean(wins) / Math.abs(mean(losses)) : 0;
  const sorted = [...r].sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(n * 0.05));
  const var95 = sorted[k - 1] ?? 0;
  const cvar95 = mean(sorted.slice(0, k));
  let bi = 0, wi = 0;
  r.forEach((v, i) => { if (v > r[bi]) bi = i; if (v < r[wi]) wi = i; });
  return {
    cum, cumSpy, cagr, cagrSpy, vol, volSpy, sharpe, sharpeSpy, sortino, sortinoSpy,
    mdd, mddSpy, mddAt, calmar, beta, alpha, corr, te, ir, upCap, downCap,
    win, beat, payoff, var95, cvar95,
    best: { label: bs[bi]?.label ?? "", v: r[bi] ?? 0 }, worst: { label: bs[wi]?.label ?? "", v: r[wi] ?? 0 }, n,
  };
}

// ——— 選擇權：Black-Scholes 希臘值 ———
const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function erf(x: number) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export function greeks(type: "PUT" | "CALL", S: number, K: number, days: number, iv: number, r = 0.043) {
  const T = Math.max(days, 0.5) / 365;
  const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);
  const delta = type === "CALL" ? N(d1) : N(d1) - 1;
  const gamma = npdf(d1) / (S * iv * Math.sqrt(T));
  const vega = (S * npdf(d1) * Math.sqrt(T)) / 100; // 每 1 個波動率點
  const thetaYr = type === "CALL"
    ? -(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * N(d2)
    : -(S * npdf(d1) * iv) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * N(-d2);
  const pItm = type === "CALL" ? N(d2) : N(-d2);
  return { delta, gamma, vega, theta: thetaYr / 365, pItm };
}
