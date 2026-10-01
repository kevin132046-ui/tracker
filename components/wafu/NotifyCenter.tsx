'use client';

import { useEffect, useRef, useState } from 'react';
import type { WafuTheme } from '@/lib/wafu/theme';
import FilingDigest from '@/components/wafu/FilingDigest';
import type { DigestSource } from '@/components/wafu/FilingDigest';

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

/** The calendar side of the center (from the prototype): upcoming earnings, closures, 財報解讀. */
export type NoticeCalendar = {
  earnings: Array<{ symbol: string; date: string; timing: 'pre' | 'post' | null; estimate: boolean; daysAway: number }>;
  closures: Array<{ key: string; market: 'US' | 'JP'; label: string; name: string; early: boolean; daysAway: number }>;
  digests: DigestSource[];
  onAskAi: (symbol: string) => void;
};
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const md = (key: string) => { const d = new Date(`${key}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${weekdays[d.getUTCDay()]}）`; };
const remindKey = 'optionflow-earnings-remind';
// Japanese holiday names in Chinese (from the prototype); others pass through.
const jpZh: Record<string, string> = {
  元日: '元旦', 成人の日: '成人之日', 建国記念の日: '建國紀念日', 天皇誕生日: '天皇誕辰', 春分の日: '春分之日',
  昭和の日: '昭和之日', 憲法記念日: '憲法紀念日', みどりの日: '綠之日', こどもの日: '兒童節', 海の日: '海之日',
  山の日: '山之日', 敬老の日: '敬老之日', 秋分の日: '秋分之日', スポーツの日: '體育之日', 文化の日: '文化之日',
  勤労感謝の日: '勤勞感謝之日', 国民の休日: '國民休日', 振替休日: '補假',
};
const holidayName = (name: string) => name.replace(/[^\s（）()・·]+/g, (part) => jpZh[part] ?? part);
const readRemind = () => { try { return window.localStorage.getItem(remindKey) ?? '7,1'; } catch { return '7,1'; } };

function BellIcon() {
  return <svg className="wafu-notify-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
}

/** 桔梗: a strategist's 軍配 fan. 時雨: a 風鈴 wind chime. (Kept for the quick sheet.) */
export function ThemeIcon({ theme }: { theme: WafuTheme }) {
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
export default function NotifyCenter({ items, openSignal = 0, bar = true, calendar }: {
  theme: WafuTheme;
  calendar?: NoticeCalendar;
  /** Wide screens: show the notice bar in the top bar (off = only the round bell). */
  bar?: boolean;
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
  // Wide screens: the button also rolls through the next few notices (every 6 s), as in the prototype.
  const [roll, setRoll] = useState(0);
  const rolling = shown.slice(0, 5);
  useEffect(() => {
    if (rolling.length < 2) return;
    const timer = window.setInterval(() => setRoll((value) => value + 1), 6000);
    return () => window.clearInterval(timer);
  }, [rolling.length]);
  const current = rolling.length ? rolling[roll % rolling.length] : null;
  // Nothing due this week: the bar names the next closure, as in the prototype.
  const nextClosure = calendar?.closures[0] ?? null;
  const [tab, setTab] = useState<'earnings' | 'holiday' | 'other'>('earnings');
  const [remind, setRemind] = useState('7,1');
  useEffect(() => { queueMicrotask(() => setRemind(readRemind())); }, []);
  const remindSet = new Set(remind.split(',').filter(Boolean));
  const toggleRemind = (day: string) => {
    const next = new Set(remindSet);
    if (next.has(day)) next.delete(day); else next.add(day);
    const value = [...next].sort((a, b) => Number(b) - Number(a)).join(',');
    setRemind(value);
    try { window.localStorage.setItem(remindKey, value); } catch { /* this visit only */ }
  };
  const soonClosures = calendar?.closures.filter((closure) => closure.daysAway <= 7) ?? [];
  const others = shown.filter((item) => item.kind === 'expiry' || item.kind === 'dividend' || item.kind === 'release');
  const markRead = (ids: string[]) => setRead((current) => writeIds(readKey, [...(current ?? []), ...ids]));
  const dismiss = (id: string) => { setDismissed((current) => writeIds(dismissedKey, [...current, id])); markRead([id]); };

  return <div className={`wafu-notify${unread ? ' has-unread' : ''}`} ref={rootRef}>
    <button type="button" className="wafu-notify-toggle" aria-expanded={open} aria-haspopup="dialog" aria-label={unread ? `通知（${unread} 則未讀）` : '通知'} title="通知" onClick={() => setOpen((value) => !value)}>
      {bar && (current
        ? <span className="wafu-notify-roll" key={current.id} aria-hidden="true"><i className="wafu-notify-lamp" /><b>通知</b><em>{current.label}</em><span>{current.text}</span><small>{current.when}</small></span>
        : nextClosure
          ? <span className="wafu-notify-roll" aria-hidden="true"><i className="wafu-notify-lamp is-calm" /><b>通知</b><em>休市</em><span>下個休市 {md(nextClosure.key)} {nextClosure.label.replace(/休市|提前收盤/, '')} · {holidayName(nextClosure.name)}（{nextClosure.daysAway} 天後）</span></span>
          : <span className="wafu-notify-roll is-empty" aria-hidden="true"><i className="wafu-notify-lamp" /><b>通知</b><span>目前沒有新通知</span></span>)}
      <BellIcon />
      {unread > 0 && <span className="wafu-notify-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && <div className="wafu-notify-panel ntc-pop" role="dialog" aria-label="通知中心">
      <header className="ntc-head">
        <b>通知中心</b>
        <div className="ntc-seg" role="tablist" aria-label="通知分類">
          {([['earnings', '財報', calendar?.earnings.filter((entry) => entry.daysAway <= 7).length ?? 0], ['holiday', '休市', soonClosures.length], ['other', '其他', others.length]] as const).map(([id, label, count]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}{count > 0 && <span className="ntc-n">{count}</span>}</button>)}
        </div>
      </header>
      {tab === 'earnings' && <div className="ntc-body">
        <h5>即將公布</h5>
        {calendar?.earnings.length ? <ul className="ntc-earn">{calendar.earnings.map((entry) => <li key={entry.symbol} className={entry.daysAway <= 7 ? 'soon' : ''}>
          <span className="ntc-tk">{entry.symbol}</span>
          <span className="ntc-item"><b>{md(entry.date)}{entry.timing ? ` · ${entry.timing === 'pre' ? '盤前' : '盤後'}` : ''}</b>
            <small>{entry.daysAway === 0 ? '今天' : `${entry.daysAway} 天後`}{entry.estimate ? ' · 預估日期' : ''} · 提醒 {[...remindSet].map((day) => `D-${day}`).join('、') || '—'}</small></span>
        </li>)}</ul> : <p className="wafu-notify-empty">持股目前沒有已知的財報日。</p>}
        <div className="ntc-remind"><span>財報前提醒</span>{['7', '3', '1'].map((day) => <button key={day} type="button" className={remindSet.has(day) ? 'on' : ''} aria-pressed={remindSet.has(day)} onClick={() => toggleRemind(day)}>D-{day}</button>)}</div>
        {calendar && calendar.digests.length > 0 && <>
          <h5>財報解讀</h5>
          {calendar.digests.map((digest) => <FilingDigest key={`${digest.symbol}-${digest.filed}`} source={digest} onAskAi={() => { setOpen(false); calendar.onAskAi(digest.symbol); }} />)}
        </>}
        <p className="ntc-note">財報公布後自動從 SEC EDGAR 抓取 8-K（Ex.99.1 新聞稿）與 10-Q，交給設定中的 AI 整理重點與論述。</p>
      </div>}
      {tab === 'holiday' && <div className="ntc-body">
        {calendar?.closures.length ? <ul className="ntc-hol">{calendar.closures.map((closure) => <li key={`${closure.key}-${closure.market}`} className={closure.daysAway <= 7 ? 'soon' : ''}>
          <span className={`ntc-mk is-${closure.market.toLowerCase()}`}>{closure.market === 'US' ? '美股' : '日股'}</span>
          <span className="ntc-item"><b>{md(closure.key)} · {holidayName(closure.name)}</b><small>{closure.early ? '提前收盤（美東 13:00）' : '全日休市'} · {closure.daysAway === 0 ? '今天' : `${closure.daysAway} 天後`}</small></span>
        </li>)}</ul> : <p className="wafu-notify-empty">未來 45 天沒有休市。</p>}
        <p className="ntc-note">休市日前 7 天起在頂欄預告；依 NYSE 與 JPX 官方年表。</p>
      </div>}
      {tab === 'other' && <div className="ntc-body">
        <div className="ntc-other-head"><h5>到期與股息</h5><button type="button" disabled={!unread} onClick={() => markRead(shown.map((item) => item.id))}>全部標為已讀</button></div>
        {others.length
          ? <ul>
            {others.map((item) => {
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
          : <p className="wafu-notify-empty">目前沒有到期或股息通知。</p>}
      </div>}
    </div>}
  </div>;
}
