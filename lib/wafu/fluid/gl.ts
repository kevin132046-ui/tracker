/**
 * Minimal WebGL plumbing for the ink layer: context + half-float capability probing,
 * program linking, (double) framebuffers. WebGL2 (RG16F/RGBA16F + EXT_color_buffer_float)
 * first, then WebGL1 + OES_texture_half_float (+ _linear, else manual filtering).
 */

export type GL = WebGLRenderingContext | WebGL2RenderingContext;

export interface TexFormat {
  internal: number;
  format: number;
}

export interface GLKit {
  canvas: HTMLCanvasElement;
  gl: GL;
  webgl2: boolean;
  /** HALF_FLOAT (WebGL2) or HALF_FLOAT_OES (WebGL1) */
  type: number;
  rgba: TexFormat;
  rg: TexFormat;
  r: TexFormat;
  /** half-float textures can be sampled with LINEAR filtering */
  linear: boolean;
  maxSize: number;
}

export interface Prog {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

export interface FBO {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
  tx: number;
  ty: number;
}

export interface DoubleFBO {
  read: FBO;
  write: FBO;
  swap(): void;
}

const ATTRS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  depth: false,
  stencil: false,
  antialias: false,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
};

function renderable(gl: GL, fmt: TexFormat, type: number): boolean {
  while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  let ok = false;
  if (tex && fb) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, 4, 4, 0, fmt.format, type, null);
    if (gl.getError() === gl.NO_ERROR) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (fb) gl.deleteFramebuffer(fb);
  if (tex) gl.deleteTexture(tex);
  return ok;
}

function probe2(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): GLKit | null {
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_color_buffer_half_float");
  const type = gl.HALF_FLOAT;
  const rgba: TexFormat = { internal: gl.RGBA16F, format: gl.RGBA };
  if (!renderable(gl, rgba, type)) return null;
  const rg0: TexFormat = { internal: gl.RG16F, format: gl.RG };
  const r0: TexFormat = { internal: gl.R16F, format: gl.RED };
  const rg = renderable(gl, rg0, type) ? rg0 : rgba;
  const r = renderable(gl, r0, type) ? r0 : rg;
  return { canvas, gl, webgl2: true, type, rgba, rg, r, linear: true, maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
}

function probe1(canvas: HTMLCanvasElement, gl: WebGLRenderingContext): GLKit | null {
  const half = gl.getExtension("OES_texture_half_float");
  if (!half) return null;
  const linear = !!gl.getExtension("OES_texture_half_float_linear");
  gl.getExtension("EXT_color_buffer_half_float");
  const type = half.HALF_FLOAT_OES;
  const rgba: TexFormat = { internal: gl.RGBA, format: gl.RGBA };
  if (!renderable(gl, rgba, type)) return null;
  return { canvas, gl, webgl2: false, type, rgba, rg: rgba, r: rgba, linear, maxSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };
}

export function loseContext(gl: GL) {
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* already gone */
  }
}

/** Creates a fresh canvas + context able to render to half-float textures, or null. */
export function createGL(): GLKit | null {
  for (const kind of ["webgl2", "webgl"] as const) {
    const canvas = document.createElement("canvas");
    let gl: GL | null = null;
    try {
      gl = canvas.getContext(kind, ATTRS) as GL | null;
    } catch {
      gl = null;
    }
    if (!gl) continue;
    const kit = kind === "webgl2" ? probe2(canvas, gl as WebGL2RenderingContext) : probe1(canvas, gl);
    if (kit) return kit;
    loseContext(gl);
  }
  return null;
}

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("ink: createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("ink: shader compile failed: " + log);
  }
  return sh;
}

/** Compiles a shared vertex shader once; returns a linker for fragment programs. */
export function programFactory(gl: GL, vertSrc: string, defines: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const shaders: WebGLShader[] = [vs];
  const programs: WebGLProgram[] = [];
  const make = (fragSrc: string): Prog => {
    const fs = compile(gl, gl.FRAGMENT_SHADER, defines + fragSrc);
    shaders.push(fs);
    const program = gl.createProgram();
    if (!program) throw new Error("ink: createProgram failed");
    programs.push(program);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("ink: link failed: " + gl.getProgramInfoLog(program));
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(program, info.name);
    }
    return { program, u };
  };
  const dispose = () => {
    programs.forEach((p) => gl.deleteProgram(p));
    shaders.forEach((s) => gl.deleteShader(s));
  };
  return { make, dispose };
}

export function createFBO(gl: GL, w: number, h: number, fmt: TexFormat, type: number, filter: number): FBO {
  gl.activeTexture(gl.TEXTURE0);
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) throw new Error("ink: out of GL objects");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, type, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb, w, h, tx: 1 / w, ty: 1 / h };
}

export function deleteFBO(gl: GL, f: FBO | null | undefined) {
  if (!f) return;
  gl.deleteFramebuffer(f.fb);
  gl.deleteTexture(f.tex);
}

export function createDoubleFBO(gl: GL, w: number, h: number, fmt: TexFormat, type: number, filter: number): DoubleFBO {
  const d: DoubleFBO = {
    read: createFBO(gl, w, h, fmt, type, filter),
    write: createFBO(gl, w, h, fmt, type, filter),
    swap() {
      const t = d.read;
      d.read = d.write;
      d.write = t;
    },
  };
  return d;
}

export function deleteDoubleFBO(gl: GL, d: DoubleFBO | null | undefined) {
  if (!d) return;
  deleteFBO(gl, d.read);
  deleteFBO(gl, d.write);
}
