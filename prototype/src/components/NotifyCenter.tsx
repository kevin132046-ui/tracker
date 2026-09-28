import { useMemo, useState } from "react";
import * as Pop from "@radix-ui/react-popover";
import { ANALYSES, EARNINGS, daysUntil, type Analysis } from "@/lib/alerts";
import { marketLabel, upcomingClosures } from "@/lib/calendar";
import { safeGet, safeSet, type Lang } from "@/lib/wa";

type Tab = "earnings" | "holiday";
const WD_ZH = ["日", "一", "二", "三", "四", "五", "六"], WD_JA = ["日", "月", "火", "水", "木", "金", "土"];
const md = (iso: string, lang: Lang) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${(lang === "ja" ? WD_JA : WD_ZH)[d.getUTCDay()]}）`;
};
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function analysisPrompt(a: Analysis, lang: Lang) {
  const facts = a.metrics.map((m) => `${m.k.zh}: ${m.v}${m.d ? `（${m.d}）` : ""}`).join("\n");
  return lang === "ja"
    ? `${a.title.ja}（${a.released} 発表、出典：${a.source.label}）。以下の公表数値だけを根拠に、投資家向けに要点・リスク・次回決算で確認すべき点を日本語で整理してください。\n${facts}`
    : `${a.title.zh}（${a.released} 公布，來源：${a.source.label}）。只根據以下公開數字，替持有者整理重點、風險，以及下次財報要確認的地方（繁體中文、條列）：\n${facts}`;
}

/** 頂欄通知中心：財報前提醒與財報解讀、提前一週的美日休市預告 */
export default function NotifyCenter({ lang, now, container, held, onAskAi }: {
  lang: Lang; now: Date; container: HTMLElement | null; held: string[]; onAskAi: (prompt: string) => void;
}) {
  const ja = lang === "ja";
  const today = localIso(now);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("earnings");
  const [remind, setRemind] = useState(() => safeGet("wa-remind") ?? "7,1");

  const closures = useMemo(() => upcomingClosures(today, 45), [today]);
  const soonClose = closures.filter((c) => c.inDays <= 7);
  const earnings = EARNINGS.filter((e) => held.includes(e.ticker)).map((e) => ({ ...e, inDays: daysUntil(e.date, now) })).filter((e) => e.inDays >= 0).sort((a, b) => a.inDays - b.inDays);
  const soonEarn = earnings.filter((e) => e.inDays <= 7);
  const badge = soonClose.length + soonEarn.length;

  // 頂欄摘要：7 天內的休市與財報（固定顯示最近一則，不輪播）
  const alerts = useMemo(() => {
    const out: { key: string; tag: string; text: string; tone: "alert" | "news" }[] = [];
    for (const c of soonClose) out.push({ key: c.date + c.market, tag: ja ? "休場" : "休市", tone: "alert", text: `${md(c.date, lang)} ${marketLabel(c.market, lang)}${c.kind === "early" ? (ja ? " 短縮取引" : " 提前收盤") : (ja ? " 休場" : " 休市")} · ${c.name[lang]}` });
    for (const e of soonEarn) out.push({ key: "e" + e.ticker, tag: ja ? "決算" : "財報", tone: "alert", text: `${e.ticker} ${md(e.date, lang)} ${e.when === "pre" ? (ja ? "寄り前" : "盤前") : (ja ? "引け後" : "盤後")}（${e.inDays} ${ja ? "日後" : "天後"}）` });
    if (!soonClose.length && closures[0]) out.push({ key: "nx", tag: ja ? "休場" : "休市", tone: "news", text: `${ja ? "次の休場" : "下個休市"} ${md(closures[0].date, lang)} ${marketLabel(closures[0].market, lang)} · ${closures[0].name[lang]}（${closures[0].inDays} ${ja ? "日後" : "天後"}）` });
    return out;
  }, [soonClose, soonEarn, closures, lang, ja]);

  const cur = alerts[0];
  const remindSet = new Set(remind.split(",").filter(Boolean));
  const toggleRemind = (d: string) => {
    const s = new Set(remindSet);
    if (s.has(d)) s.delete(d); else s.add(d);
    const v = [...s].sort((a, b) => +b - +a).join(",");
    setRemind(v); safeSet("wa-remind", v);
  };

  return (
    <Pop.Root open={open} onOpenChange={setOpen}>
      <Pop.Trigger asChild>
        <button type="button" className="ntc" aria-label={ja ? "通知センター" : "通知中心"}>
          <span className="ntc-dot" aria-hidden="true" />
          <span className="ntc-label">{ja ? "お知らせ" : "通知"}</span>
          {cur && (
            <span className="ntc-roll" key={cur.key}>
              <em className={`ntc-tag ${cur.tone}`}>{cur.tag}</em>
              <span className="ntc-text">{cur.text}</span>
            </span>
          )}
          <span className="ntc-bell" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
            {badge > 0 && <b>{badge}</b>}
          </span>
        </button>
      </Pop.Trigger>
      <Pop.Portal container={container ?? undefined}>
        <Pop.Content className="ntc-pop" sideOffset={10} align="center" collisionPadding={12}>
          <div className="ntc-head">
            <b>{ja ? "通知センター" : "通知中心"}</b>
            <div className="seg" role="tablist">
              {([["earnings", ja ? "決算" : "財報", earnings.length], ["holiday", ja ? "休場" : "休市", soonClose.length]] as const).map(([k, l, n]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{n ? <span className="ntc-n">{n}</span> : null}</button>
              ))}
            </div>
          </div>

          {tab === "earnings" && (
            <div className="ntc-body">
              <h5>{ja ? "今後の決算" : "即將公布"}</h5>
              <ul className="ntc-earn">
                {earnings.map((e) => (
                  <li key={e.ticker} className={e.inDays <= 7 ? "soon" : ""}>
                    <span className="ntc-tk">{e.ticker}</span>
                    <span className="ntc-item"><b>{md(e.date, lang)} · {e.when === "pre" ? (ja ? "寄り前" : "盤前") : (ja ? "引け後" : "盤後")} · {e.fq}</b>
                      <small>{e.inDays} {ja ? "日後" : "天後"}{e.estimated ? (ja ? " · 予定（未確定）" : " · 預估日期") : ""} · {ja ? "通知" : "提醒"} {[...remindSet].map((d) => `D-${d}`).join("、") || "—"}</small></span>
                  </li>
                ))}
              </ul>
              <div className="ntc-remind">
                <span>{ja ? "決算前の通知" : "財報前提醒"}</span>
                {["7", "3", "1"].map((d) => <button key={d} type="button" className={`chip-btn${remindSet.has(d) ? " on" : ""}`} aria-pressed={remindSet.has(d)} onClick={() => toggleRemind(d)}>D-{d}</button>)}
              </div>
              <h5>{ja ? "決算の読み解き" : "財報解讀"}</h5>
              {ANALYSES.filter((a) => held.includes(a.ticker)).map((a) => (
                <article key={a.ticker} className="ntc-ana">
                  <header><b>{a.title[lang]}</b><small>{a.released} · <a href={a.source.url} target="_blank" rel="noopener noreferrer">{a.source.label} ↗</a></small></header>
                  <div className="ntc-metrics">
                    {a.metrics.map((m) => <div key={m.k.zh} className={m.good ? "good" : ""}><span>{m.k[lang]}</span><b>{m.v}</b>{m.d && <small>{m.d}</small>}</div>)}
                  </div>
                  <ul className="ntc-points">{a.points.map((p, k) => <li key={k}>{p[lang]}</li>)}</ul>
                  <p className="ntc-watch"><b>{ja ? "次に見る点" : "接下來觀察"}</b>{a.watch.map((w) => w[lang]).join(" ／ ")}</p>
                  <button type="button" className="btn ghost wide" onClick={() => { setOpen(false); onAskAi(analysisPrompt(a, lang)); }}>✦ {ja ? "AI にさらに読み解いてもらう" : "請 AI 深入解讀"}</button>
                </article>
              ))}
              <p className="ntc-note">{ja ? "本番：決算発表後に SEC EDGAR（8-K の Ex.99.1 と 10-Q）を自動取得し、設定した AI が要点を整理します。" : "正式站：財報公布後自動從 SEC EDGAR 抓取 8-K（Ex.99.1 新聞稿）與 10-Q，交給設定中的 AI 整理重點與論述。"}</p>
            </div>
          )}

          {tab === "holiday" && (
            <div className="ntc-body">
              <ul className="ntc-hol">
                {closures.map((c) => (
                  <li key={c.date + c.market} className={c.inDays <= 7 ? "soon" : ""}>
                    <span className={`ntc-mk ${c.market}`}>{marketLabel(c.market, lang)}</span>
                    <span className="ntc-item"><b>{md(c.date, lang)} · {c.name[lang]}</b><small>{c.kind === "early" ? (ja ? "短縮取引（13:00 ET 終了）" : "提前收盤（美東 13:00）") : (ja ? "終日休場" : "全日休市")} · {c.inDays === 0 ? (ja ? "今日" : "今天") : `${c.inDays} ${ja ? "日後" : "天後"}`}</small></span>
                  </li>
                ))}
                {!closures.length && <li className="empty">{ja ? "45 日以内の休場はありません" : "未來 45 天沒有休市"}</li>}
              </ul>
              <p className="ntc-note">{ja ? "7 日前から上部に予告を表示。NYSE／JPX の公式カレンダーと照合済み（2026–2027）。" : "休市日前 7 天起在頂欄預告；已對照 NYSE 與 JPX 官方 2026–2027 年表。"}</p>
            </div>
          )}
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}

/** 品牌列下方的「一週內休市」小標籤 */
export function ClosureHint({ lang, now }: { lang: Lang; now: Date }) {
  const soon = upcomingClosures(localIso(now), 8).filter((c) => c.inDays <= 7);
  if (!soon.length) return null;
  const c = soon[0];
  return <span className="closure-hint" title={soon.map((x) => `${x.date} ${marketLabel(x.market, lang)} ${x.name[lang]}`).join("\n")}>⚑ {md(c.date, lang)} {marketLabel(c.market, lang)}{c.kind === "early" ? (lang === "ja" ? "短縮" : "提前收盤") : (lang === "ja" ? "休場" : "休市")}</span>;
}
