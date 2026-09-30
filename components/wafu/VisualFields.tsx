'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 欄位 for the visual positions list (from the prototype): extra figures shown as a quiet strip
 * under each position. The choice is kept in this browser.
 */
export type VisualFieldId = 'held' | 'annual' | 'range' | 'dte' | 'delta' | 'theta' | 'moneyness' | 'assign' | 'capital';

export const visualFields: ReadonlyArray<{ id: VisualFieldId; label: string; hint: string }> = [
  { id: 'held', label: '持有天數', hint: '最早一筆未平倉開倉至今' },
  { id: 'annual', label: '年化報酬', hint: '報酬率 × 365 ÷ 持有天數（單利）' },
  { id: 'range', label: '52 週區間', hint: '現價在一年高低點之間的位置' },
  { id: 'dte', label: '到期天數', hint: '最近到期的未平倉選擇權' },
  { id: 'delta', label: 'Delta', hint: '股數當量：股票股數 + 選擇權 Delta × 100 × 口數' },
  { id: 'theta', label: 'Theta/日', hint: '每過一日的部位價值變化；賣方為正' },
  { id: 'moneyness', label: '距履約價', hint: '最接近價內的選擇權，正值代表價外' },
  { id: 'assign', label: '被指派機率', hint: '到期價內機率（取最高者）' },
  { id: 'capital', label: '擔保占比', hint: '這檔投入資本 ÷ 全部未平倉投入資本' },
];

const storageKey = 'optionflow-visual-fields';
export const defaultVisualFields: VisualFieldId[] = ['held', 'range', 'dte', 'theta'];
const known = new Set(visualFields.map((field) => field.id));

export function loadVisualFields(): VisualFieldId[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null') as unknown;
    if (Array.isArray(saved)) return saved.filter((id): id is VisualFieldId => typeof id === 'string' && known.has(id as VisualFieldId));
  } catch { /* storage unavailable */ }
  return defaultVisualFields;
}

export function saveVisualFields(fields: VisualFieldId[]) {
  try { window.localStorage.setItem(storageKey, JSON.stringify(fields)); } catch { /* storage unavailable */ }
}

export function VisualFieldPicker({ fields, onChange }: { fields: VisualFieldId[]; onChange: (fields: VisualFieldId[]) => void }) {
  // The panel lives in a fixed layer on <body>: the filter row scrolls sideways and the rows below
  // would otherwise paint over it.
  const [spot, setSpot] = useState<{ top: number; right: number } | null>(null);
  const open = spot !== null;
  const setOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(open) : value;
    const box = wrapRef.current?.getBoundingClientRect();
    setSpot(next && box ? { top: box.bottom + 8, right: Math.max(12, window.innerWidth - box.right) } : null);
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!wrapRef.current?.contains(target) && !panelRef.current?.contains(target)) setSpot(null); };
    // Follows the button while the page scrolls; closes once the button leaves the screen.
    const moved = () => {
      const box = wrapRef.current?.getBoundingClientRect();
      setSpot(box && box.bottom > 0 && box.top < window.innerHeight ? { top: box.bottom + 8, right: Math.max(12, window.innerWidth - box.right) } : null);
    };
    window.addEventListener('scroll', moved, { passive: true, capture: true });
    window.addEventListener('resize', moved);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSpot(null); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('scroll', moved, { capture: true }); window.removeEventListener('resize', moved); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [open]);
  const toggle = (id: VisualFieldId) => onChange(visualFields.filter((field) => field.id === id ? !fields.includes(id) : fields.includes(field.id)).map((field) => field.id));
  return <div className="wafu-vfields" ref={wrapRef}>
    <button type="button" className={`column-picker-trigger ${open ? 'active' : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((value) => !value)}>欄位<span>{fields.length}</span></button>
    {spot && createPortal(<div ref={panelRef} className="wafu-vfields-panel" role="group" aria-label="圖形化持倉顯示欄位" style={{ top: spot.top, right: spot.right }}>
      <p>在每檔持倉下方顯示</p>
      {visualFields.map((field) => <label key={field.id} title={field.hint}>
        <input type="checkbox" checked={fields.includes(field.id)} onChange={() => toggle(field.id)} />
        <span>{field.label}</span><small>{field.hint}</small>
      </label>)}
      <div className="wafu-vfields-actions">
        <button type="button" onClick={() => onChange(defaultVisualFields)}>預設</button>
        <button type="button" onClick={() => onChange([])}>全部隱藏</button>
      </div>
    </div>, document.body)}
  </div>;
}
