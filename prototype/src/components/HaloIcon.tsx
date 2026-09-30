import { useId } from "react";
import { haloStrokes, strokePath, type HaloTheme } from "@/lib/halo";

// The halo is drawn in a square box centred on (0, 0).
const VIEW = { x: -1.14, y: -1.14, w: 2.28, h: 2.28 } as const;
/** Rotation centre, from the view box: the ring spins in place instead of orbiting a corner. */
export const HALO_CENTER = { x: VIEW.x + VIEW.w / 2, y: VIEW.y + VIEW.h / 2 } as const;
/** Height of a halo tilted back by `tilt` degrees, as a share of its width. */
export const haloTiltScale = (tilt: number) => Math.cos((tilt * Math.PI) / 180);

/**
 * 角色光環圖示（向量）：桔梗＝紺環＋青色光弧＋杏眼；時雨＝淡紫冰藍六角蜂巢環。
 * spin 時外環（與光弧／蜂巢）緩慢旋轉，桔梗的眼睛保持正向。
 * tilt（度）把光環往後傾：在 SVG 內壓扁，不用 CSS 3D，線條維持向量般清晰。
 */
export default function HaloIcon({ theme, size = 44, spin = true, className = "", tone = "dark", tilt = 0, minStrokePx = 0 }: {
  theme: HaloTheme; size?: number; spin?: boolean; className?: string; tone?: "dark" | "paper"; tilt?: number;
  /** 小尺寸時線條至少這麼粗（px），蜂巢格等細線才看得清楚。 */
  minStrokePx?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const strokes = haloStrokes(theme);
  const minWidth = (minStrokePx * VIEW.w) / size;
  const grad = `hg-${uid}`;
  const rot = strokes.filter((s) => s.spin);
  const still = strokes.filter((s) => !s.spin);
  const draw = (list: typeof strokes) => list.map((s, i) => (
    <path key={`${s.kind}-${i}`} className={`h-${s.kind}`} d={strokePath(s)}
      strokeWidth={Math.max(s.width, minWidth)} fill={s.kind === "pupil" ? "currentColor" : theme === "shigure" ? `url(#${grad}-f)` : "none"}
      stroke={theme === "shigure" ? `url(#${grad})` : undefined} />
  ));
  return (
    <svg className={`halo-ico halo-${theme} tone-${tone} ${className}`} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} width={size} height={size} aria-hidden="true" focusable="false">
      {theme === "shigure" && (
        <defs>
          <linearGradient id={grad} x1="-1" y1="-1" x2="1" y2="1" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#d9c8ff" />
            <stop offset="0.55" stopColor="#c3d6ff" />
            <stop offset="1" stopColor="#b8f0ff" />
          </linearGradient>
          <linearGradient id={`${grad}-f`} x1="-1" y1="-1" x2="1" y2="1" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#d9c8ff" stopOpacity="0.16" />
            <stop offset="1" stopColor="#b8f0ff" stopOpacity="0.06" />
          </linearGradient>
        </defs>
      )}
      <g transform={tilt ? `translate(${HALO_CENTER.x} ${HALO_CENTER.y}) scale(1 ${haloTiltScale(tilt).toFixed(4)}) translate(${-HALO_CENTER.x} ${-HALO_CENTER.y})` : undefined}>
        <g className={spin ? "halo-rot" : undefined} style={spin ? { transformOrigin: `${HALO_CENTER.x}px ${HALO_CENTER.y}px` } : undefined} strokeLinecap="round" strokeLinejoin="round">{draw(rot)}</g>
        <g strokeLinecap="round" strokeLinejoin="round">{draw(still)}</g>
      </g>
    </svg>
  );
}
