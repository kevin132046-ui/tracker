'use client';

import type { QuotaReport } from '@/lib/openai-free-tier';
import { freeTierArticleUrl } from '@/lib/openai-free-tier';

const tokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(value % 1_000_000 ? 2 : 0)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value);

/** One line about the selected ChatGPT model's free tokens today, or why ChatGPT is blocked. */
export function freeQuotaLine(quota: QuotaReport | null | undefined) {
  if (!quota) return '正在查詢 ChatGPT 今日免費額度…';
  if (quota.enforced === false) return `未設定 OpenAI 管理金鑰，無法檢查免費額度：ChatGPT${quota.selected ? `（${quota.selected.model}）` : ''}照常使用，用量由你的 OpenAI 帳戶計費。`;
  if (!quota.usageAvailable) return `${quota.usageError ?? '無法讀取今日用量。'}ChatGPT 已暫停，以免超出免費額度。`;
  const selected = quota.selected;
  if (!selected) return '尚未選擇 ChatGPT 模型。';
  if (!selected.group) return `${selected.model} 不在免費額度清單中，ChatGPT 已暫停。`;
  return `ChatGPT（${selected.model}）今日免費剩餘 ${tokens(selected.remaining)} / ${tokens(selected.group.limit)} tokens（${selected.group.label}，組內共用）· UTC 00:00（台灣 08:00）重置`;
}

/** True when ChatGPT has free tokens left for the selected model. */
export const freeQuotaOpen = (quota: QuotaReport | null | undefined) => quota?.enforced === false || Boolean(quota?.usageAvailable && quota.selected?.group && quota.selected.remaining > 0);

export function FreeQuotaTable({ quota }: { quota: QuotaReport | null | undefined }) {
  if (!quota) return <p className="free-quota-note">正在查詢 OpenAI 免費額度…</p>;
  const checked = quota.list.checkedAt ? new Intl.DateTimeFormat('zh-TW', { timeStyle: 'short' }).format(new Date(quota.list.checkedAt)) : '';
  return <div className="free-quota">
    <table>
      <caption>OpenAI 每日免費額度（{quota.tier === 'high' ? 'tier 3 以上' : 'tier 1–2'}，已保留 5% 緩衝）</caption>
      <thead><tr><th>組別</th><th>上限</th><th>今日已用</th><th>剩餘</th></tr></thead>
      <tbody>{quota.groups.map((group) => <tr key={group.id} className={quota.selected?.group?.id === group.id ? 'is-selected' : ''}>
        <td>{group.label}</td><td>{tokens(group.limit)}</td><td>{quota.usageAvailable ? tokens(group.used) : '—'}</td><td>{quota.usageAvailable ? tokens(group.remaining) : '—'}</td>
      </tr>)}</tbody>
    </table>
    <p className="free-quota-note">
      {quota.list.source === 'article' ? `清單於 ${checked} 從 OpenAI 說明頁讀取。` : `無法讀取 OpenAI 說明頁，暫用 ${quota.list.asOf} 的內建清單。`}
      {' '}<a href={freeTierArticleUrl} target="_blank" rel="noreferrer noopener">OpenAI 免費額度說明</a>
      {!quota.usageAvailable && <><br /><b>{quota.usageError}</b></>}
    </p>
  </div>;
}
