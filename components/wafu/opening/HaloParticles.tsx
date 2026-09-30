import { useEffect, useRef } from "react";
import { haloStrokes, sampleHalo, type HaloTheme } from "@/lib/wafu/halo";

export type HaloPhase = "idle" | "form" | "stamp" | "out";

interface Props {
  phase: HaloPhase;
  theme: HaloTheme;
  /** 光環中心與半徑（視窗座標） */
  getAnchor: () => { x: number; y: number; r: number } | null;
}

interface Pt {
  x: number; y: number; vx: number; vy: number;
  z: number; a: number; tw: number; tws: number;
  tx: number; ty: number; spin: boolean; delay: number;
  sx: number; sy: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function sprite(rgb: string, stops: [number, number][], size = 48) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, a] of stops) gr.addColorStop(o, `rgba(${rgb},${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

/** 光環成形的時間軸（秒）：粒子在 FORM_SECONDS 內落位，描線在 REVEAL_END 前畫完。Opening 的成形階段要至少這麼長。 */
export const FORM_SECONDS = 1.6;
const REVEAL_START = 0.3;
const REVEAL_END = 1.45;

/** 每一筆的起筆時間與長度：桔梗依外環→光弧→內弧→眼→瞳；時雨的蜂巢格沿著環依序亮起，最後是中心。 */
function strokeTiming(strokes: ReturnType<typeof haloStrokes>) {
  const order = ["ring", "glint", "inner", "eye", "pupil", "cell", "cellSmall", "core"];
  const groups = order.map((kind) => strokes.map((s, i) => (s.kind === kind ? i : -1)).filter((i) => i >= 0)).filter((g) => g.length);
  const span = REVEAL_END - REVEAL_START;
  const out = strokes.map(() => ({ start: REVEAL_START, dur: span }));
  // 各組平均分配起筆時間，同組內再錯開；每一筆 0.35～0.8 秒，而且一定在 REVEAL_END 前結束。
  const slot = span / (groups.length + 1);
  groups.forEach((g, gi) => {
    g.forEach((si, k) => {
      const start = REVEAL_START + slot * gi + (g.length > 1 ? (slot * 1.2 * k) / g.length : 0);
      out[si] = { start, dur: Math.max(0.35, Math.min(0.8, REVEAL_END - start - 0.05)) };
    });
  });
  return out;
}

/**
 * 空靈光粒：載入時是極細的浮塵／細雪（低透明、微閃），
 * 完成時沿「真正的光環線條」匯聚並描出光環（桔梗：紺環＋青弧＋杏眼；時雨：六角蜂巢環），
 * 之後光環緩慢旋轉，蓋印時只有一圈淡淡的漣漪，開門時光粒輕散。
 */
export default function HaloParticles({ phase, theme, getAnchor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<HaloPhase>(phase);
  const phaseAt = useRef(0); // set by the phase effect on mount
  const formAt = useRef<number | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
    phaseAt.current = performance.now();
    if (phase === "form" && formAt.current == null) formAt.current = performance.now();
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const paper = theme === "kikyo"; // 桔梗在和紙丸窗上：深色墨點；時雨在夜色上：加法發光
    let w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const coreA = paper ? sprite("34,92,190", [[0, 0.95], [0.3, 0.5], [0.65, 0.08], [1, 0]], 32) : sprite("236,230,255", [[0, 1], [0.22, 0.55], [0.6, 0.06], [1, 0]], 32);
    const coreB = paper ? sprite("64,170,235", [[0, 0.9], [0.3, 0.45], [0.65, 0.06], [1, 0]], 32) : sprite("200,244,255", [[0, 1], [0.22, 0.5], [0.6, 0.05], [1, 0]], 32);
    const aura = paper ? sprite("90,170,255", [[0, 0.16], [1, 0]], 64) : sprite("214,200,255", [[0, 0.14], [1, 0]], 64);

    const N = w < 640 ? 280 : 440;
    const targets = sampleHalo(theme, N);
    // 打亂對應，讓粒子從四面八方匯聚
    for (let i = targets.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [targets[i], targets[j]] = [targets[j], targets[i]]; }
    const pts: Pt[] = targets.map((tg) => {
      const z = 0.25 + Math.random() * 0.75;
      return {
        x: Math.random() * w, y: Math.random() * h,
        vx: paper ? (0.05 + Math.random() * 0.12) * z : (Math.random() - 0.5) * 0.12,
        vy: paper ? (-0.03 - Math.random() * 0.08) * z : (0.12 + Math.random() * 0.35) * z,
        z, a: 0.18 + z * 0.55, tw: Math.random() * TAU, tws: 0.6 + Math.random() * 1.6,
        tx: tg.x, ty: tg.y, spin: tg.spin, delay: Math.random() * 0.42, sx: 0, sy: 0,
      };
    });
    const strokes = haloStrokes(theme);
    const strokeLen = strokes.map((s) => { let l = 0; for (let i = 1; i < s.pts.length; i++) l += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); return l; });
    // 描線的先後（成形開始後的秒數）：外環先起筆，其餘依序接上；全部在 REVEAL_END 前畫完，蓋印時不會一次補齊。
    const timing = strokeTiming(strokes);

    let last: HaloPhase = phaseRef.current;
    let raf = 0;
    let prev = performance.now();

    const loop = (now: number) => {
      const ph = phaseRef.current;
      const t = (now - phaseAt.current) / 1000;
      // 開門時整張畫布由 CSS 淡出：停在最後一格，不再每格重畫（重畫會和開門搶效能）。
      if (ph === "out") return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const anchor = getAnchor();
      const cx = anchor?.x ?? w / 2, cy = anchor?.y ?? h * 0.44, R = anchor?.r ?? Math.min(w, h) * 0.14;
      const spinT = formAt.current == null ? 0 : (now - formAt.current) / 1000;
      const spin = spinT * (paper ? 0.3 : 0.24);
      const cs = Math.cos(spin), sn = Math.sin(spin);
      const map = (u: number, v: number, rot: boolean): [number, number] => rot
        ? [cx + (u * cs - v * sn) * R, cy + (u * sn + v * cs) * R]
        : [cx + u * R, cy + v * R];

      if (ph !== last) {
        if (ph === "form") for (const p of pts) { p.sx = p.x; p.sy = p.y; }
        last = ph;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = paper ? "source-over" : "lighter";

      // 光環描線：粒子匯聚的同時，每一筆依序沿路徑描出（淡入起筆，不會先冒出一顆圓點）
      const revealOf = (si: number) => ph === "stamp" ? 1 : ph === "form" ? ease(clamp((t - timing[si].start) / timing[si].dur)) : 0;
      if (ph === "form" || ph === "stamp") {
        ctx.save();
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        strokes.forEach((s, si) => {
          const reveal = revealOf(si);
          if (reveal <= 0) return;
          const L = strokeLen[si] * R;
          ctx.beginPath();
          s.pts.forEach(([u, v], i) => { const [x, y] = map(u, v, s.spin); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          if (s.closed) ctx.closePath();
          ctx.setLineDash([L * reveal, L]);
          ctx.lineDashOffset = 0;
          ctx.lineWidth = Math.max(0.8, s.width * R * (paper ? 1 : 0.8));
          let col: string;
          // A soft glow is a wide faint stroke under the line (shadowBlur costs far more per frame).
          let glow: string | null;
          if (paper) {
            col = s.kind === "glint" ? "rgba(64,196,255,0.9)" : s.kind === "inner" ? "rgba(120,200,255,0.55)" : "rgba(26,40,74,0.88)";
            glow = s.kind === "glint" ? "rgba(80,200,255,0.22)" : null;
          } else {
            const gr = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
            gr.addColorStop(0, "rgba(217,200,255,0.78)");
            gr.addColorStop(1, "rgba(184,240,255,0.78)");
            col = gr as unknown as string;
            glow = "rgba(200,190,255,0.16)";
          }
          ctx.globalAlpha = clamp(reveal * 6);
          if (glow) {
            const width = ctx.lineWidth;
            ctx.strokeStyle = glow;
            ctx.lineWidth = width * 4;
            ctx.stroke();
            ctx.lineWidth = width;
          }
          ctx.strokeStyle = col;
          ctx.stroke();
          if (s.kind === "pupil" && reveal > 0.85) {
            ctx.setLineDash([]);
            ctx.fillStyle = `rgba(26,40,74,${0.9 * (reveal - 0.85) / 0.15})`;
            ctx.fill();
            // 瞳孔高光
            const [hx, hy] = map(-0.06, -0.06, false);
            ctx.beginPath(); ctx.arc(hx, hy, R * 0.045, 0, TAU);
            ctx.fillStyle = "rgba(230,246,255,0.9)"; ctx.fill();
          }
        });
        ctx.restore();
      }

      // 蓋印：一圈淡淡的漣漪（由淡轉濃再散去，不會突然出現）
      if (ph === "stamp") {
        const k = clamp(t / 0.9);
        const swell = Math.sin(Math.PI * k);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.05 + easeOut(k) * 0.55), 0, TAU);
        ctx.strokeStyle = paper ? `rgba(40,120,220,${0.3 * swell})` : `rgba(220,210,255,${0.35 * swell})`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      for (const p of pts) {
        p.tw += p.tws * dt * 2.2;
        const twinkle = 0.55 + 0.45 * Math.sin(p.tw);
        let alpha = p.a * twinkle;
        let size = 0.6 + p.z * 1.05;
        if (ph === "idle") {
          p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt;
          if (paper) {
            p.y += Math.sin(p.tw * 0.35) * 0.04;
            if (p.x > w + 8) p.x = -8;
            if (p.y < -8) p.y = h + 8;
            // 左上窗光斜射：光帶內較亮
            const band = Math.abs((p.y - p.x * 0.55) - h * 0.1) / (h * 0.5);
            alpha *= 0.25 + 0.75 * Math.max(0, 1 - band);
          } else {
            p.x += Math.sin(p.tw * 0.3) * 0.18;
            if (p.y > h + 8) { p.y = -8; p.x = Math.random() * w; }
            alpha *= 0.6;
          }
        } else if (ph === "form" || ph === "stamp") {
          const k = ph === "stamp" ? 1 : ease(clamp((t - p.delay) / 1.05));
          const [gx, gy] = map(p.tx, p.ty, p.spin);
          if (k >= 1) {
            // 落位後：沿切線微微呼吸
            const br = Math.sin(p.tw * 0.7) * 1.1;
            const ang = Math.atan2(gy - cy, gx - cx) + Math.PI / 2;
            p.x = gx + Math.cos(ang) * br; p.y = gy + Math.sin(ang) * br;
          } else {
            const a0 = Math.atan2(p.sy - cy, p.sx - cx), r0 = Math.hypot(p.sx - cx, p.sy - cy);
            const a1 = Math.atan2(gy - cy, gx - cx), r1 = Math.hypot(gx - cx, gy - cy);
            let d = a1 - a0;
            while (d <= -Math.PI) d += TAU;
            while (d > Math.PI) d -= TAU;
            d += TAU * 0.28; // 迴旋而入
            const ang = a0 + d * k;
            const rr = r0 + (r1 - r0) * k;
            p.x = cx + Math.cos(ang) * rr; p.y = cy + Math.sin(ang) * rr;
          }
          alpha = (paper ? 0.5 : 0.42) * (0.55 + 0.45 * k) * twinkle * (0.6 + p.z * 0.5);
          size = (0.55 + p.z * 0.85) * (1 - 0.2 * k);
          if (ph === "stamp") alpha *= 1 + 0.35 * Math.sin(Math.PI * clamp(t / 0.6));
        } else {
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 0.96; p.vy *= 0.96;
          alpha *= Math.max(0, 1 - t / 0.9);
        }
        if (alpha <= 0.01) continue;
        const s = size * 3.2;
        ctx.globalAlpha = clamp(alpha * 0.55);
        ctx.drawImage(aura, p.x - s * 2.2, p.y - s * 2.2, s * 4.4, s * 4.4);
        ctx.globalAlpha = clamp(alpha);
        ctx.drawImage(p.z > 0.62 ? coreB : coreA, p.x - s, p.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { prev = performance.now(); raf = requestAnimationFrame(loop); } };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); document.removeEventListener("visibilitychange", vis); };
  }, [theme, getAnchor]);

  return <canvas ref={canvasRef} className="halo-canvas" aria-hidden="true" />;
}
