import { useCallback, useEffect, useRef, useState } from "react";
import HaloParticles, { FORM_SECONDS, type HaloPhase } from "./HaloParticles";
import InkFluid, { type InkFluidHandle } from "./InkFluid";
import { kikyoInner, kikyoOutline, kikyoStamen, snowCrystal, yukiwaOutline } from "./Marks";
import { KIKYO_SIL, SHIGURE_PRINT } from "@/assets/silhouettes";
import { audioPrefs, audioReady, playSfx, player, setSfx, unlockAudio } from "@/lib/audio";
import { THEMES, type ThemeId } from "@/lib/theme";
import { safeGet, safeSet, type Lang } from "@/lib/wa";

interface Props {
  theme: ThemeId;
  lang: Lang;
  reduced: boolean;
  onDone: () => void;
  onReveal?: () => void;
}

type Stage = "loading" | "form" | "stamp" | "opening" | "gone";

/** Opening quality: when on (default), a slow first second switches to the opening without the ink fluid. */
export const LITE_AUTO_KEY = "wa-intro-lite-auto";
export const LITE_DETECTED_KEY = "wa-intro-lite";
const liteAuto = () => safeGet(LITE_AUTO_KEY) !== "0";
// Below ~40 fps the fluid costs more than it adds.
const slowFrameMs = 25;

/**
 * 開場（點畫面任何地方即可略過，Esc／Enter 亦可；右上角可開啟音效）：
 * 底層是以 Navier–Stokes（stable fluids）模擬的水中墨：載入每一步滴下一滴墨，光環成形時墨被捲成一圈，滑鼠劃過會推動水流。
 * 桔梗 — 障子拉門＋丸窓；門後的影繪由上傳圖描出，載入越完整影子越清晰；
 *        あやとり紅線記錄進度 → 粒子匯聚成她的光環（取代朱印）→ 拉門左右滑開。
 * 時雨 — 長暖簾＋落雪；右簾以白抜き染印上由上傳圖描出的圖樣；
 *        雪晶點亮進度 → 雪片匯聚成齒輪光環 → 暖簾左右擺開、中簾上掀。
 */
export default function Opening({ theme, lang, reduced, onDone, onReveal }: Props) {
  const spec = THEMES[theme];
  const steps = spec.loaderSteps[lang];
  const [step, setStep] = useState(0);
  const [stage, setStage] = useState<Stage>("loading");
  const crestRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<InkFluidHandle>(null);
  const [inkOk, setInkOk] = useState(() => !(liteAuto() && safeGet(LITE_DETECTED_KEY) === "1"));
  const [fading, setFading] = useState(false);
  const [sound, setSound] = useState(() => audioPrefs.sfx && audioReady());
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  useEffect(() => {
    if (stage === "opening") onRevealRef.current?.();
  }, [stage]);

  const finish = useCallback((gesture = false) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (gesture && audioPrefs.sfx && unlockAudio()) {
      playSfx(theme === "kikyo" ? "slide" : "swish", theme);
      if (audioPrefs.bgm) void player.play();
    }
    setStage("gone");
    onDoneRef.current();
  }, [theme]);

  // 真實載入：字型 + 模擬報價請求；另保留最短展示時間讓描線完成
  useEffect(() => {
    let alive = true;
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(window.setTimeout(r, ms)));
    (async () => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve();
      const durations = reduced ? [120, 120, 120, 120] : [420, 380, 360, 320];
      for (let i = 0; i < durations.length; i++) {
        await wait(durations[i]);
        if (i === 0) await Promise.race([fonts, wait(1500)]);
        if (!alive) return;
        setStep(i + 1);
      }
      await wait(reduced ? 150 : 260);
      if (!alive) return;
      setStep(steps.length);
      if (reduced) {
        setStage("opening");
        await wait(420);
        if (alive) finish();
        return;
      }
      setStage("form");
      await wait(FORM_SECONDS * 1000);
      if (!alive) return;
      setStage("stamp");
      await wait(560);
      if (!alive) return;
      setStage("opening");
      await wait(1150);
      if (!alive) return;
      // The doors have finished; fade what is left instead of removing it in one frame.
      setFading(true);
      await wait(240);
      if (alive) finish();
    })();
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [reduced, steps.length, finish]);

  // 弱機保護：載入前段量 700ms 的影格間隔，太慢就收掉水墨流體（之後的開場直接用輕量版）
  useEffect(() => {
    if (reduced || !inkOk || !liteAuto()) return;
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
        safeSet(LITE_DETECTED_KEY, "1");
        setInkOk(false);
      }
    };
    raf = requestAnimationFrame(probe);
    return () => cancelAnimationFrame(raf);
    // Measured once, at the start of the opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc / Enter 也可略過
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  const getAnchor = useCallback(() => {
    const el = crestRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width * 0.98 };
  }, []);

  // 每完成一步：滴一滴墨＋一聲琴音／風鈴
  useEffect(() => {
    if (step === 0) return;
    const x = 0.2 + Math.random() * 0.6, y = 0.25 + Math.random() * 0.5;
    inkRef.current?.bloom(x, y);
    playSfx("tick", theme);
    if (step === 1) playSfx("ink", theme);
  }, [step, theme]);
  // 光環成形：墨被捲成一圈；蓋印與開門的聲音
  useEffect(() => {
    if (stage === "form") {
      const a = getAnchor();
      if (a) inkRef.current?.swirl(a.x / window.innerWidth, a.y / window.innerHeight, (a.r * 1.25) / window.innerWidth);
      playSfx("halo", theme);
    } else if (stage === "stamp") playSfx("stamp", theme);
    else if (stage === "opening") playSfx(theme === "kikyo" ? "slide" : "swish", theme);
  }, [stage, theme, getAnchor]);

  if (stage === "gone") return null;
  const pct = Math.round((step / steps.length) * 100);
  const near = step / steps.length;
  const haloPhase: HaloPhase = stage === "loading" ? "idle" : stage === "form" ? "form" : stage === "stamp" ? "stamp" : "out";
  const label = step >= steps.length ? steps[steps.length - 1] : steps[step];
  const skipHint = lang === "ja" ? "画面をタップでスキップ" : "點擊畫面略過";

  return (
    <div
      className={`opening opening-${theme} stage-${stage}${fading ? " is-fading" : ""}${reduced ? " is-reduced" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`${label} ${pct}% · ${skipHint}`}
      onClick={() => finish(true)}
    >
      {theme === "kikyo" ? <ShojiDoors near={near} reduced={reduced} /> : <NorenCurtain />}

      {!reduced && inkOk && (
        <InkFluid ref={inkRef} theme={theme} active={stage === "loading" || stage === "form"} className="opening-ink" onFail={() => setInkOk(false)} />
      )}

      {!reduced && <HaloParticles phase={haloPhase} theme={theme} getAnchor={getAnchor} />}

      <button
        type="button"
        className={`opening-sound${sound ? " on" : ""}`}
        aria-pressed={sound}
        aria-label={lang === "ja" ? "効果音" : "音效"}
        onClick={(e) => {
          e.stopPropagation();
          if (!sound) { setSfx(true); if (unlockAudio()) { playSfx("tick", theme); setSound(true); } }
          else { setSfx(false); setSound(false); }
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
          {sound ? <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
        </svg>
        <span>{sound ? (lang === "ja" ? "サウンド オン" : "音效開啟") : (lang === "ja" ? "サウンド" : "開啟音效")}</span>
      </button>

      <div className="opening-center">
        <div className="opening-crest" ref={crestRef}>
          <svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true">
            {theme === "kikyo" ? (
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

        {theme === "kikyo" ? <AyatoriThread step={step} total={steps.length} /> : <SnowSteps step={step} total={steps.length} />}
      </div>

      <div className="opening-caption">
        <div className="opening-label">
          <span className="opening-step">{label}</span>
          <span className="opening-pct">{String(pct).padStart(2, "0")}%</span>
        </div>
        <div className="opening-brand">OPTIONFLOW · {spec.title.join("")}</div>
        <div className="opening-skip">{skipHint}</div>
      </div>
    </div>
  );
}

function ShojiDoors({ near, reduced }: { near: number; reduced: boolean }) {
  return (
    <div className="doors" aria-hidden="true">
      <div className="door door-l">
        <div className="shoji-paper" />
        <span className="maru" />
        <span className="hikite" />
      </div>
      <div className="door door-r">
        <div className="shoji-paper" />
        <span className="maru" />
        <KikyoShadow near={near} reduced={reduced} />
        <span className="hikite" />
      </div>
    </div>
  );
}

/** 影繪：由上傳圖描出的剪影；尾巴擺動、光環透光，載入越完整越靠近紙門（越清晰） */
function KikyoShadow({ near, reduced }: { near: number; reduced: boolean }) {
  if (!KIKYO_SIL) return null;
  const [x, y, w, h] = KIKYO_SIL.viewBox;
  const [px, py] = KIKYO_SIL.tailPivot;
  return (
    <svg className="kage" viewBox={`${x} ${y} ${w} ${h}`} style={{ ["--near" as string]: near }} preserveAspectRatio="xMidYMax meet">
      <path className="kage-halo" d={KIKYO_SIL.halo} fillRule="evenodd" />
      <g className="kage-body">
        <path d={KIKYO_SIL.torso} fillRule="evenodd" />
        <g>
          {!reduced && (
            <animateTransform attributeName="transform" type="rotate" dur="2.8s" repeatCount="indefinite"
              values={`-6 ${px} ${py}; 5 ${px} ${py}; -6 ${px} ${py}`} calcMode="spline" keySplines=".45 0 .55 1; .45 0 .55 1" />
          )}
          <path d={KIKYO_SIL.tail} fillRule="evenodd" />
        </g>
      </g>
    </svg>
  );
}

export const yukiwaPattern = (() => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><g fill='none' stroke='%23e9fbfa' stroke-width='1.3' stroke-linejoin='round'><g transform='translate(30 30) scale(16)'><path vector-effect='non-scaling-stroke' d='${yukiwaOutline()}'/></g><g transform='translate(90 90) scale(10)' opacity='.7'><path vector-effect='non-scaling-stroke' d='${yukiwaOutline()}'/></g></g></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/\n/g, "")}")`;
})();

function NorenCurtain() {
  const [x, y, w, h] = SHIGURE_PRINT?.viewBox ?? [0, 0, 1, 1];
  return (
    <div className="noren" aria-hidden="true">
      <div className="noren-rod" />
      {[0, 1, 2].map((i) => (
        <div key={i} className={`noren-strip noren-${i}`}>
          <div className="noren-print" style={{ backgroundImage: yukiwaPattern }} />
          {i === 0 && <span className="noren-text">時雨</span>}
          {i === 2 && SHIGURE_PRINT && (
            <svg className="noren-figure" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMax meet">
              <path className="nf-tone" d={SHIGURE_PRINT.tone} fillRule="evenodd" />
              <path className="nf-solid" d={SHIGURE_PRINT.solid} fillRule="evenodd" />
              <path className="nf-lines" d={SHIGURE_PRINT.lines} fillRule="evenodd" />
            </svg>
          )}
        </div>
      ))}
      <div className="steam">
        <i /><i /><i /><i />
      </div>
    </div>
  );
}

/** あやとり：紅線依序在五個指樁之間穿過 */
function AyatoriThread({ step, total }: { step: number; total: number }) {
  const pegs = [
    [10, 26], [55, 6], [100, 26], [145, 6], [190, 26],
  ];
  const segs = [] as string[];
  for (let i = 0; i < pegs.length - 1; i++) segs.push(`M ${pegs[i][0]} ${pegs[i][1]} L ${pegs[i + 1][0]} ${pegs[i + 1][1]}`);
  const done = Math.min(segs.length, Math.round((step / total) * segs.length));
  return (
    <svg className="ayatori" viewBox="0 0 200 32" aria-hidden="true">
      <path d="M 10 26 L 190 26 M 55 6 L 145 6" className="ayatori-ghost" />
      {segs.map((d, i) => (
        <path key={i} d={d} pathLength={1} className={`ayatori-seg${i < done ? " on" : ""}`} />
      ))}
      {pegs.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.4} className={`ayatori-peg${i <= done ? " on" : ""}`} />
      ))}
    </svg>
  );
}

function SnowSteps({ step, total }: { step: number; total: number }) {
  return (
    <div className="snowsteps" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <svg key={i} viewBox="-1 -1 2 2" className={i < step ? "on" : ""}>
          <path d={snowCrystal(0.8)} fill="none" stroke="currentColor" strokeWidth={0.12} strokeLinecap="round" />
        </svg>
      ))}
    </div>
  );
}
