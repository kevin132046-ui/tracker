'use client';

import { useSyncExternalStore } from 'react';
import type { WafuAssets } from '@/lib/wafu/asset-slots';
import { getMediaPrefs, setMediaPrefs } from '@/lib/wafu/media';

/** The music player behind the top-bar button: the uploaded track of each theme, one <audio>. */
export type Track = { id: 'kikyo' | 'shigure'; title: string; src: string };

let audio: HTMLAudioElement | null = null;
let tracks: Track[] = [];
let index = 0;
let playing = false;
let error: '' | 'blocked' | 'load' = '';
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach((listener) => listener()); };

function element() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.volume = getMediaPrefs().volume;
  audio.addEventListener('ended', () => { if (tracks.length > 1) next(); else void play(); });
  audio.addEventListener('play', () => { playing = true; error = ''; emit(); });
  audio.addEventListener('pause', () => { playing = false; emit(); });
  audio.addEventListener('error', () => { if (audio?.getAttribute('src')) { playing = false; error = 'load'; emit(); } });
  return audio;
}

/** Tracks from the uploaded files; the current theme's track comes first. */
export function setTracks(assets: WafuAssets, theme: 'kikyo' | 'shigure') {
  const next: Track[] = (['kikyo', 'shigure'] as const).flatMap((id) => {
    const asset = assets[`bgm-${id}`];
    return asset ? [{ id, title: asset.name || (id === 'kikyo' ? '桔梗 · 背景音樂' : '時雨 · 背景音樂'), src: asset.url }] : [];
  }).sort((a, b) => Number(b.id === theme) - Number(a.id === theme));
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
    index = nextIndex;
    player.src = tracks[index].src;
  }
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
export function next() { void play(index + 1); }
export function setVolume(volume: number) { setMediaPrefs({ volume }); if (audio) audio.volume = volume; emit(); }
/** Stops without forgetting that music was on (the dock was switched off or the theme left). */
export function stop() { audio?.pause(); }

export const musicState = () => ({ tracks, index, current: tracks[index] ?? null, playing, error });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useMusic = () => { useSyncExternalStore(subscribe, () => version, () => 0); return musicState(); };
