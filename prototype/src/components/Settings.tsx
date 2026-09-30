import { useState } from "react";
import * as Dlg from "@radix-ui/react-dialog";
import { Crest } from "./Marks";
import HaloIcon from "./HaloIcon";
import MusicPanel from "./MusicDock";
import { aiPrefs, saveAiPrefs, type Provider } from "@/lib/ai";
import { DIVIDENDS } from "@/lib/alerts";
import { THEMES, t, type ThemeId, type ThemePref } from "@/lib/theme";
import { safeGet, safeSet, usd, type Lang } from "@/lib/wa";
import { LITE_AUTO_KEY, LITE_DETECTED_KEY } from "./Opening";

type Tab = "look" | "sound" | "ai" | "modules" | "data";

export interface SettingsProps {
  open: boolean; onOpenChange: (v: boolean) => void; lang: Lang; pref: ThemePref; theme: ThemeId; onPref: (p: ThemePref) => void;
  introOn: boolean; onIntro: (v: boolean) => void; onReplay: () => void; customBg: string | null; onClearBg: () => void;
  homebar: boolean; onHomebar: (v: boolean) => void; container: HTMLElement | null; onImport: () => void; onAssistant: () => void; now: Date;
}

function Switch({ id, label, desc, checked, onChange }: { id: string; label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row" htmlFor={id}>
      <span>{label}{desc && <small>{desc}</small>}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i className="switch" aria-hidden="true" />
    </label>
  );
}

/** 設定：外觀／音樂與音效／AI 助手／擴充模組／資料匯入。側邊抽屜以彈簧動畫滑入，內容依序浮現。 */
export default function Settings(p: SettingsProps) {
  const { lang } = p;
  const ja = lang === "ja";
  const [tab, setTab] = useState<Tab>("look");
  const [liteAuto, setLiteAuto] = useState(() => safeGet(LITE_AUTO_KEY) !== "0");
  const [ai, setAi] = useState({ ...aiPrefs });
  const [hub, setHub] = useState(() => safeGet("wa-mod-hub") === "1");
  const [div, setDiv] = useState(() => safeGet("wa-mod-div") !== "0");
  const [usTax, setUsTax] = useState(() => Number(safeGet("wa-tax-us") ?? "30"));
  const [jpTax, setJpTax] = useState(() => Number(safeGet("wa-tax-jp") ?? "15.315"));
  const [credit, setCredit] = useState<"pay" | "ex">(() => (safeGet("wa-div-credit") === "ex" ? "ex" : "pay"));
  const setAiP = (v: Partial<typeof ai>) => { const n = { ...ai, ...v }; setAi(n); saveAiPrefs(v); };
  const todayIso = `${p.now.getFullYear()}-${String(p.now.getMonth() + 1).padStart(2, "0")}-${String(p.now.getDate()).padStart(2, "0")}`;

  const tabs: { k: Tab; zh: string; ja: string }[] = [
    { k: "look", zh: "外觀", ja: "外観" }, { k: "sound", zh: "音樂", ja: "音楽" }, { k: "ai", zh: "AI", ja: "AI" },
    { k: "modules", zh: "模組", ja: "モジュール" }, { k: "data", zh: "資料", ja: "データ" },
  ];
  const themeOpts: { v: ThemePref; name: string; desc: string }[] = [
    { v: "random", name: t("themeRandom", lang), desc: ja ? "開くたびに桔梗／時雨をランダムに" : "每次開啟網頁在桔梗／時雨間隨機切換" },
    { v: "kikyo", name: "桔梗 · 夜墨紺碧", desc: ja ? "障子と猫又、光輪の粒子" : "障子拉門、貓又剪影、光環粒子" },
    { v: "shigure", name: "時雨 · 雪夜湯宿", desc: ja ? "暖簾と雪、行灯のぬくもり" : "長暖簾、落雪、行燈暖光" },
  ];
  const divRows = DIVIDENDS.map((d) => {
    const gross = d.perShare * d.shares;
    const net = gross * (1 - (d.currency === "USD" ? usTax : jpTax) / 100);
    const on = credit === "pay" ? d.payDate : d.exDate;
    return { ...d, gross, net, credited: on <= todayIso, on };
  });
  const pending = divRows.filter((r) => !r.credited).reduce((a, r) => a + r.net, 0);
  const credited = divRows.filter((r) => r.credited).reduce((a, r) => a + r.net, 0);

  return (
    <Dlg.Root open={p.open} onOpenChange={p.onOpenChange}>
      <Dlg.Portal container={p.container ?? undefined}>
        <Dlg.Overlay className="modal-overlay settings-overlay" />
        <Dlg.Content className="modal sheet settings-sheet" aria-describedby={undefined}>
          <div className="modal-head">
            <Dlg.Title className="settings-title"><HaloIcon theme={p.theme} size={28} /> {t("settings", lang)}</Dlg.Title>
            <Dlg.Close className="icon-btn" aria-label={ja ? "閉じる" : "關閉"}>×</Dlg.Close>
          </div>
          <div className="settings-tabs" role="tablist">
            {tabs.map((x) => <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} className={tab === x.k ? "on" : ""} onClick={() => setTab(x.k)}>{ja ? x.ja : x.zh}</button>)}
          </div>
          <div className="settings" key={tab}>
            {tab === "look" && (
              <>
                <section style={{ ["--i" as string]: 0 }}>
                  <h4>{t("theme", lang)}</h4>
                  <div className="theme-opts" role="radiogroup" aria-label={t("theme", lang)}>
                    {themeOpts.map((o) => (
                      <button key={o.v} type="button" role="radio" aria-checked={p.pref === o.v} className={`theme-opt${p.pref === o.v ? " on" : ""}`} onClick={() => p.onPref(o.v)}>
                        <span className="theme-swatch" data-s={o.v}>{o.v !== "random" ? <Crest theme={o.v} size={26} /> : "隨"}</span>
                        <span><b>{o.name}</b><small>{o.desc}</small></span>
                      </button>
                    ))}
                  </div>
                  <p className="muted small">{ja ? "現在：" : "目前："}{THEMES[p.theme].title.join("")}</p>
                </section>
                <section style={{ ["--i" as string]: 1 }}>
                  <h4>{ja ? "オープニング" : "開場動畫"}</h4>
                  <Switch id="intro-toggle" label={t("introToggle", lang)} checked={p.introOn} onChange={p.onIntro} />
                  <Switch id="intro-lite-toggle" label={ja ? "動作が重いときは軽量版にする" : "電腦較慢時自動改用輕量開場"}
                    desc={ja ? "開始直後が重い場合、水墨の流体演出を省きます" : "開場前段若畫面不順，就省略水墨流體效果"}
                    checked={liteAuto} onChange={(v) => { setLiteAuto(v); safeSet(LITE_AUTO_KEY, v ? "1" : "0"); if (!v) safeSet(LITE_DETECTED_KEY, "0"); }} />
                  <button type="button" className="btn ghost wide" onClick={p.onReplay}>{t("replay", lang)}</button>
                </section>
                <section style={{ ["--i" as string]: 2 }}>
                  <h4>{ja ? "ホームバー" : "底部引導條"}</h4>
                  <Switch id="homebar-toggle" label={ja ? "画面下部のバーを表示" : "顯示底部引導條"}
                    desc={ja ? "左右スワイプでセクション切替、タップで先頭へ、上スワイプでクイックメニュー" : "左右滑切換區塊、點一下回頂部、往上滑開快捷面板"} checked={p.homebar} onChange={p.onHomebar} />
                </section>
                <section style={{ ["--i" as string]: 3 }}>
                  <h4>{t("background", lang)}</h4>
                  <p className="muted small">{ja ? "左のメニュー「背景」から画像を選べます。" : "可從左側「背景」上傳自訂圖片，會取代主題背景。"}</p>
                  {p.customBg && <button type="button" className="btn ghost wide" onClick={p.onClearBg}>{ja ? "テーマ背景に戻す" : "恢復主題背景"}</button>}
                </section>
              </>
            )}

            {tab === "sound" && (
              <section style={{ ["--i" as string]: 0 }}>
                <h4>{ja ? "音楽と効果音" : "音樂與音效"}</h4>
                <MusicPanel lang={lang} theme={p.theme} />
              </section>
            )}

            {tab === "ai" && (
              <>
                <section style={{ ["--i" as string]: 0 }}>
                  <h4>{ja ? "AI プロバイダー" : "AI 提供者"}</h4>
                  <div className="theme-opts" role="radiogroup">
                    {([
                      ["claude", ja ? "Claude（このページ内蔵）" : "Claude（此頁內建）", ja ? "閲覧者自身の Claude アカウントで実行。キー不要。" : "以你自己的 Claude 帳號執行，不需金鑰。"],
                      ["openai", "OpenAI API", ja ? "正式サイト用。キーはサーバー（Cloudflare Secret）に保存。" : "正式站用；金鑰存在伺服器（Cloudflare Secret）。"],
                      ["anthropic", "Anthropic API", ja ? "正式サイト用。キーはサーバー（Cloudflare Secret）に保存。" : "正式站用；金鑰存在伺服器（Cloudflare Secret）。"],
                    ] as [Provider, string, string][]).map(([v, name, desc]) => (
                      <button key={v} type="button" role="radio" aria-checked={ai.provider === v} className={`theme-opt${ai.provider === v ? " on" : ""}`} onClick={() => setAiP({ provider: v })}>
                        <span className="theme-swatch">{v === "claude" ? "✦" : v === "openai" ? "◎" : "A"}</span>
                        <span><b>{name}</b><small>{desc}</small></span>
                      </button>
                    ))}
                  </div>
                  {ai.provider !== "claude" && (
                    <div className="ai-keys">
                      <label className="field"><span>{ja ? "モデル" : "模型"}</span><input value={ai.model} placeholder={ai.provider === "openai" ? "gpt-…" : "claude-…"} onChange={(e) => setAiP({ model: e.target.value })} /></label>
                      <label className="field"><span>{ja ? "API キー" : "API 金鑰"}</span><input type="password" autoComplete="off" value={ai.key} placeholder="sk-…" onChange={(e) => setAiP({ key: e.target.value })} /></label>
                      <p className="warn small">{ja ? "プロトタイプでは外部 API に接続できないため、キーはこのブラウザにのみ保存され送信されません。正式サイトではサーバー側の Secret に保存し、ブラウザには置きません。" : "原型不能連外，金鑰只存在這個瀏覽器、不會送出。正式站會改存 Cloudflare Secret，由 /api/ai 代呼叫，不放在瀏覽器。"}</p>
                    </div>
                  )}
                </section>
                <section style={{ ["--i" as string]: 1 }}>
                  <h4>{ja ? "自動化" : "自動化功能"}</h4>
                  <Switch id="ai-earn" label={ja ? "決算後に自動で読み解く" : "財報公布後自動解讀"} desc={ja ? "SEC EDGAR の 8-K／10-Q を取得して要点を整理" : "自動抓 SEC EDGAR 8-K／10-Q，整理重點並論述"} checked={ai.autoEarnings} onChange={(v) => setAiP({ autoEarnings: v })} />
                  <button type="button" className="btn primary wide" onClick={p.onAssistant}>✦ {ja ? "AI アシスタントを開く" : "開啟 AI 助手"}</button>
                </section>
              </>
            )}

            {tab === "modules" && (
              <>
                <section className="mod-card" style={{ ["--i" as string]: 0 }}>
                  <header><span className="mod-ico">◎</span><div><small>OPTIONAL MODULE</small><b>{ja ? "証券会社横断の資産管理とリバランス" : "跨券商資產追蹤與再平衡"}</b></div><em>{hub ? (ja ? "有効" : "已開啟") : (ja ? "既定オフ" : "預設關閉")}</em></header>
                  <p className="muted small">{ja ? "複数口座の手動ポジションを一つにまとめ、USD／JPY の平均やリバランス案を表示。オフの間は読み込みも計算もしません。" : "把不同券商的手動部位聚合成一張全景，提供 USD／JPY 平均檢視、偏離診斷、只買不賣試算與待辦；關閉時不載入、不計算。"}</p>
                  <Switch id="mod-hub" label={ja ? "有効にする" : "開啟模組"} checked={hub} onChange={(v) => { setHub(v); safeSet("wa-mod-hub", v ? "1" : "0"); }} />
                </section>
                <section className="mod-card" style={{ ["--i" as string]: 1 }}>
                  <header><span className="mod-ico">$</span><div><small>CASH AUTOMATION</small><b>{ja ? "外国人の配当課税と現金入金" : "外國投資人股息稅與現金入帳"}</b></div><em>{div ? (ja ? "有効" : "已開啟") : (ja ? "オフ" : "關閉")}</em></header>
                  <p className="muted small">{ja ? "除権日の保有株数で税引後配当を計算し、支払日に USD／JPY 現金へ入金します。" : "依除息日的持股數計算稅後股息，並在「發放日」才加入 USD／JPY 現金（不再於除息日提前入帳）。"}</p>
                  <div className="tax-grid">
                    <label className="field"><span>{ja ? "米国株 源泉税率" : "美股預扣稅率"}</span><div className="suffix"><input type="number" min={0} max={50} step={0.001} value={usTax} onChange={(e) => { const v = Number(e.target.value); setUsTax(v); safeSet("wa-tax-us", String(v)); }} /><i>%</i></div></label>
                    <label className="field"><span>{ja ? "日本株 源泉税率" : "日股預扣稅率"}</span><div className="suffix"><input type="number" min={0} max={50} step={0.001} value={jpTax} onChange={(e) => { const v = Number(e.target.value); setJpTax(v); safeSet("wa-tax-jp", String(v)); }} /><i>%</i></div></label>
                  </div>
                  <div className="seg credit-seg" role="radiogroup" aria-label={ja ? "入金タイミング" : "入帳時點"}>
                    <button type="button" role="radio" aria-checked={credit === "pay"} className={credit === "pay" ? "on" : ""} onClick={() => { setCredit("pay"); safeSet("wa-div-credit", "pay"); }}>{ja ? "支払日に入金" : "發放日入帳"}</button>
                    <button type="button" role="radio" aria-checked={credit === "ex"} className={credit === "ex" ? "on" : ""} onClick={() => { setCredit("ex"); safeSet("wa-div-credit", "ex"); }}>{ja ? "除権日に計上" : "除息日入帳"}</button>
                  </div>
                  <table className="div-table">
                    <thead><tr><th>{ja ? "銘柄" : "標的"}</th><th>{ja ? "除権日" : "除息日"}</th><th>{ja ? "支払日" : "發放日"}</th><th className="r">{ja ? "税引後" : "稅後"}</th><th>{ja ? "状態" : "狀態"}</th></tr></thead>
                    <tbody>
                      {divRows.map((r) => (
                        <tr key={r.ticker + r.exDate}><td><b>{r.ticker}</b><small>{r.shares} {ja ? "株" : "股"} × ${r.perShare}</small></td><td>{r.exDate.slice(5)}</td><td>{r.payDate.slice(5)}</td><td className="r">{usd(r.net)}</td><td>{r.credited ? <span className="pill ok">{ja ? "入金済" : "已入帳"}</span> : <span className="pill">{ja ? "予定" : "待入帳"}</span>}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">{ja ? `入金済 ${usd(credited)}・予定 ${usd(pending)}。本番は 8-K／配当発表から支払日を取得。` : `已入帳 ${usd(credited)}・待入帳 ${usd(pending)}。正式站由公司股息公告（8-K／新聞稿）與配息資料取得發放日。`}</p>
                  <Switch id="mod-div" label={ja ? "有効にする" : "開啟模組"} checked={div} onChange={(v) => { setDiv(v); safeSet("wa-mod-div", v ? "1" : "0"); }} />
                </section>
              </>
            )}

            {tab === "data" && (
              <section style={{ ["--i" as string]: 0 }}>
                <h4>{ja ? "取引の取り込み" : "匯入交易"}</h4>
                <p className="muted small">{ja ? "CSV（証券会社の履歴・自作表）の読み込み、または証券アプリのスクリーンショットを AI で認識して取り込みます。" : "讀取 CSV（券商成交紀錄或自製表格），或把券商 App 的截圖交給 AI 辨識後匯入；匯入前都會先預覽逐列確認。"}</p>
                <button type="button" className="btn primary wide" onClick={p.onImport}>⇪ {ja ? "CSV・画像を取り込む" : "匯入 CSV／截圖"}</button>
              </section>
            )}
          </div>
        </Dlg.Content>
      </Dlg.Portal>
    </Dlg.Root>
  );
}
