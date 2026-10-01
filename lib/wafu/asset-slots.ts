/**
 * 和風 art and music the owner uploads to R2 (never to the repo): for each theme several backdrops
 * and opening silhouettes (one is picked per visit) and a playlist of music tracks. Shared by
 * /api/wafu-assets and the settings card. The first slot of each kind keeps its original name
 * (bg-kikyo …), so files uploaded before stay where they were; more slots are -2, -3, ….
 */
/** bg backdrop · sil opening silhouette · bgm music · icon the opening's central emblem (in colour). */
export type WafuAssetKind = 'bg' | 'sil' | 'bgm' | 'icon';
type WafuAssetTheme = 'kikyo' | 'shigure';
/** How many files of each kind a theme can hold. */
export const assetSlotCount: Record<WafuAssetKind, number> = { bg: 5, sil: 3, bgm: 8, icon: 1 };
export type WafuAssetSlot = `${WafuAssetKind}-${WafuAssetTheme}` | `${WafuAssetKind}-${WafuAssetTheme}-${number}`;
/** The slots of one kind and theme, in order. */
export const themeSlots = (kind: WafuAssetKind, theme: WafuAssetTheme): WafuAssetSlot[] =>
  Array.from({ length: assetSlotCount[kind] }, (_, i) => (i === 0 ? `${kind}-${theme}` : `${kind}-${theme}-${i + 1}`) as WafuAssetSlot);
export const wafuAssetSlots: readonly WafuAssetSlot[] = (['bg', 'sil', 'bgm', 'icon'] as const).flatMap((kind) => (['kikyo', 'shigure'] as const).flatMap((theme) => themeSlots(kind, theme)));

export const isWafuAssetSlot = (value: unknown): value is WafuAssetSlot => (wafuAssetSlots as readonly unknown[]).includes(value);
export const assetKind = (slot: WafuAssetSlot) => slot.slice(0, slot.indexOf('-')) as WafuAssetKind;
export const assetSlot = (kind: WafuAssetKind, theme: 'kikyo' | 'shigure') => `${kind}-${theme}` as WafuAssetSlot;

/** Largest upload per kind. Backdrops are re-encoded as JPEG and silhouettes as PNG masks in the browser first. */
export const maxAssetBytes: Record<WafuAssetKind, number> = { bg: 6 * 1024 * 1024, sil: 3 * 1024 * 1024, bgm: 25 * 1024 * 1024, icon: 3 * 1024 * 1024 };

export type WafuAsset = { slot: WafuAssetSlot; version: string; type: string; size: number; name: string; updatedAt: string; url: string };
export type WafuAssets = Partial<Record<WafuAssetSlot, WafuAsset>>;

export const assetVersionPattern = /^\d{10,16}-[0-9a-f]{8}$/;
export const assetUrl = (slot: WafuAssetSlot, version: string) => `/api/wafu-assets?slot=${slot}&v=${encodeURIComponent(version)}`;

/** The media type a file really is, from its first bytes (null when it is not one this kind accepts). */
export function sniffAsset(kind: WafuAssetKind, bytes: Uint8Array): string | null {
  const at = (offset: number, text: string) => [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (kind === 'bg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : null;
  if (kind === 'sil' || kind === 'icon') return bytes[0] === 0x89 && at(1, 'PNG') ? 'image/png' : null;
  if (at(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (at(4, 'ftyp')) return 'audio/mp4';
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'fLaC')) return 'audio/flac';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  return null;
}

/** The uploaded files of one kind and theme, in slot order. */
export const themeAssets = (assets: WafuAssets, kind: WafuAssetKind, theme: WafuAssetTheme) =>
  themeSlots(kind, theme).flatMap((slot) => assets[slot] ? [assets[slot]!] : []);

// One pick per kind and theme for the whole visit, so the backdrop does not change while browsing.
const picks = new Map<string, number>();
/** A backdrop or silhouette for this visit: one of the uploaded ones, chosen at random once. */
export function visitPick(assets: WafuAssets, kind: 'bg' | 'sil' | 'icon', theme: WafuAssetTheme): WafuAsset | null {
  const list = themeAssets(assets, kind, theme);
  if (!list.length) return null;
  const key = `${kind}-${theme}`;
  let pick = picks.get(key);
  if (pick === undefined || pick >= list.length) { pick = Math.floor(Math.random() * list.length); picks.set(key, pick); }
  return list[pick];
}
