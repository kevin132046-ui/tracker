import { useEffect, useReducer, useRef } from "react";
import { audioPrefs, player, setSfx, subscribeAudio, unlockAudio, playSfx } from "@/lib/audio";
import type { Lang } from "@/lib/wa";

export function useAudioState() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeAudio(force), []);
  return { player, prefs: audioPrefs };
}

/** 音樂面板：原創 BGM、自己的音檔（OST 等，只在本機播放）、音效開關 */
export default function MusicPanel({ lang, theme, compact = false }: { lang: Lang; theme: "kikyo" | "shigure"; compact?: boolean }) {
  const ja = lang === "ja";
  const { player: p, prefs } = useAudioState();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { player.preferTheme(theme); }, [theme]);
  const cur = p.current;
  return (
    <div className={`music${compact ? " compact" : ""}`}>
      <div className={`music-now${p.playing ? " is-playing" : ""}`}>
        <div className="eq" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="music-meta">
          <b>{ja ? cur?.titleJa : cur?.title}</b>
          <small>{p.error === "blocked" ? (ja ? "ブラウザが自動再生を止めました。もう一度押してください。" : "瀏覽器擋下自動播放，請再按一次播放。") : p.error === "load" ? (ja ? "音源を読み込めませんでした。" : "音檔讀取失敗。") : cur?.note}</small>
        </div>
        <div className="music-ctl">
          <button type="button" className="icon-btn" aria-label={ja ? "前の曲" : "上一首"} onClick={() => { unlockAudio(); p.prev(); }}>⏮</button>
          <button type="button" className="icon-btn big" aria-label={p.playing ? (ja ? "一時停止" : "暫停") : (ja ? "再生" : "播放")} onClick={() => { unlockAudio(); p.toggle(); }}>{p.playing ? "⏸" : "▶"}</button>
          <button type="button" className="icon-btn" aria-label={ja ? "次の曲" : "下一首"} onClick={() => { unlockAudio(); p.next(); }}>⏭</button>
        </div>
      </div>
      <label className="music-vol">
        <span>{ja ? "音量" : "音量"}</span>
        <input type="range" min={0} max={1} step={0.01} value={prefs.volume} onChange={(e) => p.setVolume(Number(e.target.value))} aria-label={ja ? "音量" : "音量"} />
      </label>
      {!compact && (
        <>
          <ul className="music-list">
            {p.tracks.map((t, i) => (
              <li key={t.id} className={i === p.index ? "on" : ""}>
                <button type="button" onClick={() => { unlockAudio(); void p.play(i); }}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="t"><b>{ja ? t.titleJa : t.title}</b><small>{t.note}</small></span>
                </button>
                {t.user && <button type="button" className="icon-btn" aria-label={ja ? "削除" : "移除"} onClick={() => p.remove(t.id)}>×</button>}
              </li>
            ))}
          </ul>
          <div className="music-actions">
            <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>＋ {ja ? "自分の音源（OST など）" : "加入我的音檔（OST 等）"}</button>
            <input ref={fileRef} type="file" accept="audio/*" multiple className="sr-only" onChange={(e) => { if (e.target.files) p.addFiles(e.target.files); e.target.value = ""; }} />
          </div>
          <p className="muted small">{ja ? "内蔵曲はオリジナル作曲（BA 風の作曲ルールに基づく）。自分の音源はこの端末内だけで再生され、アップロードされません。" : "內建曲為原創作曲（依 BA 配樂風格規則，不使用原曲旋律）。你加入的音檔只在這台裝置播放，不會上傳。"}</p>
        </>
      )}
      <label className="switch-row" htmlFor="sfx-toggle">
        <span>{ja ? "オープニングと操作の効果音" : "開場與介面音效"}</span>
        <input id="sfx-toggle" type="checkbox" checked={prefs.sfx} onChange={(e) => { setSfx(e.target.checked); if (e.target.checked && unlockAudio()) playSfx("pop", theme); }} />
        <i className="switch" aria-hidden="true" />
      </label>
    </div>
  );
}
