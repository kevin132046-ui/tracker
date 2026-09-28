import { seeded, spark } from "./wa";

export type Kind = "stock" | "option" | "cash";
export type Source = "api" | "manual" | "cash";

export interface Position {
  id: string;
  ticker: string;
  name: string;
  kind: Kind;
  source: Source;
  open: boolean;
  qty: number; // 股票為股數；選擇權為口數（賣方為負）
  trades: number;
  cost: number; // 成本均價（選擇權為每股權利金）
  price: number; // 現價
  prevClose: number;
  sector: number; // 分類（用於方塊配色與標籤）
  openDate: string; // 首次建倉日
  closeDate?: string; // 平倉日
  exitPrice?: number; // 平倉價
  fees?: number; // 總手續費
  underlying?: number; // 選擇權標的現價
  iv?: number; // 手動設定的隱含波動率
  optionType?: "PUT" | "CALL";
  strike?: number;
  expiry?: string;
  collateral?: number;
  hi52?: number; lo52?: number; divYield?: number; beta?: number;
  note?: string;
  spark: number[];
}



export const SECTORS = ["科技", "金融", "娛樂", "必需品", "醫療", "現金"];
export const SECTORS_JA = ["テック", "金融", "娯楽", "生活必需", "ヘルス", "現金"];

export function marketValue(p: Position) {
  if (p.kind === "cash") return p.price;
  if (p.kind === "option") return p.open ? p.collateral ?? 0 : 0;
  return p.qty * p.price;
}

export function exposureValue(p: Position) {
  // 配置圖只計入未平倉；選擇權以擔保金計
  return p.open ? marketValue(p) : 0;
}

const MULT = (p: Position) => (p.kind === "option" ? 100 : 1);

export function unrealized(p: Position) {
  if (!p.open || p.kind === "cash") return 0;
  // 賣方 qty 為負：(現價 − 成本) × qty × 乘數 即為正確方向
  return (p.price - p.cost) * p.qty * MULT(p) - (p.fees ?? 0);
}

/** 平倉損益 =（平倉價 − 開倉價）× 數量 × 乘數 − 手續費（賣方數量為負） */
export function realizedPnl(p: Position) {
  if (p.open || p.exitPrice == null) return 0;
  return (p.exitPrice - p.cost) * p.qty * MULT(p) - (p.fees ?? 0);
}

/** 投入資本：股票＝買入成本＋手續費；買方選擇權＝權利金＋手續費；賣方選擇權＝擔保金 */
export function investedCapital(p: Position) {
  if (p.kind === "cash") return p.cost;
  if (p.kind === "option" && p.qty < 0) return p.collateral || p.strike! * 100 * Math.abs(p.qty);
  return Math.abs(p.cost * p.qty * MULT(p)) + Math.max(0, p.fees ?? 0);
}

export function costBasis(p: Position) {
  return investedCapital(p);
}

export interface Trade {
  date: string;
  ticker: string;
  kind: Kind;
  action: string;
  qty: number;
  price: number;
  amount: number;
  status: "open" | "closed";
  note: string;
}


export type Period = "day" | "week" | "month" | "year";
export interface ReturnPoint { label: string; mine: number; spy: number; boxx: number }

function genSeries(n: number, seed: number, mineVol: number, spyVol: number, boxx: number, drift: number) {
  const r = seeded(seed);
  const pts: { mine: number; spy: number; boxx: number }[] = [];
  for (let i = 0; i < n; i++) {
    const spy = (r() - 0.45) * spyVol;
    const mine = spy * 0.8 + (r() - 0.42) * mineVol + drift;
    pts.push({ mine: +mine.toFixed(2), spy: +spy.toFixed(2), boxx: +(boxx + (r() - 0.5) * boxx * 0.2).toFixed(2) });
  }
  return pts;
}

export function returnSeries(period: Period, now = new Date()): ReturnPoint[] {
  if (period === "month") {
    const mine = [1.2, -0.6, 2.1, 0.8, -1.9, -3.2, 5.4, 2.6, -0.4, 3.1, 2.2, 9.1];
    const spy = [2.0, 0.1, 0.5, 1.2, -1.5, -5.0, 9.8, 5.0, -1.3, 0.2, 1.3, 1.6];
    const boxx = [0.36, 0.35, 0.36, 0.34, 0.33, 0.35, 0.34, 0.33, 0.34, 0.33, 0.32, 0.33];
    const labels: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${d.getMonth() + 1}月`);
    }
    return labels.map((label, i) => ({ label, mine: mine[i], spy: spy[i], boxx: boxx[i] }));
  }
  if (period === "year") {
    const y = now.getFullYear();
    const mine = [-8.4, 21.7, 18.9, 12.3, 24.6];
    const spy = [-18.2, 26.2, 24.9, 17.8, 14.1];
    const boxx = [1.6, 5.0, 5.1, 4.3, 3.1];
    return [4, 3, 2, 1, 0].map((k, i) => ({ label: `${y - k}`, mine: mine[i], spy: spy[i], boxx: boxx[i] }));
  }
  if (period === "week") {
    const s = genSeries(26, 7, 3.2, 3.0, 0.08, 0.15);
    return s.map((p, i) => {
      const d = new Date(now.getTime() - (25 - i) * 7 * 864e5);
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, ...p };
    });
  }
  const s = genSeries(30, 3, 1.4, 1.3, 0.012, 0.05);
  const out: ReturnPoint[] = [];
  let k = 0;
  for (let back = 41; out.length < 30 && back >= 0; back--) {
    const d = new Date(now.getTime() - back * 864e5);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    out.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, ...s[k++] });
  }
  return out;
}

export interface Macro {
  key: string;
  label: string;
  labelJa?: string;
  sub: string;
  subJa?: string;
  value: number;
  unit: "" | "%" | "$";
  dp: number;
  change: number; // 絕對變動（殖利率為 bp）
  changePct: number;
  series: number[];
  bp?: boolean;
}

export const MACRO_RATES: Macro[] = [
  { key: "usdjpy", label: "美元／日圓", labelJa: "米ドル／円", sub: "USD/JPY", value: 147.62, unit: "", dp: 2, change: 0.21, changePct: 0.14, series: spark(31, 144.8, 0.001, 0.008, 30) },
  { key: "us10", label: "美國 10 年期公債", labelJa: "米国 10年債利回り", sub: "US10Y", value: 4.121, unit: "%", dp: 3, change: 3.1, changePct: 0.76, bp: true, series: spark(32, 4.02, 0.001, 0.02, 30) },
  { key: "us30", label: "美國 30 年期公債", labelJa: "米国 30年債利回り", sub: "US30Y", value: 4.713, unit: "%", dp: 3, change: -1.8, changePct: -0.38, bp: true, series: spark(33, 4.75, -0.0005, 0.015, 30) },
];
export const MACRO_COMMOD: Macro[] = [
  { key: "gold", label: "黃金期貨", labelJa: "金先物", sub: "GC · 每盎司", subJa: "GC · 1オンス", value: 3712.4, unit: "$", dp: 1, change: 18.6, changePct: 0.5, series: spark(34, 3560, 0.0015, 0.012, 30) },
  { key: "wti", label: "WTI 原油", labelJa: "WTI 原油先物", sub: "CL · 每桶", subJa: "CL · 1バレル", value: 64.18, unit: "$", dp: 2, change: -0.74, changePct: -1.14, series: spark(35, 66.5, -0.001, 0.03, 30) },
];

// 示範持倉與交易放在 seed.ts：公開的 repo 版本用虛構資料，這裡只轉出。
export { SEED_POSITIONS, SEED_TRADES } from "./seed";
