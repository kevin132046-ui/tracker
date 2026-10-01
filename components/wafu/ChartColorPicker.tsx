'use client';

import { useEffect, useRef, useState } from 'react';
import { wairo, wairoName } from '@/lib/wafu/chart-colors';

/**
 * A colour dot that opens a small palette of 和色 (plus 跟隨主題). Used beside each line in the
 * 收益分析 legend and in 設定 → 外觀 → 圖表顏色.
 */
export default function ChartColorPicker({ label, value, fallback, onChange, align = 'end' }: {
  label: string;
  /** The chosen colour, or undefined to follow the theme. */
  value: string | undefined;
  /** What the line shows when following the theme. */
  fallback: string;
  onChange: (next: string | undefined) => void;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const pick = (next: string | undefined) => { onChange(next); setOpen(false); };
  return <span className="wafu-color-pick" ref={ref}>
    <button type="button" className="wafu-color-dot" style={{ background: value ?? fallback }} aria-haspopup="true" aria-expanded={open} aria-label={`${label}顏色：${wairoName(value) ?? '跟隨主題'}`} title={`${label}顏色`} onClick={() => setOpen((current) => !current)} />
    {open && <span className={`wafu-color-menu is-${align}`} role="menu" aria-label={`${label}顏色`}>
      <b>{label}</b>
      <span className="wafu-color-grid">
        {wairo.map(([name, hex]) => <button type="button" key={hex} role="menuitemradio" aria-checked={value === hex} className={value === hex ? 'on' : ''} style={{ background: hex }} title={name} aria-label={name} onClick={() => pick(hex)} />)}
      </span>
      <button type="button" className={`wafu-color-auto ${value ? '' : 'on'}`} role="menuitemradio" aria-checked={!value} onClick={() => pick(undefined)}><i style={{ background: fallback }} />跟隨主題</button>
    </span>}
  </span>;
}
