import { useEffect, useRef, useState } from "react";
import * as Dlg from "@radix-ui/react-dialog";
import HaloIcon from "./HaloIcon";
import { aiPrefs, errorCopy, getSample, type SampleErrorLike, type SampleFn } from "@/lib/ai";
import type { Lang } from "@/lib/wa";

interface Msg { role: "user" | "assistant"; content: string; error?: boolean }

/**
 * AI 助手（右側抽屜）：以頁面資料為背景即時問答，可解讀財報、檢查風險、解釋 ROC 計算。
 * 原型使用 claude.ai 頁面內建的 Claude；觀看者第一次發問時會被詢問是否允許（使用自己的額度）。
 */
export default function Assistant({ open, onOpenChange, lang, theme, container, context, seed, onSeedUsed }: {
  open: boolean; onOpenChange: (v: boolean) => void; lang: Lang; theme: "kikyo" | "shigure";
  container: HTMLElement | null; context: string; seed?: string | null; onSeedUsed?: () => void;
}) {
  const ja = lang === "ja";
  const [sample, setSample] = useState<SampleFn | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open && sample === undefined) void getSample().then(setSample); }, [open, sample]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);
  useEffect(() => {
    if (open && seed && sample && !busy) { onSeedUsed?.(); void send(seed); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed, sample]);

  const rules = [
    ja ? "あなたは個人の株式・オプション管理サイト「OptionFlow」のアシスタントです。日本語で簡潔に答えてください。"
       : "你是個人股票／選擇權追蹤網站「OptionFlow」的助手，請用繁體中文、精簡條列回答。",
    ja ? "以下はページのデータです（サンプル価格を含む）。数字はこのデータに基づき、推測は推測と明記してください。投資の最終判断はユーザーに委ね、断定的な売買推奨はしないでください。"
       : "以下是頁面上的資料（價格含示範值）。數字以這些資料為準，推測要標明是推測；不要給斷定的買賣建議，最後決定交給使用者。",
    context,
  ].join("\n\n");

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !sample) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    const c = new AbortController();
    ctl.current = c;
    // 只帶最近 10 則，指示那一則永遠保留在最前面
    const turns = next.filter((m) => !m.error).slice(-10).map(({ role, content }) => ({ role, content }));
    try {
      const { text: answer, truncated } = await sample([{ role: "user", content: rules }, ...turns], {
        cache: false, signal: c.signal, modelTier: deep ? "default" : "quick",
        onText: ({ text: t }: { text: string }) => setMsgs([...next, { role: "assistant", content: t }]),
      });
      setMsgs([...next, { role: "assistant", content: answer + (truncated ? (ja ? "\n\n（回答が途中で切れました）" : "\n\n（回答被截斷）") : "") }]);
    } catch (err) {
      const e = err as SampleErrorLike;
      if (e.code === "cancelled") setMsgs([...next, { role: "assistant", content: e.text || (ja ? "（停止しました）" : "（已停止）") }]);
      else {
        if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled"].includes(e.code)) setBlocked(true);
        setMsgs([...next, { role: "assistant", content: (e.text ? e.text + "\n\n" : "") + errorCopy(e.code, lang), error: true }]);
      }
    } finally {
      setBusy(false);
      ctl.current = null;
    }
  }

  const chips = ja
    ? ["ポートフォリオのリスクは？", "NVDA の最新決算を読み解いて", "来週の休場と決算は？", "KO のプット売りの年率リターンの計算方法"]
    : ["我的組合風險在哪？", "解讀 NVDA 最新財報", "下週有哪些休市與財報？", "KO 賣 PUT 的年化報酬怎麼算？"];
  const providerNote = aiPrefs.provider === "claude"
    ? (ja ? "このページ内蔵の Claude（あなたの Claude アカウントで実行）" : "使用此頁內建的 Claude（以你的 Claude 帳號執行）")
    : (ja ? `正式サイトでは ${aiPrefs.provider === "openai" ? "OpenAI" : "Anthropic"} API を使用（プロトタイプは内蔵 Claude で代替）` : `正式站會改用 ${aiPrefs.provider === "openai" ? "OpenAI" : "Anthropic"} API（原型先以內建 Claude 代替）`);

  return (
    <Dlg.Root open={open} onOpenChange={onOpenChange}>
      <Dlg.Portal container={container ?? undefined}>
        <Dlg.Overlay className="modal-overlay" />
        <Dlg.Content className="modal sheet ai-sheet" aria-describedby={undefined}>
          <div className="modal-head">
            <Dlg.Title className="ai-title"><HaloIcon theme={theme} size={26} /> {ja ? "AI アシスタント" : "AI 助手"}</Dlg.Title>
            <Dlg.Close className="icon-btn" aria-label={ja ? "閉じる" : "關閉"}>×</Dlg.Close>
          </div>
          <p className="ai-provider">{providerNote}</p>
          <div className="ai-list" ref={listRef} aria-live="polite">
            {msgs.length === 0 && (
              <div className="ai-empty">
                <p>{ja ? "ポートフォリオ、決算、休場日、ROC の計算について質問できます。" : "可以問組合風險、財報重點、休市日、ROC 計算等問題。"}</p>
                <div className="ai-chips">{chips.map((c) => <button key={c} type="button" className="chip-btn" disabled={!sample || busy} onClick={() => void send(c)}>{c}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}${m.error ? " err" : ""}`}>
                {m.role === "assistant" && m.content === "" ? <span className="ai-thinking">{ja ? "考えています" : "思考中"}<i /><i /><i /></span> : m.content}
              </div>
            ))}
          </div>
          {sample === null || blocked ? (
            <p className="ai-off">{ja ? "このビューでは内蔵 Claude を利用できません。正式サイトでは設定の OpenAI／Anthropic API キーで動作します。" : "這個檢視無法使用內建 Claude。正式站可在設定改用 OpenAI／Anthropic API 金鑰。"}</p>
          ) : (
            <form className="ai-form" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
              <textarea value={draft} rows={2} placeholder={ja ? "質問を入力（Enter で送信、Shift+Enter で改行）" : "輸入問題（Enter 送出，Shift+Enter 換行）"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }} />
              <div className="ai-actions">
                <label className="mini-switch"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /><i />{ja ? "じっくり" : "深入思考"}</label>
                {busy
                  ? <button type="button" className="btn ghost" onClick={() => ctl.current?.abort()}>{ja ? "停止" : "停止"}</button>
                  : <button type="submit" className="btn primary" disabled={!sample || !draft.trim()}>{ja ? "送信" : "送出"}</button>}
              </div>
            </form>
          )}
        </Dlg.Content>
      </Dlg.Portal>
    </Dlg.Root>
  );
}
