// 美日股市休市行事曆（規則計算，已對照 NYSE 與 JPX 官方 2026、2027 年表）
// 美股：NYSE 假日＋提前收盤（13:00 ET）；日股：日本國民祝日、振替休日、國民の休日、年始年末休業。
import type { Lang } from "./wa";

export type Market = "US" | "JP";
export interface Closure {
  date: string;            // YYYY-MM-DD（該市場當地日期）
  market: Market;
  kind: "closed" | "early"; // 全日休市／提前收盤
  name: { zh: string; ja: string };
}

const key = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const dow = (y: number, m: number, d: number) => utc(y, m, d).getUTCDay();
const shift = (y: number, m: number, d: number, n: number) => {
  const t = utc(y, m, d + n);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] as const;
};
const nth = (y: number, m: number, wd: number, n: number) => 1 + ((wd - dow(y, m, 1) + 7) % 7) + (n - 1) * 7;
const last = (y: number, m: number, wd: number) => {
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return end - ((dow(y, m, end) - wd + 7) % 7);
};

function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [y, month, ((h + l - 7 * m + 114) % 31) + 1] as const;
}

const cache = new Map<string, Closure[]>();

export function usClosures(y: number): Closure[] {
  const ck = `US${y}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const out: Closure[] = [];
  const add = (yy: number, m: number, d: number, zh: string, ja: string, kind: Closure["kind"] = "closed") =>
    out.push({ date: key(yy, m, d), market: "US", kind, name: { zh, ja } });
  const observed = (m: number, d: number, zh: string, ja: string, satToFri = true) => {
    const wd = dow(y, m, d);
    if (wd === 6 && satToFri) add(...shift(y, m, d, -1), zh, ja);
    else if (wd === 0) add(...shift(y, m, d, 1), zh, ja);
    else if (wd !== 6) add(y, m, d, zh, ja);
  };
  observed(1, 1, "元旦", "元日", false); // 元旦逢週六不補假
  add(y, 1, nth(y, 1, 1, 3), "馬丁路德金恩紀念日", "キング牧師記念日");
  add(y, 2, nth(y, 2, 1, 3), "華盛頓誕辰", "ワシントン誕生日");
  const [ey, em, ed] = shift(...easter(y), -2);
  add(ey, em, ed, "耶穌受難日", "聖金曜日");
  add(y, 5, last(y, 5, 1), "陣亡將士紀念日", "メモリアルデー");
  observed(6, 19, "六月節", "ジューンティーンス");
  observed(7, 4, "獨立紀念日", "独立記念日");
  add(y, 9, nth(y, 9, 1, 1), "勞動節", "レイバーデー");
  const tg = nth(y, 11, 4, 4);
  add(y, 11, tg, "感恩節", "感謝祭");
  observed(12, 25, "聖誕節", "クリスマス");
  // 提前收盤（13:00 ET）：獨立紀念日前一天（7/4 為週二～週五）、感恩節隔天、平安夜（週一～週四）
  const j4 = dow(y, 7, 4);
  if (j4 >= 2 && j4 <= 5) add(y, 7, 3, "獨立紀念日前夕", "独立記念日前日", "early");
  add(...shift(y, 11, tg, 1), "感恩節隔天", "感謝祭翌日", "early");
  const x24 = dow(y, 12, 24);
  if (x24 >= 1 && x24 <= 4) add(y, 12, 24, "平安夜", "クリスマスイブ", "early");
  out.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(ck, out);
  return out;
}

const JP_ZH: Record<string, string> = {
  元日: "元旦", 成人の日: "成人之日", 建国記念の日: "建國紀念日", 天皇誕生日: "天皇誕辰", 春分の日: "春分之日",
  昭和の日: "昭和之日", 憲法記念日: "憲法紀念日", みどりの日: "綠之日", こどもの日: "兒童節", 海の日: "海之日",
  山の日: "山之日", 敬老の日: "敬老之日", 秋分の日: "秋分之日", スポーツの日: "體育之日", 文化の日: "文化之日",
  勤労感謝の日: "勤勞感謝之日", 国民の休日: "國民休日",
};

export function jpClosures(y: number): Closure[] {
  const ck = `JP${y}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const base = new Map<string, string>();
  const set = (m: number, d: number, name: string) => base.set(key(y, m, d), name);
  set(1, 1, "元日");
  set(1, nth(y, 1, 1, 2), "成人の日");
  set(2, 11, "建国記念の日");
  set(2, 23, "天皇誕生日");
  set(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), "春分の日");
  set(4, 29, "昭和の日");
  set(5, 3, "憲法記念日");
  set(5, 4, "みどりの日");
  set(5, 5, "こどもの日");
  set(7, nth(y, 7, 1, 3), "海の日");
  set(8, 11, "山の日");
  set(9, nth(y, 9, 1, 3), "敬老の日");
  set(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), "秋分の日");
  set(10, nth(y, 10, 1, 2), "スポーツの日");
  set(11, 3, "文化の日");
  set(11, 23, "勤労感謝の日");
  const all = new Map(base);
  // 國民の休日：前後都是祝日的平日
  for (let m = 1; m <= 12; m++) {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 2; d < days; d++) {
      const k = key(y, m, d);
      if (all.has(k) || dow(y, m, d) === 0) continue;
      if (base.has(key(...shift(y, m, d, -1))) && base.has(key(...shift(y, m, d, 1)))) all.set(k, "国民の休日");
    }
  }
  // 振替休日：祝日逢週日，順延至下一個非祝日
  for (const [k, name] of base) {
    const [yy, mm, dd] = k.split("-").map(Number);
    if (dow(yy, mm, dd) !== 0) continue;
    let s = shift(yy, mm, dd, 1);
    while (all.has(key(...s))) s = shift(...s, 1);
    all.set(key(...s), `振替休日（${name}）`);
  }
  const out: Closure[] = [];
  for (const [k, name] of all) {
    const [yy, mm, dd] = k.split("-").map(Number);
    if (dow(yy, mm, dd) === 0 || dow(yy, mm, dd) === 6) continue; // 週末本來就休市
    const zh = name.startsWith("振替休日") ? `補假（${JP_ZH[name.slice(5, -1)] ?? name.slice(5, -1)}）` : JP_ZH[name] ?? name;
    out.push({ date: k, market: "JP", kind: "closed", name: { zh, ja: name } });
  }
  // 東證年始年末休業
  for (const [m, d, zh, ja] of [[1, 2, "年始休市", "年始休業"], [1, 3, "年始休市", "年始休業"], [12, 31, "年末休市", "年末休業"]] as const) {
    const k = key(y, m, d);
    if (dow(y, m, d) !== 0 && dow(y, m, d) !== 6 && !all.has(k)) out.push({ date: k, market: "JP", kind: "closed", name: { zh, ja } });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  cache.set(ck, out);
  return out;
}

/** 某日（市場當地）是否休市／提前收盤 */
export function closureOn(market: Market, date: string) {
  const y = +date.slice(0, 4);
  return (market === "US" ? usClosures(y) : jpClosures(y)).find((c) => c.date === date) ?? null;
}

/** 從 fromDate 起 days 天內的休市與提前收盤（含當天），依日期排序 */
export function upcomingClosures(fromDate: string, days: number): (Closure & { inDays: number })[] {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = start + days * 86400000;
  const y0 = +fromDate.slice(0, 4);
  const list = [...usClosures(y0), ...usClosures(y0 + 1), ...jpClosures(y0), ...jpClosures(y0 + 1)];
  return list
    .map((c) => ({ ...c, inDays: Math.round((Date.parse(`${c.date}T00:00:00Z`) - start) / 86400000) }))
    .filter((c) => c.inDays >= 0 && Date.parse(`${c.date}T00:00:00Z`) < end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.market.localeCompare(b.market));
}

export const marketLabel = (m: Market, lang: Lang) => (m === "US" ? (lang === "ja" ? "米国株" : "美股") : (lang === "ja" ? "日本株" : "日股"));
