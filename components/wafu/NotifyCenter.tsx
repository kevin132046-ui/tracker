'use client';

import { useEffect, useRef, useState } from 'react';
import type { WafuTheme } from '@/lib/wafu/theme';

/** One notification. The id's second ':' field is its date, so old ids can be pruned. */
export type NoticeItem = {
  id: string;
  kind: 'release' | 'closure' | 'early' | 'earnings' | 'expiry' | 'dividend';
  label: string;
  text: string;
  when: string;
  /** Sort key (YYYY-MM-DD). */
  date: string;
  /** Opens something when the item is pressed (the filing analysis). */
  action?: { label: string; run: () => void };
};

const readKey = 'optionflow-notify-read';
const dismissedKey = 'optionflow-notify-dismissed';

function readIds(key: string): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}
/** Keeps ids of the last 45 days only, so the stored lists stay small. */
function writeIds(key: string, ids: string[]) {
  const cutoff = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const kept = [...new Set(ids)].filter((id) => (id.split(':')[1] ?? '') >= cutoff);
  try { window.localStorage.setItem(key, JSON.stringify(kept)); } catch { /* storage unavailable: this visit only */ }
  return kept;
}

/** 桔梗: a strategist's 軍配 fan. 時雨: a 風鈴 wind chime. */
function ThemeIcon({ theme }: { theme: WafuTheme }) {
  return <svg className="wafu-notify-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {theme === 'kikyo'
      ? <><path d="M12 2.6c5 0 8.4 2.8 8.4 6.5 0 3.3-2.8 5.7-6.7 6.2L12.9 17h-1.8l-.8-1.7C6.4 14.8 3.6 12.4 3.6 9.1c0-3.7 3.4-6.5 8.4-6.5z" /><circle cx="12" cy="9.1" r="2.3" /><path d="M3.9 9.1h5.8M14.3 9.1h5.8" opacity=".6" /><path d="M12 17v4.2" /><path d="M12 21.2l-1.6 1.4M12 21.2l1.6 1.4" /></>
      : <><circle cx="12" cy="2.9" r=".9" /><path d="M6.8 12.9c0-3.6 2.3-6.3 5.2-6.3s5.2 2.7 5.2 6.3" /><path d="M5.8 12.9h12.4" /><path d="M9.2 10.6c.4-1.3 1.2-2.1 2.2-2.4" opacity=".55" /><path d="M12 12.9v2.6" /><path d="M10.9 15.5h2.7l.9 5.8h-2.7z" /></>}
  </svg>;
}

/**
 * Notification center in the top bar: results out, market closures, earnings dates, options about to
 * expire and dividend payments, gathered in one list. Read and dismissed items are kept per browser.
 */
export default function NotifyCenter({ theme, items, openSignal = 0 }: {
  theme: WafuTheme;
  items: NoticeItem[];
  /** Bumped from outside (the quick sheet) to open the panel. */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (openSignal) queueMicrotask(() => setOpen(true)); }, [openSignal]);
  const [read, setRead] = useState<string[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    queueMicrotask(() => { setRead(readIds(readKey)); setDismissed(readIds(dismissedKey)); });
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const shown = items.filter((item) => !dismissed.includes(item.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const unread = read === null ? 0 : shown.filter((item) => !read.includes(item.id)).length;
  const markRead = (ids: string[]) => setRead((current) => writeIds(readKey, [...(current ?? []), ...ids]));
  const dismiss = (id: string) => { setDismissed((current) => writeIds(dismissedKey, [...current, id])); markRead([id]); };

  return <div className={`wafu-notify${unread ? ' has-unread' : ''}`} ref={rootRef}>
    <button type="button" className="wafu-notify-toggle" aria-expanded={open} aria-haspopup="dialog" aria-label={unread ? `通知（${unread} 則未讀）` : '通知'} title="通知" onClick={() => setOpen((value) => !value)}>
      <ThemeIcon theme={theme} />
      {unread > 0 && <span className="wafu-notify-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && <div className="wafu-notify-panel" role="dialog" aria-label="通知">
      <header>
        <b>通知</b>
        <button type="button" disabled={!unread} onClick={() => markRead(shown.map((item) => item.id))}>全部標為已讀</button>
      </header>
      {shown.length
        ? <ul>
          {shown.map((item) => {
            const isRead = read?.includes(item.id) ?? true;
            return <li key={item.id} className={`wafu-notify-item is-${item.kind}${isRead ? '' : ' is-unread'}`}>
              <button type="button" className="wafu-notify-main" onClick={() => { markRead([item.id]); if (item.action) { item.action.run(); setOpen(false); } }}>
                <span className="wafu-notify-kind">{item.label}</span>
                <span className="wafu-notify-text">{item.text}{item.action && <em>{item.action.label}</em>}</span>
                <small>{item.when}</small>
              </button>
              <button type="button" className="wafu-notify-dismiss" aria-label={`關閉「${item.label} ${item.text}」`} onClick={() => dismiss(item.id)}>×</button>
            </li>;
          })}
        </ul>
        : <p className="wafu-notify-empty">目前沒有通知。</p>}
    </div>}
  </div>;
}
