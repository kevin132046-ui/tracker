import { useEffect, useRef } from "react";
import type { ThemeId } from "@/lib/theme";
import { KIKYO_BG } from "@/assets/kikyoBg";
import { SHIGURE_BG } from "@/assets/shigureBg";

/** 背景層：桔梗＝房間插畫＋窗光光束；時雨＝枕邊插畫＋落雪＋燈籠暖光。自訂背景會取代圖片。 */
export default function Backdrop({ theme, customBg, reduced, paused = false }: { theme: ThemeId; customBg: string | null; reduced: boolean; paused?: boolean }) {
  const photo = customBg ?? (theme === "kikyo" ? KIKYO_BG : SHIGURE_BG);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => ref.current?.style.setProperty("--sy", `${Math.min(window.scrollY, 1600)}px`));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [reduced]);
  return (
    <div className={`bd bd-${theme}`} aria-hidden="true" ref={ref}>
      {photo && <div className="bd-photo" style={{ backgroundImage: `url(${photo})` }} />}
      {theme === "kikyo" && <div className="bd-beam" />}
      {theme === "shigure" && (
        <>
          <div className="bd-lantern" />
          <Snow reduced={reduced} paused={paused} />
        </>
      )}
      <div className="bd-shade" />
    </div>
  );
}

/** 落雪；開場畫面還蓋著背景時（paused）只畫一格靜止畫面，不跑動畫。 */
function Snow({ reduced, paused }: { reduced: boolean; paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const flakesRef = useRef<{ x: number; y: number; r: number; v: number; p: number }[] | null>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0;
    // 雪花存在 ref 裡：暫停→繼續時接著原本的位置飄，不會整片重排。
    const flakes = flakesRef.current ??= Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.15 + Math.random() * 0.45, p: Math.random() * 6.28 }));
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      c.width = w * dpr; c.height = h * dpr; c.style.width = w + "px"; c.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    addEventListener("resize", size);
    const still = reduced || paused;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,243,226,0.72)";
      for (const f of flakes) {
        if (!still) {
          f.p += 0.01; f.y += f.v / h * 1.6; f.x += Math.sin(f.p) * 0.0004;
          if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
        }
        ctx.globalAlpha = 0.25 + f.r / 3.5;
        ctx.beginPath();
        ctx.arc(f.x * w, f.y * h, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    };
    draw();
    const vis = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); document.removeEventListener("visibilitychange", vis); };
  }, [reduced, paused]);
  return <canvas ref={ref} className="bd-snow" />;
}
