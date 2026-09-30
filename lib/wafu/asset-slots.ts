/**
 * 和風 art and music the owner uploads to R2 (never to the repo): a backdrop, an opening
 * silhouette and a music track for each theme. Shared by /api/wafu-assets and the settings card.
 */
export const wafuAssetSlots = ['bg-kikyo', 'bg-shigure', 'sil-kikyo', 'sil-shigure', 'bgm-kikyo', 'bgm-shigure'] as const;
export type WafuAssetSlot = (typeof wafuAssetSlots)[number];
export type WafuAssetKind = 'bg' | 'sil' | 'bgm';

export const isWafuAssetSlot = (value: unknown): value is WafuAssetSlot => (wafuAssetSlots as readonly unknown[]).includes(value);
export const assetKind = (slot: WafuAssetSlot) => slot.slice(0, slot.indexOf('-')) as WafuAssetKind;
export const assetSlot = (kind: WafuAssetKind, theme: 'kikyo' | 'shigure') => `${kind}-${theme}` as WafuAssetSlot;

/** Largest upload per kind. Backdrops are re-encoded as JPEG and silhouettes as PNG masks in the browser first. */
export const maxAssetBytes: Record<WafuAssetKind, number> = { bg: 6 * 1024 * 1024, sil: 3 * 1024 * 1024, bgm: 25 * 1024 * 1024 };

export type WafuAsset = { slot: WafuAssetSlot; version: string; type: string; size: number; name: string; updatedAt: string; url: string };
export type WafuAssets = Partial<Record<WafuAssetSlot, WafuAsset>>;

export const assetVersionPattern = /^\d{10,16}-[0-9a-f]{8}$/;
export const assetUrl = (slot: WafuAssetSlot, version: string) => `/api/wafu-assets?slot=${slot}&v=${encodeURIComponent(version)}`;

/** The media type a file really is, from its first bytes (null when it is not one this kind accepts). */
export function sniffAsset(kind: WafuAssetKind, bytes: Uint8Array): string | null {
  const at = (offset: number, text: string) => [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (kind === 'bg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : null;
  if (kind === 'sil') return bytes[0] === 0x89 && at(1, 'PNG') ? 'image/png' : null;
  if (at(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (at(4, 'ftyp')) return 'audio/mp4';
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
  if (at(0, 'fLaC')) return 'audio/flac';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  return null;
}
