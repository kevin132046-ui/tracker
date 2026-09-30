'use client';

import { useEffect, useRef, useState } from 'react';
import { kikyoInner, kikyoOutline, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';
import { jikanOf, sekkiOf } from '@/lib/wafu/koyomi';
import { usePerfLite } from '@/lib/wafu/perf';
import type { WafuTheme } from '@/lib/wafu/theme';

/**
 * The lower part of the side rail (wide screens): 光粒 rising through it like the opening's halo
 * particles, the theme's crest with a slow glow, and the solar term and 刻 in vertical type.
 * The particles are a small canvas at ~30 fps; they stop off screen, in the background tab, with
 * reduced motion and in 效能模式.
 */
export default function RailFoot({ theme }: { theme: WafuTheme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lite = usePerfLite();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const still = lite || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0, height = 0, frame = 0, last = 0, visible = true;
    const color = getComputedStyle(canvas).color || 'rgb(157 188 240)';
    const motes = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.3, v: 0.012 + Math.random() * 0.03, p: Math.random() * 6.28, a: 0.25 + Math.random() * 0.55 }));
    const size = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width; height = box.height;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = (time: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      // ~30 fps is plenty for slow motes.
      if (!still && last && time - last < 32) { frame = requestAnimationFrame(draw); return; }
      const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
      last = time;
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      for (const mote of motes) {
        if (!still) {
          mote.y -= mote.v * dt * 4;
          mote.p += dt * 1.4;
          if (mote.y < -0.04) { mote.y = 1.04; mote.x = Math.random(); }
        }
        const twinkle = 0.6 + 0.4 * Math.sin(mote.p);
        // Brighter near the crest (the lower third), fading towards the top.
        context.globalAlpha = mote.a * twinkle * (0.35 + 0.65 * mote.y);
        context.beginPath();
        context.arc(mote.x * width + Math.sin(mote.p * 0.7) * 3, mote.y * height, mote.r, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      if (!still) frame = requestAnimationFrame(draw);
    };
    const start = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) { last = 0; start(); } });
    observer.observe(canvas);
    const resize = new ResizeObserver(() => { size(); if (still) draw(performance.now()); });
    resize.observe(canvas);
    const onVisibility = () => { if (!document.hidden) { last = 0; start(); } };
    document.addEventListener('visibilitychange', onVisibility);
    size();
    start();
    return () => { observer.disconnect(); resize.disconnect(); document.removeEventListener('visibilitychange', onVisibility); cancelAnimationFrame(frame); };
  }, [lite, theme]);

  return <div className={`wafu-rail-foot is-${theme}`} aria-hidden="true">
    <canvas ref={canvasRef} className="wafu-rail-motes" />
    <div className="wafu-rail-koyomi">
      {now !== null && <><span>{sekkiOf(now)}</span><span>{jikanOf(now)}</span></>}
    </div>
    <svg className="wafu-rail-crest" viewBox="-1.25 -1.25 2.5 2.5">
      {theme === 'kikyo'
        ? <g fill="none" strokeLinejoin="round" strokeLinecap="round"><path d={kikyoOutline()} strokeWidth={0.07} /><path d={kikyoInner()} strokeWidth={0.05} /></g>
        : <g fill="none" strokeLinejoin="round" strokeLinecap="round"><path d={yukiwaOutline()} strokeWidth={0.07} /><path d={snowCrystal(0.44)} strokeWidth={0.05} /></g>}
    </svg>
  </div>;
}
