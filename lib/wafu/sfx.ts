/**
 * 和風 sound effects, synthesised with WebAudio (no audio files): ink drops, koto notes, the halo's
 * overtones, sliding doors, noren. Off by default; only heard after a tap unlocks audio.
 */
import { getMediaPrefs } from "./media";

export type SfxName = "tick" | "ink" | "halo" | "stamp" | "slide" | "swish" | "open" | "close" | "pop";
type Theme = "kikyo" | "shigure";

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let wet: GainNode | null = null;
let tickIndex = 0;


function impulse(c: AudioContext, seconds = 2.6, decay = 2.8) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Call inside a user gesture (tap or key); returns whether sound can play. */
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
  for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; } // soft, pinkish noise
  const s = ctx!.createBufferSource();
  s.buffer = buf;
  s.connect(dest);
  s.start(t0);
  return s;
}

// 桔梗: koto notes on a D pentatonic scale; 時雨: high glass wind chimes.
const KOTO = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const GLASS = [1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0];

export function playSfx(name: SfxName, theme: Theme = "kikyo") {
  if (!getMediaPrefs().sfx || !ctx || !out || ctx.state !== "running") return;
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
  } catch { /* a missing audio node is skipped */ }
}
