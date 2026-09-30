// 音效與背景音樂。
// 音效以 WebAudio 即時合成（不需音檔）：墨滴、琴音、光環泛音、拉門、暖簾…
// 背景音樂為原創曲（依 BA 配樂風格規則作曲、以 GM 音色渲染），另可載入使用者自己的音檔（只在本機播放）。
import { safeGet, safeSet } from "./wa";

export type SfxName = "tick" | "ink" | "halo" | "stamp" | "slide" | "swish" | "open" | "close" | "pop";
type Theme = "kikyo" | "shigure";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let wet: GainNode | null = null;
let tickIndex = 0;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export function subscribeAudio(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export const audioPrefs = {
  sfx: safeGet("wa-sfx") !== "0",
  bgm: safeGet("wa-bgm") === "1",
  volume: Math.min(1, Math.max(0, Number(safeGet("wa-vol") ?? "0.55") || 0.55)),
};
export function setSfx(v: boolean) { audioPrefs.sfx = v; safeSet("wa-sfx", v ? "1" : "0"); emit(); }

function impulse(c: AudioContext, seconds = 2.6, decay = 2.8) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** 必須在使用者手勢（點擊／按鍵）內呼叫；回傳是否已可發聲 */
export function unlockAudio(): boolean {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.9;
      out.connect(ctx.destination);
      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx);
      wet = ctx.createGain();
      wet.gain.value = 0.32;
      wet.connect(verb).connect(out);
    }
    if (ctx.state === "suspended") void ctx.resume();
    emit();
    return true;
  } catch {
    return false;
  }
}
export const audioReady = () => !!ctx && ctx.state === "running";

function voice(t0: number, dur: number, peak = 0.3, attack = 0.005) {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(out!);
  g.connect(wet!);
  return g;
}

function osc(type: OscillatorType, f: number, t0: number, dur: number, dest: AudioNode, fEnd?: number) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur * 0.6);
  o.connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(t0: number, dur: number, dest: AudioNode) {
  const len = Math.floor(ctx!.sampleRate * dur);
  const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; } // 帶粉紅感的柔和噪音
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.connect(dest);
  s.start(t0);
  return s;
}

// 都節／陽音階（D 為主）的琴音，桔梗用；時雨用高音玻璃風鈴
const KOTO = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const GLASS = [1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0];

export function playSfx(name: SfxName, theme: Theme = "kikyo") {
  if (!audioPrefs.sfx || !ctx || !out || ctx.state !== "running") return;
  const t = ctx.currentTime + 0.01;
  try {
    switch (name) {
      case "tick": {
        const i = tickIndex++ % 6;
        if (theme === "kikyo") {
          const f = KOTO[i];
          const g = voice(t, 1.6, 0.22, 0.003);
          const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.9); lp.connect(g);
          osc("triangle", f, t, 1.5, lp); osc("sine", f * 2.01, t, 0.6, lp); osc("sine", f * 3.02, t, 0.25, lp);
        } else {
          const f = GLASS[i];
          const g = voice(t, 2.4, 0.12, 0.002);
          [1, 2.76, 5.4].forEach((m, k) => osc("sine", f * m, t, 2.2 / (k + 1), g));
        }
        break;
      }
      case "ink": {
        const g = voice(t, 0.9, 0.28, 0.002);
        osc("sine", 620, t, 0.22, g, 170);
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
        const ng = voice(t, 0.25, 0.05, 0.002); bp.connect(ng); noise(t, 0.25, bp);
        break;
      }
      case "halo": {
        const base = theme === "kikyo" ? [587.33, 880.0, 1174.66, 1318.51] : [783.99, 1174.66, 1567.98, 2093.0];
        base.forEach((f, k) => {
          const g = voice(t + k * 0.09, 3.2, 0.07, 0.35);
          osc("sine", f, t + k * 0.09, 3.1, g);
          osc("sine", f * 1.004, t + k * 0.09, 3.1, g);
        });
        break;
      }
      case "stamp": {
        const g = voice(t, 0.8, 0.45, 0.004);
        osc("sine", 110, t, 0.7, g, 52);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
        const ng = voice(t, 0.3, 0.12, 0.003); lp.connect(ng); noise(t, 0.3, lp);
        break;
      }
      case "slide": {
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.9);
        const g = voice(t, 1.05, 0.2, 0.12); bp.connect(g); noise(t, 1.1, bp);
        const k = voice(t + 1.0, 0.35, 0.25, 0.003); osc("sine", 140, t + 1.0, 0.3, k, 90);
        break;
      }
      case "swish": {
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
        lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2600, t + 0.35); lp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
        const g = voice(t, 1.0, 0.22, 0.15); lp.connect(g); noise(t, 1.0, lp);
        break;
      }
      case "open":
      case "close": {
        const seq = name === "open" ? [880, 1318.51] : [1318.51, 987.77];
        seq.forEach((f, k) => { const g = voice(t + k * 0.07, 0.9, 0.08, 0.003); osc("sine", f, t + k * 0.07, 0.8, g); osc("sine", f * 2.01, t + k * 0.07, 0.3, g); });
        break;
      }
      case "pop": {
        const g = voice(t, 0.25, 0.12, 0.002); osc("sine", 1200, t, 0.12, g, 700);
        break;
      }
    }
  } catch { /* 瀏覽器不支援某些節點時略過 */ }
}

// ———— 背景音樂 ————
export interface Track { id: string; title: string; titleJa: string; src: string; note: string; user?: boolean }

export const BUILTIN_TRACKS: Track[] = [
  { id: "kikyo", title: "桔梗 · 夜の書斎", titleJa: "桔梗・夜の書斎", src: "bgm/kikyo-yoru.mp3", note: "原創 · chill × 和風 · D · 86 BPM" },
  { id: "shigure", title: "時雨 · 湯けむり", titleJa: "時雨・湯けむり", src: "bgm/shigure-yukemuri.mp3", note: "原創 · sentimental · E♭ · 90 BPM" },
];

class Player {
  el: HTMLAudioElement | null = null;
  tracks: Track[] = [...BUILTIN_TRACKS];
  index = 0;
  playing = false;
  error = "";
  private ensure() {
    if (this.el) return this.el;
    const a = new Audio();
    a.preload = "none";
    a.loop = false;
    a.volume = audioPrefs.volume;
    a.addEventListener("ended", () => this.next());
    a.addEventListener("play", () => { this.playing = true; this.error = ""; emit(); });
    a.addEventListener("pause", () => { this.playing = false; emit(); });
    a.addEventListener("error", () => { this.playing = false; this.error = "load"; emit(); });
    this.el = a;
    return a;
  }
  get current() { return this.tracks[this.index]; }
  async play(i = this.index) {
    const a = this.ensure();
    if (i !== this.index || !a.src) { this.index = (i + this.tracks.length) % this.tracks.length; a.src = this.current.src; }
    try { await a.play(); audioPrefs.bgm = true; safeSet("wa-bgm", "1"); } catch { this.error = "blocked"; }
    emit();
  }
  pause() { this.el?.pause(); audioPrefs.bgm = false; safeSet("wa-bgm", "0"); emit(); }
  toggle() { if (this.playing) this.pause(); else void this.play(); }
  next() { void this.play(this.index + 1); }
  prev() { void this.play(this.index - 1); }
  setVolume(v: number) { audioPrefs.volume = v; safeSet("wa-vol", String(v)); if (this.el) this.el.volume = v; emit(); }
  addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(f.name));
    for (const f of list) {
      const name = f.name.replace(/\.[^.]+$/, "");
      this.tracks.push({ id: "u" + Date.now() + Math.random(), title: name, titleJa: name, src: URL.createObjectURL(f), note: "我的音檔 · 僅在本機播放", user: true });
    }
    emit();
    return list.length;
  }
  remove(id: string) {
    const i = this.tracks.findIndex((t) => t.id === id);
    if (i < 0 || !this.tracks[i].user) return;
    URL.revokeObjectURL(this.tracks[i].src);
    const wasCurrent = i === this.index;
    this.tracks.splice(i, 1);
    if (this.index >= this.tracks.length) this.index = 0;
    if (wasCurrent && this.el) { this.el.pause(); this.el.removeAttribute("src"); }
    emit();
  }
  /** 依主題切換預設曲（尚未播放時） */
  preferTheme(theme: Theme) { if (!this.playing) { const i = this.tracks.findIndex((t) => t.id === theme); if (i >= 0) this.index = i; } }
}

export const player = new Player();
