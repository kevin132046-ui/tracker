'use client';

import { useSyncExternalStore } from 'react';
import type { WafuAssets } from '@/lib/wafu/asset-slots';
import { themeAssets } from '@/lib/wafu/asset-slots';
import { getMediaPrefs, setMediaPrefs } from '@/lib/wafu/media';

/** The music player behind the top-bar button: the uploaded track of each theme, one <audio>. */
export type Track = { id: 'kikyo' | 'shigure'; title: string; src: string };
const themeName = { kikyo: '桔梗', shigure: '時雨' } as const;

let audio: HTMLAudioElement | null = null;
let tracks: Track[] = [];
let index = 0;
let playing = false;
let error: '' | 'blocked' | 'load' = '';
let version = 0;
// Playback speed, remembered across visits.
const rateKey = 'optionflow-music-rate';
export const musicRates = [0.75, 1, 1.25, 1.5, 2] as const;
let rate = 1;
try { const saved = Number(window.localStorage.getItem(rateKey)); if ((musicRates as readonly number[]).includes(saved)) rate = saved; } catch { /* server or storage unavailable */ }
// Shuffle (remembered): the next song is a random other one; ⏮ walks back through what was played.
const shuffleKey = 'optionflow-music-shuffle';
let shuffle = false;
try { shuffle = window.localStorage.getItem(shuffleKey) === '1'; } catch { /* server or storage unavailable */ }
const history: number[] = [];
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((listener) => listener()); };

function element() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.volume = getMediaPrefs().volume;
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.addEventListener('ended', () => { if (tracks.length > 1) next(); else void play(); });
  audio.addEventListener('play', () => { playing = true; error = ''; emit(); });
  audio.addEventListener('pause', () => { playing = false; emit(); });
  audio.addEventListener('error', () => { if (audio?.getAttribute('src')) { playing = false; error = 'load'; emit(); } });
  return audio;
}

/** Tracks from the uploaded files; the current theme's track comes first. */
export function setTracks(assets: WafuAssets, theme: 'kikyo' | 'shigure') {
  // Every uploaded track of both themes, the current theme's playlist first.
  const next: Track[] = (['kikyo', 'shigure'] as const).flatMap((id) => themeAssets(assets, 'bgm', id).map((asset, i) => ({
    id, title: asset.name || `${themeName[id]} · 背景音樂 ${i + 1}`, src: asset.url,
  }))).sort((a, b) => Number(b.id === theme) - Number(a.id === theme));
  const current = tracks[index];
  const same = next.length === tracks.length && next.every((track, i) => track.src === tracks[i].src);
  if (same) return;
  tracks = next;
  const kept = current ? tracks.findIndex((track) => track.src === current.src) : -1;
  if (kept >= 0 && playing) index = kept;
  else {
    index = 0;
    if (audio && (!current || kept < 0)) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  }
  emit();
}

export async function play(at = index) {
  if (!tracks.length) return;
  const player = element();
  const nextIndex = (at + tracks.length) % tracks.length;
  if (nextIndex !== index || player.getAttribute('src') !== tracks[nextIndex].src) {
    if (player.getAttribute('src')) { history.push(index); if (history.length > 50) history.shift(); }
    index = nextIndex;
    player.src = tracks[index].src;
  }
  // A new source resets the speed to the default one; keep the chosen speed.
  player.defaultPlaybackRate = rate;
  player.playbackRate = rate;
  try {
    await player.play();
    setMediaPrefs({ bgm: true });
  } catch {
    error = 'blocked';
  }
  emit();
}
export function pause() { audio?.pause(); setMediaPrefs({ bgm: false }); emit(); }
export function toggle() { if (playing) pause(); else void play(); }
export function next() {
  if (shuffle && tracks.length > 2) {
    let pick = index;
    while (pick === index) pick = Math.floor(Math.random() * tracks.length);
    void play(pick);
    return;
  }
  void play(index + 1);
}
export function setShuffle(on: boolean) {
  shuffle = on;
  try { window.localStorage.setItem(shuffleKey, on ? '1' : '0'); } catch { /* storage unavailable */ }
  emit();
}
export function previous() {
  // Past the first few seconds, ⏮ restarts the song; otherwise it goes to the one before.
  if (audio && audio.currentTime > 4) { audio.currentTime = 0; if (!playing) void play(); return; }
  if (shuffle && history.length) { const back = history.pop()!; void play(back).then(() => { history.pop(); }); return; }
  void play(index - 1);
}
/** Plays the chosen song from the list. */
export function select(at: number) { void play(at); }
export function setRate(next: number) {
  if (!(musicRates as readonly number[]).includes(next)) return;
  rate = next;
  try { window.localStorage.setItem(rateKey, String(next)); } catch { /* storage unavailable */ }
  if (audio) { audio.defaultPlaybackRate = next; audio.playbackRate = next; }
  emit();
}
export function setVolume(volume: number) { setMediaPrefs({ volume }); if (audio) audio.volume = volume; emit(); }
/** Stops without forgetting that music was on (the dock was switched off or the theme left). */
export function stop() { audio?.pause(); }

export const musicState = () => ({ tracks, index, current: tracks[index] ?? null, playing, error, rate, shuffle });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useMusic = () => { useSyncExternalStore(subscribe, () => version, () => 0); return musicState(); };
