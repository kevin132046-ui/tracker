import {
  createDoubleFBO,
  createFBO,
  createGL,
  deleteDoubleFBO,
  deleteFBO,
  loseContext,
  programFactory,
  type DoubleFBO,
  type FBO,
  type GLKit,
  type Prog,
  type TexFormat,
} from "./gl";
import { ADVECT, COPY, CURL, DISPLAY, DIVERGENCE, GRADIENT, JACOBI, PAPER, SPLAT_DYE, SPLAT_VEL, SWIRL, VERT, VORTICITY } from "./shaders";

/**
 * 水中墨 engine — Stam-style stable fluids (WebGL) rendering sumi / indigo ink on a
 * transparent, premultiplied canvas. Framework-free; InkFluid.tsx wraps it for React.
 *
 * Space: API coords are 0..1 of the canvas box, y down. Internally uv (y up) and
 * "S units" = fractions of the box's short side (keeps drops round at any aspect).
 */

export type InkTheme = "kikyo" | "shigure";

export interface InkEngineOptions {
  theme: InkTheme;
  interactive: boolean;
  /** GL context lost while alive → caller should hide the layer. */
  onLost?: () => void;
}

export interface InkEngine {
  setTheme(theme: InkTheme): void;
  setActive(active: boolean): void;
  setInteractive(on: boolean): void;
  splat(x: number, y: number, dx: number, dy: number, strength?: number): void;
  bloom(x?: number, y?: number): void;
  swirl(cx: number, cy: number, radius: number): void;
  destroy(): void;
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

interface Look {
  core: RGB; // dense ink
  thin: RGB; // diluted ink
  tint: RGB; // second pigment (kikyo: bellflower indigo, shigure: plum)
  edgeA: RGB; // thin-edge tint
  edgeB: RGB; // lit-edge sheen (shigure: lantern amber)
  absorb: number; // Beer–Lambert gain
  cap: number; // max ink alpha (text on top stays readable)
  edgeGain: number;
  edgeMix: number;
  edgeAlpha: number;
  edgeSpan: number; // gradient footprint, dye texels
  edgeThin: number; // restrict the edge tint to thin ink (exponent on 1 - body)
  grain: number; // washi grain modulation (kikyo only)
  light: [number, number];
  tintChance: number; // share of drops carrying the second pigment
  tintMax: number; // at most this fraction of a drop's ink
  ink: number; // drop density multiplier
  trail: number; // pointer trail ink
}

const LOOKS: Record<InkTheme, Look> = {
  kikyo: {
    core: hex("#141820"),
    thin: hex("#4a3526"),
    tint: hex("#2d2a5c"),
    edgeA: hex("#3a3a7c"),
    edgeB: hex("#4b3870"),
    absorb: 1.05,
    cap: 0.55,
    edgeGain: 10,
    edgeMix: 0.55,
    edgeAlpha: 0.02,
    edgeSpan: 2.5,
    edgeThin: 1.2,
    grain: 0.12,
    light: [-0.55, 0.83],
    tintChance: 0.3,
    tintMax: 0.5,
    ink: 1,
    trail: 0.035,
  },
  shigure: {
    // 藍染：深藍墨＋淡藍紫邊，邊緣帶一點行燈的暖光
    core: hex("#101a33"),
    thin: hex("#243560"),
    tint: hex("#1d2c52"),
    edgeA: hex("#a9bde9"),
    edgeB: hex("#f2b96b"),
    absorb: 1.1,
    cap: 0.5,
    edgeGain: 14,
    edgeMix: 0.6,
    edgeAlpha: 0.13,
    edgeSpan: 2.5,
    edgeThin: 1,
    grain: 0,
    light: [-0.4, 0.92],
    tintChance: 0.3,
    tintMax: 0.6,
    ink: 1.0,
    trail: 0.045,
  },
};

const SIM = {
  pressureIters: 20,
  pressureKeep: 0.8, // pressure dissipation (warm start)
  velDissipation: 0.5,
  dyeDissipation: 0.1,
  confine: 6, // vorticity confinement, tuned at 128 texels
  ambient: 0.02, // S/s — the ever-present breathing current
  dilute: 0.1, // how much a spreading drop thins the ink it pushes apart
  maxDt: 1 / 30,
  fadeIn: 0.7,
  fadeOut: 0.8,
  idleFirst: 0.25,
  idleMin: 3.4,
  idleVar: 2.4,
  presimSteps: 96,
};

/**
 * bloom(): an ink drop that spreads. Lengths in S units, speeds in S/s, spread in 1/s.
 * spread = radial expansion (a divergence source), lopsided = share given to an offset
 * second source (irregular lobes), feed = seconds the centre keeps bleeding ink.
 */
const BLOOM = {
  r: 0.042, ink: 0.85, feather: 0.9, sats: 6, turb: 0.6, turbFreq: 0.9, turb2: 0.18, turbFreq2: 2.4,
  spread: 12, lopsided: 0.5, tau: 0.6, life: 2, feed: 0.35, feedInk: 1.1, drift: 0.06,
};
/** Idle: slow drops drifting in from the frame's edge. */
const EDGE = {
  r: 0.055, rVar: 0.025, ink: 0.95, feather: 1.1, sats: 3, speed: 0.16, speedVar: 0.1, turb: 0.2, turbFreq: 0.9,
  turb2: 0.1, turbFreq2: 2.4, spread: 3, lopsided: 0.5, tau: 1.2, life: 3, feed: 0, feedInk: 0,
};
/** swirl(): tangential band + gentle sink onto the ring + wisps of ink on it. */
const SWIRL_CFG = { life: 2.4, widthK: 0.2, speed: 0.4, rate: 5, sink: -2.5, wisps: 3, ink: 0.45 };
/** Pointer / touch. */
const POINTER = { r: 0.03, push: 0.22, maxSpeed: 1.4, trailR: 0.011 };

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Source {
  t0: number;
  life: number;
  u: number;
  v: number;
  ring: number;
  width: number;
  s0: number;
  tau: number;
  ramp: number;
}

interface Swirl {
  t0: number;
  life: number;
  u: number;
  v: number;
  r: number;
  width: number;
  speed: number;
}

interface Drip {
  t0: number;
  life: number;
  u: number;
  v: number;
  r: number;
  a: number;
  b: number;
  seed: number;
}

interface DropOpts {
  r: number;
  ink: number;
  feather: number;
  sats: number;
  vx: number;
  vy: number;
  turb: number;
  turbFreq: number;
  turb2: number;
  turbFreq2: number;
  spread: number;
  lopsided: number;
  tau: number;
  life: number;
  feed: number;
  feedInk: number;
}

export function createInkEngine(host: HTMLElement, opts: InkEngineOptions): InkEngine | null {
  let kit: GLKit | null = null;
  try {
    kit = createGL();
  } catch {
    kit = null;
  }
  if (!kit) return null;
  const K = kit;
  const { gl, canvas } = K;
  const filter = K.linear ? gl.LINEAR : gl.NEAREST;

  let factory: ReturnType<typeof programFactory>;
  let P: Record<"copy" | "curl" | "vort" | "div" | "jacobi" | "grad" | "advect" | "dye" | "vel" | "swirl" | "display" | "paper", Prog>;
  try {
    factory = programFactory(gl, VERT, K.linear ? "" : "#define MANUAL_FILTERING\n");
    const m = factory.make;
    P = {
      copy: m(COPY),
      curl: m(CURL),
      vort: m(VORTICITY),
      div: m(DIVERGENCE),
      jacobi: m(JACOBI),
      grad: m(GRADIENT),
      advect: m(ADVECT),
      dye: m(SPLAT_DYE),
      vel: m(SPLAT_VEL),
      swirl: m(SWIRL),
      display: m(DISPLAY),
      paper: m(PAPER),
    };
  } catch (err) {
    console.warn(err);
    loseContext(gl);
    return null;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
  host.appendChild(canvas);

  // ---------- state ----------
  let theme = opts.theme;
  let interactive = opts.interactive;
  const mql = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = !!mql?.matches;
  let active = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  let fade = 0;
  let simTime = 0;
  const phase: [number, number, number] = [rand(0, TAU), rand(0, TAU), rand(0, TAU)];
  let staticState: "none" | "presim" | "shown" = "none";
  let presimLeft = 0;

  let short = 1;
  let sx = 1;
  let sy = 1;
  let dpr = 1;
  let simN = 128;
  let dyeN = 512;
  let sizeDirty = true;
  let vel: DoubleFBO | null = null;
  let dye: DoubleFBO | null = null;
  let pressure: DoubleFBO | null = null;
  let divF: FBO | null = null;
  let curlF: FBO | null = null;

  const sources: Source[] = [];
  const swirls: Swirl[] = [];
  const drips: Drip[] = [];
  const srcGeom = new Float32Array(16);
  const srcStr = new Float32Array(4);
  let nextIdle = 0;

  let listening = false;
  let ptrX = 0;
  let ptrY = 0;
  let ptrDirty = false;
  let ptrHas = false;
  let lastU = 0;
  let lastV = 0;

  const look = () => LOOKS[theme];

  // ---------- GL helpers ----------
  let cur: Prog = P.copy;
  const select = (p: Prog) => {
    cur = p;
    gl.useProgram(p.program);
  };
  const U = (n: string) => cur.u[n] ?? null;
  const bindTex = (name: string, f: FBO, unit: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, f.tex);
    gl.uniform1i(U(name), unit);
  };
  const texel = (f: FBO) => gl.uniform2f(U("uTexel"), f.tx, f.ty);
  const blit = (f: FBO | null) => {
    if (f) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
      gl.viewport(0, 0, f.w, f.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const clearCanvas = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  // washi grain: baked once into a tileable 256² texture (cheaper than per-pixel noise)
  const paperTex = gl.createTexture();
  {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paperTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paperTex, 0);
    select(P.paper);
    gl.viewport(0, 0, 256, 256);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
  }

  // ---------- size / resources ----------
  const res = (n: number): [number, number] => {
    const W = canvas.width;
    const H = canvas.height;
    const aspect = W > H ? W / H : H / W;
    const hi = Math.min(Math.round(n * aspect), K.maxSize);
    return W >= H ? [hi, n] : [n, hi];
  };

  const resized = (d: DoubleFBO | null, w: number, h: number, fmt: TexFormat): DoubleFBO => {
    if (d && d.read.w === w && d.read.h === h) return d;
    const n = createDoubleFBO(gl, w, h, fmt, K.type, filter);
    if (d) {
      select(P.copy);
      texel(n.read);
      bindTex("uTexture", d.read, 0);
      gl.uniform1f(U("uValue"), 1);
      blit(n.read);
      deleteDoubleFBO(gl, d);
    }
    return n;
  };

  const syncSize = (): boolean => {
    if (!sizeDirty && vel) return true;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w < 2 || h < 2) return false;
    sizeDirty = false;
    const rawDpr = window.devicePixelRatio || 1;
    dpr = Math.min(rawDpr, 1.5);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    short = Math.min(w, h);
    sx = w / short;
    sy = h / short;
    const small = short < 600 || short * rawDpr < 900;
    simN = small ? 96 : 128;
    dyeN = small ? 384 : 512;
    const [vw, vh] = res(simN);
    const [dw, dh] = res(dyeN);
    vel = resized(vel, vw, vh, K.rg);
    dye = resized(dye, dw, dh, K.rgba);
    if (!pressure || pressure.read.w !== vw || pressure.read.h !== vh) {
      deleteDoubleFBO(gl, pressure);
      deleteFBO(gl, divF);
      deleteFBO(gl, curlF);
      pressure = createDoubleFBO(gl, vw, vh, K.r, K.type, gl.NEAREST);
      divF = createFBO(gl, vw, vh, K.r, K.type, gl.NEAREST);
      curlF = createFBO(gl, vw, vh, K.r, K.type, gl.NEAREST);
    }
    return true;
  };

  // ---------- sources (spreading / gathering) ----------
  const addSource = (s: Omit<Source, "t0">) => {
    sources.push({ ...s, t0: simTime });
    if (sources.length > 8) sources.shift();
  };
  const strengthOf = (s: Source) => {
    const age = simTime - s.t0;
    if (age < 0 || age > s.life) return 0;
    const ramp = s.ramp > 0 ? Math.min(1, age / s.ramp) : 1;
    const tail = Math.min(1, (s.life - age) / 0.35);
    return s.s0 * ramp * tail * Math.exp(-age / s.tau);
  };
  const packSources = () => {
    for (let i = sources.length - 1; i >= 0; i--) if (simTime - sources[i].t0 > sources[i].life) sources.splice(i, 1);
    srcStr.fill(0);
    for (let i = 0; i < 4; i++) srcGeom.set([0, 0, 0, 1], i * 4);
    // keep the four strongest
    const picked: number[] = [];
    for (let slot = 0; slot < 4; slot++) {
      let best = -1;
      let bestS = 0;
      for (let i = 0; i < sources.length; i++) {
        if (picked.includes(i)) continue;
        const s = strengthOf(sources[i]);
        if (Math.abs(s) > Math.abs(bestS)) {
          best = i;
          bestS = s;
        }
      }
      if (best < 0) break;
      picked.push(best);
      const s = sources[best];
      srcGeom.set([s.u, s.v, s.ring, s.width], slot * 4);
      srcStr[slot] = bestS;
    }
  };
  const setSources = () => {
    gl.uniform2f(U("uScale"), sx, sy);
    gl.uniform4fv(U("uSrc"), srcGeom);
    gl.uniform1fv(U("uSrcS"), srcStr);
  };

  // ---------- splats ----------
  /** Ink along a (possibly zero-length) segment a→b, uv coords, radius in S units. */
  const splatDye = (u: number, v: number, u2: number, v2: number, r: number, a: number, b: number, feather: number, mottle: number, seed = rand(0, 97)) => {
    if (!dye) return;
    select(P.dye);
    texel(dye.read);
    bindTex("uTarget", dye.read, 0);
    gl.uniform2f(U("uScale"), sx, sy);
    gl.uniform2f(U("uPoint"), u, v);
    gl.uniform2f(U("uPoint2"), u2, v2);
    gl.uniform1f(U("uRadius"), r);
    gl.uniform4f(U("uColor"), a, b, 0, 0);
    gl.uniform1f(U("uSeed"), seed);
    gl.uniform1f(U("uFeather"), feather);
    gl.uniform1f(U("uMottle"), mottle);
    blit(dye.write);
    dye.swap();
  };
  /** Push (S units / s) along a segment, plus optional turbulent curl-noise. */
  const splatVel = (u: number, v: number, u2: number, v2: number, r: number, fx: number, fy: number, turb: number, turbFreq = 1.6) => {
    if (!vel) return;
    select(P.vel);
    texel(vel.read);
    bindTex("uTarget", vel.read, 0);
    gl.uniform2f(U("uScale"), sx, sy);
    gl.uniform2f(U("uPoint"), u, v);
    gl.uniform2f(U("uPoint2"), u2, v2);
    gl.uniform1f(U("uRadius"), r);
    gl.uniform2f(U("uForce"), fx * simN, fy * simN);
    gl.uniform1f(U("uTurb"), turb * simN);
    gl.uniform1f(U("uTurbFreq"), turbFreq);
    gl.uniform1f(U("uSeed"), rand(0, 97));
    blit(vel.write);
    vel.swap();
  };
  const swirlPass = (s: Swirl, dt: number) => {
    if (!vel) return;
    const age = simTime - s.t0;
    const env = Math.min(1, age / 0.25) * Math.min(1, (s.life - age) / (s.life * 0.5));
    if (env <= 0) return;
    select(P.swirl);
    texel(vel.read);
    bindTex("uTarget", vel.read, 0);
    gl.uniform2f(U("uScale"), sx, sy);
    gl.uniform2f(U("uPoint"), s.u, s.v);
    gl.uniform1f(U("uRadius"), s.r);
    gl.uniform1f(U("uWidth"), s.width);
    gl.uniform1f(U("uSpeed"), s.speed * simN);
    gl.uniform1f(U("uRate"), (1 - Math.exp(-SWIRL_CFG.rate * dt)) * env);
    blit(vel.write);
    vel.swap();
  };

  /** Split an ink amount between sumi / indigo (kikyo) or indigo / plum (shigure). */
  const pigment = (amount: number): [number, number] => {
    const L = look();
    const t = Math.random() < L.tintChance ? rand(0.4, 1) * L.tintMax : rand(0, 0.1);
    return [amount * (1 - t), amount * t];
  };

  const drop = (u: number, v: number, o: DropOpts) => {
    const [a, b] = pigment(o.ink * look().ink);
    splatDye(u, v, u, v, o.r, a, b, o.feather, 0.7);
    // satellite droplets: uneven density inside the bloom, which the flow draws into filaments
    for (let i = 0; i < o.sats; i++) {
      const ang = rand(0, TAU);
      const d = o.r * rand(0.5, 1.8);
      const pu = u + (Math.cos(ang) * d) / sx;
      const pv = v + (Math.sin(ang) * d) / sy;
      const k = rand(0.4, 1);
      splatDye(pu, pv, pu, pv, o.r * rand(0.25, 0.6), a * k, b * k, o.feather * 1.2, 0.8);
    }
    splatVel(u, v, u, v, o.r * 2.2, o.vx, o.vy, o.turb, o.turbFreq);
    if (o.turb2) splatVel(u, v, u, v, o.r * 2.6, 0, 0, o.turb2, o.turbFreq2);
    if (o.spread) {
      const main = 1 - o.lopsided;
      addSource({ life: o.life, u, v, ring: 0, width: o.r * 1.5, s0: o.spread * main, tau: o.tau, ramp: 0.08 });
      if (o.lopsided > 0) {
        const ang = rand(0, TAU);
        const d = o.r * rand(0.6, 1.1);
        addSource({ life: o.life * 0.8, u: u + (Math.cos(ang) * d) / sx, v: v + (Math.sin(ang) * d) / sy, ring: 0, width: o.r * 1.2, s0: o.spread * o.lopsided, tau: o.tau * 0.7, ramp: 0.2 });
      }
    }
    if (o.feed > 0) {
      const k = o.feedInk / (o.ink || 1);
      drips.push({ t0: simTime, life: o.feed, u, v, r: o.r * 0.8, a: a * k, b: b * k, seed: rand(0, 97) });
      if (drips.length > 4) drips.shift();
    }
  };

  /** Idle: a slow bloom that drifts in from a random point on the frame's edge. */
  const edgeBloom = () => {
    const per = 2 * (sx + sy);
    let p = rand(0, per);
    let u: number;
    let v: number;
    const inset = 0.05;
    if (p < sx) {
      u = p / sx;
      v = inset;
    } else if ((p -= sx) < sy) {
      u = 1 - inset;
      v = p / sy;
    } else if ((p -= sy) < sx) {
      u = 1 - p / sx;
      v = 1 - inset;
    } else {
      p -= sx;
      u = inset;
      v = 1 - p / sy;
    }
    u = Math.min(1 - inset, Math.max(inset, u));
    v = Math.min(1 - inset, Math.max(inset, v));
    const tu = 0.5 + rand(-0.25, 0.25);
    const tv = 0.5 + rand(-0.2, 0.2);
    const dx = (tu - u) * sx;
    const dy = (tv - v) * sy;
    const len = Math.hypot(dx, dy) || 1;
    const speed = EDGE.speed + rand(0, EDGE.speedVar);
    drop(u, v, { ...EDGE, r: EDGE.r + rand(0, EDGE.rVar), vx: (dx / len) * speed, vy: (dy / len) * speed });
  };

  /** A drop that blooms where it lands, drifting slowly so it trails tendrils. */
  const bloomAt = (u: number, v: number) => {
    const ang = rand(0, TAU);
    drop(u, v, { ...BLOOM, vx: Math.cos(ang) * BLOOM.drift, vy: Math.sin(ang) * BLOOM.drift });
  };

  // ---------- pointer ----------
  const onMove = (e: PointerEvent) => {
    ptrX = e.clientX;
    ptrY = e.clientY;
    ptrDirty = true;
  };
  const onDown = (e: PointerEvent) => {
    ptrHas = false;
    onMove(e);
  };
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget) ptrHas = false;
  };
  const pointer = (dt: number) => {
    if (!ptrDirty) return;
    ptrDirty = false;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const x = (ptrX - rect.left) / rect.width;
    const y = (ptrY - rect.top) / rect.height;
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) {
      ptrHas = false;
      return;
    }
    const u = x;
    const v = 1 - y;
    if (!ptrHas) {
      ptrHas = true;
      lastU = u;
      lastV = v;
      return;
    }
    const dxS = (u - lastU) * sx;
    const dyS = (v - lastV) * sy;
    const dist = Math.hypot(dxS, dyS);
    if (dist < 1e-4) return;
    const speed = Math.min(dist / Math.max(dt, 1 / 120), POINTER.maxSpeed);
    const k = (speed / dist) * POINTER.push;
    splatVel(lastU, lastV, u, v, POINTER.r, dxS * k, dyS * k, 0);
    const ink = look().trail * Math.min(1, speed / 1.2);
    if (ink > 0.002) {
      const [a, b] = pigment(ink);
      splatDye(lastU, lastV, u, v, POINTER.trailR, a, b, 1.2, 0.8);
    }
    lastU = u;
    lastV = v;
  };
  const syncListeners = () => {
    const want = active && interactive && !reduced && !destroyed;
    if (want === listening) return;
    listening = want;
    if (want) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointerout", onOut, { passive: true });
    } else {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerout", onOut);
      ptrHas = false;
      ptrDirty = false;
    }
  };
  /** Re-render the still frame (reduced motion) after a resize / theme change / re-activation. */
  const redrawStill = () => {
    if (raf || destroyed || document.hidden) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (destroyed || !active || !reduced || !syncSize()) return;
      fade = 1;
      render();
    });
  };

  // ---------- simulation ----------
  const step = (dt: number) => {
    if (!vel || !dye || !pressure || !divF || !curlF) return;
    select(P.curl);
    texel(vel.read);
    bindTex("uVelocity", vel.read, 0);
    blit(curlF);

    select(P.vort);
    texel(vel.read);
    bindTex("uVelocity", vel.read, 0);
    bindTex("uCurl", curlF, 1);
    gl.uniform1f(U("uConfine"), (SIM.confine * simN) / 128);
    gl.uniform1f(U("uDt"), dt);
    gl.uniform2f(U("uScale"), sx, sy);
    gl.uniform1f(U("uAmb"), (SIM.ambient * SIM.velDissipation * simN) / 2);
    gl.uniform3f(U("uPhase"), phase[0], phase[1], phase[2]);
    blit(vel.write);
    vel.swap();

    select(P.div);
    texel(vel.read);
    bindTex("uVelocity", vel.read, 0);
    setSources();
    blit(divF);

    select(P.copy);
    texel(pressure.read);
    bindTex("uTexture", pressure.read, 0);
    gl.uniform1f(U("uValue"), SIM.pressureKeep);
    blit(pressure.write);
    pressure.swap();

    select(P.jacobi);
    texel(pressure.read);
    bindTex("uDivergence", divF, 1);
    for (let i = 0; i < SIM.pressureIters; i++) {
      bindTex("uPressure", pressure.read, 0);
      blit(pressure.write);
      pressure.swap();
    }

    select(P.grad);
    texel(vel.read);
    bindTex("uPressure", pressure.read, 0);
    bindTex("uVelocity", vel.read, 1);
    blit(vel.write);
    vel.swap();

    select(P.advect);
    texel(vel.read);
    setSources();
    gl.uniform1f(U("uDt"), dt);
    gl.uniform2f(U("uVelTexel"), vel.read.tx, vel.read.ty);
    bindTex("uVelocity", vel.read, 0);
    gl.uniform1i(U("uSource"), 0);
    gl.uniform2f(U("uSrcTexel"), vel.read.tx, vel.read.ty);
    gl.uniform1f(U("uDissipation"), SIM.velDissipation);
    gl.uniform1f(U("uEdge"), 0);
    gl.uniform1f(U("uDilute"), 0);
    blit(vel.write);
    vel.swap();

    texel(dye.read);
    bindTex("uVelocity", vel.read, 0);
    bindTex("uSource", dye.read, 1);
    gl.uniform2f(U("uSrcTexel"), dye.read.tx, dye.read.ty);
    gl.uniform1f(U("uDissipation"), SIM.dyeDissipation);
    gl.uniform1f(U("uEdge"), 1);
    gl.uniform1f(U("uDilute"), SIM.dilute);
    blit(dye.write);
    dye.swap();
  };

  const advance = (dt: number, live: boolean) => {
    simTime += dt;
    phase[0] += dt * 0.21;
    phase[1] -= dt * 0.17;
    phase[2] += dt * 0.29;
    if (live && active) {
      if (simTime >= nextIdle) {
        edgeBloom();
        nextIdle = simTime + SIM.idleMin + rand(0, SIM.idleVar);
      }
      if (listening) pointer(dt);
    }
    for (let i = swirls.length - 1; i >= 0; i--) {
      const s = swirls[i];
      if (simTime - s.t0 > s.life) swirls.splice(i, 1);
      else swirlPass(s, dt);
    }
    // the drop's centre keeps bleeding ink for a moment (dense core → lighter veils)
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i];
      const age = (simTime - d.t0) / d.life;
      if (age > 1) {
        drips.splice(i, 1);
        continue;
      }
      const k = (1 - age) * (1 - age) * dt;
      // same seed every frame: the feed builds structure instead of averaging to a flat disc
      splatDye(d.u, d.v, d.u, d.v, d.r, d.a * k, d.b * k, 1, 0.85, d.seed);
    }
    packSources();
    step(dt);
  };

  const render = () => {
    if (!dye) return;
    const L = look();
    const f = fade * fade * (3 - 2 * fade);
    select(P.display);
    texel(dye.read);
    bindTex("uDye", dye.read, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, paperTex);
    gl.uniform1i(U("uPaper"), 1);
    gl.uniform2f(U("uDyeTexel"), dye.read.tx, dye.read.ty);
    gl.uniform1f(U("uPx"), 1 / dpr);
    gl.uniform1f(U("uFade"), f);
    gl.uniform1f(U("uAbsorb"), L.absorb);
    gl.uniform1f(U("uCap"), L.cap);
    gl.uniform3fv(U("uCore"), L.core);
    gl.uniform3fv(U("uThin"), L.thin);
    gl.uniform3fv(U("uTint"), L.tint);
    gl.uniform3fv(U("uEdgeA"), L.edgeA);
    gl.uniform3fv(U("uEdgeB"), L.edgeB);
    gl.uniform1f(U("uEdgeGain"), L.edgeGain);
    gl.uniform1f(U("uEdgeMix"), L.edgeMix);
    gl.uniform1f(U("uEdgeAlpha"), L.edgeAlpha);
    gl.uniform1f(U("uEdgeSpan"), L.edgeSpan);
    gl.uniform1f(U("uEdgeThin"), L.edgeThin);
    gl.uniform1f(U("uGrain"), L.grain);
    gl.uniform2f(U("uLight"), L.light[0], L.light[1]);
    blit(null);
  };

  // ---------- loop ----------
  const wantFrames = () => (reduced ? active && staticState !== "shown" : active || fade > 0);

  const kick = () => {
    if (raf || destroyed || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  /** prefers-reduced-motion: pre-simulate a bloom off-screen over a few frames, show one still. */
  const staticFrame = () => {
    if (!active) return;
    if (staticState === "none") {
      bloomAt(0.5 + rand(-0.08, 0.08), 0.52 + rand(-0.06, 0.06));
      edgeBloom();
      staticState = "presim";
      presimLeft = SIM.presimSteps;
    }
    if (staticState === "presim") {
      const n = Math.min(presimLeft, 16);
      for (let i = 0; i < n; i++) advance(1 / 60, false);
      presimLeft -= n;
      if (presimLeft > 0) return;
      staticState = "shown";
    }
    fade = 1;
    render();
  };

  function frame(now: number) {
    raf = 0;
    if (destroyed) return;
    // fades follow the wall clock (a slow device still stops ~0.8s after active=false);
    // the simulation step is clamped for stability
    const real = Math.min(Math.max((now - last) / 1000, 0), 0.5);
    const dt = Math.min(real, SIM.maxDt);
    last = now;
    try {
      if (!syncSize()) {
        if (wantFrames()) raf = requestAnimationFrame(frame);
        return;
      }
      if (reduced) {
        staticFrame();
      } else {
        const target = active ? 1 : 0;
        if (fade < target) fade = Math.min(target, fade + real / SIM.fadeIn);
        else if (fade > target) fade = Math.max(target, fade - real / SIM.fadeOut);
        if (dt > 0) advance(dt, true);
        if (fade > 0) render();
        else clearCanvas();
      }
    } catch (err) {
      // e.g. GPU out of memory while (re)allocating targets: give up quietly, parent hides the layer
      console.warn(err);
      api.destroy();
      opts.onLost?.();
      return;
    }
    if (wantFrames()) raf = requestAnimationFrame(frame);
  }

  // ---------- environment listeners ----------
  const onVis = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (wantFrames()) kick();
  };
  const onResize = () => {
    sizeDirty = true;
    if (reduced && active && staticState === "shown") redrawStill();
  };
  const onMotionPref = () => {
    const r = !!mql?.matches;
    if (r === reduced) return;
    reduced = r;
    if (reduced) {
      // freeze whatever is on screen as the still frame (or drop a half-finished fade-out)
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      staticState = active ? "shown" : "none";
      if (active) {
        fade = 1;
        render();
      } else {
        fade = 0;
        clearCanvas();
      }
    } else {
      staticState = "none";
      if (active) nextIdle = simTime + SIM.idleFirst;
      kick();
    }
    syncListeners();
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    if (destroyed) return;
    api.destroy();
    opts.onLost?.();
  };

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
  ro?.observe(host);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVis);
  mql?.addEventListener?.("change", onMotionPref);
  canvas.addEventListener("webglcontextlost", onLost);

  const canAct = () => active && !reduced && !destroyed && !!vel;

  const api: InkEngine = {
    setTheme(t) {
      if (t === theme) return;
      theme = t;
      if (reduced && active && staticState === "shown") redrawStill();
    },
    setActive(a) {
      if (destroyed || a === active) return;
      active = a;
      if (a) {
        if (!reduced) nextIdle = simTime + SIM.idleFirst;
        else if (staticState === "shown") redrawStill();
      } else if (reduced) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        fade = 0;
        clearCanvas();
      }
      syncListeners();
      if (wantFrames()) kick();
    },
    setInteractive(on) {
      interactive = on;
      syncListeners();
    },
    splat(x, y, dx, dy, strength = 1) {
      if (!canAct()) return;
      const u = x;
      const v = 1 - y;
      splatVel(u, v, u, v, 0.04, dx * sx, -dy * sy, 0);
      if (strength > 0) {
        const [a, b] = pigment(look().ink * 0.6 * strength);
        splatDye(u, v, u, v, 0.03, a, b, 1, 0.7);
      }
    },
    bloom(x, y) {
      if (!canAct()) return;
      const u = x ?? 0.5 + rand(-0.12, 0.12);
      const v = 1 - (y ?? 0.5 + rand(-0.1, 0.1));
      bloomAt(u, v);
    },
    swirl(cx, cy, radius) {
      if (!canAct()) return;
      const u = cx;
      const v = 1 - cy;
      const R = Math.max(0.02, radius * sx);
      const width = Math.max(0.018, R * SWIRL_CFG.widthK);
      swirls.push({ t0: simTime, life: SWIRL_CFG.life, u, v, r: R, width, speed: SWIRL_CFG.speed });
      if (swirls.length > 3) swirls.shift();
      addSource({ life: SWIRL_CFG.life * 0.66, u, v, ring: R, width: width * 1.4, s0: SWIRL_CFG.sink, tau: 0.8, ramp: 0.15 });
      // brush-stroke wisps on the ring: the vortex drags them into an ensō-like arc
      const base = rand(0, TAU);
      const n = SWIRL_CFG.wisps;
      for (let i = 0; i < n; i++) {
        const a0 = base + (i * TAU) / n + rand(-0.3, 0.3);
        const a1 = a0 - rand(0.3, 0.5);
        const [a, b] = pigment(look().ink * SWIRL_CFG.ink);
        splatDye(u + (Math.cos(a0) * R) / sx, v + (Math.sin(a0) * R) / sy, u + (Math.cos(a1) * R) / sx, v + (Math.sin(a1) * R) / sy, width * 0.8, a, b, 1, 0.7);
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      active = false;
      syncListeners();
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      mql?.removeEventListener?.("change", onMotionPref);
      canvas.removeEventListener("webglcontextlost", onLost);
      if (!gl.isContextLost()) {
        deleteDoubleFBO(gl, vel);
        deleteDoubleFBO(gl, dye);
        deleteDoubleFBO(gl, pressure);
        deleteFBO(gl, divF);
        deleteFBO(gl, curlF);
        gl.deleteBuffer(quad);
        gl.deleteTexture(paperTex);
        factory.dispose();
      }
      vel = dye = pressure = null;
      divF = curlF = null;
      loseContext(gl);
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
    },
  };

  try {
    syncSize();
  } catch (err) {
    console.warn(err);
    api.destroy();
    return null;
  }
  return api;
}
