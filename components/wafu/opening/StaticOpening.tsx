import HaloIcon from '@/components/wafu/HaloIcon';
import { kikyoInner, kikyoOutline, kikyoStamen, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';

/**
 * The 和風 opening's markup, rendered with the page itself (in the layout) so it is on screen from
 * the first frame, before any script runs. It is shown while <html data-wafu-intro> is set (the boot
 * script sets it) and only the current theme's half is visible.
 *
 * Every motion is a CSS transform or opacity change (wafu-opening.css), which the browser runs on
 * the compositor: it keeps moving even while the page underneath is still loading. The small
 * controller (Opening.tsx) only switches stages on <html> (data-op, data-op-step) and writes the
 * step name and percentage.
 */
const STEPS = 5;
const units: Array<[number, number, number]> = [[-52, -30, 2], [-40, 34, 2], [46, -38, 3], [58, 18, 3], [-8, 60, 4], [18, -64, 4]];
const advances = ['M -52 -30 C -30 -48, -12 -56, 18 -64', 'M -40 34 C -20 52, -12 58, -8 60', 'M 58 18 C 50 -4, 50 -20, 46 -38'];
// Ink washes: [left %, top %, size vmin, rotation, the step that lays it down]
const washes: Array<[number, number, number, number, number]> = [[38, 30, 30, 20, 1], [60, 56, 36, -35, 2], [30, 60, 26, 70, 3], [64, 28, 24, 140, 4], [48, 44, 40, 0, 5]];

function Crest({ theme }: { theme: 'kikyo' | 'shigure' }) {
  return <div className="op-crest">
    <svg viewBox="-1.25 -1.25 2.5 2.5">
      {theme === 'kikyo' ? <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path className="op-crest-fill" d={kikyoOutline()} />
        <path className="op-crest-a" d={kikyoOutline()} strokeWidth={0.05} />
        <path className="op-crest-b" d={kikyoInner()} strokeWidth={0.035} />
        <path className="op-crest-c" d={kikyoStamen()} strokeWidth={0.03} />
        <circle className="op-crest-dot" r={0.085} />
      </g> : <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        <path className="op-crest-fill" d={yukiwaOutline()} />
        <path className="op-crest-a" d={yukiwaOutline()} strokeWidth={0.05} />
        <path className="op-crest-b" d={snowCrystal(0.44)} strokeWidth={0.035} />
      </g>}
    </svg>
    {/* The brush: a bright point circling once while the crest is laid down. */}
    <i className="op-brush" />
    {/* The halo: the finished artwork, turning into place when the loading completes. */}
    <div className="op-halo"><HaloIcon theme={theme} size={200} spin={false} tone={theme === 'kikyo' ? 'paper' : 'dark'} /></div>
    <i className="op-halo-ring" />
    <i className="op-ripple" />
  </div>;
}

function Washes() {
  return <div className="op-washes">{washes.map(([x, y, s, r, at], i) => <i key={i} data-at={at} style={{ left: `${x}%`, top: `${y}%`, width: `${s}vmin`, height: `${s * 0.72}vmin`, rotate: `${r}deg` }}><b /></i>)}</div>;
}

function Motes({ count }: { count: number }) {
  return <div className="op-motes">{Array.from({ length: count }, (_, i) => <i key={i} style={{ left: `${(i * 37 + 11) % 100}%`, animationDelay: `${-((i * 1.9) % 11)}s`, animationDuration: `${9 + (i % 5) * 1.6}s`, ['--s' as string]: (0.5 + ((i * 7) % 10) / 14).toFixed(2) }} />)}</div>;
}

function Kikyo() {
  const pegs = [[10, 26], [55, 6], [100, 26], [145, 6], [190, 26]];
  return <div className="op-theme op-kikyo">
    <div className="doors">
      {(['l', 'r'] as const).map((side) => <div key={side} className={`door door-${side}`}>
        <div className="shoji-paper" /><span className="maru" />
        {side === 'r' && <span className="kage" />}
        <span className="hikite" />
      </div>)}
    </div>
    <svg className="op-map" viewBox="-100 -100 200 200" aria-hidden="true">
      <defs>
        <clipPath id="op-maru"><circle r="97" /></clipPath>
        <radialGradient id="op-valve"><stop offset="0" stopColor="#ffb865" stopOpacity=".95" /><stop offset=".55" stopColor="#e2743a" stopOpacity=".4" /><stop offset="1" stopColor="#e2743a" stopOpacity="0" /></radialGradient>
      </defs>
      <g clipPath="url(#op-maru)">
        <g className="op-grid">{[-75, -50, -25, 0, 25, 50, 75].map((v) => <g key={v}><line x1={v} x2={v} y1={-100} y2={100} /><line y1={v} y2={v} x1={-100} x2={100} /></g>)}<circle r="40" /><circle r="72" /></g>
        <g className="op-terrain" data-at={1}>
          <path d="M -100 18 C -70 10, -58 40, -30 30 S 10 -6, 34 8 S 76 40, 100 26" />
          <path d="M -92 -54 C -70 -70, -44 -62, -30 -76 M 60 -84 C 70 -66, 86 -64, 96 -52" />
          <path d="M -18 82 C -6 70, 12 74, 26 86" />
        </g>
        {units.map(([x, y, at], i) => <g key={i} transform={`translate(${x} ${y})`}><g className="op-unit" data-at={at}>
          <rect x="-5" y="-3.5" width="10" height="7" rx="1" /><line x1="-5" y1="-3.5" x2="-5" y2="-12" /><path d="M -5 -12 L 3 -10 L -5 -8 Z" />
        </g></g>)}
        <g className="op-advance" data-at={3}>{advances.map((d) => <path key={d} d={d} />)}</g>
      </g>
      <g transform="translate(0 84)">{Array.from({ length: STEPS }, (_, i) => <g key={i} transform={`translate(${(i - (STEPS - 1) / 2) * 13} 0)`}><g className="op-valve" data-at={i + 1}>
        <circle className="glow" r="7" fill="url(#op-valve)" /><rect x="-2.6" y="-5" width="5.2" height="8" rx="2.6" /><line x1="-1.2" y1="3" x2="-1.2" y2="6" /><line x1="1.2" y1="3" x2="1.2" y2="6" />
      </g></g>)}</g>
    </svg>
    <div className="op-sweep" />
    <Washes />
    <Motes count={18} />
    <div className="op-center">
      <Crest theme="kikyo" />
      <svg className="ayatori" viewBox="0 0 200 32" aria-hidden="true">
        <path d="M 10 26 L 190 26 M 55 6 L 145 6" className="ayatori-ghost" />
        {pegs.slice(1).map(([x, y], i) => <line key={x} x1={pegs[i][0]} y1={pegs[i][1]} x2={x} y2={y} className="ayatori-seg" data-at={i + 1} />)}
        {pegs.map(([x, y], i) => <circle key={x} cx={x} cy={y} r={2.4} className="ayatori-peg" data-at={i} />)}
      </svg>
    </div>
    <svg className="op-gunbai" viewBox="-60 -80 120 200" aria-hidden="true">
      <path className="fan" d="M 0 -72 C 44 -72, 52 -30, 42 0 C 34 22, 14 36, 0 38 C -14 36, -34 22, -42 0 C -52 -30, -44 -72, 0 -72 Z" />
      <path className="mark" d={kikyoOutline()} transform="translate(0 -20) scale(20)" />
      <rect className="grip" x="-4" y="36" width="8" height="70" rx="3" /><circle className="tassel" cx="0" cy="110" r="4" />
    </svg>
  </div>;
}

const yukiwaPattern = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='none' stroke='#e9fbfa' stroke-width='1.3' stroke-linejoin='round'><g transform='translate(30 30) scale(16)'><path vector-effect='non-scaling-stroke' d='${yukiwaOutline()}'/></g><g transform='translate(90 90) scale(10)' opacity='.7'><path vector-effect='non-scaling-stroke' d='${yukiwaOutline()}'/></g></g></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}")`;
})();

function Shigure() {
  const gauges = ['湯溫', '壓力', '濃度', '香氣'];
  return <div className="op-theme op-shigure">
    <div className="noren">
      <div className="noren-rod" />
      {[0, 1, 2].map((i) => <div key={i} className={`noren-strip noren-${i}`}>
        <div className="noren-print" style={{ backgroundImage: yukiwaPattern }} />
        {i === 0 && <span className="noren-text"><i>時</i><i>雨</i></span>}
        {i === 2 && <span className="noren-figure" />}
      </div>)}
      <div className="steam"><i /><i /><i /><i /></div>
    </div>
    <div className="op-crt"><i className="noise" /><i className="scan" /></div>
    <Washes />
    <Motes count={26} />
    <svg className="op-furin" viewBox="-20 0 40 120" aria-hidden="true">
      <line x1="0" y1="0" x2="0" y2="16" /><path className="bell" d="M -11 30 C -11 18, 11 18, 11 30 L 12 34 L -12 34 Z" />
      <line x1="0" y1="34" x2="0" y2="62" /><rect className="tanzaku" x="-5" y="62" width="10" height="40" rx="1" />
    </svg>
    <div className="op-center">
      <Crest theme="shigure" />
      <div className="brew-gauges">{gauges.map((name, i) => <div key={name} className="brew-gauge" data-at={i + 1}>
        <svg viewBox="-12 -12 24 16"><path className="track" d="M -9 0 A 9 9 0 0 1 9 0" /><g className="needle"><line x1="0" y1="0" x2="-7" y2="0" /></g><circle r="1.4" /></svg>
        <span>{name}</span>
      </div>)}</div>
    </div>
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
      <div className="opening-label"><span className="opening-step" id="op-label" /><span className="opening-pct" id="op-pct">00%</span></div>
      <span className="opening-bar"><i /></span>
    </div>
  </div>;
}
