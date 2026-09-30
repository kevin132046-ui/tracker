'use client';

import { useSyncExternalStore } from 'react';
import type { WafuAsset, WafuAssets, WafuAssetSlot } from '@/lib/wafu/asset-slots';

/**
 * The uploaded 和風 art and music, read once per page (only by 和風 components, so the classic page
 * never asks) and shared by the backdrop, the opening, the music player and the settings card.
 */
type State = { status: 'idle' | 'loading' | 'ready' | 'error'; assets: WafuAssets; error: string };
let state: State = { status: 'idle', assets: {}, error: '' };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener()); };

export async function refreshWafuAssets() {
  if (state.status === 'idle') set({ status: 'loading' });
  try {
    const response = await fetch('/api/wafu-assets', { cache: 'no-store' });
    const payload = await response.json() as { assets?: WafuAssets; error?: string };
    if (!response.ok || !payload.assets) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
    set({ status: 'ready', assets: payload.assets, error: '' });
  } catch (reason) {
    set({ status: 'error', error: reason instanceof Error ? reason.message : '和風素材無法讀取' });
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (state.status === 'idle') void refreshWafuAssets();
  return () => { listeners.delete(listener); };
};
const serverState: State = { status: 'idle', assets: {}, error: '' };
export const useWafuAssets = () => useSyncExternalStore(subscribe, () => state, () => serverState);

async function send(method: 'PUT' | 'DELETE', slot: WafuAssetSlot, body?: Blob, name?: string) {
  const response = await fetch(`/api/wafu-assets?slot=${slot}`, {
    method,
    body,
    headers: body ? { 'Content-Type': body.type || 'application/octet-stream', ...(name ? { 'X-File-Name': encodeURIComponent(name) } : {}) } : undefined,
  });
  const payload = await response.json().catch(() => ({})) as { asset?: WafuAsset; error?: string };
  if (!response.ok) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
  if (method === 'PUT' && payload.asset) set({ assets: { ...state.assets, [slot]: payload.asset } });
  if (method === 'DELETE') { const assets = { ...state.assets }; delete assets[slot]; set({ assets }); }
}
export const uploadWafuAsset = (slot: WafuAssetSlot, file: Blob, name?: string) => send('PUT', slot, file, name);
export const deleteWafuAsset = (slot: WafuAssetSlot) => send('DELETE', slot);

async function decode(file: Blob) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('無法讀取這張圖片（可用 JPEG、PNG、WebP）。');
  }
}
const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('圖片無法轉檔。')), type, quality);
});

/** A backdrop: at most 2400 px on the long side, as JPEG. */
export async function prepareBackdrop(file: Blob) {
  const image = await decode(file);
  const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('瀏覽器無法處理圖片。');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.86, 0.78, 0.68]) {
    const blob = await toBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= 5.5 * 1024 * 1024) return blob;
  }
  throw new Error('圖片太大，請先縮小再上傳。');
}

/**
 * A silhouette: a white PNG whose alpha is the figure, trimmed to it, at most 1000 px. A picture with
 * transparency keeps its own cut-out; otherwise the background is taken from the colour of the edges.
 */
export async function prepareSilhouette(file: Blob) {
  const image = await decode(file);
  const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('瀏覽器無法處理圖片。');
  context.drawImage(image, 0, 0, width, height);
  image.close();
  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  const total = width * height;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 200) clear++;

  if (clear / total < 0.03) {
    // No cut-out: the median edge colour is the background.
    const edge: number[][] = [[], [], []];
    const sample = (x: number, y: number) => { const i = (y * width + x) * 4; for (let c = 0; c < 3; c++) edge[c].push(data[i + c]); };
    for (let x = 0; x < width; x++) { sample(x, 0); sample(x, height - 1); }
    for (let y = 0; y < height; y++) { sample(0, y); sample(width - 1, y); }
    const background = edge.map((values) => values.sort((a, b) => a - b)[values.length >> 1]);
    for (let i = 0; i < data.length; i += 4) {
      const distance = Math.hypot(data[i] - background[0], data[i + 1] - background[1], data[i + 2] - background[2]);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, (distance - 28) / 42)) * 255);
    }
  }

  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] > 16) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
  }
  if (right < 0) throw new Error('找不到圖中的人物輪廓，請改用去背 PNG。');
  if ((right - left + 1) * (bottom - top + 1) > total * 0.97) throw new Error('背景和人物分不開，請改用去背 PNG 或背景單純的圖。');
  context.putImageData(pixels, 0, 0);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return toBlob(out, 'image/png');
}
