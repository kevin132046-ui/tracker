// 和風工具：和暦、二十四節氣、十二時辰、美股交易時段、格式化

export type Lang = "zh" | "ja";

const SEKKI: [number, number, string, string][] = [
  [1, 5, "小寒", "小寒"], [1, 20, "大寒", "大寒"], [2, 4, "立春", "立春"], [2, 19, "雨水", "雨水"],
  [3, 5, "驚蟄", "啓蟄"], [3, 20, "春分", "春分"], [4, 4, "清明", "清明"], [4, 20, "穀雨", "穀雨"],
  [5, 5, "立夏", "立夏"], [5, 21, "小滿", "小満"], [6, 5, "芒種", "芒種"], [6, 21, "夏至", "夏至"],
  [7, 7, "小暑", "小暑"], [7, 22, "大暑", "大暑"], [8, 7, "立秋", "立秋"], [8, 23, "處暑", "処暑"],
  [9, 7, "白露", "白露"], [9, 23, "秋分", "秋分"], [10, 8, "寒露", "寒露"], [10, 23, "霜降", "霜降"],
  [11, 7, "立冬", "立冬"], [11, 22, "小雪", "小雪"], [12, 7, "大雪", "大雪"], [12, 21, "冬至", "冬至"],
];

const WEEK_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
const JIKAN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

/** 取得某時區的年月日時分秒 */
export function zoned(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    weekday: "short", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    y: +get("year"), m: +get("month"), d: +get("day"),
    h: +get("hour") % 24, min: +get("minute"), s: +get("second"), wd,
  };
}

export function wafuDate(now: Date, lang: Lang) {
  const z = zoned(now, "Asia/Tokyo");
  const reiwa = z.y - 2018;
  let sekki = SEKKI[SEKKI.length - 1];
  for (const s of SEKKI) if (z.m > s[0] || (z.m === s[0] && z.d >= s[1])) sekki = s;
  const week = lang === "ja" ? WEEK_JA[z.wd] : WEEK_ZH[z.wd];
  return {
    era: `令和${reiwa}年`,
    md: `${z.m}月${z.d}日`,
    week: lang === "ja" ? `（${week}）` : `（${week}）`,
    sekki: lang === "ja" ? sekki[3] : sekki[2],
  };
}

export function jikan(now: Date) {
  const z = zoned(now, "Asia/Tokyo");
  const idx = Math.floor(((z.h + 1) % 24) / 2);
  return `${JIKAN[idx]}の刻`;
}

export function clock(now: Date, timeZone: string) {
  const z = zoned(now, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(z.h)}:${p(z.min)}:${p(z.s)}`;
}

export type MarketState = "open" | "pre" | "post" | "closed";
export function marketState(now: Date): MarketState {
  const z = zoned(now, "America/New_York");
  if (z.wd === 0 || z.wd === 6) return "closed";
  const t = z.h * 60 + z.min;
  if (t >= 570 && t < 960) return "open";
  if (t >= 240 && t < 570) return "pre";
  if (t >= 960 && t < 1200) return "post";
  return "closed";
}

export const usd = (n: number, dp = 2) =>
  (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const signedUsd = (n: number, dp = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const pct = (n: number, dp = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(dp) + "%";
export const num = (n: number, dp = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** 可重現的亂數（示範資料用） */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 漂亮的刻度 */
export function niceTicks(min: number, max: number, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks, step };
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function safeGet(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function safeSet(key: string, v: string) {
  try { window.localStorage.setItem(key, v); } catch { /* 無痕或封鎖時略過 */ }
}

/** 示意用的走勢線：固定亂數種子，每次產生相同的序列。 */
export function spark(seed: number, start: number, drift: number, vol: number, n = 24) {
  const r = seeded(seed);
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1] * (1 + drift + (r() - 0.5) * vol));
  return out;
}
