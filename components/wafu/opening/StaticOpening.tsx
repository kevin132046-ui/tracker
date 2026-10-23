import type { CSSProperties } from 'react';
import { kikyoOutline, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';
import { paperFibre } from '@/lib/wafu/ink';

/**
 * The 和風 opening's markup (水墨), rendered with the page itself (in the layout) so it is on screen from
 * the first frame, before any script runs. It is shown while <html data-wafu-intro> is set (the boot
 * script sets it) and only the current theme's half is visible.
 *
 * 桔梗 · 墨染: a drop of ink falls on washi and spreads; the character (the backdrop picture) shows in
 * the ink, the steps are written down the side and the 桔梗 seal is pressed; then the ink floods the
 * page and lifts away, leaving the same picture in colour behind the dashboard.
 * 時雨 · 一筆: one dry-brush stroke crosses the rainy night with the character inside it, an ensō closes
 * round the 雪輪; then the stroke opens over the whole screen and lifts away.
 *
 * Every motion is a transform or opacity change (wafu-opening.css), so the compositor runs it even
 * while the page underneath is still loading. The picture never moves: it lies still underneath, and
 * the ink is a sheet of plain bitmaps (app/ink) that only scale, blended over it so the picture shows
 * through where the ink is. Nothing is masked or re-drawn while it plays. The controller
 * (Opening.tsx) switches stages on <html> (data-op, data-op-step, --op-p), sets the picture
 * (--op-photo), the uploaded silhouette (--op-sil) and emblem (--op-icon), and writes the step text.
 */
type Vars = CSSProperties & Record<`--${string}`, string>;
const blots: Array<{ key: string; cx: string; cy: string }> = [
  { key: 'a', cx: '36vw', cy: '40vh' },
  { key: 'b', cx: '22vw', cy: '60vh' },
  { key: 'c', cx: '58vw', cy: '62vh' },
];

/** What shows through the ink: the backdrop picture, else the uploaded silhouette, else the ink alone. */
function InkBase() {
  return <div className="ink-base"><i className="ink-ground" /><i className="ink-photo" /><i className="ink-sil" /></div>;
}

function Kikyo() {
  return <div className="op-theme op-kikyo">
    <InkBase />
    {/* White paper with black blots, screened over the picture: the picture is left where the ink is,
        white elsewhere. The paper (its colour and fibres) is then multiplied in, so the blacks stay black. */}
    <div className="ink-sheet">
      {blots.map(({ key, cx, cy }) => <div key={key} className={`ink-blot ink-blot-${key}`} style={{ '--cx': cx, '--cy': cy } as Vars}><i className="ink-spot" /></div>)}
    </div>
    <div className="ink-tint" style={{ backgroundImage: paperFibre }} />
    <i className="ink-drop" />
    <div className="ink-title" aria-hidden="true">桔梗</div>
    <div className="ink-seal" aria-hidden="true"><svg viewBox="-1.25 -1.25 2.5 2.5"><path d={kikyoOutline()} /></svg></div>
    <i className="ink-icon" />
  </div>;
}

function Shigure() {
  return <div className="op-theme op-shigure">
    <InkBase />
    {/* A white stroke on black, multiplied over the picture (the picture stays only in the stroke);
        the night colour is then screened over it, so outside the stroke it is plain night. */}
    <div className="ink-sheet"><i className="ink-stroke" /></div>
    <div className="ink-night" />
    <i className="stroke-cover" />
    <i className="ink-lantern" />
    <div className="ink-rain">{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</div>
    <div className="ink-title" aria-hidden="true">時雨</div>
    <div className="enso" aria-hidden="true">
      <svg viewBox="-1.3 -1.3 2.6 2.6">
        <path className="enso-ring" d="M -0.05 -1.12 A 1.12 1.12 0 1 1 -0.32 -1.073" />
        <g className="enso-crest" transform="scale(0.62)"><path d={yukiwaOutline()} /><path className="enso-detail" d={snowCrystal(0.44)} /></g>
      </svg>
      <i className="ink-icon" />
    </div>
    <div className="ink-seal" aria-hidden="true"><svg viewBox="-1.25 -1.25 2.5 2.5"><path d={yukiwaOutline()} /></svg></div>
  </div>;
}

export default function StaticOpening() {
  return <div id="wafu-opening" className="op" role="status" aria-live="polite" aria-label="載入中 · 點擊畫面略過" data-i18n-skip="">
    <div className="op-bg" />
    <Kikyo />
    <Shigure />
    <button type="button" className="opening-sound" id="op-sound" aria-pressed="false" aria-label="音效">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><g className="on"><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></g><path className="off" d="M16 9.5l5 5M21 9.5l-5 5" />
      </svg>
      <span id="op-sound-label">音效</span>
    </button>
    <div className="opening-caption">
      <span className="opening-bar"><i /></span>
      <div className="opening-label"><span className="opening-step" id="op-label" /><span className="opening-pct" id="op-pct">00%</span></div>
    </div>
  </div>;
}
