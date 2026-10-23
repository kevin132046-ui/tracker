/**
 * Shapes for the 水墨 opening, as SVG images used for CSS masks: drawn once by the browser, then only
 * moved and scaled, so the opening keeps moving on the compositor while the page underneath loads.
 */
const svgUrl = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** An ink blot on paper: a soft round pool with a few spatters, its edge torn by turbulence. */
export function inkBlot(seed: number): string {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='f' x='-20%' y='-20%' width='140%' height='140%'><feTurbulence type='fractalNoise' baseFrequency='.035' numOctaves='3' seed='${seed}'/><feDisplacementMap in='SourceGraphic' scale='34' xChannelSelector='R' yChannelSelector='G'/><feGaussianBlur stdDeviation='1.4'/></filter><g filter='url(#f)' fill='#fff'><circle cx='100' cy='100' r='62'/><circle cx='${150 - seed * 3}' cy='${78 + seed * 2}' r='13'/><circle cx='${58 + seed * 2}' cy='146' r='9'/><circle cx='158' cy='${132 - seed}' r='5'/></g></svg>`);
}

/** One dry-brush stroke across the screen, from the lower left up to the right (stretched to the screen). */
export const brushStroke = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900' preserveAspectRatio='none'><filter id='d' x='-10%' y='-40%' width='120%' height='180%'><feTurbulence type='fractalNoise' baseFrequency='.0025 .03' numOctaves='3' seed='4'/><feDisplacementMap in='SourceGraphic' scale='48' xChannelSelector='R' yChannelSelector='G'/><feGaussianBlur stdDeviation='1.6'/></filter><path filter='url(#d)' d='M 110 740 C 470 560, 950 650, 1490 280' fill='none' stroke='#fff' stroke-width='250' stroke-linecap='round'/></svg>`);

/** Paper fibres for 桔梗's washi (a faint, static texture). */
export const paperFibre = svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .42  0 0 0 0 .35  0 0 0 0 .25  0 0 0 .55 0'/></filter><rect width='220' height='220' filter='url(#n)'/></svg>`);
