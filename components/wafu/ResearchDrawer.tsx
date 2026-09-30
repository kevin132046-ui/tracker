'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export type ResearchTab = 'technical' | 'fundamentals' | 'dcf' | 'lots';
const tabs: ReadonlyArray<readonly [ResearchTab, string]> = [['technical', '技術面'], ['fundamentals', '基本面'], ['dcf', 'DCF 估值'], ['lots', '購買紀錄']];

/**
 * 個股研究 / 銘柄リサーチ (from the prototype): one stock's technical view, fundamentals, DCF valuation and
 * purchase lots in a drawer from the right (full screen on phones), over the page. The content is
 * the site's own panels with live data; the drawer only frames and switches them.
 */
export default function ResearchDrawer({ symbol, company, summary, tab, onTab, onClose, children }: {
  symbol: string;
  company: string;
  /** One line under the title: holding, average cost, unrealised P&L (already formatted). */
  summary: Array<{ text: string; tone?: 'positive' | 'negative' }>;
  tab: ResearchTab;
  onTab: (tab: ResearchTab) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [tab, symbol]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  // The page behind stays put while the drawer scrolls.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.researchOpen = '1';
    return () => { delete root.dataset.researchOpen; };
  }, []);

  return <div className="wafu-research-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="wafu-research" role="dialog" aria-modal="true" aria-labelledby="wafu-research-title">
      <header className="wafu-research-head">
        <div>
          <h2 id="wafu-research-title"><span className="wafu-research-kicker">個股研究</span><span className="wafu-research-symbol">{symbol}</span></h2>
          <p className="wafu-research-sub"><span>{company}</span>{summary.map((part) => <span key={part.text} className={part.tone ?? ''}>{part.text}</span>)}</p>
        </div>
        <button type="button" ref={closeRef} className="wafu-research-close" onClick={onClose} aria-label="關閉個股研究">×</button>
      </header>
      <div className="wafu-research-tabs" role="tablist" aria-label="個股研究分頁">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" id={`research-tab-${id}`} aria-selected={tab === id} aria-controls="research-panel" className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>{label}</button>)}
      </div>
      <div className="wafu-research-body" id="research-panel" role="tabpanel" aria-labelledby={`research-tab-${tab}`} ref={bodyRef}>{children}</div>
    </aside>
  </div>;
}
