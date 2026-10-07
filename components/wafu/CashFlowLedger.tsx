'use client';

import type { FormEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import type { CashFlow, CashFlowCurrency, CashFlowInput, CashFlowKind } from '@/lib/cash-flows';
import { cashFlowKey, cleanCashFlowNote, cashFlowKindLabels, cashFlowsToCsv, maxCashFlowBatch, signedCashFlow, summarizeCashFlows } from '@/lib/cash-flows';
import { downloadText, localDateKey } from '@/lib/download';
import type { CsvTrade } from '@/lib/trade-csv';
import { parseCsvTable, parseDate, parseNumber } from '@/lib/trade-csv';

const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const yen = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const dollars = (value: number) => `${value < 0 ? '−' : ''}$${amount.format(Math.abs(value))}`;
const signedDollars = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}$${amount.format(Math.abs(value))}`;
const native = (value: number, currency: CashFlowCurrency) => currency === 'JPY' ? `¥${yen.format(value)}` : `$${amount.format(value)}`;
const tone = (value: number) => Math.abs(value) < 0.005 ? '' : value > 0 ? 'positive' : 'negative';
const syncKey = 'optionflow-cashflow-sync';

type Draft = { date: string; kind: CashFlowKind; amount: string; currency: CashFlowCurrency; note: string };
const blankDraft = (): Draft => ({ date: localDateKey(), kind: 'deposit', amount: '', currency: 'USD', note: '' });
const toDraft = (flow: CashFlow): Draft => ({ date: flow.date, kind: flow.kind, amount: String(flow.amount), currency: flow.currency, note: flow.note });

async function send<T>(method: string, body: unknown, url = '/api/cash-flows'): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
  return payload;
}

// Ledger CSV columns (its own export, or a hand-made sheet).
const headerFields: Record<string, keyof CashFlowInput> = {
  date: 'date', 日期: 'date', 日付: 'date', kind: 'kind', type: 'kind', 類型: 'kind', 種類: 'kind', 'deposit/withdrawal': 'kind',
  amount: 'amount', 金額: 'amount', 金额: 'amount', currency: 'currency', 幣別: 'currency', 通貨: 'currency', note: 'note', notes: 'note', 備註: 'note', メモ: 'note',
};
const kindOf = (raw: string): CashFlowKind | null => {
  const value = raw.normalize('NFKC').trim().toLowerCase();
  if (['deposit', 'in', '存入', '入金', '存款'].includes(value)) return 'deposit';
  if (['withdrawal', 'withdraw', 'out', '提領', '出金', '提款'].includes(value)) return 'withdrawal';
  return null;
};

/** Rows of a ledger CSV, or why the file cannot be read. */
function readLedgerCsv(text: string): { flows: CashFlowInput[]; skipped: number } | { error: string } {
  const table = parseCsvTable(text);
  const columns = table.header.map((name) => headerFields[name.normalize('NFKC').trim().toLowerCase()] ?? headerFields[name.trim()] ?? null);
  if (!columns.includes('date') || !columns.includes('amount')) return { error: '找不到「date／日期」與「amount／金額」欄位。' };
  const flows: CashFlowInput[] = [];
  let skipped = 0;
  for (const cells of table.rows) {
    const get = (field: keyof CashFlowInput) => { const index = columns.indexOf(field); return index >= 0 ? (cells[index] ?? '').trim() : ''; };
    const date = parseDate(get('date'));
    const value = parseNumber(get('amount'));
    const kind = kindOf(get('kind')) ?? (value !== null && value < 0 ? 'withdrawal' : 'deposit');
    if (!date || value === null || value === 0) { skipped += 1; continue; }
    flows.push({ date, kind, amount: Math.abs(value), currency: get('currency').toUpperCase() === 'JPY' ? 'JPY' : 'USD', note: cleanCashFlowNote(get('note')) });
  }
  return { flows, skipped };
}

/**
 * 存提款紀錄 (the fourth tab of 交易與持倉): deposits and withdrawals, with what they add up to and how
 * the account has done against them. A new, edited or deleted record can move the latest cash row of
 * its currency by the same amount (同步調整現金餘額).
 */
export default function CashFlowLedger({ flows, error, trades, usdJpyRate, accountValue, onFlowsChanged, onTradesChanged, notify }: {
  /** null while loading. */
  flows: readonly CashFlow[] | null;
  error: string;
  trades: readonly CsvTrade[];
  usdJpyRate: number;
  /** Open cash rows and positions (short options count against it), in US dollars. */
  accountValue: { cash: number; positions: number };
  onFlowsChanged: () => Promise<unknown>;
  onTradesChanged: () => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState<{ id: number; draft: Draft } | null>(null);
  const [sync, setSync] = useState(() => { try { return localStorage.getItem(syncKey) !== 'off'; } catch { return true; } });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [restore, setRestore] = useState<{ name: string; add: CashFlowInput[]; existing: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => flows ?? [], [flows]);
  const summary = useMemo(() => summarizeCashFlows(list, usdJpyRate), [list, usdJpyRate]);
  const value = accountValue.cash + accountValue.positions;
  const gain = value - summary.net;
  const gainPct = summary.net > 0 ? gain / summary.net : null;

  const changeSync = (on: boolean) => {
    setSync(on);
    try { localStorage.setItem(syncKey, on ? 'on' : 'off'); } catch { /* the choice just is not remembered */ }
  };

  // Moves the latest open cash row of the currency by delta (a new row for a first deposit).
  const adjustCash = async (currency: CashFlowCurrency, delta: number, date: string): Promise<string> => {
    if (Math.abs(delta) < 0.005) return '';
    const target = trades
      .filter((trade) => !trade.derived && trade.type === 'CASH' && trade.status === 'open' && (trade.ticker ?? 'USD') === currency)
      .sort((a, b) => b.openDate.localeCompare(a.openDate) || b.id - a.id)[0];
    if (target) {
      const quantity = Math.max(0, Math.round((target.quantity + delta) * 100) / 100);
      await send('PUT', { ...target, quantity, collateral: quantity }, '/api/trades');
      return `現金 ${currency} ${native(target.quantity, currency)} → ${native(quantity, currency)}${target.quantity + delta < 0 ? '（不足，已歸零）' : ''}`;
    }
    if (delta < 0) return `沒有 ${currency} 現金列可扣除`;
    await send('POST', { type: 'CASH', event: 'CASH', ticker: currency, market: currency === 'JPY' ? 'JP' : 'US', strike: null, expiryDate: null, closeDate: null, quantity: delta, entryPrice: 1, currentPrice: 1, fees: 0, collateral: delta, openDate: date, status: 'open', quoteMode: 'manual', notes: '由存提款紀錄建立' }, '/api/trades');
    return `新增現金列 ${currency} ${native(delta, currency)}`;
  };

  const parsed = (form: Draft): CashFlowInput | string => {
    const value = parseNumber(form.amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return '請填日期';
    if (value === null || value <= 0) return '金額要大於 0';
    return { date: form.date, kind: form.kind, amount: Math.round(value * 100) / 100, currency: form.currency, note: form.note.trim() };
  };

  // Saves, then (if on) moves cash by the change in signed amount per currency.
  const run = async (work: () => Promise<{ message: string; deltas: Array<[CashFlowCurrency, number, string]> }>) => {
    setBusy(true);
    setFormError('');
    try {
      const { message, deltas } = await work();
      const cash = sync ? (await Promise.all(deltas.map(([currency, delta, date]) => adjustCash(currency, delta, date)))).filter(Boolean) : [];
      await onFlowsChanged();
      if (cash.length) onTradesChanged();
      notify([message, ...cash].join('；'));
      return true;
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '儲存失敗');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const flow = parsed(draft);
    if (typeof flow === 'string') return setFormError(flow);
    const done = await run(async () => {
      await send('POST', flow);
      return { message: `已記錄${cashFlowKindLabels[flow.kind]} ${native(flow.amount, flow.currency)}`, deltas: [[flow.currency, signedCashFlow(flow), flow.date]] };
    });
    if (done) setDraft((current) => ({ ...blankDraft(), kind: current.kind, currency: current.currency }));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const before = list.find((flow) => flow.id === editing.id);
    const flow = parsed(editing.draft);
    if (typeof flow === 'string') return setFormError(flow);
    if (!before) return;
    const done = await run(async () => {
      await send('PUT', { id: editing.id, ...flow });
      const deltas: Array<[CashFlowCurrency, number, string]> = before.currency === flow.currency
        ? [[flow.currency, signedCashFlow(flow) - signedCashFlow(before), flow.date]]
        : [[before.currency, -signedCashFlow(before), before.date], [flow.currency, signedCashFlow(flow), flow.date]];
      return { message: '已更新存提款紀錄', deltas };
    });
    if (done) setEditing(null);
  };

  const remove = async (flow: CashFlow) => {
    await run(async () => {
      await send('DELETE', { id: flow.id });
      return { message: `已刪除 ${flow.date} 的${cashFlowKindLabels[flow.kind]}紀錄`, deltas: [[flow.currency, -signedCashFlow(flow), flow.date]] };
    });
  };

  const pickRestore = async (file: File | undefined) => {
    if (!file) return;
    setFormError('');
    const read = readLedgerCsv(await file.text());
    if ('error' in read) return setFormError(read.error);
    // One stored record answers one row: two identical deposits on a day stay two.
    const pool = new Map<string, number>();
    for (const flow of list) pool.set(cashFlowKey(flow), (pool.get(cashFlowKey(flow)) ?? 0) + 1);
    const addRows = read.flows.filter((flow) => { const left = pool.get(cashFlowKey(flow)) ?? 0; if (left) { pool.set(cashFlowKey(flow), left - 1); return false; } return true; });
    setRestore({ name: file.name, add: addRows, existing: read.flows.length - addRows.length, skipped: read.skipped });
  };

  const applyRestore = async () => {
    if (!restore?.add.length) return setRestore(null);
    setBusy(true);
    setFormError('');
    try {
      for (let index = 0; index < restore.add.length; index += maxCashFlowBatch) await send('POST', { flows: restore.add.slice(index, index + maxCashFlowBatch) });
      await onFlowsChanged();
      notify(`已從 CSV 加入 ${restore.add.length} 筆存提款紀錄（不調整現金餘額）`);
      setRestore(null);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '加入失敗');
    } finally {
      setBusy(false);
    }
  };

  const field = (form: Draft, set: (next: Draft) => void, compact = false) => <>
    <div className="cf-kind" role="radiogroup" aria-label="類型">
      {(['deposit', 'withdrawal'] as const).map((kind) => <button type="button" key={kind} role="radio" aria-checked={form.kind === kind} className={`${kind} ${form.kind === kind ? 'on' : ''}`} disabled={busy} onClick={() => set({ ...form, kind })}>{cashFlowKindLabels[kind]}</button>)}
    </div>
    <label className="cf-date"><span>日期</span><input type="date" value={form.date} disabled={busy} required onChange={(event) => set({ ...form, date: event.target.value })} /></label>
    <label className="cf-amount"><span>金額</span><input inputMode="decimal" value={form.amount} disabled={busy} placeholder="0.00" onChange={(event) => set({ ...form, amount: event.target.value })} /></label>
    <label className="cf-currency"><span>幣別</span><select value={form.currency} disabled={busy} onChange={(event) => set({ ...form, currency: event.target.value as CashFlowCurrency })}><option value="USD">USD</option><option value="JPY">JPY</option></select></label>
    {!compact && <label className="cf-note"><span>備註</span><input value={form.note} disabled={busy} maxLength={500} placeholder="例：ACH 入金" onChange={(event) => set({ ...form, note: event.target.value })} /></label>}
  </>;

  return <div className="wafu-cashflows">
    <div className="wafu-gains-head">
      <div><h3>存提款紀錄</h3><span>記錄存入與提領，看帳戶相對投入資金的表現。</span></div>
      <div className="wafu-gains-actions">
        <button type="button" disabled={!list.length} onClick={() => downloadText(`optionflow-cash-flows-${localDateKey()}.csv`, cashFlowsToCsv(list))}>匯出 CSV</button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>從 CSV 加入</button>
        <input ref={fileRef} className="visually-hidden" type="file" accept=".csv,text/csv,text/plain" tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void pickRestore(file); }} />
      </div>
    </div>

    <div className="cf-summary">
      <article><p>累計存入</p><strong>{dollars(summary.deposited)}</strong><span>{summary.depositCount} 筆</span></article>
      <article><p>累計提領</p><strong>{dollars(summary.withdrawn)}</strong><span>{summary.withdrawalCount} 筆</span></article>
      <article><p>淨投入</p><strong>{dollars(summary.net)}</strong><span>存入 − 提領{summary.hasYen ? `（日圓以 ${usdJpyRate.toFixed(1)} 換算）` : ''}</span></article>
      <article><p>帳戶淨值（估）</p><strong>{dollars(value)}</strong><span>現金 {dollars(accountValue.cash)} ＋ 持倉 {dollars(accountValue.positions)}</span></article>
      <article className="cf-return"><p>投入報酬</p><strong className={tone(gain)}>{list.length ? signedDollars(gain) : '—'}</strong><span className={tone(gain)}>{list.length && gainPct !== null ? `${gainPct >= 0 ? '+' : '−'}${amount.format(Math.abs(gainPct * 100))}%` : '先記錄存入金額'}</span></article>
    </div>

    <form className="cf-form" onSubmit={(event) => void add(event)}>
      {field(draft, setDraft)}
      <label className="cf-sync"><input type="checkbox" checked={sync} disabled={busy} onChange={(event) => changeSync(event.target.checked)} />同步調整現金餘額</label>
      <button type="submit" className="primary-button" disabled={busy}>{busy ? '儲存中…' : '記錄'}</button>
    </form>
    {formError && <p className="cf-error" role="alert">{formError}</p>}
    {restore && <div className="cf-restore" role="status">
      <span>「{restore.name}」有 {restore.add.length + restore.existing} 筆{restore.existing ? `，其中 ${restore.existing} 筆已在紀錄中` : ''}{restore.skipped ? `；${restore.skipped} 列無法辨識已略過` : ''}。</span>
      <button type="button" className="primary-button" disabled={busy || !restore.add.length} onClick={() => void applyRestore()}>加入 {restore.add.length} 筆</button>
      <button type="button" className="cancel-button" disabled={busy} onClick={() => setRestore(null)}>取消</button>
    </div>}

    <div className="wafu-gains-wrap">
      <table className="wafu-gains-table cf-table">
        <thead><tr><th scope="col">日期</th><th scope="col">類型</th><th scope="col">金額</th><th scope="col">幣別</th><th scope="col">備註</th><th scope="col"><span className="visually-hidden">操作</span></th></tr></thead>
        <tbody>
          {flows === null && <tr className="wafu-gains-empty"><td colSpan={6}>{error || '正在讀取存提款紀錄…'}</td></tr>}
          {flows !== null && !list.length && <tr className="wafu-gains-empty"><td colSpan={6}>還沒有紀錄。在上方填入第一筆存入金額。</td></tr>}
          {list.map((flow) => editing?.id === flow.id
            ? <tr key={flow.id} className="cf-editing"><td colSpan={6}><div className="cf-edit-row">
              {field(editing.draft, (next) => setEditing({ id: flow.id, draft: next }))}
              <button type="button" className="primary-button" disabled={busy} onClick={() => void saveEdit()}>儲存</button>
              <button type="button" className="cancel-button" disabled={busy} onClick={() => setEditing(null)}>取消</button>
            </div></td></tr>
            : <tr key={flow.id}>
              <td>{flow.date}</td>
              <td><span className={`cf-tag ${flow.kind}`}>{cashFlowKindLabels[flow.kind]}</span></td>
              <td className={flow.kind === 'deposit' ? 'positive' : 'negative'}>{flow.kind === 'deposit' ? '+' : '−'}{native(flow.amount, flow.currency)}</td>
              <td>{flow.currency}</td>
              <td className="cf-note-cell">{flow.note || '—'}</td>
              <td className="cf-actions"><button type="button" disabled={busy} onClick={() => setEditing({ id: flow.id, draft: toDraft(flow) })}>編輯</button><button type="button" className="danger" disabled={busy} onClick={() => void remove(flow)}>刪除</button></td>
            </tr>)}
        </tbody>
      </table>
    </div>
    <p className="wafu-gains-note"><b>帳戶淨值</b>＝未平倉的現金列＋股票市值＋買方選擇權市值−賣方選擇權目前權利金，日圓以 {usdJpyRate.toFixed(1)} 換算；現金列要是最新的才準。<b>同步調整現金餘額</b>開啟時，新增、修改或刪除紀錄會把差額加到最新一筆同幣別的現金列（沒有現金列時，存入會新增一筆）。從 CSV 加入的紀錄不會調整現金。</p>
  </div>;
}
