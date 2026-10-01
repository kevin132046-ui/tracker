'use client';

import { useRef, useState } from 'react';
import type { WafuAssetKind, WafuAssetSlot } from '@/lib/wafu/asset-slots';
import { assetKind, assetSlotCount, maxAssetBytes, themeSlots } from '@/lib/wafu/asset-slots';
import { isZipFile, unzip } from '@/lib/wafu/unzip';
import { deleteWafuAsset, prepareBackdrop, prepareIcon, prepareSilhouette, uploadWafuAsset, useWafuAssets } from '@/lib/wafu/assets';
import type { WafuMediaPrefs } from '@/lib/wafu/media';
import { setMediaPrefs, useMediaPrefs } from '@/lib/wafu/media';
import { playSfx, unlockAudio } from '@/lib/wafu/sfx';
import type { WafuTheme } from '@/lib/wafu/theme';

const kinds: ReadonlyArray<{ kind: WafuAssetKind; label: string; accept: string; hint: string }> = [
  { kind: 'bg', label: '背景圖', accept: 'image/jpeg,image/png,image/webp', hint: '會縮到 2400 px 並轉成 JPEG' },
  { kind: 'sil', label: '開場剪影', accept: 'image/png,image/webp,image/jpeg', hint: '去背 PNG 最好；一般圖片以邊緣顏色自動去背' },
  { kind: 'icon', label: '開場圖標', accept: 'image/png,image/webp,image/jpeg', hint: '取代開場中央的圖騰；彩色保留，單色背景會自動去除' },
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
/** Which kind and theme a file from a batch is, by its name (桔梗／kikyo, 時雨／shigure; 剪影 → silhouette; audio → music; other pictures → backdrop). */
function targetForFile(file: File): { kind: WafuAssetKind; theme: WafuTheme } | null {
  const name = file.name.toLowerCase();
  const theme: WafuTheme | null = /桔梗|kikyo/.test(name) ? 'kikyo' : /時雨|shigure/.test(name) ? 'shigure' : null;
  if (!theme) return null;
  const audio = file.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/.test(name);
  const kind: WafuAssetKind = audio ? 'bgm' : /剪影|silhouette|sil/.test(name) ? 'sil' : /圖標|icon|emblem/.test(name) ? 'icon' : 'bg';
  return { kind, theme };
}
const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Settings card (和風 only): upload the backdrop, opening silhouette and music of each theme to R2, and the switches. */
export default function WafuMediaCard({ theme }: { theme: WafuTheme }) {
  const { status, assets, error: loadError } = useWafuAssets();
  const prefs = useMediaPrefs();
  const [busy, setBusy] = useState<WafuAssetSlot | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const inputs = useRef<Partial<Record<WafuAssetSlot, HTMLInputElement | null>>>({});
  const batchRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState(false);

  const send = async (slot: WafuAssetSlot, file: File) => {
    const kind = assetKind(slot);
    const body = kind === 'bg' ? await prepareBackdrop(file) : kind === 'sil' ? await prepareSilhouette(file) : kind === 'icon' ? await prepareIcon(file) : file;
    if (body.size > maxAssetBytes[kind]) throw new Error(`檔案超過 ${maxAssetBytes[kind] / 1024 / 1024} MB。`);
    await uploadWafuAsset(slot, body, kind === 'bgm' ? file.name : undefined);
  };
  const upload = async (slot: WafuAssetSlot, file: File | undefined) => {
    if (!file || busy || batch) return;
    setBusy(slot);
    setMessage(null);
    try {
      await send(slot, file);
      setMessage({ text: '已上傳。', error: false });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : '上傳失敗。', error: true });
    } finally {
      setBusy(null);
    }
  };
  // Several files at once: each goes to the slot its name points to.
  const uploadAll = async (picked: File[]) => {
    if (!picked.length || busy || batch) return;
    setBatch(true);
    const done: string[] = [];
    const failed: string[] = [];
    // A zip (such as 和風素材.zip) is opened here and its files take part like picked ones.
    const files: File[] = [];
    for (const file of picked) {
      if (!isZipFile(file)) { files.push(file); continue; }
      setMessage({ text: `解壓縮中：${file.name}`, error: false });
      try {
        files.push(...await unzip(file));
      } catch (reason) {
        failed.push(`${file.name}（${reason instanceof Error ? reason.message : '無法解壓縮'}）`);
      }
    }
    // Each file takes the next free slot of its kind and theme (a full list replaces from the last slot).
    const taken = new Set(Object.keys(assets));
    const planned = files.map((file) => {
      const target = targetForFile(file);
      if (!target) return [file, null] as const;
      const slots = themeSlots(target.kind, target.theme);
      const slot = slots.find((candidate) => !taken.has(candidate)) ?? slots[slots.length - 1];
      taken.add(slot);
      return [file, slot] as const;
    });
    const skipped = planned.filter(([, slot]) => !slot).map(([file]) => file.name);
    const jobs = planned.filter((job): job is readonly [File, WafuAssetSlot] => Boolean(job[1]));
    for (const [index, [file, slot]] of jobs.entries()) {
      setBusy(slot);
      setMessage({ text: `上傳中 ${index + 1}/${jobs.length}：${file.name}`, error: false });
      try {
        await send(slot, file);
        done.push(file.name);
      } catch (reason) {
        failed.push(`${file.name}（${reason instanceof Error ? reason.message : '上傳失敗'}）`);
      }
    }
    setBusy(null);
    setBatch(false);
    const lines = [`已上傳 ${done.length} 個檔案。`];
    if (failed.length) lines.push(`失敗：${failed.join('、')}`);
    if (skipped.length) lines.push(`檔名看不出是桔梗或時雨，已略過：${skipped.join('、')}`);
    setMessage({ text: lines.join(' '), error: failed.length > 0 || skipped.length > 0 });
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
    <p>每個主題可以放多張背景圖（最多 5 張，每次造訪隨機一張）、開場剪影（最多 3 張）與背景音樂（最多 8 首，依序播放）。檔案只存在你的 Cloudflare R2，不會進 GitHub。</p>
    <div className="wafu-media-toggles">
      {toggles.map((toggle) => <label key={toggle.key}><input type="checkbox" checked={prefs[toggle.key]} onChange={(event) => {
        const on = event.target.checked;
        setMediaPrefs({ [toggle.key]: on });
        if (toggle.key === 'sfx' && on && unlockAudio()) playSfx('pop', theme);
      }} /><span>{toggle.label}</span></label>)}
    </div>
    <div className="wafu-media-batch">
      <input ref={batchRef} className="visually-hidden" type="file" multiple accept="image/*,audio/*,.mp3,.m4a,.ogg,.wav,.flac,.zip,application/zip" tabIndex={-1} onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void uploadAll(files); }} />
      <button type="button" disabled={Boolean(busy) || batch} onClick={() => batchRef.current?.click()}>一次上傳全部</button>
      <small>可以直接選 zip 壓縮檔（例如和風素材.zip），或一次選多個檔案；依檔名放進對應欄位：含「桔梗」或「時雨」；含「剪影」的是剪影，音檔是背景音樂，其餘圖片是背景圖。</small>
    </div>
    {status === 'error' && <p className="wafu-media-note is-error" role="alert">{`無法讀取已上傳的檔案：${loadError}`}</p>}
    {themes.map((item) => <div key={item.id} className="wafu-media-theme">
      <h4>{item.label}</h4>
      {kinds.map((kind) => {
        const slots = themeSlots(kind.kind, item.id);
        const filled = slots.filter((slot) => assets[slot]);
        const free = slots.find((slot) => !assets[slot]) ?? null;
        // The uploaded files, then one empty row to add another while there is room.
        const shownSlots = [...filled, ...(free ? [free] : [])];
        return <div key={kind.kind} className="wafu-media-kind">
          {shownSlots.map((slot, index) => {
            const asset = assets[slot];
            const working = busy === slot;
            const adding = !asset && filled.length > 0;
            return <div key={slot} className={`wafu-media-row${adding ? ' is-add' : ''}`}>
              <div className={`wafu-media-thumb is-${kind.kind}`} aria-hidden="true">
                {asset && kind.kind !== 'bgm' ? <span style={{ [kind.kind === 'bg' || kind.kind === 'icon' ? 'backgroundImage' : 'maskImage']: `url("${asset.url}")`, ...(kind.kind === 'sil' ? { WebkitMaskImage: `url("${asset.url}")` } : {}) }} /> : <span>{adding ? '＋' : kind.kind === 'bgm' ? '♪' : '—'}</span>}
              </div>
              <div className="wafu-media-info">
                <b>{adding ? `新增${kind.label}` : `${kind.label}${filled.length > 1 || index > 0 ? ` ${index + 1}` : ''}`}</b>
                <small>{working ? '處理中…' : asset ? `${kind.kind === 'bgm' && asset.name ? `${asset.name} · ` : ''}${sizeLabel(asset.size)}` : adding ? `還可以放 ${assetSlotCount[kind.kind] - filled.length} 個${kind.kind === 'bgm' ? '（依序播放）' : '（每次造訪隨機選一張）'}` : kind.kind === 'sil' ? `未上傳 · ${item.sil}` : `未上傳 · ${kind.hint}`}</small>
              </div>
              <input ref={(element) => { inputs.current[slot] = element; }} className="visually-hidden" type="file" accept={kind.accept} tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(slot, file); }} />
              <button type="button" disabled={Boolean(busy) || batch} onClick={() => inputs.current[slot]?.click()}>{asset ? '更換' : '上傳'}</button>
              {asset && <button type="button" className="is-quiet" disabled={Boolean(busy) || batch} onClick={() => void remove(slot)}>移除</button>}
            </div>;
          })}
        </div>;
      })}
    </div>)}
    {message && <p className={`wafu-media-note${message.error ? ' is-error' : ''}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </section>;
}
