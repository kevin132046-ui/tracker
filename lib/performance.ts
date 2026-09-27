/**
 * Pure portfolio-performance helpers shared by the dashboard.
 *
 * No React and no server imports: everything here is deterministic given its
 * inputs so it can run in the browser, during SSR, or in a quick script.
 */

export type CapitalBasis = 'collateral' | 'strike' | 'cost' | 'premium';

/** The subset of a trade row the performance maths needs. */
export type PerformanceTrade = {
  id: number;
  type: string;
  openDate: string;
  closeDate: string | null;
  ticker: string | null;
  event: string;
  strike: string | null;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  fees: number;
  collateral: number;
  market?: 'US' | 'JP';
  derived?: boolean;
};

type TradeKind = Pick<PerformanceTrade, 'type' | 'event'>;
type TradeCurrency = Pick<PerformanceTrade, 'market' | 'ticker'>;

export const isJapaneseTicker = (ticker: string | null | undefined) => Boolean(ticker?.toUpperCase().endsWith('.T'));
export const isYenTicker = (ticker: string | null | undefined) => ticker?.toUpperCase() === 'JPY' || isJapaneseTicker(ticker);
export const isCashTrade = (trade: TradeKind) => trade.type === 'CASH' || trade.event === 'CASH' || trade.event === 'DIVIDEND';
export const isStockTrade = (trade: TradeKind) => trade.type === 'SDI' || trade.event === 'STOCK';
export const isShortTrade = (trade: Pick<PerformanceTrade, 'type'>) => trade.type.toLowerCase() === 'sell';
export const isYenTrade = (trade: TradeCurrency) => trade.market === 'JP' || isYenTicker(trade.ticker);
export const normalizeTickerForMarket = (ticker: string | null | undefined, market: 'US' | 'JP') => {
  const normalized = String(ticker ?? '').trim().toUpperCase();
  return market === 'JP' && /^\d{4}$/.test(normalized) ? `${normalized}.T` : normalized;
};
export const normalizedUsdAmount = (trade: TradeCurrency, value: number, usdJpyRate: number) => isYenTrade(trade) && usdJpyRate > 0 ? value / usdJpyRate : value;

/**
 * Native-currency capital a trade ties up.
 * - stock: entry cost + fees
 * - long option: premium × 100 × qty + fees
 * - short option: collateral; when missing, strike × 100 × qty (strike notional); else the premium cost
 * - cash: the balance
 */
export function capitalBase(trade: PerformanceTrade): { amount: number; basis: CapitalBasis } {
  if (isCashTrade(trade)) return { amount: Math.abs(trade.quantity), basis: 'cost' };
  const stock = isStockTrade(trade);
  const entryCost = Math.abs(trade.entryPrice * trade.quantity * (stock ? 1 : 100)) + Math.max(0, trade.fees);
  if (stock) return { amount: entryCost, basis: 'cost' };
  if (!isShortTrade(trade)) return { amount: entryCost, basis: 'premium' };
  if (trade.collateral > 0) return { amount: trade.collateral, basis: 'collateral' };
  const strikeNotional = Math.abs(Number(trade.strike) * trade.quantity * 100);
  if (Number.isFinite(strikeNotional) && strikeNotional > 0) return { amount: strikeNotional, basis: 'strike' };
  return { amount: entryCost, basis: 'premium' };
}

export const investedCapitalUsd = (trade: PerformanceTrade, usdJpyRate: number) => normalizedUsdAmount(trade, capitalBase(trade).amount, usdJpyRate);

export function strategyLabel(trade: Pick<PerformanceTrade, 'type' | 'event' | 'strike'>) {
  if (isStockTrade(trade)) return trade.type === 'SDI' ? 'STOCK' : `${trade.type} ${trade.event}`;
  const strike = trade.strike?.trim();
  return [trade.type, trade.event, strike].filter(Boolean).join(' ');
}

export type AnnualRocRow = {
  id: number;
  ticker: string;
  strategy: string;
  openDate: string;
  closeDate: string;
  days: number;
  capital: number;
  basis: CapitalBasis;
  pnl: number;
  roc: number | null;
  simpleAnnualized: number | null;
  compoundAnnualized: number | null;
  capitalYears: number;
};

export type AnnualRocSummary = {
  year: number;
  count: number;
  /** Σ realized P&L ÷ Σ(capital × days ÷ 365); null when no capital-years. */
  value: number | null;
  realizedPnl: number;
  capitalYears: number;
  totalCapital: number;
  rows: AnnualRocRow[];
};

export const compoundAnnualized = (roc: number, days: number) => 1 + roc <= 0 ? -1 : Math.pow(1 + roc, 365 / days) - 1;

/** Capital-weighted annualized ROC for trades closed in `year`, with the per-trade rows behind it. */
export function buildAnnualRocSummary(
  items: ReadonlyArray<{ trade: PerformanceTrade; pnl: number; days: number }>,
  year: number,
  usdJpyRate: number,
): AnnualRocSummary {
  const prefix = `${year}-`;
  const rows = items.flatMap<AnnualRocRow>(({ trade, pnl, days }) => {
    if (isCashTrade(trade) || !trade.closeDate?.startsWith(prefix) || !Number.isFinite(pnl) || !(days > 0)) return [];
    const { amount, basis } = capitalBase(trade);
    const capital = normalizedUsdAmount(trade, amount, usdJpyRate);
    const roc = capital > 0 ? pnl / capital : null;
    return [{
      id: trade.id,
      ticker: trade.ticker || '—',
      strategy: strategyLabel(trade),
      openDate: trade.openDate,
      closeDate: trade.closeDate,
      days,
      capital,
      basis,
      pnl,
      roc,
      simpleAnnualized: roc === null ? null : roc * 365 / days,
      compoundAnnualized: roc === null ? null : compoundAnnualized(roc, days),
      capitalYears: capital * days / 365,
    }];
  }).sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.openDate.localeCompare(b.openDate) || a.id - b.id);
  const realizedPnl = rows.reduce((sum, row) => sum + row.pnl, 0);
  const capitalYears = rows.reduce((sum, row) => sum + row.capitalYears, 0);
  return {
    year,
    count: rows.length,
    value: capitalYears > 0 ? realizedPnl / capitalYears : null,
    realizedPnl,
    capitalYears,
    totalCapital: rows.reduce((sum, row) => sum + row.capital, 0),
    rows,
  };
}
