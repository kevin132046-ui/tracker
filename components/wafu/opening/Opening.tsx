'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import HaloParticles, { FORM_SECONDS, type HaloPhase } from './HaloParticles';
import InkFluid, { type InkFluidHandle } from './InkFluid';
import type { IntroLanguage } from '@/lib/wafu/intro';
import { introLanguage, introLiteDetected, liftIntroVeil, loadIntroLiteAuto, markIntroSeen, setIntroLiteDetected } from '@/lib/wafu/intro';
import { useWafuAssets } from '@/lib/wafu/assets';
import { kikyoInner, kikyoOutline, kikyoStamen, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';
import { setMediaPrefs, useMediaPrefs } from '@/lib/wafu/media';
import { audioReady, playSfx, unlockAudio } from '@/lib/wafu/sfx';
import type { WafuTheme } from '@/lib/wafu/theme';

type Stage = 'loading' | 'form' | 'stamp' | 'opening' | 'gone';

const titles: Record<WafuTheme, string> = { kikyo: '桐生桔梗', shigure: '間宵時雨' };
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
const soundLabels: Record<IntroLanguage, { name: string; on: string; off: string }> = {
  zh: { name: '音效', on: '音效開啟', off: '開啟音效' },
  ja: { name: '効果音', on: 'サウンド オン', off: 'サウンド' },
  en: { name: 'Sound', on: 'Sound on', off: 'Sound' },
};
// Below ~40 fps the ink costs more than it adds.
const slowFrameMs = 25;
// Longest the last step waits for the trades before the doors open anyway.
const readyWaitMs = 3000;

/**
 * 和風 opening, over the page while it loads (tap anywhere, Esc, Enter or Space skips it).
 * Underneath is ink in water (stable fluids): each loading step drops ink, and when the halo forms
 * the ink is pulled into a ring. 桔梗: shoji doors with a round window, an あやとり thread for the
 * progress, then the doors slide apart. 時雨: long noren in the snow steam, snow crystals for the
 * progress, then the noren swing aside. The last step waits (briefly) for the trades to load.
 * An uploaded silhouette appears behind the shoji (sharper as loading completes) or dyed into the
 * right noren; sound effects are synthesised and play once the sound button (or a tap) unlocks audio.
 */
export default function Opening({ theme, reduced, ready, onDone, onReveal }: {
  theme: WafuTheme;
  reduced: boolean;
  /** The page's data has loaded. */
  ready: boolean;
  onDone: () => void;
  onReveal?: () => void;
}) {
  const [language] = useState(introLanguage);
  const steps = loaderSteps[theme][language];
  const [step, setStep] = useState(0);
  const [stage, setStage] = useState<Stage>('loading');
  const [fading, setFading] = useState(false);
  const [inkOk, setInkOk] = useState(() => !(loadIntroLiteAuto() && introLiteDetected()));
  const { assets } = useWafuAssets();
  const silhouette = assets[`sil-${theme}`]?.url ?? null;
  const prefs = useMediaPrefs();
  const [unlocked, setUnlocked] = useState(audioReady);
  const sound = prefs.sfx && unlocked;
  const crestRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<InkFluidHandle>(null);
  const doneRef = useRef(false);
  const callbacks = useRef({ onDone, onReveal });
  const readyRef = useRef(ready);
  const readyWaiters = useRef<Array<() => void>>([]);

  useEffect(() => { callbacks.current = { onDone, onReveal }; });
  useEffect(() => {
    readyRef.current = ready;
    if (ready) readyWaiters.current.splice(0).forEach((resolve) => resolve());
  }, [ready]);
  // The opening now covers the page itself.
  useLayoutEffect(() => { liftIntroVeil(); markIntroSeen(); }, []);
  useEffect(() => { if (stage === 'opening') callbacks.current.onReveal?.(); }, [stage]);

  const finish = useCallback((gesture = false) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (gesture && unlockAudio()) playSfx(theme === 'kikyo' ? 'slide' : 'swish', theme);
    setStage('gone');
    callbacks.current.onDone();
  }, [theme]);

  // Fonts and the trades load for real; each step also has a minimum time so the crest can draw.
  useEffect(() => {
    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => { timers.push(window.setTimeout(resolve, ms)); });
    const untilReady = () => readyRef.current ? Promise.resolve() : new Promise<void>((resolve) => { readyWaiters.current.push(resolve); });
    void (async () => {
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
      if (reduced) {
        setStage('opening');
        await wait(420);
        if (alive) finish();
        return;
      }
      setStage('form');
      await wait(FORM_SECONDS * 1000);
      if (!alive) return;
      setStage('stamp');
      await wait(560);
      if (!alive) return;
      setStage('opening');
      await wait(1150);
      if (!alive) return;
      // The doors have finished; fade what is left instead of removing it in one frame.
      setFading(true);
      await wait(240);
      if (alive) finish();
    })();
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [reduced, steps.length, finish]);

  // Slow-device guard: measure frame gaps for 700 ms; if the median is slow, drop the ink (and
  // remember it, so later openings start lite).
  useEffect(() => {
    if (reduced || !inkOk || !loadIntroLiteAuto()) return;
    let raf = 0;
    let last = 0;
    const gaps: number[] = [];
    const started = performance.now();
    const probe = (now: number) => {
      if (last) gaps.push(now - last);
      last = now;
      if (now - started < 700) { raf = requestAnimationFrame(probe); return; }
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      if (median > slowFrameMs) {
        setIntroLiteDetected(true);
        setInkOk(false);
      }
    };
    raf = requestAnimationFrame(probe);
    return () => cancelAnimationFrame(raf);
    // Measured once, at the start of the opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      finish(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const getAnchor = useCallback(() => {
    const element = crestRef.current;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width * 0.98 };
  }, []);

  // Each finished step drops a little ink, with a koto note or a wind chime.
  useEffect(() => {
    if (step === 0) return;
    inkRef.current?.bloom(0.2 + Math.random() * 0.6, 0.25 + Math.random() * 0.5);
    playSfx('tick', theme);
    if (step === 1) playSfx('ink', theme);
  }, [step, theme]);
  // As the halo forms, the ink is drawn into a ring around it; then the stamp and the doors sound.
  useEffect(() => {
    if (stage === 'form') {
      const anchor = getAnchor();
      if (anchor) inkRef.current?.swirl(anchor.x / window.innerWidth, anchor.y / window.innerHeight, (anchor.r * 1.25) / window.innerWidth);
      playSfx('halo', theme);
    } else if (stage === 'stamp') playSfx('stamp', theme);
    else if (stage === 'opening') playSfx(theme === 'kikyo' ? 'slide' : 'swish', theme);
  }, [stage, theme, getAnchor]);

  if (stage === 'gone') return null;
  const pct = Math.round((step / steps.length) * 100);
  const haloPhase: HaloPhase = stage === 'loading' ? 'idle' : stage === 'form' ? 'form' : stage === 'stamp' ? 'stamp' : 'out';
  const label = step >= steps.length ? steps[steps.length - 1] : steps[step];
  const skipHint = skipHints[language];

  return (
    <div
      className={`opening opening-${theme} stage-${stage}${fading ? ' is-fading' : ''}${reduced ? ' is-reduced' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${label} ${pct}% · ${skipHint}`}
      data-i18n-skip=""
      onClick={() => finish(true)}
    >
      {theme === 'kikyo' ? <ShojiDoors silhouette={silhouette} near={step / steps.length} /> : <NorenCurtain silhouette={silhouette} />}

      {!reduced && inkOk && (
        <InkFluid ref={inkRef} theme={theme} active={stage === 'loading' || stage === 'form'} className="opening-ink" onFail={() => setInkOk(false)} />
      )}

      {!reduced && <HaloParticles phase={haloPhase} theme={theme} getAnchor={getAnchor} />}

      <button
        type="button"
        className={`opening-sound${sound ? ' on' : ''}`}
        aria-pressed={sound}
        aria-label={soundLabels[language].name}
        onClick={(event) => {
          event.stopPropagation();
          if (sound) { setMediaPrefs({ sfx: false }); return; }
          setMediaPrefs({ sfx: true });
          if (unlockAudio()) { setUnlocked(true); playSfx('tick', theme); }
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
          {sound ? <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
        </svg>
        <span>{sound ? soundLabels[language].on : soundLabels[language].off}</span>
      </button>

      <div className="opening-center">
        <div className="opening-crest" ref={crestRef}>
          <svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true">
            {theme === 'kikyo' ? (
              <g fill="none" strokeLinejoin="round" strokeLinecap="round">
                <path className="crest-fill" d={kikyoOutline()} />
                <path className="crest-draw crest-draw-a" pathLength={1} d={kikyoOutline()} strokeWidth={0.05} />
                <path className="crest-draw crest-draw-b" pathLength={1} d={kikyoInner()} strokeWidth={0.035} />
                <path className="crest-draw crest-draw-c" pathLength={1} d={kikyoStamen()} strokeWidth={0.03} />
                <circle className="crest-dot" r={0.085} />
              </g>
            ) : (
              <g fill="none" strokeLinejoin="round" strokeLinecap="round">
                <path className="crest-fill" d={yukiwaOutline()} />
                <path className="crest-draw crest-draw-a" pathLength={1} d={yukiwaOutline()} strokeWidth={0.05} />
                <path className="crest-draw crest-draw-b" pathLength={1} d={snowCrystal(0.44)} strokeWidth={0.035} />
              </g>
            )}
          </svg>
        </div>

        {theme === 'kikyo' ? <AyatoriThread step={step} total={steps.length} /> : <SnowSteps step={step} total={steps.length} />}
      </div>

      <div className="opening-caption">
        <div className="opening-label">
          <span className="opening-step">{label}</span>
          <span className="opening-pct">{`${String(pct).padStart(2, '0')}%`}</span>
        </div>
        <div className="opening-brand">{`OPTIONFLOW · ${titles[theme]}`}</div>
        <div className="opening-skip">{skipHint}</div>
      </div>
    </div>
  );
}

/** The mask of an uploaded silhouette (a white PNG whose alpha is the figure). */
const maskStyle = (url: string) => ({ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` });

function ShojiDoors({ silhouette, near }: { silhouette: string | null; near: number }) {
  return (
    <div className="doors" aria-hidden="true">
      {(['l', 'r'] as const).map((side) => (
        <div key={side} className={`door door-${side}`}>
          <div className="shoji-paper" />
          <span className="maru" />
          {/* 影繪: the figure behind the paper comes closer (sharper) as loading completes. */}
          {side === 'r' && silhouette && <span className="kage" style={{ ...maskStyle(silhouette), ['--near' as string]: near }} />}
          <span className="hikite" />
        </div>
      ))}
    </div>
  );
}

const yukiwaPattern = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='none' stroke='#e9fbfa' stroke-width='1.3' stroke-linejoin='round'><g transform='translate(30 30) scale(16)'><path vector-effect='non-scaling-stroke' d='${yukiwaOutline()}'/></g><g transform='translate(90 90) scale(10)' opacity='.7'><path vector-effect='non-scaling-stroke' d='${yukiwaOutline()}'/></g></g></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}")`;
})();

function NorenCurtain({ silhouette }: { silhouette: string | null }) {
  return (
    <div className="noren" aria-hidden="true">
      <div className="noren-rod" />
      {[0, 1, 2].map((i) => (
        <div key={i} className={`noren-strip noren-${i}`}>
          <div className="noren-print" style={{ backgroundImage: yukiwaPattern }} />
          {i === 0 && <span className="noren-text"><i>時</i><i>雨</i></span>}
          {i === 2 && silhouette && <span className="noren-figure" style={maskStyle(silhouette)} />}
        </div>
      ))}
      <div className="steam"><i /><i /><i /><i /></div>
    </div>
  );
}

/** あやとり: a red thread strung peg to peg as the steps finish. */
function AyatoriThread({ step, total }: { step: number; total: number }) {
  const pegs = [[10, 26], [55, 6], [100, 26], [145, 6], [190, 26]];
  const segments = pegs.slice(1).map(([x, y], i) => `M ${pegs[i][0]} ${pegs[i][1]} L ${x} ${y}`);
  const done = Math.min(segments.length, Math.round((step / total) * segments.length));
  return (
    <svg className="ayatori" viewBox="0 0 200 32" aria-hidden="true">
      <path d="M 10 26 L 190 26 M 55 6 L 145 6" className="ayatori-ghost" />
      {segments.map((d, i) => <path key={d} d={d} pathLength={1} className={`ayatori-seg${i < done ? ' on' : ''}`} />)}
      {pegs.map(([x, y], i) => <circle key={x} cx={x} cy={y} r={2.4} className={`ayatori-peg${i <= done ? ' on' : ''}`} />)}
    </svg>
  );
}

function SnowSteps({ step, total }: { step: number; total: number }) {
  return (
    <div className="snowsteps" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <svg key={i} viewBox="-1 -1 2 2" className={i < step ? 'on' : ''}>
          <path d={snowCrystal(0.8)} fill="none" stroke="currentColor" strokeWidth={0.12} strokeLinecap="round" />
        </svg>
      ))}
    </div>
  );
}
