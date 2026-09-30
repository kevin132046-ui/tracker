'use client';

import { useRef, useState } from 'react';
import type { WafuAssetKind, WafuAssetSlot } from '@/lib/wafu/asset-slots';
import { assetSlot, maxAssetBytes } from '@/lib/wafu/asset-slots';
import { deleteWafuAsset, prepareBackdrop, prepareSilhouette, uploadWafuAsset, useWafuAssets } from '@/lib/wafu/assets';
import type { WafuMediaPrefs } from '@/lib/wafu/media';
import { setMediaPrefs, useMediaPrefs } from '@/lib/wafu/media';
import { playSfx, unlockAudio } from '@/lib/wafu/sfx';
import type { WafuTheme } from '@/lib/wafu/theme';

const kinds: ReadonlyArray<{ kind: WafuAssetKind; label: string; accept: string; hint: string }> = [
  { kind: 'bg', label: '背景圖', accept: 'image/jpeg,image/png,image/webp', hint: '會縮到 2400 px 並轉成 JPEG' },
  { kind: 'sil', label: '開場剪影', accept: 'image/png,image/webp,image/jpeg', hint: '去背 PNG 最好；一般圖片以邊緣顏色自動去背' },
  { kind: 'bgm', label: '背景音樂', accept: 'audio/*,.mp3,.m4a,.ogg,.wav,.flac,.webm', hint: `MP3、M4A、OGG、WAV、FLAC，${maxAssetBytes.bgm / 1024 / 1024} MB 內` },
];
const themes: ReadonlyArray<{ id: WafuTheme; label: string; sil: string }> = [
  { id: 'kikyo', label: '桔梗', sil: '映在障子上的影子' },
  { id: 'shigure', label: '時雨', sil: '染在暖簾上的白抜き圖樣' },
];
const toggles: ReadonlyArray<{ key: keyof Pick<WafuMediaPrefs, 'photo' | 'effects' | 'musicDock' | 'sfx'>; label: string }> = [
  { key: 'photo', label: '顯示背景圖' },
  { key: 'effects', label: '光影特效（桔梗的光束、時雨的落雪與燈籠）' },
  { key: 'musicDock', label: '頂欄音樂播放器' },
  { key: 'sfx', label: '開場與介面音效' },
];
const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Settings card (和風 only): upload the backdrop, opening silhouette and music of each theme to R2, and the switches. */
export default function WafuMediaCard({ theme }: { theme: WafuTheme }) {
  const { status, assets, error: loadError } = useWafuAssets();
  const prefs = useMediaPrefs();
  const [busy, setBusy] = useState<WafuAssetSlot | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const inputs = useRef<Partial<Record<WafuAssetSlot, HTMLInputElement | null>>>({});

  const upload = async (slot: WafuAssetSlot, kind: WafuAssetKind, file: File | undefined) => {
    if (!file || busy) return;
    setBusy(slot);
    setMessage(null);
    try {
      const body = kind === 'bg' ? await prepareBackdrop(file) : kind === 'sil' ? await prepareSilhouette(file) : file;
      if (body.size > maxAssetBytes[kind]) throw new Error(`檔案超過 ${maxAssetBytes[kind] / 1024 / 1024} MB。`);
      await uploadWafuAsset(slot, body, kind === 'bgm' ? file.name : undefined);
      setMessage({ text: '已上傳。', error: false });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : '上傳失敗。', error: true });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (slot: WafuAssetSlot) => {
    if (busy) return;
    setBusy(slot);
    setMessage(null);
    try {
      await deleteWafuAsset(slot);
      setMessage({ text: '已移除。', error: false });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : '移除失敗。', error: true });
    } finally {
      setBusy(null);
    }
  };

  return <section className="settings-feature-card wafu-media-card is-enabled">
    <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">景</span><div><p>Backdrop &amp; music</p><h3>和風背景與音樂</h3></div><span className="settings-feature-status">{status === 'loading' ? '讀取中' : `${Object.keys(assets).length} 個檔案`}</span></div>
    <p>每個主題可以放自己的背景圖、開場剪影與背景音樂。檔案只存在你的 Cloudflare R2，不會進 GitHub。</p>
    <div className="wafu-media-toggles">
      {toggles.map((toggle) => <label key={toggle.key}><input type="checkbox" checked={prefs[toggle.key]} onChange={(event) => {
        const on = event.target.checked;
        setMediaPrefs({ [toggle.key]: on });
        if (toggle.key === 'sfx' && on && unlockAudio()) playSfx('pop', theme);
      }} /><span>{toggle.label}</span></label>)}
    </div>
    {status === 'error' && <p className="wafu-media-note is-error" role="alert">{`無法讀取已上傳的檔案：${loadError}`}</p>}
    {themes.map((item) => <div key={item.id} className="wafu-media-theme">
      <h4>{item.label}</h4>
      {kinds.map((kind) => {
        const slot = assetSlot(kind.kind, item.id);
        const asset = assets[slot];
        const working = busy === slot;
        return <div key={slot} className="wafu-media-row">
          <div className={`wafu-media-thumb is-${kind.kind}`} aria-hidden="true">
            {asset && kind.kind !== 'bgm' ? <span style={{ [kind.kind === 'bg' ? 'backgroundImage' : 'maskImage']: `url("${asset.url}")`, ...(kind.kind === 'sil' ? { WebkitMaskImage: `url("${asset.url}")` } : {}) }} /> : <span>{kind.kind === 'bgm' ? '♪' : '—'}</span>}
          </div>
          <div className="wafu-media-info">
            <b>{kind.label}</b>
            <small>{working ? '處理中…' : asset ? `${kind.kind === 'bgm' && asset.name ? `${asset.name} · ` : ''}${sizeLabel(asset.size)}` : kind.kind === 'sil' ? `未上傳 · ${item.sil}` : `未上傳 · ${kind.hint}`}</small>
          </div>
          <input ref={(element) => { inputs.current[slot] = element; }} className="visually-hidden" type="file" accept={kind.accept} tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(slot, kind.kind, file); }} />
          <button type="button" disabled={Boolean(busy)} onClick={() => inputs.current[slot]?.click()}>{asset ? '更換' : '上傳'}</button>
          {asset && <button type="button" className="is-quiet" disabled={Boolean(busy)} onClick={() => void remove(slot)}>移除</button>}
        </div>;
      })}
    </div>)}
    {message && <p className={`wafu-media-note${message.error ? ' is-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </section>;
}
