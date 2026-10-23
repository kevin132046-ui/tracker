import { kikyoInner, kikyoOutline, snowCrystal, yukiwaOutline } from '@/lib/wafu/marks';

/**
 * The small mark of each theme, a 花の輪: 桔梗's bellflower
 * crest (時雨: a 雪輪 with a snow crystal) inside a thin gold ring set with tiny crests. Flat (tilt 0) it is
 * an icon — settings title, AI button. Tilted back (tilt in degrees) only the ring is drawn, as a wreath
 * floating above the current item or the assistant's name. `spin` turns the ring slowly; reduced motion
 * and 效能模式 stop it (wafu.css, the cm-* rules).
 */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(r * Math.sin(a)).toFixed(3)} ${(-r * Math.cos(a)).toFixed(3)}`;
};
const RING = 1.12;

export default function CrestMark({ theme, size = 26, spin = true, tilt = 0, className = '' }: {
  theme: 'kikyo' | 'shigure'; size?: number; spin?: boolean; tilt?: number; className?: string;
}) {
  const kikyo = theme === 'kikyo';
  const count = kikyo ? 5 : 6;
  const outline = kikyo ? kikyoOutline() : yukiwaOutline();
  const bead = kikyo ? kikyoOutline() : snowCrystal(0.9);
  const wreath = tilt !== 0;
  const squash = wreath ? `scale(1 ${Math.cos((tilt * Math.PI) / 180).toFixed(4)})` : undefined;
  const beadScale = wreath ? 0.2 : 0.13;
  return <svg className={`halo-ico crest-mark crest-${theme} ${wreath ? 'is-wreath' : ''} ${className}`} viewBox="-1.3 -1.3 2.6 2.6" width={size} height={size} aria-hidden="true" focusable="false">
    <g transform={squash}>
      <g className={spin ? 'cm-turn' : undefined}>
        <circle className="cm-ring" r={RING} />
        {Array.from({ length: count }, (_, i) => <path key={i} className="cm-bead" transform={`translate(${polar((i * 360) / count, RING)}) scale(${beadScale})`} d={bead} />)}
      </g>
      {!wreath && <g transform="scale(0.7)">
        <path className="cm-crest" d={outline} />
        {size >= 22 && <path className="cm-detail" d={kikyo ? kikyoInner() : snowCrystal(0.44)} />}
      </g>}
    </g>
  </svg>;
}
