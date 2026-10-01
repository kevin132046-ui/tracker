'use client';

import { useId } from 'react';
import { haloStrokes, strokePath, type HaloTheme } from '@/lib/wafu/halo';

// The halo is drawn in a square box centred on (0, 0).
const VIEW = { x: -1.14, y: -1.14, w: 2.28, h: 2.28 } as const;
/** Rotation centre, from the view box: the ring spins in place instead of orbiting a corner. */
export const HALO_CENTER = { x: VIEW.x + VIEW.w / 2, y: VIEW.y + VIEW.h / 2 } as const;
/** Height of a halo tilted back by `tilt` degrees, as a share of its width. */
export const haloTiltScale = (tilt: number) => Math.cos((tilt * Math.PI) / 180);

/**
 * 角色光環圖示（向量）：桔梗＝藍色雙 C 外環＋深色雙臂螺旋＋杏眼；時雨＝相連六角蜂巢的齒輪狀環（粗的青藍發光線）。
 * spin 時外環（與光弧／蜂巢）緩慢旋轉，桔梗的眼睛保持正向。
 * tilt（度）把光環往後傾：在 SVG 內壓扁，不用 CSS 3D，線條維持向量般清晰。
 * 立體感：下方疊幾層較暗的同形線條當作環的厚度，上緣加一道細高光，底下一圈柔和陰影（depth=false 時關閉）。
 */
export default function HaloIcon({ theme, size = 44, spin = true, className = '', tone = 'dark', tilt = 0, minStrokePx = 0, depth = true }: {
  theme: HaloTheme; size?: number; spin?: boolean; className?: string; tone?: 'dark' | 'paper'; tilt?: number; depth?: boolean;
  /** 小尺寸時線條至少這麼粗（px），蜂巢格等細線才看得清楚。 */
  minStrokePx?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const strokes = haloStrokes(theme);
  // Small icons keep every line at least about a pixel wide, so they stay crisp.
  const minWidth = (Math.max(minStrokePx, size < 48 ? 0.9 : 0) * VIEW.w) / size;
  // Thickness of the ring: about 2.5% of its width, never under half a pixel per layer.
  const layer = Math.max(0.028, (0.6 * VIEW.w) / size);
  const layers = depth ? [3, 2, 1] : [];
  const grad = `hg-${uid}`;
  const rot = strokes.filter((s) => s.spin);
  const still = strokes.filter((s) => !s.spin);
  const draw = (list: typeof strokes, scale = 1) => list.map((s, i) => (
    <path key={`${s.kind}-${i}`} className={`h-${s.kind}`} d={strokePath(s)}
      strokeWidth={Math.max(s.width, minWidth) * scale} fill={s.kind === 'pupil' ? 'currentColor' : theme === 'shigure' ? `url(#${grad}-f)` : 'none'}
      stroke={theme === 'shigure' ? `url(#${grad})` : undefined} />
  ));
  const tilted = tilt ? `translate(${HALO_CENTER.x} ${HALO_CENTER.y}) scale(1 ${haloTiltScale(tilt).toFixed(4)}) translate(${-HALO_CENTER.x} ${-HALO_CENTER.y})` : undefined;
  // One copy of the halo (spinning part and still part), as the face, an edge layer or the highlight.
  const halo = (scale = 1, only?: (kind: string) => boolean) => {
    const pick = (list: typeof strokes) => only ? list.filter((s) => only(s.kind)) : list;
    return <g transform={tilted}>
      <g className={spin ? 'halo-rot' : undefined} style={spin ? { transformOrigin: `${HALO_CENTER.x}px ${HALO_CENTER.y}px` } : undefined} strokeLinecap='round' strokeLinejoin='round'>{draw(pick(rot), scale)}</g>
      <g strokeLinecap='round' strokeLinejoin='round'>{draw(pick(still), scale)}</g>
    </g>;
  };
  const ringOnly = (kind: string) => kind !== 'pupil' && kind !== 'eye';
  return (
    <svg className={`halo-ico halo-${theme} tone-${tone} ${className}`} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} width={size} height={size} aria-hidden='true' focusable='false'>
      <defs>
        <radialGradient id={`${grad}-sh`}><stop offset='0.55' stopColor='currentColor' stopOpacity='0.32' /><stop offset='1' stopColor='currentColor' stopOpacity='0' /></radialGradient>
      {theme === 'shigure' && (
        <>
          <linearGradient id={grad} x1='-1' y1='-1' x2='1' y2='1' gradientUnits='userSpaceOnUse'>
            <stop offset='0' stopColor='#8fe4ff' />
            <stop offset='0.5' stopColor='#46c6f5' />
            <stop offset='1' stopColor='#9eeaff' />
          </linearGradient>
          <linearGradient id={`${grad}-f`} x1='-1' y1='-1' x2='1' y2='1' gradientUnits='userSpaceOnUse'>
            <stop offset='0' stopColor='#d9c8ff' stopOpacity='0.16' />
            <stop offset='1' stopColor='#b8f0ff' stopOpacity='0.06' />
          </linearGradient>
        </>
      )}
      </defs>
      {depth && <ellipse className='h-shadow' fill={`url(#${grad}-sh)`} cx={HALO_CENTER.x} cy={HALO_CENTER.y + layer * 5} rx={1.06} ry={1.06 * (tilt ? haloTiltScale(tilt) : 1)} />}
      {layers.map((n) => <g key={n} className='h-depth' style={{ opacity: 0.3 + 0.18 * (3 - n) }} transform={`translate(0 ${(layer * n).toFixed(4)})`}>{halo(1.05, ringOnly)}</g>)}
      {halo()}
      {depth && <g className='h-shine' transform={`translate(0 ${(-layer * 0.45).toFixed(4)})`}>{halo(0.38, ringOnly)}</g>}
    </svg>
  );
}
