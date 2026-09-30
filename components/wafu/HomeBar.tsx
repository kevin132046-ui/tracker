'use client';

import { useEffect, useRef, useState } from 'react';
import HaloIcon from '@/components/wafu/HaloIcon';
import NavIcon from '@/components/wafu/NavIcon';
import type { WafuTheme } from '@/lib/wafu/theme';

export type HomeSection = 'overview' | 'positions' | 'returns' | 'valuation';

const more = <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18.5" cy="12" r="1.7" /></svg>;

/**
 * Phones: the main menu as a bar along the bottom (thumb reach), like an app. The current item
 * carries the character's halo; 估值 and 背景 sit under 「更多」. Replaces the top strip on small screens.
 */
export default function HomeBar({ theme, active, settingsOpen, assistant, onSection, onSettings, onValuation, background }: {
  theme: WafuTheme;
  active: HomeSection;
  settingsOpen: boolean;
  /** null when the AI assistant is switched off. */
  assistant: { open: boolean; toggle: () => void } | null;
  onSection: (section: 'overview' | 'positions' | 'returns') => void;
  onSettings: () => void;
  onValuation: () => void;
  background: { label: string; busy: boolean; pick: () => void };
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [moreOpen]);

  const current = settingsOpen ? 'settings' : assistant?.open ? 'ai' : active === 'valuation' ? 'more' : active;
  const halo = <span className="wafu-homebar-halo" aria-hidden="true"><HaloIcon theme={theme} size={30} tilt={64} /></span>;
  const item = (id: string, label: string, icon: React.ReactNode, onClick: () => void, extra: Record<string, unknown> = {}) => (
    <button key={id} type="button" className={`wafu-homebar-item${current === id ? ' is-current' : ''}`} aria-current={current === id ? 'page' : undefined} onClick={onClick} {...extra}>
      <span className="wafu-homebar-icon">{icon}{current === id && id !== 'ai' && halo}</span>
      <span className="wafu-homebar-label">{label}</span>
    </button>
  );

  return <nav className="wafu-homebar" aria-label="主選單">
    {item('overview', '總覽', <NavIcon name="overview" />, () => onSection('overview'))}
    {item('positions', '持倉', <NavIcon name="positions" />, () => onSection('positions'))}
    {item('returns', '收益', <NavIcon name="returns" />, () => onSection('returns'))}
    {assistant && item('ai', 'AI', <HaloIcon theme={theme} size={24} spin={assistant.open} minStrokePx={1} />, assistant.toggle, { 'aria-haspopup': 'dialog', 'aria-expanded': assistant.open })}
    {item('settings', '設定', <NavIcon name="settings" />, onSettings, { 'aria-haspopup': 'dialog' })}
    <div className="wafu-homebar-more" ref={moreRef}>
      {item('more', '更多', more, () => setMoreOpen((open) => !open), { 'aria-haspopup': 'menu', 'aria-expanded': moreOpen })}
      {moreOpen && <div className="wafu-homebar-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onValuation(); }}><NavIcon name="valuation" /><span>估值</span></button>
        <button type="button" role="menuitem" disabled={background.busy} onClick={() => { setMoreOpen(false); background.pick(); }}><NavIcon name={background.busy ? 'saving' : 'background'} /><span>{background.label}</span></button>
      </div>}
    </div>
  </nav>;
}
