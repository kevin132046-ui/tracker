import { haloStrokes, type HaloStroke, type HaloTheme, type Pt } from '@/lib/wafu/halo';

/**
 * 手繪光環：同一份光環幾何，逐格「重畫」成手繪動畫（傳統動畫的 on twos，每秒 8 格）。
 * - 每格旋轉部分轉一小格，轉滿一個對稱週期（桔梗 180°、時雨 60°）剛好接回第一格。
 * - 抖動（boiling line）是一個隨位置平滑變化、每格不同的位移場：共用的頂點一起移動，
 *   六角格的接點不會裂開；每條線再於中段輕微弓起，兩端固定。
 * - 開放的筆畫畫成「筆刷」：中段粗、兩端收細的填色帶；閉合的線（眼睛）與六角格邊維持描線。
 * - 主線下方再描一道錯開的淡鉛筆線，像原畫的草稿線。
 */
export type HandStroke = { kind: HaloStroke['kind']; d: string; sketch: string; width: number; ribbon: boolean };
export type HandFrame = HandStroke[];

export const handFrameCount: Record<HaloTheme, number> = { kikyo: 12, shigure: 10 };
const period: Record<HaloTheme, number> = { kikyo: Math.PI, shigure: Math.PI / 3 };
export const handFps = 8;

// Deterministic noise so every visit draws the same frames.
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** The frame's boil: a smooth displacement that depends only on position, so shared points move together. */
function boil(frame: number, amp: number) {
  const a = hash(frame * 3 + 1) * Math.PI * 2, b = hash(frame * 3 + 2) * Math.PI * 2, c = hash(frame * 3 + 3) * Math.PI * 2;
  return ([x, y]: Pt): Pt => [
    x + amp * (Math.sin(2.3 * y + a) * 0.6 + Math.sin(4.1 * x + 3.7 * y + c) * 0.4),
    y + amp * (Math.sin(2.7 * x + b) * 0.6 + Math.sin(3.9 * y - 4.3 * x + c) * 0.4),
  ];
}

/** A gentle bow in the middle of a line (ends stay put). */
function bow(pts: Pt[], amount: number): Pt[] {
  return pts.map(([x, y], i) => {
    const t = pts.length > 1 ? i / (pts.length - 1) : 0;
    const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const k = Math.sin(Math.PI * t) * amount;
    return [x - (dy / len) * k, y + (dx / len) * k];
  });
}

/** Straight edges split into a few points so they can bow instead of staying ruler-straight. */
function subdivide(pts: Pt[], parts: number): Pt[] {
  if (pts.length > 2) return pts;
  const [a, b] = pts;
  return Array.from({ length: parts + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / parts, a[1] + ((b[1] - a[1]) * i) / parts] as Pt);
}

const f3 = (v: number) => v.toFixed(3);
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** A smooth curve through the points (quadratic segments between midpoints). */
function curve(pts: Pt[], closed: boolean) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${f3(p[0])} ${f3(p[1])}`).join('');
  const list = closed ? pts.slice(0, -1) : pts;
  if (closed) {
    const n = list.length, start = mid(list[n - 1], list[0]);
    let d = `M${f3(start[0])} ${f3(start[1])}`;
    for (let i = 0; i < n; i++) { const m = mid(list[i], list[(i + 1) % n]); d += `Q${f3(list[i][0])} ${f3(list[i][1])} ${f3(m[0])} ${f3(m[1])}`; }
    return `${d}Z`;
  }
  let d = `M${f3(list[0][0])} ${f3(list[0][1])}`;
  for (let i = 1; i < list.length - 1; i++) { const m = mid(list[i], list[i + 1]); d += `Q${f3(list[i][0])} ${f3(list[i][1])} ${f3(m[0])} ${f3(m[1])}`; }
  const last = list[list.length - 1];
  return `${d}L${f3(last[0])} ${f3(last[1])}`;
}

/** A brush stroke: a filled band, full width in the middle, tapering to a soft point at both ends. */
function ribbon(pts: Pt[], width: number, seed: number) {
  const left: Pt[] = [], right: Pt[] = [];
  const press = 0.9 + hash(seed) * 0.2;
  pts.forEach(([x, y], i) => {
    const t = i / (pts.length - 1);
    const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    // Pressure: quick attack, long body, gentle lift at the end.
    const w = (width / 2) * press * (0.28 + 0.72 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.45));
    left.push([x - (dy / len) * w, y + (dx / len) * w]);
    right.push([x + (dy / len) * w, y - (dx / len) * w]);
  });
  const outline = [...left, ...right.reverse()];
  return curve([...outline, outline[0]], true);
}

const rotate = (pts: Pt[], a: number): Pt[] => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); };

const cache = new Map<HaloTheme, HandFrame[]>();

export function handHaloFrames(theme: HaloTheme): HandFrame[] {
  const hit = cache.get(theme);
  if (hit) return hit;
  const strokes = haloStrokes(theme);
  const count = handFrameCount[theme];
  const amp = theme === 'kikyo' ? 0.009 : 0.007;
  const frames = Array.from({ length: count }, (_, f) => {
    const field = boil(f, amp);
    const sketchField = boil(f + 40, amp * 1.8);
    return strokes.map((s, i): HandStroke => {
      const base = subdivide(s.pts, 6);
      const turned = s.spin ? rotate(base, (period[theme] * f) / count) : base;
      const seed = f * 97 + i * 13 + 1;
      const bend = (hash(seed) - 0.5) * (theme === 'kikyo' ? 0.012 : 0.01);
      const main = bow(turned.map(field), bend);
      const sketch = bow(turned.map(sketchField), -bend * 1.5);
      const brush = !s.closed && s.kind !== 'cell' && s.kind !== 'pupil';
      return { kind: s.kind, d: brush ? ribbon(main, s.width * 1.15, seed) : curve(main, s.closed), sketch: curve(sketch, s.closed), width: s.width, ribbon: brush };
    });
  });
  cache.set(theme, frames);
  return frames;
}
