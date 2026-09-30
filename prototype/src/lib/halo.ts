// 兩位角色光環的向量幾何（單位半徑、y 向下）。
// 同一份幾何供：側欄旋轉圖示（SVG）、開場粒子目標點、開場描線（canvas）。
// 桔梗：深紺厚環＋左上青色光弧＋杏眼與瞳孔；時雨：淡紫→冰藍的六角蜂巢環。
export type HaloTheme = "kikyo" | "shigure";
export type Pt = [number, number];
export type StrokeKind = "glint" | "ring" | "inner" | "eye" | "pupil" | "cell" | "cellSmall" | "core";
export interface HaloStroke { kind: StrokeKind; pts: Pt[]; closed: boolean; width: number; spin: boolean }

const TAU = Math.PI * 2;
const rad = (d: number) => (d * Math.PI) / 180;

function arc(r: number, a0: number, a1: number, n: number, cx = 0, cy = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function hexagon(cx: number, cy: number, r: number, rot: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = rot + (i * TAU) / 6;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

const cache = new Map<HaloTheme, HaloStroke[]>();

export function haloStrokes(theme: HaloTheme): HaloStroke[] {
  const hit = cache.get(theme);
  if (hit) return hit;
  let out: HaloStroke[];
  if (theme === "kikyo") {
    const w = 0.56, h = 0.36;
    const eye = [
      ...cubic([-w, 0], [-w * 0.48, -h], [w * 0.48, -h], [w, 0], 28),
      ...cubic([w, 0], [w * 0.48, h], [-w * 0.48, h], [-w, 0], 28).slice(1),
    ];
    out = [
      { kind: "glint", pts: arc(0.985, rad(172), rad(318), 60), closed: false, width: 0.075, spin: true },
      { kind: "ring", pts: arc(0.84, 0, TAU, 128), closed: true, width: 0.15, spin: true },
      { kind: "inner", pts: arc(0.69, rad(20), rad(330), 96), closed: false, width: 0.026, spin: true },
      { kind: "eye", pts: eye, closed: true, width: 0.075, spin: false },
      { kind: "pupil", pts: arc(0.17, 0, TAU, 40), closed: true, width: 0.07, spin: false },
    ];
  } else {
    const cells: HaloStroke[] = [];
    for (let k = 0; k < 12; k++) {
      const a = rad(k * 30 - 90);
      cells.push({ kind: "cell", pts: hexagon(Math.cos(a) * 0.76, Math.sin(a) * 0.76, 0.205, a), closed: true, width: 0.034, spin: true });
    }
    for (let k = 0; k < 6; k++) {
      const a = rad(k * 60 - 60);
      cells.push({ kind: "cellSmall", pts: hexagon(Math.cos(a) * 0.43, Math.sin(a) * 0.43, 0.125, a + rad(30)), closed: true, width: 0.028, spin: true });
    }
    cells.push({ kind: "core", pts: hexagon(0, 0, 0.13, rad(30)), closed: true, width: 0.03, spin: true });
    out = cells;
  }
  cache.set(theme, out);
  return out;
}

export function strokePath(s: HaloStroke) {
  return s.pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join("") + (s.closed ? "Z" : "");
}

const len = (pts: Pt[]) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
};

export interface HaloTarget { x: number; y: number; spin: boolean; kind: StrokeKind }

/** 沿光環線條依長度均勻取樣 n 個點（粒子落點）；權重讓主環較密 */
export function sampleHalo(theme: HaloTheme, n: number): HaloTarget[] {
  const strokes = haloStrokes(theme);
  const weight: Record<StrokeKind, number> = { glint: 1.4, ring: 1.6, inner: 0.5, eye: 1.2, pupil: 1.0, cell: 1, cellSmall: 0.8, core: 0.6 };
  const lens = strokes.map((s) => len(s.pts) * weight[s.kind]);
  const total = lens.reduce((a, b) => a + b, 0);
  const out: HaloTarget[] = [];
  strokes.forEach((s, si) => {
    const m = Math.max(2, Math.round((n * lens[si]) / total));
    const L = len(s.pts);
    for (let j = 0; j < m; j++) {
      let d = ((j + Math.random() * 0.6) / m) * L;
      for (let i = 1; i < s.pts.length; i++) {
        const [x0, y0] = s.pts[i - 1], [x1, y1] = s.pts[i];
        const seg = Math.hypot(x1 - x0, y1 - y0);
        if (d <= seg || i === s.pts.length - 1) {
          const t = seg ? Math.min(1, d / seg) : 0;
          // 粗線條的點散在線寬內，看起來是發光的帶而不是一條細線
          const nx = -(y1 - y0) / (seg || 1), ny = (x1 - x0) / (seg || 1);
          const off = (Math.random() - 0.5) * s.width * 0.9;
          out.push({ x: x0 + (x1 - x0) * t + nx * off, y: y0 + (y1 - y0) * t + ny * off, spin: s.spin, kind: s.kind });
          break;
        }
        d -= seg;
      }
    }
  });
  return out;
}
