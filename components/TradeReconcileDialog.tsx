'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { CsvTrade } from '@/lib/trade-csv';
import { tradesToCsv } from '@/lib/trade-csv';
import { applyTradeChanges, type BatchChanges } from '@/lib/trade-batch';
import { contractLabel, diffTrades } from '@/lib/trade-diff';
import { reconcileTrades, reconItemsFromTrades, type ReconResult } from '@/lib/trade-reconcile';

/**
 * 整理選擇權紀錄: the stored trades reconciled (lib/trade-reconcile.ts), shown as groups of changes
 * with every field that changes (before → after). Nothing is written until 套用; a CSV backup of the
 * current data downloads first, then the chosen changes are saved through /api/trades/batch.
 */
type Group = 'pair' | 'matched' | 'orphan' | 'expiry';
type Entry = { ref: number | null; action: 'update' | 'delete' | 'create'; before: CsvTrade | null; after: CsvTrade | null; detail: string };
type Unit = { key: string; group: Group; title: string; entries: Entry[] };

const groupText: Record<Group, { title: string; note: string }> = {
  pair: { title: '合併開倉與平倉成交', note: '券商把開倉（OPEN CONTRACT）與平倉（CLOSING CONTRACT）記成兩筆；合併成一筆已平倉交易，平倉成交那筆刪除。' },
  matched: { title: '與已平倉紀錄對應', note: '這些平倉成交和你先前手動記錄的已平倉交易是同一筆：以券商的平倉日與平倉價更新那筆紀錄，重複的平倉成交刪除。' },
  orphan: { title: '找不到開倉的平倉成交', note: '開倉在資料起點之前，無法計算損益。可轉為已平倉（損益以 0 計，之後可編輯補上開倉價），或直接刪除。' },
  expiry: { title: '已過到期日仍未平倉', note: '到期日已過的選擇權：以 0 平倉。有「ASSIGNED」股票紀錄的標為被指派，平倉日用指派當天。' },
};
const groups: Group[] = ['pair', 'matched', 'orphan', 'expiry'];

function buildUnits(trades: readonly CsvTrade[], result: ReconResult): Unit[] {
  const byRef = new Map(trades.map((trade) => [trade.id, trade] as const));
  const changeByRef = new Map(result.changes.map((change) => [change.ref, change] as const));
  const matchedRefs = new Set(result.changes.filter((change) => change.reason === 'matched').map((change) => change.ref));
  const used = new Set<number>();
  const units: Unit[] = [];
  const updateEntry = (ref: number): Entry[] => {
    const change = changeByRef.get(ref);
    if (!change || used.has(ref)) return [];
    used.add(ref);
    const added = result.added.filter((item) => item.fromRef === ref).map<Entry>((item) => ({ ref: null, action: 'create', before: null, after: item.trade, detail: item.detail }));
    return [{ ref, action: change.trade ? 'update' : 'delete', before: byRef.get(ref) ?? null, after: change.trade, detail: change.detail }, ...added];
  };
  for (const change of result.changes) {
    if (change.reason !== 'folded' && change.reason !== 'orphan') continue;
    const group: Group = change.reason === 'orphan' ? 'orphan' : change.related.some((ref) => matchedRefs.has(ref)) ? 'matched' : 'pair';
    const before = byRef.get(change.ref) ?? null;
    const entries = [...updateEntry(change.ref), ...change.related.flatMap(updateEntry)];
    units.push({ key: `c${change.ref}`, group, title: before ? contractLabel(before, false) : `#${change.ref}`, entries });
  }
  for (const change of result.changes) {
    if (used.has(change.ref)) continue;
    const before = byRef.get(change.ref) ?? null;
    const group: Group = change.reason === 'expired' || change.reason === 'assigned' ? 'expiry' : change.reason === 'matched' ? 'matched' : 'pair';
    units.push({ key: `u${change.ref}`, group, title: before ? contractLabel(before, false) : `#${change.ref}`, entries: updateEntry(change.ref) });
  }
  return units;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const actionLabel: Record<Entry['action'], string> = { update: '更新', delete: '刪除', create: '新增' };

export default function TradeReconcileDialog({ trades, today, onClose, onApplied }: {
  trades: readonly CsvTrade[];
  today: string;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const titleId = useId();
  const stored = useMemo(() => trades.filter((trade) => !trade.derived), [trades]);
  const result = useMemo(() => reconcileTrades(reconItemsFromTrades(stored), { today, label: (ref) => `#${ref}` }), [stored, today]);
  const units = useMemo(() => buildUnits(stored, result), [stored, result]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(units.map((unit) => unit.key)));
  const [orphanMode, setOrphanMode] = useState<'convert' | 'delete'>('convert');
  const [open, setOpen] = useState<Set<Group>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  const entriesOf = (unit: Unit) => unit.group === 'orphan' && orphanMode === 'delete'
    ? unit.entries.map<Entry>((entry) => entry.action === 'update' && entry.ref !== null && entry.after?.notes.includes('開倉紀錄不在資料中') ? { ...entry, action: 'delete', after: null, detail: '刪除這筆平倉成交' } : entry)
    : unit.entries;
  const chosen = units.filter((unit) => selected.has(unit.key));
  const changes = useMemo<BatchChanges<CsvTrade>>(() => {
    const batch: BatchChanges<CsvTrade> = { updates: [], creates: [], deletes: [] };
    for (const unit of units) {
      if (!selected.has(unit.key)) continue;
      for (const entry of entriesOf(unit)) {
        if (entry.action === 'update' && entry.ref !== null && entry.after) batch.updates.push({ ...entry.after, id: entry.ref });
        else if (entry.action === 'delete' && entry.ref !== null) batch.deletes.push(entry.ref);
        else if (entry.action === 'create' && entry.after) batch.creates.push(entry.after);
      }
    }
    return batch;
    // entriesOf depends only on orphanMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, selected, orphanMode]);
  const total = changes.updates.length + changes.creates.length + changes.deletes.length;

  const toggleUnit = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleGroup = (group: Group, on: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const unit of units) if (unit.group === group) { if (on) next.add(unit.key); else next.delete(unit.key); }
    return next;
  });

  const apply = async () => {
    if (!total || busy) return;
    setBusy(true);
    setError('');
    try {
      download(`optionflow-backup-before-cleanup-${today}.csv`, tradesToCsv(stored));
      await applyTradeChanges(changes, (done, all) => setProgress({ done, total: all }));
      onApplied(`已整理 ${chosen.length} 組紀錄：更新 ${changes.updates.length}、刪除 ${changes.deletes.length}${changes.creates.length ? `、新增 ${changes.creates.length}` : ''} 筆（已先下載備份 CSV）`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '整理失敗，請稍後再試。');
      setBusy(false);
    }
  };

  return <div className="confirm-backdrop import-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="import-modal recon-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header>
        <div><p className="eyebrow">Data check</p><h2 id={titleId}>整理選擇權紀錄</h2></div>
        <button type="button" className="close-button" onClick={onClose} disabled={busy} aria-label="關閉">×</button>
      </header>
      <div className="import-body">
        {!units.length
          ? <p className="import-alert recon-clean">沒有需要整理的紀錄：每筆平倉成交都已配對，也沒有過了到期日仍未平倉的選擇權。</p>
          : <>
            <p className="recon-intro">依券商描述（OPEN／CLOSING CONTRACT）配對開倉與平倉，並把到期日已過的選擇權平倉。每項都列出會改變的欄位；取消勾選的項目維持原樣。套用前會自動下載目前資料的 CSV 備份。</p>
            {groups.map((group) => {
              const list = units.filter((unit) => unit.group === group);
              if (!list.length) return null;
              const on = list.filter((unit) => selected.has(unit.key)).length;
              const expanded = open.has(group);
              return <section key={group} className="recon-group">
                <div className="recon-group-head">
                  <label className="recon-check"><input type="checkbox" checked={on === list.length} ref={(input) => { if (input) input.indeterminate = on > 0 && on < list.length; }} disabled={busy} onChange={(event) => toggleGroup(group, event.target.checked)} /><b>{groupText[group].title}</b><span className="recon-count">{on}／{list.length}</span></label>
                  <button type="button" className="recon-toggle" aria-expanded={expanded} onClick={() => setOpen((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}>{expanded ? '收合明細' : '查看明細'}</button>
                </div>
                <p className="recon-note">{groupText[group].note}</p>
                {group === 'orphan' && <div className="recon-orphan-mode" role="radiogroup" aria-label="找不到開倉的平倉成交">
                  <label><input type="radio" name={`${titleId}-orphan`} checked={orphanMode === 'convert'} disabled={busy} onChange={() => setOrphanMode('convert')} />轉為已平倉（損益 0）</label>
                  <label><input type="radio" name={`${titleId}-orphan`} checked={orphanMode === 'delete'} disabled={busy} onChange={() => setOrphanMode('delete')} />刪除</label>
                </div>}
                {expanded && <ul className="recon-units">{list.map((unit) => <li key={unit.key} className={selected.has(unit.key) ? '' : 'is-off'}>
                  <label className="recon-check"><input type="checkbox" checked={selected.has(unit.key)} disabled={busy} onChange={() => toggleUnit(unit.key)} /><b>{unit.title}</b></label>
                  {entriesOf(unit).map((entry, index) => <div key={`${entry.ref ?? 'new'}-${index}`} className={`recon-entry is-${entry.action}`}>
                    <span className="recon-action">{actionLabel[entry.action]}{entry.ref !== null ? ` #${entry.ref}` : ''}</span>
                    <span className="recon-detail">{entry.detail}</span>
                    {entry.action === 'update' && <span className="recon-diff">{diffTrades(entry.before, entry.after).map((diff) => <span key={diff.field}><i>{diff.label}</i>{diff.before}<em>→</em><b>{diff.after}</b></span>)}</span>}
                    {entry.action === 'create' && entry.after && <span className="recon-diff"><span><i>數量</i><b>{entry.after.quantity}</b></span><span><i>狀態</i><b>{entry.after.status === 'closed' ? '已平倉' : '未平倉'}</b></span></span>}
                  </div>)}
                </li>)}</ul>}
              </section>;
            })}
          </>}
        {error && <p className="import-alert is-error" role="alert">{error}</p>}
      </div>
      <footer className="import-footer">
        <div className="import-status" aria-live="polite">
          {busy ? <><progress max={progress.total || total} value={progress.done} /><span>儲存中 {progress.done} / {progress.total || total}…</span></> : units.length ? <span>已選 {chosen.length} 組，共 {total} 項變更</span> : null}
        </div>
        <button type="button" className="cancel-button" disabled={busy} onClick={onClose}>{units.length ? '取消' : '關閉'}</button>
        {units.length > 0 && <button type="button" className="primary-button" disabled={busy || !total} onClick={() => void apply()}>{busy ? '整理中…' : `套用 ${total} 項變更`}</button>}
      </footer>
    </section>
  </div>;
}
