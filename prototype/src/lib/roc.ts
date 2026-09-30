// 年化計算（與正式站的定義一致，並修正投入資本的口徑）
import { investedCapital, realizedPnl, unrealized, type Position } from "./data";

export const DAY = 864e5;

/** 持有天數：同日開平倉算 1 天 */
export function heldDays(open: string, close?: string, now = new Date()) {
  const a = new Date(open + "T00:00:00Z").getTime();
  const b = close ? new Date(close + "T00:00:00Z").getTime() : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((b - a) / DAY));
}

/** 單利年化：報酬率 × 365 ÷ 天數（業界 ROC 常用） */
export const simpleAnnual = (r: number, days: number) => (r * 365) / Math.max(1, days);
/** 複利年化：(1 + 報酬率)^(365 ÷ 天數) − 1；報酬 ≤ −100% 時不適用 */
export const compoundAnnual = (r: number, days: number) => (r <= -1 ? -1 : Math.pow(1 + r, 365 / Math.max(1, days)) - 1);

export interface RocRow {
  id: string; ticker: string; label: string;
  openDate: string; closeDate: string; days: number;
  capital: number; pnl: number; roc: number;
  simple: number; compound: number; capitalYears: number;
}

/**
 * 本年度加權年化 ROC ＝ Σ 已實現損益 ÷ Σ（投入資本 × 持有天數 ÷ 365）
 * - 只計入「平倉日在本年度」的交易
 * - 投入資本：賣方選擇權＝擔保金；買方選擇權＝權利金＋手續費；股票＝成本＋手續費
 *   （正式站目前只看 collateral > 0，股票與買方選擇權會被排除）
 * - 等同於以「資金 × 時間」加權的單利年化，長時間占用大量資金的交易權重較高
 */
export function weightedRoc(positions: Position[], year: number) {
  const rows: RocRow[] = positions
    .filter((p) => !p.open && p.closeDate?.startsWith(`${year}-`) && p.kind !== "cash")
    .map((p) => {
      const days = heldDays(p.openDate, p.closeDate);
      const capital = investedCapital(p);
      const pnl = realizedPnl(p);
      const roc = capital > 0 ? pnl / capital : 0;
      const label = p.kind === "option" ? `${p.qty < 0 ? "賣出" : "買入"} ${p.strike}${p.optionType === "PUT" ? "P" : "C"}` : `${p.qty} 股`;
      return {
        id: p.id, ticker: p.ticker, label, openDate: p.openDate, closeDate: p.closeDate!, days, capital, pnl, roc,
        simple: simpleAnnual(roc, days), compound: compoundAnnual(roc, days), capitalYears: (capital * days) / 365,
      };
    })
    .filter((r) => r.capital > 0);
  const pnl = rows.reduce((a, r) => a + r.pnl, 0);
  const capitalYears = rows.reduce((a, r) => a + r.capitalYears, 0);
  return { rows, pnl, capitalYears, value: capitalYears > 0 ? pnl / capitalYears : null };
}

/** 未平倉部位的持有報酬與年化（持有未滿 30 天時年化僅供參考） */
export function openAnnual(p: Position, now = new Date()) {
  const days = heldDays(p.openDate, undefined, now);
  const capital = investedCapital(p);
  const r = capital > 0 ? unrealized(p) / capital : 0;
  return { days, r, simple: simpleAnnual(r, days), compound: compoundAnnual(r, days), short: days < 30 };
}
