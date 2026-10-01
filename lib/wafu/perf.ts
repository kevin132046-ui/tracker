import { useSyncExternalStore } from 'react';
import { introLiteDetected, setIntroLiteDetected, wafuIntroLiteKey } from '@/lib/wafu/intro';

/**
 * 效能模式: on slow devices the decorative motion steps aside (window beam, lantern, snow, the
 * backdrop's parallax and zoom, floating halos, the top bar's blur). Numbers, charts and every
 * control stay as they are. 'auto' follows the slow-device flag the opening also uses.
 */
export type PerfPreference = 'auto' | 'on' | 'off';
export const perfModeKey = 'optionflow-perf-mode';
const slowFrameMs = 25;

const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };

export function loadPerfPreference(): PerfPreference {
  const saved = read(perfModeKey);
  return saved === 'on' || saved === 'off' ? saved : 'auto';
}

/** Very small devices count as slow without measuring. */
function lowEndDevice() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory ?? 8) <= 2 || (nav.hardwareConcurrency ?? 8) <= 2;
}

export const perfLiteFor = (preference: PerfPreference) => preference === 'on' || (preference === 'auto' && (introLiteDetected() || lowEndDevice()));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Sets data-perf on <html>, which the CSS reads. */
export function applyPerf() {
  const lite = perfLiteFor(loadPerfPreference());
  const root = document.documentElement;
  if (lite) root.dataset.perf = 'lite';
  else delete root.dataset.perf;
  notify();
}

export function savePerfPreference(preference: PerfPreference) {
  try {
    if (preference === 'auto') window.localStorage.removeItem(perfModeKey);
    else window.localStorage.setItem(perfModeKey, preference);
  } catch { /* storage unavailable */ }
  applyPerf();
}

/** Clears the slow-device flag so 'auto' measures again on the next load. */
export function resetSlowDevice() {
  setIntroLiteDetected(false);
  applyPerf();
}

export const usePerfLite = () => useSyncExternalStore(subscribe, () => document.documentElement.dataset.perf === 'lite', () => false);
export const usePerfPreference = () => useSyncExternalStore(subscribe, loadPerfPreference, () => 'auto' as PerfPreference);
export const slowDeviceDetected = () => introLiteDetected();

/**
 * In 'auto', measures one second of frames once the page has settled (only when the opening did not
 * already measure); a slow median sets the shared slow-device flag.
 */
export function probeFramesOnce() {
  if (loadPerfPreference() !== 'auto' || read(wafuIntroLiteKey) === '1' || read('optionflow-perf-probed') === '1') return () => undefined;
  let raf = 0;
  let last = 0;
  const gaps: number[] = [];
  let started = 0;
  const timer = window.setTimeout(() => {
    if (document.hidden) return;
    started = performance.now();
    const step = (now: number) => {
      if (last) gaps.push(now - last);
      last = now;
      if (now - started < 1000) { raf = requestAnimationFrame(step); return; }
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      try { window.localStorage.setItem('optionflow-perf-probed', '1'); } catch { /* storage unavailable */ }
      if (median > slowFrameMs) { setIntroLiteDetected(true); applyPerf(); }
    };
    raf = requestAnimationFrame(step);
  }, 4000);
  return () => { window.clearTimeout(timer); cancelAnimationFrame(raf); };
}
