'use client';

import { useEffect, useRef, useState } from 'react';
import { next as nextTrack, toggle as toggleMusic, useMusic } from '@/lib/wafu/music';
import { playSfx } from '@/lib/wafu/sfx';
import type { WafuTheme } from '@/lib/wafu/theme';

export type GuideSection = { id: string; label: string };
export type GuideAction = { id: string; label: string; icon: string; run: () => void };

/**
 * 底部引導條 (like the bar at the bottom of an iPhone): swipe left or right to move between the
 * page's sections, tap to go back to the top, swipe up or hold to open the quick sheet (new trade,
 * import, AI, research, notices, settings, the sections and the music). Keyboard: ← / → switch,
 * Enter opens the sheet, Home goes to the top.
 */
export default function GuideBar({ theme, sections, current, onGo, actions }: {
  theme: WafuTheme;
  sections: GuideSection[];
  current: string;
  onGo: (id: string) => void;
  actions: GuideAction[];
}) {
  const [sheet, setSheet] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const hold = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const music = useMusic();
  const index = Math.max(0, sections.findIndex((section) => section.id === current));

  const go = (step: number) => {
    const target = sections[(index + step + sections.length) % sections.length];
    if (!target) return;
    onGo(target.id);
    playSfx('pop', theme);
  };
  const openSheet = () => { setSheet(true); playSfx('open', theme); };
  const closeSheet = () => { setSheet(false); playSfx('close', theme); };
  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const hint = drag && Math.abs(drag.dx) > 18 ? sections[(index + (drag.dx < 0 ? 1 : -1) + sections.length) % sections.length]?.label : null;

  useEffect(() => {
    if (!sheet) return;
    sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSheet(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [sheet]);
  useEffect(() => () => { if (hold.current) window.clearTimeout(hold.current); }, []);

  return <>
    <div className="wafu-guide" data-playing={music.playing || undefined}>
      {hint && <span className="wafu-guide-hint">{hint}</span>}
      <button
        type="button"
        className="wafu-guide-hit"
        aria-label="快捷列：左右滑切換區塊，點一下回頂部，往上滑或長按開啟快捷面板"
        aria-haspopup="dialog"
        aria-expanded={sheet}
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY, t: performance.now() };
          event.currentTarget.setPointerCapture(event.pointerId);
          hold.current = window.setTimeout(() => { hold.current = null; start.current = null; setDrag(null); openSheet(); }, 520);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const dx = event.clientX - start.current.x;
          const dy = event.clientY - start.current.y;
          if (Math.hypot(dx, dy) > 6 && hold.current) { window.clearTimeout(hold.current); hold.current = null; }
          setDrag({ dx, dy });
        }}
        onPointerUp={(event) => {
          if (hold.current) { window.clearTimeout(hold.current); hold.current = null; }
          const began = start.current;
          start.current = null;
          setDrag(null);
          if (!began) return;
          const dx = event.clientX - began.x;
          const dy = event.clientY - began.y;
          if (dy < -30 && Math.abs(dy) > Math.abs(dx)) openSheet();
          else if (Math.abs(dx) > 44) go(dx < 0 ? 1 : -1);
          else if (performance.now() - began.t < 320 && Math.hypot(dx, dy) < 8) toTop();
        }}
        onPointerCancel={() => { if (hold.current) window.clearTimeout(hold.current); start.current = null; setDrag(null); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
          else if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
          else if (event.key === 'Home') { event.preventDefault(); toTop(); }
          else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSheet(); }
        }}
      >
        <span className="wafu-guide-dots" aria-hidden="true">{sections.map((section) => <i key={section.id} className={section.id === current ? 'on' : ''} />)}</span>
        <span className="wafu-guide-pill" style={drag ? { translate: `${Math.max(-40, Math.min(40, drag.dx * 0.35))}px ${Math.max(-10, Math.min(0, drag.dy * 0.2))}px` } : undefined} />
      </button>
    </div>

    {sheet && <div className="wafu-quick-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSheet(); }}>
      <div className={`wafu-quick-sheet is-${theme}`} role="dialog" aria-modal="true" aria-label="快捷面板" ref={sheetRef}>
        <span className="wafu-quick-grip" aria-hidden="true" />
        <div className="wafu-quick-grid">
          {actions.map((action, order) => <button key={action.id} type="button" style={{ ['--k' as string]: order }} onClick={() => { setSheet(false); action.run(); }}>
            <i aria-hidden="true">{action.icon}</i><span>{action.label}</span>
          </button>)}
        </div>
        <div className="wafu-quick-sections">
          {sections.map((section) => <button key={section.id} type="button" className={section.id === current ? 'on' : ''} aria-current={section.id === current ? 'true' : undefined} onClick={() => { setSheet(false); onGo(section.id); }}>{section.label}</button>)}
        </div>
        {music.tracks.length > 0 && <div className="wafu-quick-music">
          <span className="wafu-quick-music-title"><small>背景音樂</small><b>{music.current?.title ?? music.tracks[0].title}</b></span>
          <button type="button" onClick={toggleMusic} aria-label={music.playing ? '暫停' : '播放'}>{music.playing ? '❚❚' : '▶'}</button>
          {music.tracks.length > 1 && <button type="button" onClick={nextTrack} aria-label="下一首">⏭</button>}
        </div>}
      </div>
    </div>}
  </>;
}
