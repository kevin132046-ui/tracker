'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type ManualQuoteRow = {
  id: number;
  ticker: string;
  /** e.g. "PUT 75" or "股票". */
  label: string;
  /** e.g. "到期 2026-10-17 · 成本 $1.20". */
  sub: string;
  current: number | null;
  /** A reference shown beside the input, e.g. "標的 $62.10". */
  hint?: string;
  auto: boolean;
  currency: '$' | '¥';
};

/**
 * 手動報價 (from the prototype): every open position whose price the API cannot fetch (options,
 * manual stocks) in one list, so a round of prices can be entered and saved at once. Only changed
 * rows are saved; each saved row switches to manual quoting, as the inline editor does.
 */
export default function ManualQuotes({ rows, onSave, onClose }: {
  rows: ManualQuoteRow[];
  onSave: (changes: Array<{ id: number; price: number }>) => Promise<number>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((row) => [row.id, row.current === null ? '' : String(row.current)])));
  const [showAuto, setShowAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose, saving]);

  const visible = rows.filter((row) => showAuto || !row.auto);
  const changes = useMemo(() => rows.flatMap((row) => {
    const text = values[row.id]?.trim() ?? '';
    if (!text) return [];
    const price = Number(text);
    return Number.isFinite(price) && price >= 0 && price !== row.current ? [{ id: row.id, price }] : [];
  }), [rows, values]);
  const invalid = rows.some((row) => { const text = values[row.id]?.trim() ?? ''; return text !== '' && !(Number(text) >= 0); });

  const save = async () => {
    if (!changes.length || invalid) return;
    setSaving(true);
    // A partial failure keeps the dialog open (the page reports which part failed).
    try { await onSave(changes); onClose(); } catch { /* stay open */ } finally { setSaving(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="wafu-mq" role="dialog" aria-modal="true" aria-labelledby="wafu-mq-title">
      <header>
        <div><p className="eyebrow">Manual quotes</p><h2 id="wafu-mq-title">手動報價</h2></div>
        <button type="button" className="wafu-research-close" onClick={onClose} aria-label="關閉手動報價" disabled={saving}>×</button>
      </header>
      <p className="wafu-mq-note">無法由 API 取得報價的部位（如選擇權）可在這裡一次輸入現價；只會儲存有改動的列，並改為手動報價。</p>
      {rows.some((row) => row.auto) && <label className="wafu-mq-toggle"><input type="checkbox" checked={showAuto} onChange={(event) => setShowAuto(event.target.checked)} />也顯示自動報價的股票</label>}
      <div className="wafu-mq-list">
        {!visible.length && <p className="wafu-mq-empty">目前沒有需要手動報價的未平倉部位。</p>}
        {visible.map((row, index) => {
          const text = values[row.id] ?? '';
          const bad = text.trim() !== '' && !(Number(text) >= 0);
          const changed = changes.some((change) => change.id === row.id);
          return <label key={row.id} className={`wafu-mq-row ${changed ? 'is-changed' : ''} ${bad ? 'is-bad' : ''}`}>
            <span className="wafu-mq-name"><b>{row.ticker}</b><em>{row.label}</em><small>{row.sub}</small></span>
            {row.hint && <span className="wafu-mq-hint">{row.hint}</span>}
            <span className="wafu-mq-input"><i>{row.currency}</i><input ref={index === 0 ? firstRef : undefined} inputMode="decimal" value={text} placeholder="—" aria-label={`${row.ticker} ${row.label} 現價`} onChange={(event) => setValues((current) => ({ ...current, [row.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save(); }} /></span>
          </label>;
        })}
      </div>
      <footer>
        <span>{invalid ? '有無效的價格' : changes.length ? `將更新 ${changes.length} 筆` : '尚未改動'}</span>
        <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>取消</button>
        <button type="button" className="primary-button" onClick={() => void save()} disabled={saving || invalid || !changes.length}>{saving ? '儲存中…' : '儲存'}</button>
      </footer>
    </section>
  </div>;
}
