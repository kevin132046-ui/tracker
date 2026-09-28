import type { Lang } from "./wa";

export type ThemeId = "kikyo" | "shigure";
export type ThemePref = "random" | ThemeId;

export interface ThemeSpec {
  id: ThemeId;
  title: [string, string]; // 姓、名（名的部分上主題色）
  crestName: Record<Lang, string>;
  subtitle: Record<Lang, string>;
  loaderSteps: Record<Lang, string[]>;
  loaderDone: Record<Lang, string>;
  series: { portfolio: string; spy: string; boxx: string };
  palette: string[];
  halo: { core: string; glow: string; rgb: [number, number, number] };
}

export const THEMES: Record<ThemeId, ThemeSpec> = {
  kikyo: {
    id: "kikyo",
    title: ["桐生", "桔梗"],
    crestName: { zh: "桔梗紋", ja: "桔梗紋" },
    subtitle: { zh: "作戰參謀的帳簿 · 百花繚亂", ja: "作戦参謀の帳簿 · 百花繚乱" },
    loaderSteps: {
      zh: ["偵察報價", "確認布陣", "推演損益", "整備圖表", "軍議完成"],
      ja: ["相場を偵察", "布陣を確認", "損益を推演", "図表を整備", "軍議完了"],
    },
    loaderDone: { zh: "開門", ja: "開門" },
    series: { portfolio: "#9dbcf0", spy: "#bdb7aa", boxx: "#c9a45c" },
    palette: ["#7d9fe0", "#9a8ce0", "#6fb7a0", "#c9a45c", "#d9735c", "#a7a3b8", "#6d8aa8", "#b9a88a"],
    halo: { core: "#dce8ff", glow: "#7fa2e8", rgb: [78, 122, 212] },
  },
  shigure: {
    id: "shigure",
    title: ["間宵", "時雨"],
    crestName: { zh: "雪輪紋", ja: "雪輪紋" },
    subtitle: { zh: "赤冬 · 雪夜的自家調配帳", ja: "赤冬 · 雪夜の自家製ブレンド帳" },
    loaderSteps: {
      zh: ["汲取報價", "調配持倉", "溫熱損益", "結晶圖表", "剛剛好"],
      ja: ["相場を汲む", "持高を調合", "損益を温める", "図表を結晶", "ちょうどいい"],
    },
    loaderDone: { zh: "掀簾", ja: "暖簾をくぐる" },
    series: { portfolio: "#62d4d2", spy: "#c9d8d8", boxx: "#f0c24b" },
    palette: ["#62d4d2", "#f0c24b", "#b69ae8", "#ec8f7f", "#86b6ea", "#a2d27e", "#d8b48a", "#8fa9ab"],
    halo: { core: "#e9fffd", glow: "#5fd0cf", rgb: [120, 225, 222] },
  },
};

export function pickTheme(pref: ThemePref): ThemeId {
  if (pref !== "random") return pref;
  return Math.random() < 0.5 ? "kikyo" : "shigure";
}

type Dict = Record<string, [string, string]>;
const D: Dict = {
  settings: ["設定", "設定"],
  overview: ["總覽", "総覧"],
  positions: ["持倉", "建玉"],
  returns: ["收益", "収益"],
  valuation: ["估值", "評価"],
  background: ["背景", "背景"],
  refresh: ["更新報價", "株価更新"],
  addTrade: ["新增交易", "取引を追加"],
  add: ["新增", "追加"],
  open: ["交易中", "取引中"],
  pre: ["盤前", "プレ"],
  post: ["盤後", "アフター"],
  closed: ["非交易時段", "取引時間外"],
  liveClock: ["即時市場時間", "市場時刻"],
  et: ["美東", "米東部"],
  jst: ["日本", "日本"],
  quoteEvery: ["報價每 60 秒更新 · 上次", "株価は60秒ごとに更新 · 前回"],
  tracked: ["追蹤市值", "評価額"],
  openCount: ["筆未平倉持倉", "件の未決済建玉"],
  unreal: ["未實現損益", "含み損益"],
  collateral: ["擔保／投入資本", "担保／投下資本"],
  collateralNote: ["股票採買入成本；賣方選擇權採擔保金", "株式は取得原価、売りオプションは担保金"],
  roc: ["本年度加權年化 ROC", "年初来 加重年率ROC"],
  closedTrades: ["筆有效平倉交易", "件の決済取引"],
  returnAnalytics: ["Return analytics", "Return analytics"],
  returnTitle: ["收益率", "収益率"],
  day: ["日", "日"], week: ["週", "週"], month: ["月", "月"], year: ["年", "年"],
  latest: ["最近一期報酬率", "直近期間のリターン"],
  mine: ["我的組合", "マイ組合"],
  macroTitle: ["匯率與美債殖利率", "為替と米国債利回り"],
  macroAlt: ["黃金／原油", "金／原油"],
  macroRates: ["匯率／美債", "為替／米債"],
  update: ["更新", "更新"],
  macroNote: ["美元／日圓顯示至小數點後 2 位；美國 10 年與 30 年公債顯示殖利率、變動點數與漲跌幅。", "ドル円は小数第2位まで。米10年・30年債は利回り、変化幅（bp）、騰落率を表示。"],
  holdings: ["持倉配置", "ポートフォリオ構成"],
  donut: ["圓環圖", "ドーナツ"],
  bars: ["長條圖", "棒グラフ"],
  now: ["目前", "現在"], m1: ["1 個月", "1か月"], m3: ["3 個月", "3か月"], y1: ["1 年", "1年"],
  historyDate: ["歷史日期", "履歴日付"],
  exposure: ["目前曝險", "現在のエクスポージャー"],
  allocNote: ["股票按目前價格、選擇權按擔保金、現金按原幣餘額計算；日圓部位會換算為 USD。", "株式は時価、オプションは担保金、現金は原通貨残高で計算。円建てはUSD換算。"],
  activeBook: ["Active book", "Active book"],
  tradesTitle: ["交易與持倉", "取引と建玉"],
  visual: ["圖形持倉", "ビジュアル"],
  ledger: ["交易明細", "取引明細"],
  search: ["搜尋 ticker、策略或備註", "ティッカー・戦略・メモで検索"],
  fOpen: ["未平倉", "未決済"], fClosed: ["已平倉", "決済済"], fOption: ["選擇權", "オプション"],
  fStock: ["股票", "株式"], fCash: ["現金", "現金"], fAll: ["全部", "すべて"],
  hTicker: ["標的／公司", "銘柄"], hValue: ["持倉市值", "評価額"], hCost: ["成本均價／現價", "取得単価／現在値"],
  hMove: ["今日漲跌", "本日騰落"], hPnl: ["損益／報酬率", "損益／リターン"], hWeight: ["組合占比", "構成比"],
  apiQuote: ["股票 API 報價", "API株価"], manual: ["手動價格", "手動価格"], cashDiv: ["現金／稅後股息", "現金／税引後配当"],
  footNote: ["現金不呼叫股票報價；股息依持有期間、除息事件與設定的外國投資人預扣稅率試算。", "現金は株価APIを呼び出しません。配当は保有期間・権利落ち・源泉税率で試算。"],
  demo: ["示範資料", "サンプル"],
  skip: ["略過", "スキップ"],
  theme: ["主題", "テーマ"],
  themeRandom: ["每次隨機", "毎回ランダム"],
  replay: ["重播開場動畫", "オープニングを再生"],
  introToggle: ["開啟網頁時播放開場", "起動時にオープニングを再生"],
  empty: ["沒有符合條件的紀錄", "該当する記録はありません"],
};

export function t(key: keyof typeof D | string, lang: Lang) {
  const v = D[key as string];
  if (!v) return key;
  return lang === "ja" ? v[1] : v[0];
}
