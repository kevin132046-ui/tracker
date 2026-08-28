'use client';

import { useEffect, useState } from 'react';
import styles from './CompanyFundamentals.module.css';

type Metrics = Record<string, number | string | null>;
type CompanyPayload = { symbol: string; name: string; currency: string; exchange: string; instrumentType: string; updatedAt: string; metrics: Metrics; error?: string };

const percent = (value: unknown) => typeof value === 'number' ? `${value >= 0 ? '' : '−'}${Math.abs(value * 100).toFixed(2)}%` : '—';
const multiple = (value: unknown) => typeof value === 'number' ? `${value.toFixed(2)}×` : '—';
const amount = (value: unknown, currency: string) => {
  if (typeof value !== 'number') return '—';
  const abs = Math.abs(value);
  const units = currency === 'JPY' ? [['兆', 1e12], ['億', 1e8]] : [['T', 1e12], ['B', 1e9], ['M', 1e6]];
  const unit = units.find(([, divisor]) => abs >= Number(divisor));
  const symbol = currency === 'JPY' ? '¥' : '$';
  return unit ? `${value < 0 ? '−' : ''}${symbol}${(abs / Number(unit[1])).toFixed(abs / Number(unit[1]) >= 100 ? 1 : 2)}${unit[0]}` : `${value < 0 ? '−' : ''}${symbol}${abs.toLocaleString()}`;
};

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return <div className={styles.row}><dt>{label}</dt><dd className={tone ? styles[tone] : ''}>{value}</dd></div>;
}

export default function CompanyFundamentals({ symbol, onOpenDcf }: { symbol: string; onOpenDcf: () => void }) {
  const [data, setData] = useState<CompanyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CompanyPayload;
        if (!response.ok) throw new Error(payload.error ?? '公司資料暫時無法取得');
        setData(payload);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '公司資料暫時無法取得');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry, symbol]);

  const retryLoad = () => { setLoading(true); setError(''); setRetry((value) => value + 1); };

  const metrics = data?.metrics ?? {};
  const currency = data?.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD');
  const netCash = metrics.netCash;
  return <section className={styles.section} aria-labelledby="company-fundamentals-title">
    <header className={styles.header}><div><p>Company fundamentals</p><h3 id="company-fundamentals-title">公司資訊與財務品質</h3><span>{data ? `${data.name} · ${data.exchange || data.currency}` : `載入 ${symbol} 的估值、現金流與資產負債資料`}</span></div><button type="button" onClick={onOpenDcf}>開啟 {symbol} DCF 估值</button></header>
    {loading && <div className={styles.loading} role="status"><i />正在整理最新可用公司資料…</div>}
    {!loading && error && <div className={styles.error}><span>{error}</span><button type="button" onClick={retryLoad}>重新載入</button></div>}
    {!loading && data && <div className={styles.grid}>
      <article><h4>Valuation <span>估值</span></h4><dl><MetricRow label="市值" value={amount(metrics.marketCap, currency)} /><MetricRow label="P/E（TTM）" value={multiple(metrics.trailingPe)} /><MetricRow label="P/E（Forward）" value={multiple(metrics.forwardPe)} /><MetricRow label="Price / Sales" value={multiple(metrics.priceToSales)} /><MetricRow label="EV / EBITDA" value={multiple(metrics.evToEbitda)} /><MetricRow label="Price / Book" value={multiple(metrics.priceToBook)} /></dl></article>
      <article><h4>Cash Flow <span>現金流</span></h4><dl><MetricRow label="自由現金流" value={amount(metrics.freeCashFlow, currency)} /><MetricRow label="FCF Yield" value={percent(metrics.freeCashFlowYield)} /><MetricRow label="SBC 調整後 FCF" value={amount(metrics.adjustedFreeCashFlow, currency)} /><MetricRow label="SBC 調整後 FCF Yield" value={percent(metrics.adjustedFreeCashFlowYield)} /><MetricRow label="SBC 對 FCF 影響" value={percent(metrics.stockBasedCompensationImpact)} tone={typeof metrics.stockBasedCompensationImpact === 'number' && metrics.stockBasedCompensationImpact < 0 ? 'negative' : undefined} /></dl></article>
      <article><h4>Margins & Growth <span>利潤與成長</span></h4><dl><MetricRow label="淨利率" value={percent(metrics.profitMargin)} /><MetricRow label="營業利益率" value={percent(metrics.operatingMargin)} /><MetricRow label="季度獲利 YoY" value={percent(metrics.quarterlyEarningsGrowth)} tone={typeof metrics.quarterlyEarningsGrowth === 'number' ? metrics.quarterlyEarningsGrowth >= 0 ? 'positive' : 'negative' : undefined} /><MetricRow label="季度營收 YoY" value={percent(metrics.quarterlyRevenueGrowth)} tone={typeof metrics.quarterlyRevenueGrowth === 'number' ? metrics.quarterlyRevenueGrowth >= 0 ? 'positive' : 'negative' : undefined} /></dl></article>
      <article><h4>Balance <span>資產負債</span></h4><dl><MetricRow label="現金與短期投資" value={amount(metrics.cash, currency)} /><MetricRow label="總負債" value={amount(metrics.debt, currency)} /><MetricRow label="淨現金／（淨負債）" value={amount(netCash, currency)} tone={typeof netCash === 'number' ? netCash >= 0 ? 'positive' : 'negative' : undefined} /></dl></article>
      <article className={styles.dividend}><h4>Dividend <span>股息</span></h4><dl><MetricRow label="股息殖利率" value={percent(metrics.dividendYield)} /><MetricRow label="配息率" value={percent(metrics.payoutRatio)} /><MetricRow label="最近除息日" value={typeof metrics.latestDividendDate === 'string' ? metrics.latestDividendDate : '—'} /><MetricRow label="最近每股股息" value={typeof metrics.latestDividendAmount === 'number' ? new Intl.NumberFormat(currency === 'JPY' ? 'ja-JP' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 4 }).format(metrics.latestDividendAmount) : '—'} /></dl></article>
    </div>}
    <footer>財務資料來自交易所行情與公開財務時間序列；缺值以「—」顯示，不以 0 代替。更新時間 {data ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.updatedAt)) : '—'}。</footer>
  </section>;
}
