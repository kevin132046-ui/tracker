import type { CSSProperties } from 'react';
import { kikyoInner, kikyoOutline, kikyoStamen, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';

/**
 * The opening's centre emblem (花の輪): a slowly turning gold ring set with small crests, around the
 * crest drawn while the page loads. 桔梗 sets five bellflowers on it and a few petals drift down; 時雨 sets
 * six snow crystals around a 雪輪. Drawn in a box centred on 0,0 (unit radius ≈ 1); every motion is CSS
 * (wafu-opening.css, the ow-* rules) and starts when the opening reaches its 'form' stage.
 */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(4)} ${(-r * Math.cos(a)).toFixed(4)}`;
};
const ORBIT = 1.18;
// The centre crest matches the size of the crest drawn while loading, so one melts into the other.
const CORE = 0.57;
const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
const petal = 'M 0 0 L -0.2586 -0.356 C -0.5353 -0.5945 -0.2588 -0.9659 0 -1.04 C 0.2588 -0.9659 0.5353 -0.5945 0.2586 -0.356 Z';

export default function WreathEmblem({ theme }: { theme: 'kikyo' | 'shigure' }) {
  const kikyo = theme === 'kikyo';
  const count = kikyo ? 5 : 6;
  const outline = kikyo ? kikyoOutline() : yukiwaOutline();
  const mini = kikyo ? outline : snowCrystal(0.9);
  const detail = kikyo ? `${kikyoInner()} ${kikyoStamen()}` : snowCrystal(0.44);
  return <svg className={`op-wreath op-wreath-${theme}`} viewBox="-1.5 -1.5 3 3" aria-hidden="true" focusable="false">
    <circle className="ow-dots" r="0.98" />
    <g className="ow-orbit">
      {/* Drawn on from the top, clockwise. The dash is set in plain units longer than the ring (see .ow-ring):
          at this small scale browsers measure curves a little short, so a pathLength-based dash leaves a gap. */}
      <path className="ow-ring" d={`M 0 ${-ORBIT} A ${ORBIT} ${ORBIT} 0 1 1 0 ${ORBIT} A ${ORBIT} ${ORBIT} 0 1 1 0 ${-ORBIT}`} />
      {Array.from({ length: count }, (_, i) => <g key={i} transform={`translate(${polar((i * 360) / count, ORBIT)})`}>
        <g className="ow-bloom" style={stagger(i)}><path className="ow-mini" transform={`scale(${kikyo ? 0.17 : 0.2})`} d={mini} /></g>
      </g>)}
    </g>
    <g className="ow-core" transform={`scale(${CORE})`}>
      <path className="ow-crest" d={outline} />
      <path className="ow-detail" pathLength={1} d={detail} />
    </g>
    <circle className="ow-heart" r="0.055" />
    {/* Each petal is scaled by CSS (--s) about its own centre, so its fall and spin stay in emblem units. */}
    {kikyo && <g className="ow-petals">
      {[[-0.35, -0.08, 0.11], [0.42, 0.08, 0.09], [0.08, -0.2, 0.08]].map(([x, y, s], i) => <g key={i} transform={`translate(${x} ${y})`}>
        <path className="ow-petal" style={{ ...stagger(i), '--s': s } as CSSProperties} d={petal} />
      </g>)}
    </g>}
  </svg>;
}
