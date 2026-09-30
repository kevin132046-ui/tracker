'use client';

import { kikyoOutline } from '@/lib/wafu/marks';

/**
 * The opening's short PV, one scene per theme, drawn between the doors and the ink. Everything here
 * moves with transform and opacity only (no filters, no per-frame script), so it costs the
 * compositor and not the main thread.
 *
 * 桔梗 · 軍議機関: in the round window a faint retro-future war-council map boots up. Five
 * valves glow one by one with the loading steps, the terrain is inked in, the formation (布陣) is
 * set and the lines of advance drawn, while a radar sweep turns. When the crest is stamped a 軍配
 * (war fan) sweeps down: the order is given and the doors open.
 *
 * 時雨 · 喫茶の夜: the night begins as CRT static over the noren; step by step the static clears
 * into real snow, the neon 時雨 on the noren flickers on (see NorenCurtain) and a 風鈴 on the rod
 * starts to swing. The brewing machine's four gauges (BrewGauges) are the progress.
 */
export type SceneStage = 'loading' | 'form' | 'stamp' | 'opening' | 'gone';

const units: Array<[number, number, number]> = [[-52, -30, 2], [-40, 34, 2], [46, -38, 3], [58, 18, 3], [-8, 60, 4], [18, -64, 4]];
const advances = ['M -52 -30 C -30 -48, -12 -56, 18 -64', 'M -40 34 C -20 52, -12 58, -8 60', 'M 58 18 C 50 -4, 50 -20, 46 -38'];

export function KikyoScene({ step, total, stage }: { step: number; total: number; stage: SceneStage }) {
  const on = (at: number) => step >= at ? ' on' : '';
  return <div className={`scene scene-kikyo stage-${stage}`} aria-hidden="true">
    <svg className="scene-map" viewBox="-100 -100 200 200">
      <defs>
        <clipPath id="scene-maru"><circle r="97" /></clipPath>
        <radialGradient id="scene-valve"><stop offset="0" stopColor="#ffb865" stopOpacity=".95" /><stop offset=".55" stopColor="#e2743a" stopOpacity=".4" /><stop offset="1" stopColor="#e2743a" stopOpacity="0" /></radialGradient>
        <linearGradient id="scene-sweep" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#3d5fa8" stopOpacity="0" /><stop offset="1" stopColor="#3d5fa8" stopOpacity=".22" /></linearGradient>
      </defs>
      <g clipPath="url(#scene-maru)">
        <g className="scene-grid">
          {[-75, -50, -25, 0, 25, 50, 75].map((v) => <g key={v}><line x1={v} x2={v} y1={-100} y2={100} /><line y1={v} y2={v} x1={-100} x2={100} /></g>)}
          <circle r="40" /><circle r="72" />
        </g>
        <g className="scene-sweep"><path d="M 0 0 L 100 0 A 100 100 0 0 0 70.7 -70.7 Z" fill="url(#scene-sweep)" /><line x1="0" y1="0" x2="100" y2="0" /></g>
        <g className={`scene-terrain${on(1)}`}>
          <path pathLength={1} d="M -100 18 C -70 10, -58 40, -30 30 S 10 -6, 34 8 S 76 40, 100 26" />
          <path pathLength={1} d="M -92 -54 C -70 -70, -44 -62, -30 -76 M 60 -84 C 70 -66, 86 -64, 96 -52" />
          <path pathLength={1} d="M -18 82 C -6 70, 12 74, 26 86" />
        </g>
        {units.map(([x, y, at], i) => <g key={i} className={`scene-unit${on(at)}`} transform={`translate(${x} ${y})`} style={{ transitionDelay: `${(i % 2) * 120}ms` }}>
          <rect x="-5" y="-3.5" width="10" height="7" rx="1" />
          <line x1="-5" y1="-3.5" x2="-5" y2="-12" /><path d="M -5 -12 L 3 -10 L -5 -8 Z" />
        </g>)}
        <g className={`scene-advance${on(3)}`}>{advances.map((d, i) => <path key={d} d={d} pathLength={1} style={{ transitionDelay: `${i * 140}ms` }} />)}</g>
      </g>
      <g className="scene-valves" transform="translate(0 84)">
        {Array.from({ length: total }, (_, i) => {
          const x = (i - (total - 1) / 2) * 13;
          return <g key={i} className={`scene-valve${step > i ? ' on' : ''}`} transform={`translate(${x} 0)`}>
            <circle className="glow" r="7" fill="url(#scene-valve)" />
            <rect x="-2.6" y="-5" width="5.2" height="8" rx="2.6" />
            <line x1="-1.2" y1="3" x2="-1.2" y2="6" /><line x1="1.2" y1="3" x2="1.2" y2="6" />
          </g>;
        })}
      </g>
    </svg>
    <svg className="scene-gunbai" viewBox="-60 -80 120 200">
      <path className="fan" d="M 0 -72 C 44 -72, 52 -30, 42 0 C 34 22, 14 36, 0 38 C -14 36, -34 22, -42 0 C -52 -30, -44 -72, 0 -72 Z" />
      <path className="mark" d={kikyoOutline()} transform="translate(0 -20) scale(20)" />
      <rect className="grip" x="-4" y="36" width="8" height="70" rx="3" />
      <circle className="tassel" cx="0" cy="110" r="4" />
    </svg>
  </div>;
}

export function ShigureScene({ step, total, stage }: { step: number; total: number; stage: SceneStage }) {
  const progress = Math.min(1, step / Math.max(1, total - 1));
  return <div className={`scene scene-shigure stage-${stage}`} style={{ ['--p' as string]: progress }} aria-hidden="true">
    <div className="scene-crt"><i className="noise" /><i className="scan" /><i className="roll" /></div>
    <div className="scene-snow">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-((i * 1.7) % 9)}s`, animationDuration: `${7 + (i % 5) * 1.3}s`, ['--s' as string]: 0.5 + ((i * 7) % 10) / 12 }} />)}</div>
    <svg className={`scene-furin${step >= 2 ? ' on' : ''}`} viewBox="-20 0 40 120">
      <line x1="0" y1="0" x2="0" y2="16" />
      <path className="bell" d="M -11 30 C -11 18, 11 18, 11 30 L 12 34 L -12 34 Z" />
      <line x1="0" y1="34" x2="0" y2="62" />
      <rect className="tanzaku" x="-5" y="62" width="10" height="40" rx="1" />
    </svg>
  </div>;
}

/** 時雨's progress: the brewing machine's four gauges; each needle swings up as a step finishes. */
export function BrewGauges({ step, total }: { step: number; total: number }) {
  const gauges = ['湯溫', '壓力', '濃度', '香氣'];
  return <div className="brew-gauges" aria-hidden="true">
    {gauges.map((name, i) => {
      const done = step > i;
      const full = step >= total;
      return <div key={name} className={`brew-gauge${done ? ' on' : ''}${full ? ' full' : ''}`}>
        <svg viewBox="-12 -12 24 16">
          <path className="track" d="M -9 0 A 9 9 0 0 1 9 0" pathLength={1} />
          <path className="fill" d="M -9 0 A 9 9 0 0 1 9 0" pathLength={1} />
          <line className="needle" x1="0" y1="0" x2="-7" y2="0" />
          <circle r="1.4" />
        </svg>
        <span>{name}</span>
      </div>;
    })}
  </div>;
}
