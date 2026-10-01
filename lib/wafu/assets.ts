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

  const cutOut = clear / total >= 0.03;
  if (!cutOut) {
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
  // Only a picture cut out by edge colour can fail this way; a real cut-out may be cropped to the figure.
  if (!cutOut && (right - left + 1) * (bottom - top + 1) > total * 0.97) throw new Error('背景和人物分不開，請改用去背 PNG 或背景單純的圖。');
  context.putImageData(pixels, 0, 0);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return toBlob(out, 'image/png');
}

/**
 * The opening emblem: kept in colour, at most 900 px, as PNG. A picture without transparency loses
 * its plain background by a flood fill from the edges (so a dark kimono inside a black backdrop
 * stays), then is cropped to what remains.
 */
export async function prepareIcon(file: Blob) {
  const image = await decode(file);
  const scale = Math.min(1, 900 / Math.max(image.width, image.height));
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
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 200) clear++;
  if (clear / (width * height) < 0.03) {
    const edge: number[][] = [[], [], []];
    const sample = (x: number, y: number) => { const i = (y * width + x) * 4; for (let c = 0; c < 3; c++) edge[c].push(data[i + c]); };
    for (let x = 0; x < width; x++) { sample(x, 0); sample(x, height - 1); }
    for (let y = 0; y < height; y++) { sample(0, y); sample(width - 1, y); }
    const background = edge.map((values) => values.sort((a, b) => a - b)[values.length >> 1]);
    const near = (p: number) => Math.hypot(data[p * 4] - background[0], data[p * 4 + 1] - background[1], data[p * 4 + 2] - background[2]);
    // Flood fill from every edge pixel through pixels close to the background colour.
    const seen = new Uint8Array(width * height);
    const stack: number[] = [];
    // Tight enough that a dark kimono against a black backdrop stays.
    let limit = 18;
    const push = (p: number) => { if (!seen[p] && near(p) < limit) { seen[p] = 1; stack.push(p); } };
    const fill = () => {
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % width, y = (p - x) / width;
        if (x > 0) push(p - 1);
        if (x < width - 1) push(p + 1);
        if (y > 0) push(p - width);
        if (y < height - 1) push(p + width);
      }
    };
    for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
    fill();
    // Pockets of the exact backdrop colour closed in by the figure (inside a halo ring) go too, when
    // large enough (over 1.2% of the picture) not to be eyes, outlines or shading.
    limit = 6;
    const pocket = Math.max(900, width * height * 0.012);
    for (let start = 0; start < width * height; start++) {
      if (seen[start] || near(start) >= limit) continue;
      stack.push(start); seen[start] = 1;
      const collected: number[] = [];
      while (stack.length) {
        const p = stack.pop()!;
        collected.push(p);
        const x = p % width, y = (p - x) / width;
        for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
          if (q >= 0 && !seen[q] && near(q) < limit) { seen[q] = 1; stack.push(q); }
        }
      }
      // A small pocket is shading: give it back.
      if (collected.length < pocket) for (const p of collected) seen[p] = 2;
    }
    const cleared = (p: number) => seen[p] === 1;
    for (let p = 0; p < width * height; p++) {
      if (cleared(p)) data[p * 4 + 3] = 0;
      // A soft edge: anti-aliased pixels next to the cleared area fade; outlines stay solid.
      else if ((p % width > 0 && cleared(p - 1)) || (p % width < width - 1 && cleared(p + 1)) || (p >= width && cleared(p - width)) || (p < width * (height - 1) && cleared(p + width))) {
        data[p * 4 + 3] = Math.round(Math.min(1, Math.max(0, (near(p) - 18) / 40)) * 255);
      }
    }
  }
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 16) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < 0) throw new Error('圖片去背後沒有剩下內容，請改用去背 PNG。');
  context.putImageData(pixels, 0, 0);
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return toBlob(out, 'image/png');
}
