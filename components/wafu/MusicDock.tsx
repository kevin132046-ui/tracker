'use client';

import { useEffect, useRef, useState } from 'react';
import { useWafuAssets } from '@/lib/wafu/assets';
import { getMediaPrefs, useMediaPrefs } from '@/lib/wafu/media';
import { next, play, setTracks, setVolume, stop, toggle, useMusic } from '@/lib/wafu/music';
import { unlockAudio } from '@/lib/wafu/sfx';
import type { WafuTheme } from '@/lib/wafu/theme';

const note = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>;

/**
 * Top-bar music button (和風 only): plays the uploaded track of each theme. Nothing plays until you
 * press play; if music was on last time it resumes on your first tap or key press.
 */
export default function MusicDock({ theme }: { theme: WafuTheme }) {
  const { assets } = useWafuAssets();
  const prefs = useMediaPrefs();
  const music = useMusic();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setTracks(assets, theme); }, [assets, theme]);
  // Leaving the 和風 page or hiding the dock stops the sound.
  useEffect(() => () => stop(), []);

  // Browsers only start audio from a gesture, so a remembered "music on" waits for the first one.
  const hasTracks = music.tracks.length > 0;
  useEffect(() => {
    if (!hasTracks || !getMediaPrefs().bgm) return;
    const start = () => { unlockAudio(); void play(); remove(); };
    const remove = () => { window.removeEventListener('pointerdown', start, true); window.removeEventListener('keydown', start, true); };
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('keydown', start, true);
    return remove;
  }, [hasTracks]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const current = music.current;
  const status = music.error === 'blocked' ? '瀏覽器擋下自動播放，請再按一次播放。'
    : music.error === 'load' ? '音檔讀取失敗。'
    : !hasTracks ? '還沒有音樂：到「設定 → 和風背景與音樂」上傳。'
    : music.playing ? '播放中' : '已暫停';

  return <div className={`wafu-music${music.playing ? ' is-playing' : ''}`} ref={rootRef}>
    <button type="button" className="wafu-music-toggle" aria-expanded={open} aria-haspopup="dialog" aria-label="背景音樂" title="背景音樂" onClick={() => setOpen((value) => !value)}>
      {music.playing ? <span className="wafu-eq" aria-hidden="true"><i /><i /><i /><i /></span> : note}
    </button>
    {open && <div className="wafu-music-panel" role="dialog" aria-label="背景音樂">
      <div className="wafu-music-now">
        <span className="wafu-eq" aria-hidden="true"><i /><i /><i /><i /></span>
        <div><b>{current?.title ?? '背景音樂'}</b><small>{status}</small></div>
        <button type="button" className="wafu-music-play" disabled={!hasTracks} aria-label={music.playing ? '暫停' : '播放'} onClick={() => { unlockAudio(); toggle(); }}>{music.playing ? '❚❚' : '▶'}</button>
        {music.tracks.length > 1 && <button type="button" className="wafu-music-next" aria-label="下一首" onClick={() => { unlockAudio(); next(); }}>⏭</button>}
      </div>
      <label className="wafu-music-volume"><span>音量</span><input type="range" min={0} max={1} step={0.01} value={prefs.volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="音量" /></label>
    </div>}
  </div>;
}
