'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  normalizeTradeColumns,
  presetForColumns,
  toggleTradeColumn,
  tradeColumnGroups,
  tradeColumnPresets,
  tradeColumns,
  type TradeColumnId,
} from '@/lib/trade-columns';

type PanelPlacement = { mode: 'sheet' } | { mode: 'popover'; left: number; top?: number; bottom?: number; maxHeight: number };

const panelWidth = 360;
const sheetBreakpoint = 720;

function placementFor(trigger: HTMLElement): PanelPlacement {
  if (window.innerWidth <= sheetBreakpoint) return { mode: 'sheet' };
  const rect = trigger.getBoundingClientRect();
  const left = Math.min(Math.max(12, rect.right - panelWidth), window.innerWidth - panelWidth - 12);
  const below = window.innerHeight - rect.bottom - 20;
  const above = rect.top - 20;
  return below >= 380 || below >= above
    ? { mode: 'popover', left, top: rect.bottom + 8, maxHeight: Math.max(220, below) }
    : { mode: 'popover', left, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(220, above) };
}

/** 「欄位」 button and its popover for choosing the trade details columns. */
export default function TradeColumnPicker({ columns, onChange }: { columns: TradeColumnId[]; onChange: (columns: TradeColumnId[]) => void }) {
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = placement !== null;
  const activePreset = presetForColumns(columns);
  const optionalCount = columns.filter((id) => !tradeColumns.find((column) => column.id === id)?.locked).length;

  const close = useCallback((restoreFocus: boolean) => {
    setPlacement(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const presets = panelRef.current?.querySelector('.column-picker-presets');
    (presets?.querySelector<HTMLElement>('button.active') ?? presets?.querySelector<HTMLElement>('button'))?.focus();
    const reposition = () => { if (triggerRef.current) setPlacement(placementFor(triggerRef.current)); };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (panelRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      setPlacement(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [close, open]);

  const panel = open ? <div
    className={`column-picker-layer ${placement.mode === 'sheet' ? 'is-sheet' : ''}`}
    onMouseDown={(event) => { if (placement.mode === 'sheet' && event.target === event.currentTarget) close(true); }}
  >
    <div
      ref={panelRef}
      id={panelId}
      className="column-picker-panel"
      role="dialog"
      aria-label="選擇交易明細欄位"
      style={placement.mode === 'popover' ? { left: placement.left, top: placement.top, bottom: placement.bottom, maxHeight: placement.maxHeight, width: panelWidth } : undefined}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next) && !triggerRef.current?.contains(next)) setPlacement(null);
      }}
    >
      <header><div><p className="eyebrow">Table columns</p><strong>顯示欄位</strong></div><button type="button" className="column-picker-close" onClick={() => close(true)} aria-label="收合欄位選單">×</button></header>
      <div className="column-picker-presets" role="group" aria-label="欄位組合">
        {tradeColumnPresets.map((preset) => <button type="button" key={preset.id} className={activePreset === preset.id ? 'active' : ''} aria-pressed={activePreset === preset.id} onClick={() => onChange(normalizeTradeColumns(preset.columns))}>{preset.label}</button>)}
      </div>
      {tradeColumnGroups.map((group) => <fieldset key={group.id} className="column-picker-group">
        <legend>{group.label}</legend>
        <div className="column-picker-options">
          {tradeColumns.filter((column) => column.group === group.id && !column.locked).map((column) => <label key={column.id} className="column-picker-option" title={column.description}>
            <input type="checkbox" checked={columns.includes(column.id)} onChange={() => onChange(toggleTradeColumn(columns, column.id))} />
            <span>{column.pickerLabel ?? column.label}</span>
          </label>)}
        </div>
      </fieldset>)}
      <p className="column-picker-note">標的與操作欄固定顯示；股票與現金列的選擇權欄位顯示「—」。選擇會保存在這個瀏覽器。</p>
    </div>
  </div> : null;

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={`column-picker-trigger ${open ? 'active' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => {
        const trigger = triggerRef.current;
        if (open || !trigger) return close(false);
        // Bring the table up so the popover opens below the button, next to the columns it changes.
        const rect = trigger.getBoundingClientRect();
        if (window.innerWidth > sheetBreakpoint && window.innerHeight - rect.bottom < 560) window.scrollBy({ top: rect.top - 120, behavior: 'auto' });
        setPlacement(placementFor(trigger));
      }}
    >欄位<span>{activePreset === 'default' ? '預設' : activePreset ? tradeColumnPresets.find((preset) => preset.id === activePreset)?.label : `自訂 ${optionalCount}`}</span></button>
    {panel && createPortal(panel, document.body)}
  </>;
}
