// 個股研究（技術走勢／財務品質／DCF）用的純函式與示範資料。
// - 行情：固定種子的幾何隨機漫步日 K（約 420 個交易日），最後一根收盤＝持倉現價；
//   最近 22 個交易日另有合成的 5 分 K（美東時間），並彙總成 30 分 K。
// - 指標：SMA、布林通道（20, 2σ 母體）、RSI（Wilder 14）、MACD（12/26/9）——算法與正式站相同，
//   先以完整序列計算、再截取顯示期間，所以 MA200 在短期間也有效。
// - 財務：MSFT 為依公開財報整理的示意值（2026/9/27），其餘標的為依價格縮放的示意值。
// - DCF：calculateDcf 與正式站完全相同。

export type RLang = "zh" | "ja";
export type Currency = "USD" | "JPY";

export const MINUS = "−";
export const DAY = 86_400_000;
const B = 1e9;

export const tr = (lang: RLang, zh: string, ja: string) => (lang === "ja" ? ja : zh);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, dp: number) => {
  const k = 10 ** dp;
  return Math.round(v * k) / k;
};

// ———————————————————— 亂數 ————————————————————

export function hashString(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：可重現的 [0, 1) 亂數 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// ———————————————————— 格式化 ————————————————————

export const currencyOf = (ticker: string): Currency => (/\.T$/i.test(ticker) ? "JPY" : "USD");
const sym = (cur: Currency) => (cur === "JPY" ? "¥" : "$");

function grouped(v: number, dp: number) {
  return Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** 價格：$516.17、¥3,450 */
export function fmtPrice(v: number, cur: Currency = "USD", dp?: number) {
  if (!Number.isFinite(v)) return "—";
  const d = dp ?? (cur === "JPY" ? 0 : 2);
  return `${v < 0 ? MINUS : ""}${sym(cur)}${grouped(v, d)}`;
}

export function fmtSignedPrice(v: number, cur: Currency = "USD", dp?: number) {
  if (!Number.isFinite(v)) return "—";
  const d = dp ?? (cur === "JPY" ? 0 : 2);
  const zero = Math.abs(v) < 0.5 * 10 ** -d;
  return `${zero ? "" : v > 0 ? "+" : MINUS}${sym(cur)}${grouped(v, d)}`;
}

/** 比率 → 百分比（0.1075 → 10.75%），負號用 U+2212，正值不加號（與正式站一致） */
export function fmtPct(v: number | null | undefined, dp = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v < 0 ? MINUS : ""}${Math.abs(v * 100).toFixed(dp)}%`;
}

export function fmtSignedPct(v: number | null | undefined, dp = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const zero = Math.abs(v * 100) < 0.5 * 10 ** -dp;
  return `${zero ? "" : v > 0 ? "+" : MINUS}${Math.abs(v * 100).toFixed(dp)}%`;
}

export function fmtMultiple(v: number | null | undefined) {
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}×`;
}

export function fmtNum(v: number | null | undefined, dp = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v < 0 ? MINUS : ""}${grouped(v, dp)}`;
}

const UNITS: Record<Currency, [string, number][]> = {
  USD: [["T", 1e12], ["B", 1e9], ["M", 1e6]],
  JPY: [["兆", 1e12], ["億", 1e8]],
};

/** 金額縮寫：$3.72T、$66.99B（與正式站相同：≥100 用一位小數） */
export function fmtAmount(v: number | null | undefined, cur: Currency = "USD", dp?: number) {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const unit = UNITS[cur].find(([, d]) => abs >= d);
  const sign = v < 0 ? MINUS : "";
  if (!unit) return `${sign}${sym(cur)}${grouped(abs, 0)}`;
  const q = abs / unit[1];
  return `${sign}${sym(cur)}${q.toFixed(dp ?? (q >= 100 ? 1 : 2))}${unit[0]}`;
}

/** 圖表刻度用：盡量短（$20B、$2.5B） */
export function fmtAmountTick(v: number, cur: Currency = "USD") {
  if (v === 0) return `${sym(cur)}0`;
  const abs = Math.abs(v);
  const unit = UNITS[cur].find(([, d]) => abs >= d) ?? UNITS[cur][UNITS[cur].length - 1];
  const q = abs / unit[1];
  const s = q >= 10 || Number.isInteger(q) ? q.toFixed(0) : q.toFixed(1);
  return `${v < 0 ? MINUS : ""}${sym(cur)}${s}${unit[0]}`;
}

/** 漂亮刻度步長：在 1、2、2.5、5、10 × 10ⁿ 中挑刻度數最接近 count 的 */
export function niceStep(span: number, count = 4) {
  const s = Math.max(span, 1e-9);
  const mag = 10 ** Math.floor(Math.log10(s / count));
  let best = mag;
  let err = Infinity;
  for (const c of [1, 2, 2.5, 5, 10, 20]) {
    const step = c * mag;
    const e = Math.abs(s / step - count);
    if (e < err - 1e-9) { best = step; err = e; }
  }
  return best;
}

/** 在 [lo, hi] 內的刻度 */
export function ticksWithin(lo: number, hi: number, count = 4) {
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return { ticks: out, step };
}

// ———————————————————— 日期（以 UTC 午夜毫秒代表交易日） ————————————————————

const WEEK_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
export const OPEN_MIN = 570; // 9:30 ET
export const CLOSE_MIN = 960; // 16:00 ET

const isWeekend = (day: number) => {
  const w = new Date(day).getUTCDay();
  return w === 0 || w === 6;
};

export function isoOf(day: number) {
  return new Date(day).toISOString().slice(0, 10);
}

export function parseIso(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

export function mdOf(day: number) {
  const d = new Date(day);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function ymdOf(day: number) {
  const d = new Date(day);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function dateWithWeek(day: number, lang: RLang) {
  const w = new Date(day).getUTCDay();
  return `${ymdOf(day)}（${(lang === "ja" ? WEEK_JA : WEEK_ZH)[w]}）`;
}

export function hhmm(min: number) {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

interface EtParts { y: number; m: number; d: number; h: number; min: number; wd: number }

function etParts(now: Date): EtParts {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "0";
    return {
      y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour") % 24, min: +get("minute"),
      wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    };
  } catch {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), min: now.getMinutes(), wd: now.getDay() };
  }
}

/** 最近一個已開盤的交易日；盤中則回傳目前分鐘（部分交易時段） */
export function sessionAnchor(now = new Date()) {
  const p = etParts(now);
  let day = Date.UTC(p.y, p.m - 1, p.d);
  const minutes = p.h * 60 + p.min;
  if (p.wd >= 1 && p.wd <= 5 && minutes >= OPEN_MIN) {
    return { day, partial: minutes < CLOSE_MIN ? minutes : null };
  }
  do day -= DAY; while (isWeekend(day));
  return { day, partial: null as number | null };
}

// ———————————————————— 行情與技術指標 ————————————————————

/** min = −1 表示日 K；否則為美東時間當日分鐘數（K 棒起點） */
export interface Bar { day: number; min: number; o: number; h: number; l: number; c: number }

export type Series = (number | null)[];

export interface TechPoint extends Bar {
  ma20: number | null; ma50: number | null; ma200: number | null;
  bu: number | null; bm: number | null; bl: number | null;
  rsi: number | null; macd: number | null; sig: number | null; hist: number | null;
}

export function sma(values: number[], period: number): Series {
  const out: Series = new Array<number | null>(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA：以前 period 筆的 SMA 作為起點（與正式站相同） */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array<number | null>(values.length).fill(null);
  if (values.length < period) return out;
  const a = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * a + prev * (1 - a);
    out[i] = prev;
  }
  return out;
}

/** 布林通道：SMA ± k × 母體標準差 */
export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const up: Series = new Array<number | null>(values.length).fill(null);
  const lo: Series = new Array<number | null>(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - m) ** 2;
    const dev = Math.sqrt(sq / period) * mult;
    up[i] = m + dev;
    lo[i] = m - dev;
  }
  return { mid, up, lo };
}

/** RSI（Wilder 平滑） */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array<number | null>(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    gain += Math.max(0, ch);
    loss += Math.max(0, -ch);
  }
  let ag = gain / period;
  let al = loss / period;
  const calc = () => (ag === 0 && al === 0 ? 50 : al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out[period] = calc();
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(0, ch)) / period;
    al = (al * (period - 1) + Math.max(0, -ch)) / period;
    out[i] = calc();
  }
  return out;
}

/** MACD(12, 26, 9)：訊號線以有效 MACD 值計算 EMA 9 */
export function macd(values: number[]) {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const line: Series = values.map((_, i) => {
    const a = e12[i];
    const b = e26[i];
    return a != null && b != null ? a - b : null;
  });
  const compact = line.filter((v): v is number => v != null);
  const sigCompact = ema(compact, 9);
  let k = 0;
  const signal: Series = line.map((v) => (v == null ? null : sigCompact[k++] ?? null));
  const hist: Series = line.map((v, i) => {
    const s = signal[i];
    return v != null && s != null ? v - s : null;
  });
  return { line, signal, hist };
}

export function enrich(bars: Bar[]): TechPoint[] {
  const closes = bars.map((b) => b.c);
  const m20 = sma(closes, 20);
  const m50 = sma(closes, 50);
  const m200 = sma(closes, 200);
  const bb = bollinger(closes, 20, 2);
  const r = rsi(closes, 14);
  const m = macd(closes);
  return bars.map((b, i) => ({
    ...b,
    ma20: m20[i], ma50: m50[i], ma200: m200[i],
    bu: bb.up[i], bm: bb.mid[i], bl: bb.lo[i],
    rsi: r[i], macd: m.line[i], sig: m.signal[i], hist: m.hist[i],
  }));
}

// 1 年期間約 262 根＋MA200 需 199 根暖機 → 取 465 個交易日，讓 1 年圖的 MA200 從第一根就有值
const DAILY_N = 465;
const INTRADAY_SESSIONS = 22;
const STEP_MIN = 5;

// 常見標的的約略年化波動度，讓示意走勢的振幅合理；其餘標的依種子取 18%–36%
const ANNUAL_VOL: Record<string, number> = {
  MSFT: 0.22, AAPL: 0.24, GOOGL: 0.27, GOOG: 0.27, AMZN: 0.3, META: 0.34, NVDA: 0.46, AVGO: 0.4, AMD: 0.48, TSLA: 0.55,
  SPGI: 0.2, TRV: 0.19, V: 0.18, MA: 0.19, JPM: 0.22, TTWO: 0.28, PFE: 0.22, CNC: 0.34, KO: 0.14,
  DIS: 0.28, COST: 0.2, JNJ: 0.16, KHC: 0.22, INTC: 0.45, MRK: 0.22, UBER: 0.38,
};

function genDaily(seed: number, endDay: number, price: number, annualVol?: number) {
  const r = rng(seed);
  const annVol = annualVol ?? 0.18 + r() * 0.18;
  if (annualVol != null) r();
  const sd = annVol / Math.sqrt(252);
  const mu = (-0.02 + r() * 0.22) / 252;
  const earnPhase = Math.floor(r() * 63);
  const days: number[] = [];
  for (let d = endDay; days.length < DAILY_N; d -= DAY) if (!isWeekend(d)) days.push(d);
  days.reverse();
  const bars: Bar[] = [];
  let c = 100;
  let trend = 0;
  let vol = 1;
  for (let k = 0; k < DAILY_N; k++) {
    trend = trend * 0.97 + gauss(r) * sd * 0.012; // 緩慢變化的趨勢
    vol = clamp(vol * 0.94 + 0.06 * (0.45 + Math.abs(gauss(r)) * 0.7), 0.55, 2.2); // 波動聚集
    const s = sd * vol;
    let gap = gauss(r) * s * 0.28;
    if (k % 63 === earnPhase) gap += gauss(r) * s * 2.6; // 財報跳空
    const o = c * Math.exp(gap);
    c = o * Math.exp(mu + trend + gauss(r) * s * 0.95);
    const h = Math.max(o, c) * Math.exp(Math.abs(gauss(r)) * s * 0.42);
    const l = Math.min(o, c) * Math.exp(-Math.abs(gauss(r)) * s * 0.42);
    bars.push({ day: days[k], min: -1, o, h, l, c });
  }
  const k = price / c;
  for (const b of bars) {
    b.o *= k; b.h *= k; b.l *= k; b.c *= k;
  }
  const last = bars[bars.length - 1];
  last.c = price;
  last.h = Math.max(last.h, last.o, price);
  last.l = Math.min(last.l, last.o, price);
  return { bars, sd };
}

/** 以布朗橋在每日開盤→收盤之間產生 5 分 K，並回寫日 K 的高低點，確保兩者一致 */
function genIntraday(seed: number, daily: Bar[], sd: number, partial: number | null) {
  const r = rng(seed ^ 0x5bd1e995);
  const out: Bar[] = [];
  const n = daily.length;
  const s = sd / Math.sqrt(78);
  for (let j = Math.max(0, n - INTRADAY_SESSIONS); j < n; j++) {
    const D = daily[j];
    const endMin = j === n - 1 && partial != null ? partial : CLOSE_MIN;
    const count = Math.max(1, Math.ceil((endMin - OPEN_MIN) / STEP_MIN));
    const w: number[] = [0];
    for (let k = 0; k < count; k++) {
      const u = 1.35 - 0.75 * Math.sin((Math.PI * (k + 0.5)) / 78); // U 形：開收盤波動較大
      w.push(w[k] + gauss(r) * s * u);
    }
    const x0 = Math.log(D.o);
    const x1 = Math.log(D.c);
    const xs = w.map((wk, k) => x0 + (k / count) * (x1 - x0) + wk - (k / count) * w[count]);
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = 0; k < count; k++) {
      const o = k === 0 ? D.o : Math.exp(xs[k]);
      const c = k === count - 1 ? D.c : Math.exp(xs[k + 1]);
      const h = Math.max(o, c) * Math.exp(Math.abs(gauss(r)) * s * 0.35);
      const l = Math.min(o, c) * Math.exp(-Math.abs(gauss(r)) * s * 0.35);
      hi = Math.max(hi, h);
      lo = Math.min(lo, l);
      out.push({ day: D.day, min: OPEN_MIN + k * STEP_MIN, o, h, l, c });
    }
    D.h = hi;
    D.l = lo;
  }
  return out;
}

function aggregate(bars: Bar[], minutes: number) {
  const out: Bar[] = [];
  for (const b of bars) {
    const bucket = OPEN_MIN + Math.floor((b.min - OPEN_MIN) / minutes) * minutes;
    const last = out[out.length - 1];
    if (last && last.day === b.day && last.min === bucket) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
    } else out.push({ day: b.day, min: bucket, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  return out;
}

export interface TechDataset {
  daily: TechPoint[]; m5: TechPoint[]; m30: TechPoint[];
  firstDay: number; lastDay: number; intradayFrom: number; partial: boolean;
}

export function buildDataset(ticker: string, price: number, now = new Date()): TechDataset {
  const T = ticker.toUpperCase();
  const seed = hashString(T);
  const anchor = sessionAnchor(now);
  const { bars, sd } = genDaily(seed, anchor.day, price > 0 ? price : 100, ANNUAL_VOL[T]);
  const m5 = genIntraday(seed, bars, sd, anchor.partial);
  return {
    daily: enrich(bars),
    m5: enrich(m5),
    m30: enrich(aggregate(m5, 30)),
    firstDay: bars[0].day,
    lastDay: bars[bars.length - 1].day,
    intradayFrom: m5[0]?.day ?? anchor.day,
    partial: anchor.partial != null,
  };
}

export type TechRange = "1d" | "1w" | "1mo" | "3mo" | "6mo" | "1y" | "custom";
export type Interval = "5m" | "30m" | "1d";

export interface RangeView {
  interval: Interval; points: TechPoint[];
  latest: number; prevClose: number; change: number; changePct: number;
  high: number; low: number;
}

const RANGE_DAYS: Record<"1mo" | "3mo" | "6mo" | "1y", number> = { "1mo": 31, "3mo": 92, "6mo": 184, "1y": 366 };

/** 依期間截取；1 日＝最近交易日 5 分 K、1 週＝近 7 天 30 分 K、其餘＝日 K（自訂期間依長度自動選擇） */
export function selectRange(ds: TechDataset, range: TechRange, from: string, to: string): RangeView | null {
  let interval: Interval = "1d";
  let points: TechPoint[];
  if (range === "1d") {
    interval = "5m";
    points = ds.m5.filter((p) => p.day === ds.lastDay);
  } else if (range === "1w") {
    interval = "30m";
    const start = ds.lastDay - 6 * DAY;
    points = ds.m30.filter((p) => p.day >= start);
  } else if (range === "custom") {
    const f = parseIso(from);
    const t = parseIso(to);
    if (f == null || t == null || t < f) return null;
    const span = (t - f) / DAY + 1;
    const within = (p: TechPoint) => p.day >= f && p.day <= t;
    if (span <= 2 && f >= ds.intradayFrom) {
      interval = "5m";
      points = ds.m5.filter(within);
    } else if (span <= 14 && f >= ds.intradayFrom) {
      interval = "30m";
      points = ds.m30.filter(within);
    } else points = ds.daily.filter(within);
  } else {
    const start = ds.lastDay - (RANGE_DAYS[range] - 1) * DAY;
    points = ds.daily.filter((p) => p.day >= start);
  }
  if (!points.length) return null;
  const last = points[points.length - 1];
  const dailyBefore = ds.daily.findLast((p) => p.day < last.day);
  const prevClose = interval === "1d"
    ? points.length > 1 ? points[points.length - 2].c : dailyBefore?.c ?? last.o
    : dailyBefore?.c ?? points[0].o;
  let high = -Infinity;
  let low = Infinity;
  for (const p of points) {
    high = Math.max(high, p.h);
    low = Math.min(low, p.l);
  }
  return {
    interval, points, latest: last.c, prevClose,
    change: last.c - prevClose, changePct: prevClose ? last.c / prevClose - 1 : 0,
    high, low,
  };
}

export function intervalLabel(iv: Interval, lang: RLang) {
  if (iv === "5m") return tr(lang, "5 分鐘線", "5分足");
  if (iv === "30m") return tr(lang, "30 分鐘線", "30分足");
  return tr(lang, "日線", "日足");
}

// ———————————————————— 財務資料 ————————————————————

export type HistKey =
  | "freeCashFlow" | "adjustedFreeCashFlow" | "sbcImpact" | "revenue" | "netIncome"
  | "profitMargin" | "operatingMargin" | "cash" | "debt" | "netCash";
export type HistPeriod = "q" | "y";
export interface HistPoint { label: string; value: number }
export type HistSeries = Record<HistKey, HistPoint[]>;

export interface HistMeta { zh: string; ja: string; capZh: string; capJa: string; format: "amount" | "percent"; chart: "bar" | "line" }

export const HIST_META: Record<HistKey, HistMeta> = {
  freeCashFlow: { zh: "自由現金流", ja: "フリーキャッシュフロー", capZh: "營運現金流扣除資本支出", capJa: "営業CFから設備投資を差し引いた額", format: "amount", chart: "bar" },
  adjustedFreeCashFlow: { zh: "SBC 調整後自由現金流", ja: "SBC 控除後 FCF", capZh: "自由現金流扣除股票薪酬", capJa: "FCF から株式報酬を差し引いた額", format: "amount", chart: "bar" },
  sbcImpact: { zh: "SBC 對 FCF 影響", ja: "SBC の FCF への影響", capZh: "股票薪酬占自由現金流比重", capJa: "株式報酬が FCF に占める割合", format: "percent", chart: "line" },
  revenue: { zh: "營收", ja: "売上高", capZh: "公司銷售收入（季營收 YoY 的基礎）", capJa: "売上高（四半期売上 YoY の元データ）", format: "amount", chart: "bar" },
  netIncome: { zh: "淨利", ja: "純利益", capZh: "稅後損益（季獲利 YoY 的基礎）", capJa: "税引後利益（四半期純利益 YoY の元データ）", format: "amount", chart: "bar" },
  profitMargin: { zh: "淨利率", ja: "純利益率", capZh: "淨利占營收比重", capJa: "売上高に対する純利益の割合", format: "percent", chart: "line" },
  operatingMargin: { zh: "營業利益率", ja: "営業利益率", capZh: "營業利益占營收比重", capJa: "売上高に対する営業利益の割合", format: "percent", chart: "line" },
  cash: { zh: "現金與短期投資", ja: "現金・短期投資", capZh: "期末流動性部位", capJa: "期末の手元流動性", format: "amount", chart: "bar" },
  debt: { zh: "總負債", ja: "有利子負債", capZh: "期末有息負債", capJa: "期末の有利子負債", format: "amount", chart: "bar" },
  netCash: { zh: "淨現金／（淨負債）", ja: "ネットキャッシュ／（純負債）", capZh: "現金與短期投資扣除總負債", capJa: "現金・短期投資から有利子負債を差し引いた額", format: "amount", chart: "bar" },
};

export interface Fundamentals {
  ticker: string; currency: Currency; exchange: string; asOf: string; source: "site" | "demo";
  marketCap: number | null; peTtm: number | null; peFwd: number | null; ps: number | null; evEbitda: number | null; pb: number | null;
  fcfQuarter: number | null; fcfTtm: number | null; fcfYield: number | null;
  sbcAdjFcf: number | null; sbcAdjYield: number | null; sbcImpact: number | null;
  profitMargin: number | null; operatingMargin: number | null; earningsYoY: number | null; revenueYoY: number | null;
  cash: number | null; debt: number | null; netCash: number | null;
  divYield: number | null; payout: number | null; exDate: string | null; dividend: number | null;
  dilutedShares: number | null;
  history: Record<HistPeriod, HistSeries>;
}

interface RawHistory { fcf: number[]; sbc: number[]; rev: number[]; ni: number[]; oi: number[]; cash: number[]; debt: number[] }

function toSeries(labels: string[], h: RawHistory): HistSeries {
  const map = (fn: (i: number) => number) => labels.map((label, i) => ({ label, value: fn(i) }));
  return {
    freeCashFlow: map((i) => h.fcf[i]),
    adjustedFreeCashFlow: map((i) => h.fcf[i] - h.sbc[i]),
    sbcImpact: map((i) => (h.fcf[i] > 0 ? -h.sbc[i] / h.fcf[i] : 0)),
    revenue: map((i) => h.rev[i]),
    netIncome: map((i) => h.ni[i]),
    profitMargin: map((i) => h.ni[i] / h.rev[i]),
    operatingMargin: map((i) => h.oi[i] / h.rev[i]),
    cash: map((i) => h.cash[i]),
    debt: map((i) => h.debt[i]),
    netCash: map((i) => h.cash[i] - h.debt[i]),
  };
}

const scaleB = (xs: number[]) => xs.map((x) => x * B);

// MSFT：依公開財報整理的示意值（2026/9/27）；FCF 季度歷史取自財報，其餘歷史序列為與這些數字一致的示意值。
const MSFT_Q: RawHistory = {
  fcf: scaleB([26.5, 26.6, 5.9, 15.8, 19.64]),
  sbc: scaleB([3.11, 2.96, 3.04, 3.18, 3.23]),
  rev: scaleB([76.44, 77.67, 81.27, 82.89, 84.66]),
  ni: scaleB([27.23, 27.75, 44.82, 33.72, 25.3239]),
  oi: scaleB([34.32, 37.96, 38.28, 37.4, 39.09]),
  cash: scaleB([94.56, 102.01, 89.46, 80.02, 76.65]),
  debt: scaleB([60.59, 60.25, 58.4, 57.66, 56.83]),
};
const MSFT_Y: RawHistory = {
  fcf: scaleB([59.48, 74.07, 71.61, 66.99]),
  sbc: scaleB([9.61, 10.73, 11.97, 12.41]),
  rev: scaleB([211.92, 245.12, 281.72, 326.49]),
  ni: scaleB([72.36, 88.14, 101.83, 131.61]),
  oi: scaleB([88.52, 109.43, 128.53, 152.73]),
  cash: scaleB([111.26, 75.54, 94.56, 76.65]),
  debt: scaleB([79.44, 67.13, 60.59, 56.83]),
};

const MSFT: Omit<Fundamentals, "history"> = {
  ticker: "MSFT", currency: "USD", exchange: "NASDAQ", asOf: "2026-09-27", source: "site",
  marketCap: 3.72e12, peTtm: 27.74, peFwd: 25.13, ps: 11.18, evEbitda: 17.72, pb: 8.36,
  fcfQuarter: 19.64 * B, fcfTtm: 66.99 * B, fcfYield: 0.018,
  sbcAdjFcf: 54.58 * B, sbcAdjYield: 0.0147, sbcImpact: -0.1852,
  profitMargin: 0.4031, operatingMargin: 0.4678, earningsYoY: -0.07, revenueYoY: 0.1075,
  cash: 76.65 * B, debt: 56.83 * B, netCash: 19.82 * B,
  divYield: 0.0071, payout: 0.1977, exDate: "2026-08-20", dividend: 0.91,
  dilutedShares: 7.43 * B,
};

type ProfileKey = "tech" | "fin" | "media" | "staples" | "health" | "general";
type Rng2 = [number, number];
interface Profile {
  pe: Rng2; margin: Rng2; opx: Rng2; fcfConv: Rng2; sbc: Rng2; pb: Rng2; div: Rng2;
  revYoY: Rng2; epsYoY: Rng2; cashRev: Rng2; debtRev: Rng2; growth: Rng2;
}

const PROFILES: Record<ProfileKey, Profile> = {
  tech: { pe: [28, 46], margin: [0.24, 0.5], opx: [1.1, 1.28], fcfConv: [0.85, 1.15], sbc: [0.08, 0.2], pb: [8, 28], div: [0, 0.007], revYoY: [0.06, 0.42], epsYoY: [0.04, 0.55], cashRev: [0.22, 0.5], debtRev: [0.04, 0.18], growth: [0.08, 0.3] },
  fin: { pe: [14, 30], margin: [0.2, 0.48], opx: [1.15, 1.32], fcfConv: [0.85, 1.15], sbc: [0.03, 0.08], pb: [1.8, 14], div: [0.006, 0.02], revYoY: [0.03, 0.12], epsYoY: [-0.04, 0.2], cashRev: [0.1, 0.35], debtRev: [0.3, 0.9], growth: [0.04, 0.12] },
  media: { pe: [26, 55], margin: [0.05, 0.16], opx: [1.2, 1.55], fcfConv: [0.7, 1.25], sbc: [0.14, 0.32], pb: [2.2, 6], div: [0, 0], revYoY: [0.02, 0.18], epsYoY: [-0.25, 0.4], cashRev: [0.2, 0.5], debtRev: [0.2, 0.6], growth: [0.03, 0.15] },
  staples: { pe: [18, 27], margin: [0.12, 0.24], opx: [1.2, 1.4], fcfConv: [0.8, 1.05], sbc: [0.02, 0.05], pb: [5, 12], div: [0.024, 0.034], revYoY: [0, 0.06], epsYoY: [-0.04, 0.1], cashRev: [0.05, 0.2], debtRev: [0.3, 0.9], growth: [0.02, 0.06] },
  health: { pe: [10, 22], margin: [0.08, 0.24], opx: [1.2, 1.45], fcfConv: [0.85, 1.25], sbc: [0.03, 0.08], pb: [1.6, 5], div: [0.02, 0.065], revYoY: [-0.05, 0.08], epsYoY: [-0.18, 0.15], cashRev: [0.1, 0.3], debtRev: [0.4, 1.0], growth: [0, 0.06] },
  general: { pe: [15, 32], margin: [0.08, 0.24], opx: [1.15, 1.4], fcfConv: [0.8, 1.15], sbc: [0.03, 0.12], pb: [2, 8], div: [0, 0.024], revYoY: [0, 0.14], epsYoY: [-0.1, 0.25], cashRev: [0.08, 0.3], debtRev: [0.2, 0.7], growth: [0.03, 0.1] },
};

// 常見標的的約略股數（十億股）與類型，讓示意市值更合理
const KNOWN: Record<string, { shares: number; profile: ProfileKey; exchange: string }> = {
  NVDA: { shares: 24.4, profile: "tech", exchange: "NASDAQ" },
  AAPL: { shares: 14.9, profile: "tech", exchange: "NASDAQ" },
  GOOGL: { shares: 12.2, profile: "tech", exchange: "NASDAQ" },
  GOOG: { shares: 12.2, profile: "tech", exchange: "NASDAQ" },
  AMZN: { shares: 10.7, profile: "tech", exchange: "NASDAQ" },
  META: { shares: 2.52, profile: "tech", exchange: "NASDAQ" },
  AVGO: { shares: 4.75, profile: "tech", exchange: "NASDAQ" },
  AMD: { shares: 1.63, profile: "tech", exchange: "NASDAQ" },
  TSLA: { shares: 3.22, profile: "tech", exchange: "NASDAQ" },
  SPGI: { shares: 0.305, profile: "fin", exchange: "NYSE" },
  TRV: { shares: 0.226, profile: "fin", exchange: "NYSE" },
  V: { shares: 1.95, profile: "fin", exchange: "NYSE" },
  MA: { shares: 0.91, profile: "fin", exchange: "NYSE" },
  JPM: { shares: 2.8, profile: "fin", exchange: "NYSE" },
  TTWO: { shares: 0.185, profile: "media", exchange: "NASDAQ" },
  PFE: { shares: 5.69, profile: "health", exchange: "NYSE" },
  CNC: { shares: 0.49, profile: "health", exchange: "NYSE" },
  KO: { shares: 4.31, profile: "staples", exchange: "NYSE" },
  DIS: { shares: 1.81, profile: "media", exchange: "NYSE" },
  COST: { shares: 0.443, profile: "staples", exchange: "NASDAQ" },
  JNJ: { shares: 2.41, profile: "health", exchange: "NYSE" },
  KHC: { shares: 1.19, profile: "staples", exchange: "NASDAQ" },
  INTC: { shares: 4.37, profile: "tech", exchange: "NASDAQ" },
  MRK: { shares: 2.51, profile: "health", exchange: "NYSE" },
  UBER: { shares: 2.09, profile: "tech", exchange: "NYSE" },
};

function profileFromSector(sector?: string): ProfileKey {
  const s = (sector ?? "").toLowerCase();
  if (/科技|テック|tech|半導體|半導体|software/.test(s)) return "tech";
  if (/金融|保險|保険|銀行|fin|bank|insur/.test(s)) return "fin";
  if (/娛樂|娯楽|media|entertain|game/.test(s)) return "media";
  if (/必需|staple|consumer/.test(s)) return "staples";
  if (/醫療|ヘルス|health|醫藥|医薬|pharma/.test(s)) return "health";
  return "general";
}

/** 最近 5 個已公布季度（季末後 40 天視為已公布）與最近 4 個完整年度 */
function periodLabels(now: Date) {
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) - 1;
  if (q < 0) { q = 3; y--; }
  const end = Date.UTC(y, q * 3 + 3, 0);
  if (now.getTime() - end < 40 * DAY) {
    q--;
    if (q < 0) { q = 3; y--; }
  }
  const quarters: string[] = [];
  for (let k = 4; k >= 0; k--) {
    let qq = q - k;
    let yy = y;
    while (qq < 0) { qq += 4; yy--; }
    quarters.push(`${yy} Q${qq + 1}`);
  }
  const lastFy = now.getUTCMonth() >= 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
  const years = [3, 2, 1, 0].map((k) => String(lastFy - k));
  return { quarters, years };
}

function demoFundamentals(ticker: string, price: number, sector: string | undefined, now: Date): Fundamentals {
  const T = ticker.toUpperCase();
  const r = rng(hashString(`${T}:fundamentals`));
  const pick = ([a, b]: Rng2) => a + (b - a) * r();
  const jitter = (amp: number) => 1 + (r() * 2 - 1) * amp;
  const known = KNOWN[T];
  const prof = PROFILES[known?.profile ?? profileFromSector(sector)];
  const currency = currencyOf(T);
  const px = price > 0 ? price : 100;
  const shares = (known?.shares ?? round(0.25 + r() * 4.5, 3)) * B;
  const mcap = px * shares;
  const pe = pick(prof.pe);
  const margin = pick(prof.margin);
  const ni = mcap / pe;
  const rev = ni / margin;
  const oi = Math.min(rev * 0.62, ni * pick(prof.opx));
  const conv = pick(prof.fcfConv);
  const fcf = ni * conv;
  const sbcPct = pick(prof.sbc);
  const sbc = fcf * sbcPct;
  const cash = rev * pick(prof.cashRev);
  const debt = rev * pick(prof.debtRev);
  const netCash = cash - debt;
  const ebitda = oi * (1.08 + r() * 0.18);
  const divRaw = pick(prof.div);
  const divYield = divRaw > 0.0005 ? divRaw : null;
  const revYoY = pick(prof.revYoY);
  const epsYoY = pick(prof.epsYoY);
  const g = pick(prof.growth);
  const { quarters, years } = periodLabels(now);

  // 季度：最近 4 季合計＝TTM；最早一季由 YoY 反推
  const fitTtm = (xs: number[], ttm: number) => {
    const s = xs.slice(1).reduce((a, v) => a + v, 0);
    return xs.map((v, i) => (i === 0 ? v : (v * ttm) / s));
  };
  const qRevRaw = [0, 1, 2, 3, 4].map((k) => (rev / 4) * (1 + (g / 4) * (k - 2)) * jitter(0.025));
  const qRev = fitTtm(qRevRaw, rev);
  qRev[0] = qRev[4] / (1 + revYoY);
  const qNiRaw = qRev.map((v) => v * margin * jitter(0.08));
  const qNi = fitTtm(qNiRaw, ni);
  qNi[0] = qNi[4] / (1 + epsYoY);
  const qOi = fitTtm(qRev.map((v) => v * (oi / rev) * jitter(0.05)), oi);
  const qFcf = fitTtm(qNi.map((v) => v * conv * (0.72 + r() * 0.56)), fcf);
  const qSbc = fitTtm(qFcf.map(() => (sbc / 4) * jitter(0.08)), sbc);
  const qCash = [cash];
  const qDebt = [debt];
  for (let k = 0; k < 4; k++) {
    qCash.unshift(qCash[0] * jitter(0.08));
    qDebt.unshift(qDebt[0] * jitter(0.04));
  }
  const quarterly: RawHistory = { fcf: qFcf, sbc: qSbc, rev: qRev, ni: qNi, oi: qOi, cash: qCash, debt: qDebt };

  // 年度：最近年度約為 TTM 的 94–98%，往前以成長率回推
  const yRev = [rev * (0.94 + r() * 0.04)];
  for (let k = 0; k < 3; k++) yRev.unshift(yRev[0] / (1 + g * jitter(0.35)));
  const yMargin = yRev.map((_, k) => margin * (1 - (3 - k) * 0.025 * r()));
  const yNi = yRev.map((v, k) => v * yMargin[k]);
  const yOi = yRev.map((v, k) => v * yMargin[k] * (oi / ni) * jitter(0.03));
  const yFcf = yNi.map((v) => v * conv * jitter(0.1));
  const ySbc = yFcf.map((v) => v * sbcPct * jitter(0.12));
  const yCash = [cash * jitter(0.1)];
  const yDebt = [debt * jitter(0.06)];
  for (let k = 0; k < 3; k++) {
    yCash.unshift(yCash[0] * jitter(0.15));
    yDebt.unshift(yDebt[0] * jitter(0.1));
  }
  const annual: RawHistory = { fcf: yFcf, sbc: ySbc, rev: yRev, ni: yNi, oi: yOi, cash: yCash, debt: yDebt };

  const exDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Math.round(12 + r() * 70) * DAY;
  return {
    ticker: T, currency, exchange: known?.exchange ?? (currency === "JPY" ? "TSE" : r() < 0.5 ? "NASDAQ" : "NYSE"),
    asOf: isoOf(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), source: "demo",
    marketCap: mcap, peTtm: pe, peFwd: pe * (0.8 + r() * 0.14), ps: mcap / rev,
    evEbitda: (mcap - netCash) / ebitda, pb: pick(prof.pb),
    fcfQuarter: qFcf[4], fcfTtm: fcf, fcfYield: fcf / mcap,
    sbcAdjFcf: fcf - sbc, sbcAdjYield: (fcf - sbc) / mcap, sbcImpact: -sbc / fcf,
    profitMargin: margin, operatingMargin: oi / rev, earningsYoY: epsYoY, revenueYoY: revYoY,
    cash, debt, netCash,
    divYield, payout: divYield != null ? divYield * pe : null,
    exDate: divYield != null ? isoOf(exDay) : null,
    dividend: divYield != null ? round((px * divYield) / 4, currency === "JPY" ? 0 : 2) : null,
    dilutedShares: shares,
    history: { q: toSeries(quarters, quarterly), y: toSeries(years, annual) },
  };
}

export function fundamentalsFor(ticker: string, price: number, sector?: string, now = new Date()): Fundamentals {
  if (ticker.toUpperCase() === "MSFT") {
    return {
      ...MSFT,
      history: {
        q: toSeries(["2025 Q2", "2025 Q3", "2025 Q4", "2026 Q1", "2026 Q2"], MSFT_Q),
        y: toSeries(["2023", "2024", "2025", "2026"], MSFT_Y),
      },
    };
  }
  return demoFundamentals(ticker, price, sector, now);
}

// ———————————————————— DCF ————————————————————

export interface DcfInputs {
  currentPrice: number; freeCashFlow: number; shares: number; netCash: number;
  growth: number; years: number; wacc: number; terminalGrowth: number; marginOfSafety: number;
}

// 與正式站相同的計算（期中折現、以淨現金銜接股權價值）
export function calculateDcf(i: { freeCashFlow: number; shares: number; netCash: number; growth: number; years: number; wacc: number; terminalGrowth: number; currentPrice: number; marginOfSafety: number }) {
  const wacc = i.wacc / 100, tg = i.terminalGrowth / 100, g = i.growth / 100;
  if (!(i.freeCashFlow > 0) || !(i.shares > 0) || !(i.years >= 1) || !(g > -1) || !(wacc > 0) || !(wacc > tg)) return null;
  const projections = Array.from({ length: i.years }, (_, k) => { const year = k + 1; const fcf = i.freeCashFlow * ((1 + g) ** year); return { year, fcf, presentValue: fcf / ((1 + wacc) ** (year - .5)) }; });
  const finalFcf = projections[projections.length - 1].fcf; if (!(finalFcf > 0)) return null;
  const terminalValue = finalFcf * (1 + tg) / (wacc - tg); const terminalPresentValue = terminalValue / ((1 + wacc) ** (i.years - .5));
  const forecastPresentValue = projections.reduce((s, p) => s + p.presentValue, 0); const enterpriseValue = forecastPresentValue + terminalPresentValue;
  const equityValue = enterpriseValue + i.netCash; const intrinsicValue = equityValue / i.shares;
  return { projections, forecastPresentValue, terminalPresentValue, terminalShare: enterpriseValue ? terminalPresentValue / enterpriseValue : 0, enterpriseValue, equityValue, intrinsicValue, upside: i.currentPrice > 0 ? intrinsicValue / i.currentPrice - 1 : null, buyBelow: intrinsicValue * (1 - i.marginOfSafety / 100) };
}

export type DcfResult = NonNullable<ReturnType<typeof calculateDcf>>;
export type DcfField = keyof DcfInputs;

export interface FieldLimit { min?: number; max?: number; integer?: boolean }

/** 各欄位的有效範圍（永續成長率上限 = min(3.5, WACC − 1)） */
export function dcfLimits(i: DcfInputs): Record<DcfField, FieldLimit> {
  return {
    currentPrice: { min: 0 },
    freeCashFlow: { min: 0 },
    shares: { min: 0 },
    netCash: {},
    growth: { min: -50, max: 50 },
    years: { min: 3, max: 10, integer: true },
    wacc: { min: 4, max: 25 },
    terminalGrowth: { min: -2, max: round(Math.min(3.5, i.wacc - 1), 4) },
    marginOfSafety: { min: 0, max: 90 },
  };
}

export function normalizeDcf(i: DcfInputs): DcfInputs {
  const fin = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);
  const wacc = clamp(fin(i.wacc, 9), 4, 25);
  return {
    currentPrice: Math.max(0, fin(i.currentPrice, 0)),
    freeCashFlow: Math.max(0, fin(i.freeCashFlow, 0)),
    shares: Math.max(0, fin(i.shares, 0)),
    netCash: fin(i.netCash, 0),
    growth: clamp(fin(i.growth, 0), -50, 50),
    years: Math.round(clamp(fin(i.years, 5), 3, 10)),
    wacc,
    terminalGrowth: clamp(fin(i.terminalGrowth, 2.5), -2, Math.min(3.5, wacc - 1)),
    marginOfSafety: clamp(fin(i.marginOfSafety, 20), 0, 90),
  };
}

export function dcfModelErrors(i: DcfInputs, lang: RLang) {
  const out: string[] = [];
  if (!(i.freeCashFlow > 0)) out.push(tr(lang, "TTM 自由現金流必須大於 0", "TTM フリーキャッシュフローは 0 より大きくしてください"));
  if (!(i.shares > 0)) out.push(tr(lang, "稀釋後股數必須大於 0", "希薄化後株式数は 0 より大きくしてください"));
  if (!(i.wacc > i.terminalGrowth)) out.push(tr(lang, "WACC 必須高於永續成長率", "WACC は永続成長率より高くしてください"));
  return out;
}

export function defaultDcf(ticker: string, price: number, f: Fundamentals): DcfInputs {
  const T = ticker.toUpperCase();
  const px = round(price > 0 ? price : 0, 2);
  if (T === "MSFT") {
    return { currentPrice: px, freeCashFlow: 74, shares: 7.43, netCash: 31, growth: 9, years: 5, wacc: 9, terminalGrowth: 2.5, marginOfSafety: 20 };
  }
  const r = rng(hashString(`${T}:dcf`));
  const jp = f.currency === "JPY";
  return normalizeDcf({
    currentPrice: px,
    freeCashFlow: round((f.fcfTtm ?? 0) / B, 2),
    shares: round((f.dilutedShares ?? 0) / B, 3),
    netCash: round((f.netCash ?? 0) / B, 2),
    growth: Math.round(5 + r() * 8),
    years: 5,
    wacc: jp ? 7 : 9,
    terminalGrowth: jp ? 1 : 2.5,
    marginOfSafety: 20,
  });
}

/** 由財務資料帶入基期（十億元／十億股） */
export function dcfFromFundamentals(f: Fundamentals) {
  return {
    freeCashFlow: f.fcfTtm != null ? round(f.fcfTtm / B, 2) : null,
    shares: f.dilutedShares != null ? round(f.dilutedShares / B, 3) : null,
    netCash: f.netCash != null ? round(f.netCash / B, 2) : null,
  };
}

// ———————————————————— 估值情境（localStorage） ————————————————————

export const SCENARIO_KEY = "wa-dcf-scenarios";

export interface DcfScenario { id: string; name: string; ticker: string; inputs: DcfInputs; savedAt: string }

const DCF_FIELDS: DcfField[] = ["currentPrice", "freeCashFlow", "shares", "netCash", "growth", "years", "wacc", "terminalGrowth", "marginOfSafety"];

function toScenario(x: unknown): DcfScenario | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const raw = o.inputs;
  if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.ticker !== "string" || typeof raw !== "object" || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const vals: Partial<DcfInputs> = {};
  for (const k of DCF_FIELDS) {
    const v = src[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    vals[k] = v;
  }
  return { id: o.id, name: o.name, ticker: o.ticker, inputs: normalizeDcf(vals as DcfInputs), savedAt: typeof o.savedAt === "string" ? o.savedAt : "" };
}

export function readScenarios(): DcfScenario[] {
  try {
    const raw = window.localStorage.getItem(SCENARIO_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x) => {
      const s = toScenario(x);
      return s ? [s] : [];
    });
  } catch {
    return [];
  }
}

export function writeScenarios(list: DcfScenario[]) {
  try {
    window.localStorage.setItem(SCENARIO_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// ———————————————————— SVG 路徑 ————————————————————

/** 折線（遇到 null 斷開） */
export function linePath(vals: Series, x: (i: number) => number, y: (v: number) => number) {
  let d = "";
  let pen = false;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v == null || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** 帶狀區域（上下界皆有值的連續段） */
export function bandPath(up: Series, lo: Series, x: (i: number) => number, y: (v: number) => number) {
  const parts: string[] = [];
  let seg: number[] = [];
  const flush = () => {
    if (seg.length > 1) {
      const top = seg.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)} ${y(up[i] as number).toFixed(1)}`).join("");
      const bottom = [...seg].reverse().map((i) => `L${x(i).toFixed(1)} ${y(lo[i] as number).toFixed(1)}`).join("");
      parts.push(`${top}${bottom}Z`);
    }
    seg = [];
  };
  for (let i = 0; i < up.length; i++) {
    const a = up[i];
    const b = lo[i];
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) seg.push(i);
    else flush();
  }
  flush();
  return parts.join("");
}
