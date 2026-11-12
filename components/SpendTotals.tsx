'use client';

import { useEffect, useState } from 'react';
import type { QuotaReport } from '@/lib/openai-free-tier';
import type { BalanceEstimate, SavedBalance, SpendSummary } from '@/lib/openai-spend';
import { searchCostEstimate } from '@/lib/openai-spend';

type Spend = { spend: SpendSummary | null; costsError: string | null; saved: SavedBalance | null; balance: BalanceEstimate | null };
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: Spend };

const usd = (value: number) => `$${value < 10 ? value.toFixed(2) : value.toFixed(0)}`;
const tokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value);
const shortDate = (iso: string) => new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(new Date(iso));

/**
 * 今日總量 in the AI settings: the two free groups (from the quota report), what was billed today and this
 * month (OpenAI Costs API), and the prepaid balance estimate with the web searches it still covers.
 */
export default function SpendTotals({ quota, refresh }: { quota: QuotaReport | null | undefined; refresh: unknown }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/openai-spend', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Spend & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
        setLoad({ state: 'ok', data: payload });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoad({ state: 'error', message: error instanceof Error ? error.message : '讀不到費用資料。' }); });
    return () => controller.abort();
  }, [refresh]);

  const send = (method: 'PUT' | 'DELETE') => {
    setBusy(true);
    setSaveError(null);
    fetch('/api/openai-spend', method === 'PUT'
      ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: draft }) }
      : { method })
      .then(async (response) => {
        const payload = await response.json() as Spend & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
        setLoad({ state: 'ok', data: payload });
        setDraft('');
      })
      .catch((error: unknown) => setSaveError(error instanceof Error ? error.message : '沒有存成功。'))
      .finally(() => setBusy(false));
  };

  const groups = quota?.usageAvailable ? quota.groups : [];
  const data = load.state === 'ok' ? load.data : null;
  const spend = data?.spend ?? null;
  const balance = data?.balance ?? null;

  return <section className="spend-totals" aria-labelledby="spend-totals-title">
    <h4 id="spend-totals-title">今日總量</h4>
    <div className="spend-totals-cells">
      {groups.map((group) => <div key={group.id} className="spend-cell">
        <small>免費 · {group.label}</small>
        <b>{tokens(group.used)} <span>/ {tokens(group.limit)}</span></b>
        <i className="spend-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, group.limit ? group.used / group.limit * 100 : 0)}%` }} /></i>
      </div>)}
      <div className="spend-cell is-paid">
        <small>要付費的部分（今日）</small>
        <b>{spend ? usd(spend.today.total) : '—'}</b>
        <span>{spend ? `搜尋費 ${usd(spend.today.search)} · 其他 ${usd(spend.today.other)} · 本月 ${usd(spend.month)}` : load.state === 'loading' ? '讀取中…' : data?.costsError ?? (load.state === 'error' ? load.message : '')}</span>
      </div>
    </div>

    <div className="spend-balance">
      {balance ? <p className={balance.low ? 'is-low' : ''}>
        預付餘額約 <b>{usd(balance.remaining)}</b> · 約可再搜尋 <b>{balance.searchesLeft.toLocaleString('en-US')}</b> 次
        <small>（{shortDate(balance.at)} 記錄 {usd(balance.amount)}，之後花了 {usd(balance.spent)}；每次搜尋以 {Math.round(searchCostEstimate * 1000) / 10} 美分估）</small>
        {balance.low && <strong>餘額不到 1 美元：餘額歸零時免費額度也會一起停用，記得加值。</strong>}
      </p> : <p>{data?.saved ? '讀不到費用，暫時算不出餘額。' : '填入 OpenAI Billing 頁上的目前餘額，就能推算還能搜尋幾次。'}</p>}
      <div className="spend-balance-form">
        <label><span>目前預付餘額（美元）</span>
          <input type="text" inputMode="decimal" value={draft} placeholder={data?.saved ? String(data.saved.amount) : '例如 4.90'} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <button type="button" disabled={busy || !draft.trim()} onClick={() => send('PUT')}>記錄餘額</button>
        {data?.saved && <button type="button" disabled={busy} onClick={() => send('DELETE')}>清除</button>}
        <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer noopener">開啟 OpenAI Billing</a>
      </div>
      {saveError && <p className="ai-free-tier-error" role="alert">{saveError}</p>}
    </div>
    <p className="free-quota-note">免費額度內的用量不收費，不會出現在費用裡。OpenAI 的費用資料約有數小時延遲；加值後記得更新一次餘額。</p>
  </section>;
}
