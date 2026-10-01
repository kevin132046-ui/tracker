'use client';

import { visitPick } from '@/lib/wafu/asset-slots';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useWafuAssets } from '@/lib/wafu/assets';
import { useMediaPrefs } from '@/lib/wafu/media';
import { usePerfLite } from '@/lib/wafu/perf';
import type { WafuTheme } from '@/lib/wafu/theme';

const reducedQuery = '(prefers-reduced-motion: reduce)';
const watchReduced = (change: () => void) => {
  const query = window.matchMedia(reducedQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};

/**
 * The 和風 backdrop behind the page: the uploaded picture (if any) and the theme's light —
 * a slow window beam for 桔梗, lantern glow and falling snow for 時雨. Both parts can be switched off.
 */
export default function Backdrop({ theme, paused }: { theme: WafuTheme; paused: boolean }) {
  const { assets } = useWafuAssets();
  const prefs = useMediaPrefs();
  // null on the server and while hydrating: the backdrop only exists in the browser.
  const reduced = useSyncExternalStore(watchReduced, () => window.matchMedia(reducedQuery).matches, () => null);
  const lite = usePerfLite();
  const ref = useRef<HTMLDivElement>(null);
  const photo = prefs.photo ? visitPick(assets, 'bg', theme)?.url ?? null : null;
  const shown = reduced !== null && (Boolean(photo) || prefs.effects);

  // The page's own gradient steps aside while the backdrop is shown.
  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.dataset.wafuBackdrop = '1';
    return () => { delete root.dataset.wafuBackdrop; };
  }, [shown]);

  // A little parallax on the picture (not on touch screens, where it costs more than it adds, nor in 效能模式).
  useEffect(() => {
    if (reduced || lite || !photo || window.matchMedia('(pointer: coarse)').matches) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => ref.current?.style.setProperty('--sy', `${Math.min(window.scrollY, 1600)}px`));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [reduced, lite, photo]);

  if (!shown) return null;
  return createPortal(
    <div className={`wafu-bd wafu-bd-${theme}${photo ? ' has-photo' : ''}`} aria-hidden="true" ref={ref}>
      {photo && <div key={photo} className="wafu-bd-photo" style={{ backgroundImage: `url("${photo}")` }} />}
      {prefs.effects && theme === 'kikyo' && <div className="wafu-bd-beam" />}
      {prefs.effects && theme === 'shigure' && <><div className="wafu-bd-lantern" /><Snow still={Boolean(reduced) || paused || lite} /></>}
      <div className="wafu-bd-shade" />
    </div>,
    document.body,
  );
}

type Flake = { x: number; y: number; r: number; v: number; p: number };

/** Falling snow; while the opening covers the page (or with reduced motion) one still frame. */
function Snow({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Kept across pauses so the snow carries on where it was.
  const flakesRef = useRef<Flake[] | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let width = 0, height = 0, frame = 0;
    const flakes = flakesRef.current ??= Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.15 + Math.random() * 0.45, p: Math.random() * 6.28 }));
    const size = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = width * ratio; canvas.height = height * ratio;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255,243,226,0.72)';
      for (const flake of flakes) {
        if (!still) {
          flake.p += 0.01; flake.y += (flake.v / height) * 1.6; flake.x += Math.sin(flake.p) * 0.0004;
          if (flake.y > 1.02) { flake.y = -0.02; flake.x = Math.random(); }
        }
        context.globalAlpha = 0.25 + flake.r / 3.5;
        context.beginPath();
        context.arc(flake.x * width, flake.y * height, flake.r, 0, Math.PI * 2);
        context.fill();
      }
      if (!still && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const resize = () => { size(); if (still) draw(); };
    const visible = () => { if (!document.hidden && !still) { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); } };
    size();
    draw();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visible);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visible); };
  }, [still]);
  return <canvas ref={ref} className="wafu-bd-snow" />;
}
