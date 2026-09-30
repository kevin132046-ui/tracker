// 示範資料：持倉、交易，以及跟著持倉的財報與股息日曆。
// 全部是虛構的示範組合（代號、股數、價格、日期都不是任何人的真實部位），只用來展示介面。
import type { DividendEvent, EarningsItem } from "./alerts";
import type { Position, Trade } from "./data";
import { spark } from "./wa";

export const SEED_POSITIONS: Position[] = [
  { id: "p1", ticker: "AAPL", name: "Apple", kind: "stock", source: "api", open: true, qty: 12, trades: 2, cost: 198.3, price: 231.4, prevClose: 229.8, sector: 0, openDate: "2026-04-14", hi52: 260.1, lo52: 169.2, divYield: 0.0044, beta: 1.2, spark: spark(11, 205, 0.004, 0.03) },
  { id: "p2", ticker: "JPM", name: "JPMorgan Chase", kind: "stock", source: "api", open: true, qty: 6, trades: 2, cost: 244.0, price: 301.5, prevClose: 299.1, sector: 1, openDate: "2026-03-02", hi52: 318.0, lo52: 202.4, divYield: 0.019, beta: 1.1, spark: spark(12, 270, 0.004, 0.025) },
  { id: "p3", ticker: "DIS", name: "Walt Disney", kind: "stock", source: "api", open: true, qty: 8, trades: 1, cost: 112.6, price: 118.9, prevClose: 119.7, sector: 2, openDate: "2026-05-18", hi52: 124.7, lo52: 80.1, divYield: 0.0085, beta: 1.25, spark: spark(13, 112, 0.002, 0.03) },
  { id: "p4", ticker: "COST", name: "Costco", kind: "stock", source: "api", open: true, qty: 1, trades: 1, cost: 905.0, price: 948.2, prevClose: 951.0, sector: 3, openDate: "2026-07-21", hi52: 1078.2, lo52: 870.5, divYield: 0.0055, beta: 0.8, spark: spark(14, 910, 0.002, 0.02) },
  { id: "p5", ticker: "JNJ", name: "Johnson & Johnson", kind: "stock", source: "api", open: true, qty: 5, trades: 2, cost: 158.2, price: 177.6, prevClose: 176.9, sector: 4, openDate: "2026-02-10", hi52: 181.0, lo52: 140.7, divYield: 0.029, beta: 0.45, spark: spark(15, 160, 0.004, 0.018) },
  { id: "p6", ticker: "GOOGL", name: "Alphabet", kind: "stock", source: "api", open: true, qty: 4, trades: 1, cost: 172.5, price: 247.1, prevClose: 245.0, sector: 0, openDate: "2026-01-20", hi52: 256.0, lo52: 142.7, divYield: 0.0034, beta: 1.05, spark: spark(16, 180, 0.012, 0.035) },
  { id: "p7", ticker: "USD", name: "美元現金 · 稅後股息", kind: "cash", source: "cash", open: true, qty: 1, trades: 4, cost: 850.25, price: 850.25, prevClose: 850.25, sector: 5, openDate: "2026-01-02", spark: spark(17, 800, 0.003, 0.002) },
  { id: "p10", ticker: "KHC", name: "Kraft Heinz", kind: "option", source: "manual", open: true, qty: -1, trades: 1, cost: 0.38, price: 0.21, prevClose: 0.24, sector: 3, openDate: "2026-09-19", fees: 1.0, underlying: 27.6, iv: 0.24, optionType: "PUT", strike: 26, expiry: "2026-10-16", collateral: 2600, divYield: 0.058, beta: 0.4, note: "賣出賣權 · 擔保現金", spark: spark(20, 0.4, -0.02, 0.12) },
  { id: "p8", ticker: "INTC", name: "Intel", kind: "option", source: "manual", open: false, qty: -1, trades: 2, cost: 0.55, price: 0.05, prevClose: 0.05, sector: 0, openDate: "2026-08-12", closeDate: "2026-09-10", exitPrice: 0.05, fees: 2.0, optionType: "PUT", strike: 22, expiry: "2026-09-18", collateral: 2200, note: "賣出賣權 · 0.05 買回停利", spark: spark(18, 0.6, -0.05, 0.1) },
  { id: "p11", ticker: "MRK", name: "Merck", kind: "stock", source: "api", open: false, qty: 6, trades: 2, cost: 82.1, price: 88.6, prevClose: 88.6, sector: 4, openDate: "2026-03-16", closeDate: "2026-07-08", exitPrice: 88.6, fees: 2.0, note: "波段停利", spark: spark(21, 82, 0.003, 0.02) },
  { id: "p9", ticker: "UBER", name: "Uber", kind: "option", source: "manual", open: false, qty: 1, trades: 2, cost: 2.1, price: 1.4, prevClose: 1.4, sector: 0, openDate: "2026-08-04", closeDate: "2026-08-20", exitPrice: 1.4, fees: 2.0, optionType: "CALL", strike: 90, expiry: "2026-09-18", collateral: 0, note: "買入買權 · 提前停損", spark: spark(19, 2.1, -0.01, 0.1) },
];

export const SEED_TRADES: Trade[] = [
  { date: "2026-09-19", ticker: "KHC", kind: "option", action: "賣出 26P", qty: 1, price: 0.38, amount: 38, status: "open", note: "10/16 到期 · 擔保 $2,600" },
  { date: "2026-09-10", ticker: "INTC", kind: "option", action: "買回平倉 22P", qty: 1, price: 0.05, amount: -5, status: "closed", note: "權利金收 90.9% 停利" },
  { date: "2026-08-20", ticker: "UBER", kind: "option", action: "賣出平倉 90C", qty: 1, price: 1.4, amount: 140, status: "closed", note: "提前停損" },
  { date: "2026-08-14", ticker: "USD", kind: "cash", action: "股息入帳", qty: 1, price: 6.3, amount: 6.3, status: "open", note: "JNJ 股息 · 已扣 30% 預扣稅" },
  { date: "2026-08-12", ticker: "INTC", kind: "option", action: "賣出 22P", qty: 1, price: 0.55, amount: 55, status: "closed", note: "擔保 $2,200 · 權利金手動" },
  { date: "2026-08-04", ticker: "UBER", kind: "option", action: "買入 90C", qty: 1, price: 2.1, amount: -210, status: "closed", note: "財報前佈局" },
  { date: "2026-07-21", ticker: "COST", kind: "stock", action: "買入", qty: 1, price: 905.0, amount: -905, status: "open", note: "" },
  { date: "2026-07-08", ticker: "MRK", kind: "stock", action: "賣出", qty: 6, price: 88.6, amount: 531.6, status: "closed", note: "波段停利" },
  { date: "2026-05-18", ticker: "DIS", kind: "stock", action: "買入", qty: 8, price: 112.6, amount: -900.8, status: "open", note: "" },
  { date: "2026-04-14", ticker: "AAPL", kind: "stock", action: "買入", qty: 12, price: 198.3, amount: -2379.6, status: "open", note: "分兩筆買進" },
  { date: "2026-03-16", ticker: "MRK", kind: "stock", action: "買入", qty: 6, price: 82.1, amount: -492.6, status: "closed", note: "" },
  { date: "2026-03-02", ticker: "JPM", kind: "stock", action: "買入", qty: 6, price: 244.0, amount: -1464, status: "open", note: "" },
  { date: "2026-02-10", ticker: "JNJ", kind: "stock", action: "買入", qty: 5, price: 158.2, amount: -791, status: "open", note: "" },
  { date: "2026-01-20", ticker: "GOOGL", kind: "stock", action: "買入", qty: 4, price: 172.5, amount: -690, status: "open", note: "" },
];

// 財報日：依各公司慣例的預估日期（正式站以 Yahoo／Nasdaq 財報日曆更新並標示是否已確認）
export const EARNINGS: EarningsItem[] = [
  { ticker: "JPM", date: "2026-10-13", when: "pre", estimated: true, fq: "Q3 2026" },
  { ticker: "JNJ", date: "2026-10-14", when: "pre", estimated: true, fq: "Q3 2026" },
  { ticker: "GOOGL", date: "2026-10-27", when: "post", estimated: true, fq: "Q3 2026" },
  { ticker: "KHC", date: "2026-10-28", when: "pre", estimated: true, fq: "Q3 2026" },
  { ticker: "AAPL", date: "2026-10-29", when: "post", estimated: true, fq: "FQ4 2026" },
  { ticker: "DIS", date: "2026-11-12", when: "post", estimated: true, fq: "FQ4 2026" },
  { ticker: "COST", date: "2026-12-10", when: "post", estimated: true, fq: "FQ1 2027" },
];

// 股息發放日曆（示範數值；正式站由除息日／記錄日／發放日資料計算，於「發放日」才入帳現金）
export const DIVIDENDS: DividendEvent[] = [
  { ticker: "JPM", perShare: 1.5, exDate: "2026-10-06", payDate: "2026-10-31", shares: 6, currency: "USD", source: "示範數值" },
  { ticker: "AAPL", perShare: 0.26, exDate: "2026-11-10", payDate: "2026-11-13", shares: 12, currency: "USD", source: "示範數值" },
  { ticker: "JNJ", perShare: 1.3, exDate: "2026-11-24", payDate: "2026-12-09", shares: 5, currency: "USD", source: "示範數值" },
  { ticker: "GOOGL", perShare: 0.21, exDate: "2026-12-08", payDate: "2026-12-15", shares: 4, currency: "USD", source: "示範數值" },
];
