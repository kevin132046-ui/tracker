import type { TradesChangeAction, TradesChanged, TradesChangeTag } from '@/lib/trades-changed';
import { isChangeReason, isOpId, parseTradesChanged } from '@/lib/trades-changed';

/** app_meta key of the last change to the trade records (lib/trades-changed.ts). */
export const tradesChangedKey = 'trades_changed';

/** The action and operation id for a write, from the optional tag a client sent. */
export function changeFrom(tag: unknown, fallback: TradesChangeAction): { action: TradesChangeAction; op: string | null } {
  const { reason, op } = (tag && typeof tag === 'object' ? tag : {}) as TradesChangeTag;
  return { action: isChangeReason(reason) ? reason : fallback, op: isOpId(op) ? op : null };
}

/**
 * The statement that records a change; it goes in the same batch as the write. A request carrying the
 * same operation id as the stored record adds its count to it, so an import sent in several requests
 * shows its whole size.
 */
export function tradesChangedStatement(db: D1Database, action: TradesChangeAction, count: number, op: string | null = null) {
  const value = JSON.stringify({ at: new Date().toISOString(), action, count: Math.max(0, Math.round(count)), op });
  return db.prepare(`INSERT INTO app_meta (key, value) VALUES ('${tradesChangedKey}', ?)
    ON CONFLICT(key) DO UPDATE SET value = CASE
      WHEN json_extract(excluded.value, '$.op') IS NOT NULL AND json_extract(app_meta.value, '$.op') = json_extract(excluded.value, '$.op')
        THEN json_set(excluded.value, '$.count', coalesce(json_extract(app_meta.value, '$.count'), 0) + json_extract(excluded.value, '$.count'))
      ELSE excluded.value END`).bind(value);
}

/**
 * The last change. Before anything was recorded, the newest trade's creation time stands in (updated_at
 * also moves with every quote refresh, so it can't).
 */
export async function readTradesChanged(db: D1Database): Promise<TradesChanged | null> {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(tradesChangedKey).first<{ value: string }>();
  const recorded = parseTradesChanged(row?.value);
  if (recorded) return recorded;
  const newest = await db.prepare('SELECT MAX(created_at) AS at FROM trades').first<{ at: string | null }>();
  return newest?.at ? { at: newest.at, action: null, count: null } : null;
}
