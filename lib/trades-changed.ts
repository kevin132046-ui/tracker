/**
 * 設定 → 資料 → 匯入與匯出: when the trade records were last changed (and how), and the latest date
 * they cover. Every trade write records { at, action, count } in app_meta (lib/server/trades-changed.ts);
 * requests that belong to one import or tidy-up share an operation id, so their counts add up.
 */
export type TradesChangeAction = 'add' | 'edit' | 'delete' | 'clear' | 'import' | 'reconcile' | 'restore' | 'batch';
export type TradesChanged = { at: string; action: TradesChangeAction | null; count: number | null };
/** What a client may say a write was part of (the server decides add / edit / delete / clear itself). */
export type TradesChangeReason = 'import' | 'reconcile';
export type TradesChangeTag = { reason?: TradesChangeReason; op?: string };

const actions: readonly TradesChangeAction[] = ['add', 'edit', 'delete', 'clear', 'import', 'reconcile', 'restore', 'batch'];
export const isChangeReason = (value: unknown): value is TradesChangeReason => value === 'import' || value === 'reconcile';
export const isOpId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{8,40}$/.test(value);

/** A tag for one multi-request operation (an import or a tidy-up). */
export function newChangeTag(reason: TradesChangeReason): TradesChangeTag {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return { reason, op: random };
}

/** The stored record, or null when it is missing or malformed. */
export function parseTradesChanged(value: unknown): TradesChanged | null {
  const record = typeof value === 'string' ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })() : value;
  if (!record || typeof record !== 'object') return null;
  const { at, action, count } = record as Record<string, unknown>;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return {
    at,
    action: actions.includes(action as TradesChangeAction) ? action as TradesChangeAction : null,
    count: typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.round(count) : null,
  };
}

export const changeActionLabels: Record<TradesChangeAction, string> = {
  add: '新增交易', edit: '編輯交易', delete: '刪除交易', clear: '清除全部交易',
  import: '匯入交易', reconcile: '整理選擇權紀錄', restore: '還原備份', batch: '批次更新',
};

/** The latest open or close date among the recorded trades (not the derived dividend rows). */
export function latestRecordDate(trades: ReadonlyArray<{ openDate?: string | null; closeDate?: string | null; derived?: unknown }>) {
  let latest: string | null = null;
  for (const trade of trades) {
    if (trade.derived) continue;
    for (const date of [trade.openDate, trade.closeDate]) {
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) && (!latest || date > latest)) latest = date.slice(0, 10);
    }
  }
  return latest;
}
