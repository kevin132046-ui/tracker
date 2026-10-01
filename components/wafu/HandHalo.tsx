'use client';

import { useEffect, useId, useState } from 'react';
import { handFps, handHaloFrames } from '@/lib/wafu/hand-halo';
import type { HaloTheme } from '@/lib/wafu/halo';
import { HALO_CENTER, haloTiltScale } from '@/components/wafu/HaloIcon';

/**
 * 手繪光環圖示：逐格切換預先畫好的手繪畫格（每秒 8 格），不是連續旋轉。
 * spin=false、省電模式或「減少動態」時停在第一格。開場動畫仍用 HaloIcon。
 */
export default function HandHalo({ theme, size = 30, spin = true, tilt = 0, tone = 'dark', className = '' }: {
  theme: HaloTheme; size?: number; spin?: boolean; tilt?: number; tone?: 'dark' | 'paper'; className?: string;
}) {
  const frames = handHaloFrames(theme);
  const [frame, setFrame] = useState(0);
  const uid = useId().replace(/:/g, '');
  useEffect(() => {
    if (!spin) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.perf === 'lite';
    if (still) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setFrame((current) => (current + 1) % frames.length); }, 1000 / handFps);
    return () => window.clearInterval(timer);
  }, [spin, frames.length]);
  const shown = frames[spin ? frame : 0];
  // Lines stay at least about a pixel wide at small sizes.
  const minWidth = (0.95 * 2.28) / size;
  const grad = `hh-${uid}`;
  const squash = tilt ? `translate(${HALO_CENTER.x} ${HALO_CENTER.y}) scale(1 ${haloTiltScale(tilt).toFixed(4)}) translate(${-HALO_CENTER.x} ${-HALO_CENTER.y})` : undefined;
  return <svg className={`halo-ico hand-halo halo-${theme} tone-${tone} ${className}`} viewBox="-1.14 -1.14 2.28 2.28" width={size} height={size} aria-hidden="true" focusable="false">
    {theme === 'shigure' && <defs><linearGradient id={grad} x1="-1" y1="-1" x2="1" y2="1" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#8fe4ff" /><stop offset=".5" stopColor="#46c6f5" /><stop offset="1" stopColor="#9eeaff" /></linearGradient></defs>}
    <g transform={squash} strokeLinecap="round" strokeLinejoin="round">
      {shown.map((s, i) => <path key={`s${i}`} className={`h-${s.kind} hh-sketch`} d={s.sketch} fill="none" strokeWidth={Math.max(s.width * 0.28, minWidth * 0.6)} stroke={theme === 'shigure' ? `url(#${grad})` : undefined} />)}
      {shown.map((s, i) => s.ribbon
        ? <path key={`m${i}`} className={`h-${s.kind} hh-brush`} d={s.d} />
        : <path key={`m${i}`} className={`h-${s.kind}`} d={s.d} fill={s.kind === 'eye' ? undefined : 'none'} strokeWidth={Math.max(s.width, minWidth)} stroke={theme === 'shigure' ? `url(#${grad})` : undefined} />)}
    </g>
  </svg>;
}
