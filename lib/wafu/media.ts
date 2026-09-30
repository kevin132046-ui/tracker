'use client';

import { useSyncExternalStore } from 'react';

/** 和風 backdrop and sound switches, kept in this browser. */
export type WafuMediaPrefs = {
  /** The uploaded backdrop picture. */
  photo: boolean;
  /** Light beam (桔梗) or snow and lantern glow (時雨). */
  effects: boolean;
  /** The music button in the top bar. */
  musicDock: boolean;
  /** Opening and interface sound effects (synthesised, no files). */
  sfx: boolean;
  volume: number;
  /** Music was playing when the page was left: it resumes on the first tap. */
  bgm: boolean;
};

const key = 'optionflow-wafu-media';
export const defaultMediaPrefs: WafuMediaPrefs = { photo: true, effects: true, musicDock: true, sfx: false, volume: 0.55, bgm: false };

function read(): WafuMediaPrefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? '{}') as Partial<Record<keyof WafuMediaPrefs, unknown>>;
    const flag = (name: 'photo' | 'effects' | 'musicDock' | 'sfx' | 'bgm') => typeof saved[name] === 'boolean' ? saved[name] as boolean : defaultMediaPrefs[name];
    const volume = typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : defaultMediaPrefs.volume;
    return { photo: flag('photo'), effects: flag('effects'), musicDock: flag('musicDock'), sfx: flag('sfx'), bgm: flag('bgm'), volume };
  } catch {
    return defaultMediaPrefs;
  }
}

let prefs: WafuMediaPrefs | null = null;
const listeners = new Set<() => void>();
export const getMediaPrefs = () => prefs ??= read();

export function setMediaPrefs(change: Partial<WafuMediaPrefs>) {
  prefs = { ...getMediaPrefs(), ...change };
  try { window.localStorage.setItem(key, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useMediaPrefs = () => useSyncExternalStore(subscribe, getMediaPrefs, () => defaultMediaPrefs);
