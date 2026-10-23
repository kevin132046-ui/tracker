/**
 * Shapes for the 水墨 opening.
 *
 * The ink blots and the brush stroke are bitmaps in app/ink (used from wafu-opening.css). They were rendered
 * once from SVG: blot-{2,5,8} from a 200×200 viewBox with a circle (r 62) and three spatters, displaced by
 * feTurbulence (fractalNoise, baseFrequency .035, 3 octaves, that seed; feDisplacementMap scale 34) and
 * softened by feGaussianBlur 1.4, at 1024 px; the stroke from the path M 110 740 C 470 560, 950 650, 1490 280
 * (width 250, round caps) in a 1600×900 viewBox, displaced the same way (baseFrequency .0025 .03, scale 48,
 * blur 1.6), at 1920×1080. As bitmaps they cost nothing to scale; as live SVG filters the browser had to
 * re-render the turbulence at every new size, which made the opening stutter.
 */
const svgUrl = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** Paper fibres for 桔梗's washi (a faint, static texture, drawn once as a 220 px tile). */
export const paperFibre = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42  0 0 0 0 .35  0 0 0 0 .25  0 0 0 .55 0'/></filter><rect width='220' height='220' filter='url(#n)'/></svg>`);
