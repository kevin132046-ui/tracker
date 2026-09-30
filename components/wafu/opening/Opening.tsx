'use client';

import { useEffect, useRef } from 'react';
import type { IntroLanguage } from '@/lib/wafu/intro';
import { introLanguage, markIntroSeen } from '@/lib/wafu/intro';
import { useWafuAssets } from '@/lib/wafu/assets';
import { setMediaPrefs, useMediaPrefs } from '@/lib/wafu/media';
import { audioReady, playSfx, unlockAudio } from '@/lib/wafu/sfx';
import type { WafuTheme } from '@/lib/wafu/theme';

const loaderSteps: Record<WafuTheme, Record<IntroLanguage, string[]>> = {
  kikyo: {
    zh: ['偵察報價', '確認布陣', '推演損益', '整備圖表', '軍議完成'],
    ja: ['相場を偵察', '布陣を確認', '損益を推演', '図表を整備', '軍議完了'],
    en: ['Scouting quotes', 'Checking positions', 'Working out P&L', 'Readying charts', 'Council complete'],
  },
  shigure: {
    zh: ['汲取報價', '調配持倉', '溫熱損益', '結晶圖表', '剛剛好'],
    ja: ['相場を汲む', '持高を調合', '損益を温める', '図表を結晶', 'ちょうどいい'],
    en: ['Drawing quotes', 'Blending positions', 'Warming P&L', 'Crystallising charts', 'Just right'],
  },
};
const skipHints: Record<IntroLanguage, string> = { zh: '點擊畫面略過', ja: '画面をタップでスキップ', en: 'Tap anywhere to skip' };
const soundLabels: Record<IntroLanguage, { on: string; off: string }> = {
  zh: { on: '音效開啟', off: '開啟音效' }, ja: { on: 'サウンド オン', off: 'サウンド' }, en: { on: 'Sound on', off: 'Sound' },
};
// Longest the last step waits for the trades before the doors open anyway.
const readyWaitMs = 3000;
const FORM_MS = 1600;

/**
 * Controller of the 和風 opening. The opening itself is static markup that ships with the page
 * (StaticOpening, in the layout) and animates on the compositor from the first frame; this only
 * moves it through its stages by setting attributes on <html> (data-op, data-op-step, --op-p),
 * writes the step name and percentage, plays the sounds, and handles skip and replay. Renders nothing.
 */
export default function Opening({ theme, reduced, ready, onDone, onReveal }: {
  theme: WafuTheme;
  reduced: boolean;
  /** The page's data has loaded. */
  ready: boolean;
  onDone: () => void;
  onReveal?: () => void;
}) {
  const { assets } = useWafuAssets();
  const silhouette = assets[`sil-${theme}`]?.url ?? null;
  const prefs = useMediaPrefs();
  const callbacks = useRef({ onDone, onReveal });
  const readyRef = useRef(ready);
  const readyWaiters = useRef<Array<() => void>>([]);
  const soundRef = useRef(false);
  useEffect(() => { callbacks.current = { onDone, onReveal }; });
  useEffect(() => {
    readyRef.current = ready;
    if (ready) readyWaiters.current.splice(0).forEach((resolve) => resolve());
  }, [ready]);

  // The uploaded silhouette behind the shoji / on the noren.
  useEffect(() => {
    const root = document.documentElement;
    if (silhouette) { root.style.setProperty('--op-sil', `url("${silhouette}")`); root.dataset.opSil = '1'; }
    return () => { root.style.removeProperty('--op-sil'); delete root.dataset.opSil; };
  }, [silhouette]);

  // The sound button reflects the preference (sound needs a gesture to start).
  useEffect(() => {
    const button = document.getElementById('op-sound');
    const label = document.getElementById('op-sound-label');
    const language = introLanguage();
    const on = prefs.sfx && audioReady();
    soundRef.current = on;
    button?.setAttribute('aria-pressed', String(on));
    if (label) label.textContent = on ? soundLabels[language].on : soundLabels[language].off;
  }, [prefs.sfx]);

  useEffect(() => {
    const root = document.documentElement;
    const el = document.getElementById('wafu-opening');
    if (!el) { callbacks.current.onDone(); return; }
    const language = introLanguage();
    const steps = loaderSteps[theme][language];
    const label = document.getElementById('op-label');
    const pctText = document.getElementById('op-pct');
    const sound = document.getElementById('op-sound');
    let alive = true;
    let done = false;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => { timers.push(window.setTimeout(resolve, ms)); });

    // On a fresh load the boot script already shows the opening; from the settings it is replayed:
    // shown again with its CSS animations restarted.
    const w = window as Window & { __wafuIntroT?: number };
    if (w.__wafuIntroT) { window.clearTimeout(w.__wafuIntroT); w.__wafuIntroT = undefined; }
    if (!root.dataset.wafuIntro) {
      root.dataset.wafuIntro = '1';
      el.style.display = 'none';
      void el.offsetWidth;
      el.style.display = '';
    }
    markIntroSeen();
    root.dataset.op = 'loading';
    root.dataset.opStep = '';
    root.style.setProperty('--op-p', '0.12');

    // Percentage text: eases toward the finished steps and keeps creeping while a step works.
    let shown = 0, stepDone = 0, stepAt = performance.now(), raf = 0, prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const creep = stepDone >= steps.length ? 0 : 0.85 * (1 - Math.exp(-(now - stepAt) / 1400));
      const target = Math.min(1, (stepDone + creep) / steps.length);
      shown += (target - shown) * Math.min(1, dt * 5);
      if (target >= 1 && 1 - shown < 0.004) shown = 1;
      if (pctText) pctText.textContent = `${String(Math.round(shown * 100)).padStart(2, '0')}%`;
      if (shown < 1 && alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const setStep = (n: number) => {
      stepDone = n;
      stepAt = performance.now();
      root.dataset.opStep = Array.from({ length: n }, (_, i) => i + 1).join(' ');
      root.style.setProperty('--op-p', String(Math.min(1, (n + 0.6) / steps.length)));
      const text = n >= steps.length ? steps[steps.length - 1] : steps[n];
      if (label) label.textContent = text;
      el.setAttribute('aria-label', `${text} · ${skipHints[language]}`);
      if (n > 0) playSfx('tick', theme);
      if (n === 1) playSfx('ink', theme);
    };
    if (label) label.textContent = steps[0];
    el.setAttribute('aria-label', `${steps[0]} · ${skipHints[language]}`);

    const cleanup = () => {
      delete root.dataset.op;
      delete root.dataset.opStep;
      root.style.removeProperty('--op-p');
      delete root.dataset.wafuIntro;
    };
    const finish = (gesture = false) => {
      if (done) return;
      done = true;
      alive = false;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      if (gesture && unlockAudio()) playSfx(theme === 'kikyo' ? 'slide' : 'swish', theme);
      cleanup();
      callbacks.current.onDone();
    };
    const stage = (name: 'form' | 'stamp' | 'opening' | 'fading') => {
      root.dataset.op = name;
      if (name === 'form') playSfx('halo', theme);
      else if (name === 'stamp') playSfx('stamp', theme);
      else if (name === 'opening') { playSfx(theme === 'kikyo' ? 'slide' : 'swish', theme); callbacks.current.onReveal?.(); }
    };

    const onClick = (event: MouseEvent) => {
      if (sound && sound.contains(event.target as Node)) return;
      finish(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      finish(true);
    };
    const onSound = (event: MouseEvent) => {
      event.stopPropagation();
      if (soundRef.current) { setMediaPrefs({ sfx: false }); return; }
      setMediaPrefs({ sfx: true });
      if (unlockAudio()) { soundRef.current = true; sound?.setAttribute('aria-pressed', 'true'); playSfx('tick', theme); }
    };
    el.addEventListener('click', onClick);
    sound?.addEventListener('click', onSound);
    window.addEventListener('keydown', onKey);

    void (async () => {
      const untilReady = () => readyRef.current ? Promise.resolve() : new Promise<void>((resolve) => { readyWaiters.current.push(resolve); });
      const fonts = document.fonts?.ready ?? Promise.resolve();
      const durations = reduced ? [120, 120, 120, 120] : [420, 380, 360, 320];
      for (let i = 0; i < durations.length; i++) {
        await wait(durations[i]);
        if (i === 0) await Promise.race([fonts, wait(1500)]);
        if (i === durations.length - 1) await Promise.race([untilReady(), wait(readyWaitMs)]);
        if (!alive) return;
        setStep(i + 1);
      }
      await wait(reduced ? 150 : 260);
      if (!alive) return;
      setStep(steps.length);
      if (reduced) { stage('opening'); await wait(380); if (alive) finish(); return; }
      stage('form');
      await wait(FORM_MS);
      if (!alive) return;
      stage('stamp');
      await wait(560);
      if (!alive) return;
      stage('opening');
      await wait(1150);
      if (!alive) return;
      stage('fading');
      await wait(280);
      if (alive) finish();
    })();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      el.removeEventListener('click', onClick);
      sound?.removeEventListener('click', onSound);
      window.removeEventListener('keydown', onKey);
      if (!done) cleanup();
    };
  }, [theme, reduced]);

  return null;
}
