/**
 * 水中墨 — GLSL (ES 1.00, runs on WebGL1 and WebGL2) for the stable-fluids ink layer.
 *
 * Units: velocity is stored in sim-texels / second, so the finite-difference operators
 * (curl, divergence, Jacobi, gradient) all work on a unit grid. Divergence, curl and the
 * spreading sources are therefore in 1/s and independent of resolution.
 * `uScale` converts a uv delta into "S units" (fractions of the canvas' short side) so
 * that splats stay round whatever the aspect ratio.
 */

/** Fragment precision header (+ optional MANUAL_FILTERING define prepended by gl.ts). */
const HEAD = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
precision highp sampler2D;
#else
precision mediump float;
precision mediump sampler2D;
#endif
`;

/** Bilinear sampling that also works when half-float textures cannot be linearly filtered. */
const SAMPLE = /* glsl */ `
vec4 sample2(sampler2D tex, vec2 uv, vec2 ts) {
#ifdef MANUAL_FILTERING
  vec2 st = uv / ts - 0.5;
  vec2 i = floor(st);
  vec2 f = fract(st);
  vec4 a = texture2D(tex, (i + vec2(0.5, 0.5)) * ts);
  vec4 b = texture2D(tex, (i + vec2(1.5, 0.5)) * ts);
  vec4 c = texture2D(tex, (i + vec2(0.5, 1.5)) * ts);
  vec4 d = texture2D(tex, (i + vec2(1.5, 1.5)) * ts);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
#else
  return texture2D(tex, uv);
#endif
}
`;

/** Cheap hash / value noise / fbm (no sin-hash: stable on highp and most mediump GPUs). */
const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s * 1.0667;
}
`;

/** Up to four spreading sources (a drop's radial spread, or a sink ring around a swirl). */
const SOURCES = /* glsl */ `
uniform vec2 uScale;
uniform vec4 uSrc[4];    // xy = centre (uv), z = ring radius (S), w = width (S)
uniform float uSrcS[4];  // strength, 1/s (> 0 spreads, < 0 gathers)
float sourceAt(vec2 uv) {
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    if (uSrcS[i] != 0.0) {
      vec2 p = (uv - uSrc[i].xy) * uScale;
      float d = (length(p) - uSrc[i].z) / uSrc[i].w;
      s += uSrcS[i] * exp(-d * d);
    }
  }
  return s;
}
`;

export const VERT = /* glsl */ `
precision highp float;
attribute vec2 aPosition;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** Scaled copy (pressure dissipation, resize resampling). */
export const COPY = HEAD + /* glsl */ `
uniform sampler2D uTexture;
uniform float uValue;
varying vec2 vUv;
void main () {
  gl_FragColor = uValue * texture2D(uTexture, vUv);
}
`;

export const CURL = HEAD + /* glsl */ `
uniform sampler2D uVelocity;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}
`;

/**
 * Vorticity confinement + the ambient "breathing" current: a slowly drifting,
 * analytically divergence-free field (curl of a 3-wave stream function).
 */
export const VORTICITY = HEAD + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uConfine;
uniform float uDt;
uniform vec2 uScale;
uniform float uAmb;
uniform vec3 uPhase;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
vec2 wave(vec2 p, vec2 k, float ph) {
  return cos(dot(k, p) + ph) * vec2(k.y, -k.x) / length(k);
}
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uConfine * C;
  force.y *= -1.0;
  vec2 p = vUv * uScale;
  vec2 amb = wave(p, vec2(3.3, 2.1), uPhase.x)
           + wave(p, vec2(-1.8, 3.9), uPhase.y)
           + 0.6 * wave(p, vec2(5.2, -2.7), uPhase.z);
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel += (force + amb * uAmb) * uDt;
  vel = clamp(vel, vec2(-1000.0), vec2(1000.0));
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

/** Divergence with open boundaries (clamp-to-edge velocity) minus the spreading sources. */
export const DIVERGENCE = HEAD + SOURCES + /* glsl */ `
uniform sampler2D uVelocity;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  float div = 0.5 * (R - L + T - B) - sourceAt(vUv);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

/** Jacobi iteration, Dirichlet p = 0 outside the frame (the water continues past the edge). */
export const JACOBI = HEAD + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main () {
  float L = texture2D(uPressure, vL).x * step(0.0, vL.x);
  float R = texture2D(uPressure, vR).x * step(vR.x, 1.0);
  float T = texture2D(uPressure, vT).x * step(vT.y, 1.0);
  float B = texture2D(uPressure, vB).x * step(0.0, vB.y);
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

export const GRADIENT = HEAD + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
void main () {
  float L = texture2D(uPressure, vL).x * step(0.0, vL.x);
  float R = texture2D(uPressure, vR).x * step(vR.x, 1.0);
  float T = texture2D(uPressure, vT).x * step(vT.y, 1.0);
  float B = texture2D(uPressure, vB).x * step(0.0, vB.y);
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel -= 0.5 * vec2(R - L, T - B);
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

/**
 * Semi-Lagrangian advection. For dye: clear water flows in from outside the frame
 * (uEdge = 1) and a spreading source thins the ink it pushes apart (uDilute).
 */
export const ADVECT = HEAD + SAMPLE + SOURCES + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelTexel;
uniform vec2 uSrcTexel;
uniform float uDt;
uniform float uDissipation;
uniform float uEdge;
uniform float uDilute;
varying vec2 vUv;
void main () {
  vec2 coord = vUv - uDt * sample2(uVelocity, vUv, uVelTexel).xy * uVelTexel;
  vec4 result = sample2(uSource, coord, uSrcTexel);
  if (uEdge > 0.5) {
    vec2 inside = step(vec2(0.0), coord) * step(coord, vec2(1.0));
    result *= inside.x * inside.y;
  }
  result /= 1.0 + uDissipation * uDt;
  if (uDilute > 0.0) result *= exp(-uDilute * sourceAt(vUv) * uDt);
  gl_FragColor = result;
}
`;

/**
 * Splats run along a segment uPoint→uPoint2 (equal for a round drop) so a fast
 * pointer stroke is one continuous capsule instead of a row of dots.
 * Returns the offset to the segment in radius units; `rel` = offset from uPoint.
 */
const SEGMENT = /* glsl */ `
uniform vec2 uScale;
uniform vec2 uPoint;
uniform vec2 uPoint2;
uniform float uRadius;
vec2 segment(vec2 uv, out vec2 rel) {
  vec2 pa = (uv - uPoint) * uScale;
  vec2 ba = (uPoint2 - uPoint) * uScale;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  rel = pa / uRadius;
  return (pa - ba * h) / uRadius;
}
`;

/**
 * Ink drop: a gaussian on a domain-warped plane (fractal, feathered rim) with
 * mottled internal density — never a plain disc.
 */
export const SPLAT_DYE = HEAD + NOISE + SEGMENT + /* glsl */ `
uniform sampler2D uTarget;
uniform vec4 uColor;
uniform float uSeed;
uniform float uFeather;
uniform float uMottle;
varying vec2 vUv;
void main () {
  vec4 base = texture2D(uTarget, vUv);
  vec2 rel;
  vec2 q = segment(vUv, rel);
  if (dot(q, q) > 14.0) { gl_FragColor = base; return; }
  vec2 s = vec2(uSeed * 7.13, uSeed * 3.71);
  vec2 warp = vec2(fbm(rel * 0.85 + s), fbm(rel * 0.85 + s + vec2(5.2, 1.3))) - 0.5;
  vec2 w = q + warp * uFeather * 2.2;
  float shape = exp(-dot(w, w) * 1.1);
  float m = fbm(rel * 1.8 - s);
  shape *= mix(1.0, 0.25 + 1.5 * m, uMottle);
  gl_FragColor = base + uColor * shape;
}
`;

/** Push along a segment (+ optional turbulent curl-noise that frays a drop's rim into tendrils). */
export const SPLAT_VEL = HEAD + NOISE + SEGMENT + /* glsl */ `
uniform sampler2D uTarget;
uniform vec2 uForce;
uniform float uTurb;
uniform float uTurbFreq;
uniform float uSeed;
varying vec2 vUv;
void main () {
  vec4 base = texture2D(uTarget, vUv);
  vec2 rel;
  vec2 q = segment(vUv, rel);
  float r2 = dot(q, q);
  if (r2 > 9.0) { gl_FragColor = base; return; }
  float g = exp(-r2);
  vec2 v = uForce * g;
  if (uTurb != 0.0) {
    vec2 p = rel * uTurbFreq + vec2(uSeed * 5.3, uSeed * 2.9);
    float e = 0.06;
    float n0 = fbm(p);
    float nx = fbm(p + vec2(e, 0.0));
    float ny = fbm(p + vec2(0.0, e));
    v += uTurb * g * vec2(ny - n0, n0 - nx) / e;
  }
  gl_FragColor = vec4(base.xy + v, 0.0, 1.0);
}
`;

/**
 * Vortex ring: relaxes the tangential velocity in an annulus toward uSpeed
 * (clockwise on screen, matching the halo particles).
 */
export const SWIRL = HEAD + /* glsl */ `
uniform sampler2D uTarget;
uniform vec2 uScale;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uWidth;
uniform float uSpeed;
uniform float uRate;
varying vec2 vUv;
void main () {
  vec4 base = texture2D(uTarget, vUv);
  vec2 p = (vUv - uPoint) * uScale;
  float r = length(p);
  float d = (r - uRadius) / uWidth;
  if (abs(d) > 3.5) { gl_FragColor = base; return; }
  float band = exp(-d * d);
  vec2 n = p / max(r, 1e-5);
  vec2 t = vec2(n.y, -n.x);
  float vt = dot(base.xy, t);
  vec2 vel = base.xy + t * (uSpeed - vt) * band * uRate;
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

/**
 * Washi grain, rendered once into a tileable 256² RGBA8 texture (periodic value noise):
 * fine grain + uneven fibre "clouds" + a few long diagonal fibres.
 */
export const PAPER = HEAD + /* glsl */ `
varying vec2 vUv;
float hashP(vec2 i, vec2 period) {
  vec2 p = mod(i, period);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoiseP(vec2 x, vec2 period) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashP(i, period);
  float b = hashP(i + vec2(1.0, 0.0), period);
  float c = hashP(i + vec2(0.0, 1.0), period);
  float d = hashP(i + vec2(1.0, 1.0), period);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main () {
  vec2 px = floor(vUv * 256.0);
  float grain = hashP(px + 7.0, vec2(256.0));
  float cloud = 0.0;
  float amp = 0.5;
  float cells = 4.0;
  for (int i = 0; i < 4; i++) {
    cloud += amp * vnoiseP(vUv * cells + float(i) * 17.0, vec2(cells));
    amp *= 0.5;
    cells *= 2.0;
  }
  cloud /= 0.9375;
  // diagonal fibres stay periodic because (x ± y) wraps with the tile
  vec2 d = vec2(vUv.x + vUv.y, vUv.x - vUv.y);
  float f1 = vnoiseP(vec2(d.x * 6.0, d.y * 48.0), vec2(6.0, 48.0));
  float f2 = vnoiseP(vec2(d.y * 5.0 + 3.0, d.x * 40.0), vec2(5.0, 40.0));
  float fib = smoothstep(0.62, 0.9, max(f1, f2));
  float v = grain * 0.35 + cloud * 0.5 + fib * 0.2 - 0.02;
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

/**
 * Display: Beer–Lambert ink with a soft alpha cap, premultiplied on transparent.
 * Edge = |∇density| → thin-edge tint (kikyo: warm indigo) or lit sheen (shigure:
 * lavender ↔ lantern amber by edge orientation). Optional washi grain.
 */
export const DISPLAY = HEAD + SAMPLE + NOISE + /* glsl */ `
uniform sampler2D uDye;
uniform sampler2D uPaper;
uniform vec2 uDyeTexel;
uniform float uPx;
uniform float uFade;
uniform float uAbsorb;
uniform float uCap;
uniform vec3 uCore;
uniform vec3 uThin;
uniform vec3 uTint;
uniform vec3 uEdgeA;
uniform vec3 uEdgeB;
uniform float uEdgeGain;
uniform float uEdgeMix;
uniform float uEdgeAlpha;
uniform float uEdgeSpan;
uniform float uEdgeThin;
uniform float uGrain;
uniform vec2 uLight;
varying vec2 vUv;

float dens(vec2 uv) {
  vec4 c = sample2(uDye, uv, uDyeTexel);
  return max(c.r + c.g, 0.0);
}
void main () {
  vec4 c = sample2(uDye, vUv, uDyeTexel);
  float d = max(c.r + c.g, 0.0);
  vec2 o = uDyeTexel * uEdgeSpan;
  float dl = dens(vUv - vec2(o.x, 0.0));
  float dr = dens(vUv + vec2(o.x, 0.0));
  float db = dens(vUv - vec2(0.0, o.y));
  float du = dens(vUv + vec2(0.0, o.y));
  vec2 g = vec2(dr - dl, du - db) / uEdgeSpan;
  float gm = length(g);

  float body = 1.0 - exp(-uAbsorb * d);
  float ge = gm * uEdgeGain;
  float edge = ge / (1.0 + ge) * smoothstep(0.0, 0.04, d) * pow(1.0 - body, uEdgeThin);

  vec3 col = mix(uThin, uCore, smoothstep(0.08, 0.9, body));
  col = mix(col, uTint, clamp(c.g / max(d, 0.001), 0.0, 1.0) * 0.85);
  float lit = dot(-g / (gm + 1e-5), uLight) * 0.5 + 0.5;
  vec3 sheen = mix(uEdgeA, uEdgeB, smoothstep(0.45, 0.9, lit));
  col = mix(col, sheen, edge * uEdgeMix);

  float a = uCap * body + edge * uEdgeAlpha;
  if (uGrain > 0.0) a *= 1.0 + uGrain * (texture2D(uPaper, gl_FragCoord.xy * uPx / 256.0).r - 0.5) * 2.0;
  a += (hash12(gl_FragCoord.xy + 17.0) - 0.5) * (1.5 / 255.0) * smoothstep(0.0, 0.02, a);
  a = clamp(a, 0.0, 1.0) * uFade;
  gl_FragColor = vec4(col * a, a);
}
`;
