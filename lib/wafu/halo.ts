// 兩位角色光環的向量幾何（單位半徑、y 向下）。
// 同一份幾何供：側欄旋轉圖示（SVG）、開場粒子目標點、開場描線（canvas）。
// 桔梗：兩段藍色 C 形外環（右上、左下斷開）＋兩臂向內捲的深色螺旋＋中央杏眼；時雨：相連的六角蜂巢格組成的齒輪狀環（粗的青藍發光線）。
export type HaloTheme = 'kikyo' | 'shigure';
export type Pt = [number, number];
export type StrokeKind = 'glint' | 'ring' | 'inner' | 'eye' | 'pupil' | 'cell' | 'cellSmall' | 'core';
export interface HaloStroke { kind: StrokeKind; pts: Pt[]; closed: boolean; width: number; spin: boolean }

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

const cache = new Map<HaloTheme, HaloStroke[]>();

export function haloStrokes(theme: HaloTheme): HaloStroke[] {
  const hit = cache.get(theme);
  if (hit) return hit;
  let out: HaloStroke[];
  if (theme === 'kikyo') {
    // The eye: a narrow almond with a short slit.
    const w = 0.34, h = 0.17;
    const eye = [
      ...cubic([-w, 0], [-w * 0.45, -h], [w * 0.45, -h], [w, 0], 24),
      ...cubic([w, 0], [w * 0.45, h], [-w * 0.45, h], [-w, 0], 24).slice(1),
    ];
    // Two arms that start on the outside and curl inward toward the eye's tips.
    const spiral = (start: number): Pt[] => {
      const out: Pt[] = [];
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const r = 0.7 - 0.36 * t;
        const a = start + rad(200) * t;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return out;
    };
    out = [
      // Outer ring in two blue arcs; the gaps sit at the upper right and lower left.
      { kind: 'glint', pts: arc(0.9, rad(-22), rad(132), 72), closed: false, width: 0.15, spin: true },
      { kind: 'glint', pts: arc(0.9, rad(158), rad(312), 72), closed: false, width: 0.15, spin: true },
      { kind: 'ring', pts: spiral(rad(-30)), closed: false, width: 0.1, spin: true },
      { kind: 'ring', pts: spiral(rad(150)), closed: false, width: 0.1, spin: true },
      { kind: 'eye', pts: eye, closed: true, width: 0.07, spin: false },
      { kind: 'pupil', pts: [[-w * 0.5, 0], [w * 0.5, 0]], closed: false, width: 0.035, spin: false },
    ];
  } else {
    // A ring of joined honeycomb cells (pointy-top hexagons sharing edges), so its outline reads as a
    // gear; each shared edge is drawn once.
    const size = 0.165;
    const edges = new Map<string, Pt[]>();
    const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const cx = Math.sqrt(3) * size * (q + r / 2);
        const cy = 1.5 * size * r;
        const d = Math.hypot(cx, cy);
        if (d < 0.36 || d > 0.8) continue;
        const corners = Array.from({ length: 6 }, (_, i) => { const a = rad(60 * i - 30); return [cx + Math.cos(a) * size, cy + Math.sin(a) * size] as Pt; });
        corners.forEach((a, i) => {
          const b = corners[(i + 1) % 6];
          const id = [key(a), key(b)].sort().join('|');
          if (!edges.has(id)) edges.set(id, [a, b]);
        });
      }
    }
    out = [...edges.values()].map((pts) => ({ kind: 'cell' as const, pts, closed: false, width: 0.05, spin: true }));
  }
  cache.set(theme, out);
  return out;
}

export function strokePath(s: HaloStroke) {
  return s.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(4)} ${p[1].toFixed(4)}`).join('') + (s.closed ? 'Z' : '');
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
