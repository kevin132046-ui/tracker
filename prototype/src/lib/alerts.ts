// 通知中心資料：財報日曆（預估）、財報解讀（NVDA 為真實公開資料）、股息發放日曆（示範）

export interface EarningsItem { ticker: string; date: string; when: "pre" | "post"; estimated: boolean; fq: string }
export interface Analysis {
  ticker: string; title: { zh: string; ja: string }; released: string; source: { label: string; url: string };
  metrics: { k: { zh: string; ja: string }; v: string; d?: string; good?: boolean }[];
  points: { zh: string; ja: string }[];
  watch: { zh: string; ja: string }[];
}
export interface DividendEvent { ticker: string; perShare: number; exDate: string; payDate: string; shares: number; currency: "USD" | "JPY"; source: string }


// 財報解讀範例：NVIDIA 2026/8/26 公布的 FY2027 第二季財報（數據取自 NVIDIA 官方新聞稿）
export const ANALYSES: Analysis[] = [
  {
    ticker: "NVDA",
    title: { zh: "NVIDIA FY2027 第二季財報解讀", ja: "NVIDIA 2027年度 第2四半期 決算の読み解き" },
    released: "2026-08-26",
    source: { label: "NVIDIA 新聞稿（2026/8/26）", url: "https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027" },
    metrics: [
      { k: { zh: "營收", ja: "売上高" }, v: "$96.2B", d: "季 +18%｜年 +106%", good: true },
      { k: { zh: "資料中心", ja: "データセンター" }, v: "$89.0B", d: "年 +117%｜占營收 92.5%", good: true },
      { k: { zh: "Edge Computing", ja: "エッジ" }, v: "$7.2B", d: "年 +27%" },
      { k: { zh: "毛利率", ja: "粗利率" }, v: "75.0%", d: "GAAP＝非 GAAP" },
      { k: { zh: "EPS（非 GAAP）", ja: "EPS（非GAAP）" }, v: "$2.22", d: "年 +120%｜GAAP $2.46", good: true },
      { k: { zh: "下季營收指引", ja: "次四半期ガイダンス" }, v: "$108.0B ±2%", d: "隱含季增約 12%" },
    ],
    points: [
      { zh: "成長仍由資料中心主導：單季 $89.0B、年增 117%，營收集中度升到九成以上，景氣循環風險也更集中。", ja: "成長はデータセンター主導：単四半期 $89.0B（前年比 +117%）。売上の9割超に集中し、景気循環リスクも集中。" },
      { zh: "下季指引 $108.0B（±2%）代表季增約 12%，比本季的 18% 放緩，但絕對金額仍創新高。", ja: "次四半期ガイダンス $108.0B（±2%）は前期比約 +12%。今期の +18% から減速するが、金額は過去最高。" },
      { zh: "毛利率指引 74.0%（±0.5pt）比本季 75.0% 略降，新平台量產初期成本是觀察重點。", ja: "粗利率ガイダンス 74.0%（±0.5pt）は今期 75.0% からやや低下。新プラットフォーム立ち上げのコストに注目。" },
      { zh: "GAAP EPS（$2.46）高於非 GAAP（$2.22），代表 GAAP 含非經常性收益；評估本業以非 GAAP 為準，細節需看 10-Q 附註。", ja: "GAAP EPS（$2.46）が非GAAP（$2.22）を上回るのは一時的な利益を含むため。本業評価は非GAAPで、詳細は10-Qの注記を確認。" },
      { zh: "本季回饋股東約 $26.0B（買回＋股息），剩餘買回授權 $99.0B；季度股息 $0.25（記錄日 9/10，10/1 發放）。", ja: "株主還元は約 $26.0B（自社株買い＋配当）、残りの買戻し枠 $99.0B。四半期配当 $0.25（基準日 9/10、10/1 支払）。" },
    ],
    watch: [
      { zh: "資料中心年增率是否連續放緩", ja: "データセンターの伸び率の減速が続くか" },
      { zh: "毛利率能否守住 74% 以上", ja: "粗利率 74% 以上を維持できるか" },
      { zh: "下次財報（預估 11 月中下旬）前 7 天提醒", ja: "次回決算（11月中下旬予定）の7日前に通知" },
    ],
  },
];



export const daysUntil = (iso: string, from: Date) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000);

// 財報與股息的示範日曆跟著示範持倉，放在 seed.ts。
export { DIVIDENDS, EARNINGS } from "./seed";
