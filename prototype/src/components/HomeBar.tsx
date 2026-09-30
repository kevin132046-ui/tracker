import { useRef, useState } from "react";
import * as Dlg from "@radix-ui/react-dialog";
import MusicPanel, { useAudioState } from "./MusicDock";
import { playSfx } from "@/lib/audio";
import type { Lang } from "@/lib/wa";

export interface Section { id: string; label: string }
export type QuickAction = "add" | "import" | "ai" | "research" | "notify" | "settings";

/**
 * 底部引導條（像 iPhone 底部那條）：
 * 左右滑＝切換頁面區塊；點一下＝回到頂部；往上滑或長按＝快捷面板（新增交易、匯入、AI、研究、音樂…）。
 * 鍵盤：←／→ 切換、Enter 開快捷面板、Home 回頂部。可於設定關閉。
 */
export default function HomeBar({ lang, theme, sections, current, onGo, onAction, container }: {
  lang: Lang; theme: "kikyo" | "shigure"; sections: Section[]; current: string;
  onGo: (id: string) => void; onAction: (a: QuickAction) => void; container: HTMLElement | null;
}) {
  const ja = lang === "ja";
  const [sheet, setSheet] = useState(false);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const hold = useRef<number | null>(null);
  const { player } = useAudioState();
  const idx = Math.max(0, sections.findIndex((s) => s.id === current));
  const go = (d: number) => {
    const n = sections[(idx + d + sections.length) % sections.length];
    onGo(n.id);
    playSfx("pop", theme);
  };
  const openSheet = () => { setSheet(true); playSfx("open", theme); };
  const hint = drag && Math.abs(drag.dx) > 18 ? sections[(idx + (drag.dx < 0 ? 1 : -1) + sections.length) % sections.length].label : null;

  const actions: { k: QuickAction; zh: string; ja: string; ico: string }[] = [
    { k: "add", zh: "新增交易", ja: "取引を追加", ico: "＋" },
    { k: "import", zh: "匯入 CSV／截圖", ja: "CSV・画像取込", ico: "⇪" },
    { k: "ai", zh: "AI 助手", ja: "AI アシスタント", ico: "✦" },
    { k: "research", zh: "個股研究", ja: "銘柄リサーチ", ico: "◎" },
    { k: "notify", zh: "通知與休市", ja: "通知・休場", ico: "◔" },
    { k: "settings", zh: "設定", ja: "設定", ico: "⚙" },
  ];

  return (
    <>
      <div className="homebar" data-playing={player.playing || undefined}>
        {hint && <span className="homebar-hint">{hint}</span>}
        <button type="button" className="homebar-hit"
          aria-label={ja ? "クイックメニュー（左右スワイプでセクション切替、上スワイプでメニュー）" : "快捷列（左右滑切換區塊，往上滑開啟快捷面板）"}
          onPointerDown={(e) => {
            start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
            e.currentTarget.setPointerCapture(e.pointerId);
            hold.current = window.setTimeout(() => { hold.current = null; start.current = null; setDrag(null); openSheet(); }, 520);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
            if (Math.hypot(dx, dy) > 6 && hold.current) { clearTimeout(hold.current); hold.current = null; }
            setDrag({ dx, dy });
          }}
          onPointerUp={(e) => {
            if (hold.current) { clearTimeout(hold.current); hold.current = null; }
            const s = start.current;
            start.current = null;
            setDrag(null);
            if (!s) return;
            const dx = e.clientX - s.x, dy = e.clientY - s.y, dt = performance.now() - s.t;
            if (dy < -30 && Math.abs(dy) > Math.abs(dx)) openSheet();
            else if (Math.abs(dx) > 44) go(dx < 0 ? 1 : -1);
            else if (dt < 320 && Math.hypot(dx, dy) < 8) window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onPointerCancel={() => { if (hold.current) clearTimeout(hold.current); start.current = null; setDrag(null); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
            else if (e.key === "Home") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(); }
          }}>
          <span className="homebar-dots" aria-hidden="true">{sections.map((s) => <i key={s.id} className={s.id === current ? "on" : ""} />)}</span>
          <span className="homebar-pill" style={drag ? { translate: `${Math.max(-40, Math.min(40, drag.dx * 0.35))}px ${Math.max(-10, Math.min(0, drag.dy * 0.2))}px` } : undefined} />
        </button>
      </div>

      <Dlg.Root open={sheet} onOpenChange={(v) => { setSheet(v); if (!v) playSfx("close", theme); }}>
        <Dlg.Portal container={container ?? undefined}>
          <Dlg.Overlay className="modal-overlay" />
          <Dlg.Content className="quick-sheet" aria-describedby={undefined}>
            <span className="quick-grip" aria-hidden="true" />
            <Dlg.Title className="sr-only">{ja ? "クイックメニュー" : "快捷面板"}</Dlg.Title>
            <div className="quick-grid">
              {actions.map((a, k) => (
                <button key={a.k} type="button" style={{ ["--k" as string]: k }} onClick={() => { setSheet(false); onAction(a.k); }}>
                  <i aria-hidden="true">{a.ico}</i><span>{ja ? a.ja : a.zh}</span>
                </button>
              ))}
            </div>
            <div className="quick-sections">
              {sections.map((s) => <button key={s.id} type="button" className={`chip-btn${s.id === current ? " on" : ""}`} onClick={() => { setSheet(false); onGo(s.id); }}>{s.label}</button>)}
            </div>
            <MusicPanel lang={lang} theme={theme} compact />
          </Dlg.Content>
        </Dlg.Portal>
      </Dlg.Root>
    </>
  );
}
