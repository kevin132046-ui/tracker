'use client';

import { Fragment, useMemo, useState } from 'react';
import type { GainCategory, GainReport, GainTotals, GainTrade } from '@/lib/gains';
import { gainCsv, gainReport, realizedLots, unrealizedLots } from '@/lib/gains';

export type Tab = 'this' | 'last' | 'open';

const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (value: number) => `${value < 0 ? '−' : ''}$${amount.format(Math.abs(value))}`;
const plain = (value: number) => `${value < 0 ? '−' : ''}${amount.format(Math.abs(value))}`;
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${amount.format(Math.abs(value))}`;
const percentOf = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${amount.format(Math.abs(value * 100))}%`;
const tone = (value: number) => Math.abs(value) < 0.005 ? '' : value > 0 ? 'positive' : 'negative';

function Figures({ row }: { row: Pick<GainTotals, 'proceeds' | 'cost' | 'wash' | 'gain' | 'pct'> }) {
  return <>
    <td>{dollars(row.proceeds)}</td>
    <td>{dollars(row.cost)}</td>
    <td>{plain(row.wash)}</td>
    <td className={tone(row.gain)}>{signed(row.gain)}</td>
    <td className={row.pct === null ? '' : tone(row.gain)}>{percentOf(row.pct)}</td>
  </>;
}

/**
 * 益損 (from the broker-style report the user asked for): this year's and last year's realized gains
 * and the unrealized ones, split short-term / long-term, each expandable by ticker and then by trade,
 * with print and CSV. Worked out from the site's trades by lib/gains; wash sales are not estimated.
 */
export default function GainsLedger({ trades, usdJpyRate, today, query, initialTab = 'this' }: {
  trades: GainTrade[];
  /** The tab to open on (the 未實現損益 card opens 未實現). */
  initialTab?: Tab;
  usdJpyRate: number;
  today: string;
  /** The positions search: narrows the rows to matching tickers. */
  query: string;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const year = Number(today.slice(0, 4));
  const filter = query.trim().toUpperCase();

  const report: GainReport = useMemo(() => {
    const scoped = filter ? trades.filter((trade) => (trade.ticker ?? '').toUpperCase().includes(filter)) : trades;
    if (tab === 'open') { const { lots, skipped } = unrealizedLots(scoped, today, usdJpyRate); return gainReport('unrealized', lots, skipped); }
    const { lots, skipped } = realizedLots(scoped, tab === 'this' ? year : year - 1, usdJpyRate);
    return gainReport('realized', lots, skipped);
  }, [filter, tab, today, trades, usdJpyRate, year]);

  const unrealized = report.kind === 'unrealized';
  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // Phones show only 類別 / 益損 / 益損%; the amounts go on a second line under the name.
  const sub = (row: { proceeds: number; cost: number }) => <small className="wafu-gains-sub">{unrealized ? '市值' : '所得'} {dollars(row.proceeds)} · 成本 {dollars(row.cost)}</small>;
  const title = unrealized ? `截至 ${today} 的未實現損益` : `${tab === 'this' ? year : year - 1} 稅務年度損益資訊`;

  const print = () => {
    const root = document.documentElement;
    root.dataset.print = 'gains';
    const done = () => { delete root.dataset.print; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([gainCsv(report)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `optionflow-gains-${unrealized ? 'unrealized' : `${tab === 'this' ? year : year - 1}-realized`}-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const category = (row: GainCategory) => {
    const key = row.term;
    const expanded = open.has(key);
    const name = `${row.term === 'short' ? '短期' : '長期'}${unrealized ? '未實現' : '已實現'}益損總值`;
    return <Fragment key={key}>
      <tr className="wafu-gains-cat">
        <td><button type="button" aria-expanded={expanded} onClick={() => toggle(key)}><i aria-hidden="true">›</i>{name}{row.count > 0 && <small>{row.count} 筆</small>}</button>{sub(row)}</td>
        <Figures row={row} />
      </tr>
      {expanded && !row.tickers.length && <tr className="wafu-gains-empty"><td colSpan={6}>{unrealized ? '沒有這類未平倉部位。' : '這一年沒有這類平倉交易。'}</td></tr>}
      {expanded && row.tickers.map((ticker) => {
        const tickerKey = `${key}:${ticker.ticker}`;
        const tickerOpen = open.has(tickerKey);
        return <Fragment key={tickerKey}>
          <tr className="wafu-gains-ticker">
            <td><button type="button" aria-expanded={tickerOpen} onClick={() => toggle(tickerKey)}><i aria-hidden="true">›</i><b>{ticker.ticker}</b><small>{ticker.count} 筆</small></button>{sub(ticker)}</td>
            <Figures row={ticker} />
          </tr>
          {tickerOpen && ticker.lots.map((lot) => <tr key={lot.id} className="wafu-gains-lot">
            <td><span>{lot.label}</span><small>{lot.quantity} {lot.label === 'STOCK' ? '股' : '口'} · {lot.opened} → {lot.closed ?? '持有中'}</small>{sub(lot)}</td>
            <Figures row={{ ...lot, pct: Math.abs(lot.cost) > 0 ? lot.gain / Math.abs(lot.cost) : null }} />
          </tr>)}
        </Fragment>;
      })}
    </Fragment>;
  };

  return <section className="wafu-gains" aria-labelledby="wafu-gains-title">
    <header className="wafu-gains-head">
      <div><h3 id="wafu-gains-title">益損</h3><span>{title}</span></div>
      <div className="wafu-gains-actions">
        <button type="button" onClick={print}>列印</button>
        <button type="button" onClick={download}>下載 CSV</button>
      </div>
    </header>
    <div className="wafu-gains-tabs" role="tablist" aria-label="益損期間">
      {([['this', '今年實現益損'], ['last', '去年實現益損'], ['open', '未實現益損']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div className="wafu-gains-wrap">
      <table className="wafu-gains-table">
        <thead><tr><th>類別</th><th>{unrealized ? '市值' : '銷售所得'}</th><th>{unrealized ? '成本' : '調整成本'}</th><th>WS 損失不允</th><th>益損$</th><th>益損%</th></tr></thead>
        <tbody>
          {category(report.short)}
          {category(report.long)}
          <tr className="wafu-gains-total"><td>總計{filter && <small>（篩選：{filter}）</small>}{sub(report.total)}</td><Figures row={report.total} /></tr>
        </tbody>
      </table>
    </div>
    <p className="wafu-gains-note">
      依網站上的交易紀錄計算，金額以美元表示（日股以目前匯率換算）。賣出開倉的選擇權一律列為短期；持有超過一年列為長期。
      WS 損失不允（洗售）未估算，以券商報表為準。被指派的賣權權利金不併入股票成本，所以損益落在哪一年可能和券商不同。僅供對帳參考，不是報稅文件。
      {report.skipped > 0 && <b> {report.skipped} 筆{unrealized ? '持倉沒有現價' : '已平倉交易缺少平倉日期或價格'}，未列入。</b>}
    </p>
  </section>;
}
