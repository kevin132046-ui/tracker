/**
 * The two crests drawn in the 和風 opening, as SVG paths in a unit box centred on 0,0
 * (polar angles: 0° points up, clockwise).
 */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [+(r * Math.sin(a)).toFixed(4), +(-r * Math.cos(a)).toFixed(4)] as const;
};
const pt = (deg: number, r: number) => polar(deg, r).join(' ');

/** 桔梗紋: five pointed petals with a V notch between them. */
export function kikyoOutline() {
  let d = `M ${pt(-36, 0.44)}`;
  for (let i = 0; i < 5; i++) {
    const a = i * 72;
    d += ` C ${pt(a - 42, 0.8)} ${pt(a - 15, 1.0)} ${pt(a, 1.04)}`;
    d += ` C ${pt(a + 15, 1.0)} ${pt(a + 42, 0.8)} ${pt(a + 36, 0.44)}`;
  }
  return d + ' Z';
}

/** Petal borders and leaf veins inside the 桔梗紋. */
export function kikyoInner() {
  const lines: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 72;
    lines.push(`M ${pt(a + 36, 0.13)} L ${pt(a + 36, 0.44)}`);
    lines.push(`M ${pt(a, 0.36)} L ${pt(a, 0.74)}`);
  }
  return lines.join(' ');
}

export function kikyoStamen() {
  const d: string[] = [];
  for (let i = 0; i < 5; i++) d.push(`M ${pt(i * 72, 0.1)} L ${pt(i * 72, 0.25)}`);
  return d.join(' ');
}

/** 雪輪紋: six outward arcs, each pair joined by a small inward notch. */
export function yukiwaOutline() {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = i * 60;
    const [sx, sy] = polar(a - 30 + 7, 0.86);
    const [ex, ey] = polar(a + 30 - 7, 0.86);
    const [cx, cy] = polar(a, 1.2);
    d += `${i === 0 ? 'M' : 'L'} ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey} `;
    const [nx, ny] = polar(a + 30, 0.74);
    const [nx2, ny2] = polar(a + 30 + 7, 0.86);
    d += `Q ${nx} ${ny} ${nx2} ${ny2} `;
  }
  return d + 'Z';
}

export function snowCrystal(r = 0.46) {
  const d: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60;
    d.push(`M 0 0 L ${pt(a, r)}`);
    d.push(`M ${pt(a, r * 0.55)} L ${pt(a - 28, r * 0.78)}`);
    d.push(`M ${pt(a, r * 0.55)} L ${pt(a + 28, r * 0.78)}`);
  }
  return d.join(' ');
}
