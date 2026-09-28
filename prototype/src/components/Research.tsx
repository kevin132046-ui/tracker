import { useCallback, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import * as Dlg from "@radix-ui/react-dialog";
import { RIcon } from "@/components/research/common";
import { TechView, type TechSettings } from "@/components/research/TechView";
import { FundView, type FundSettings } from "@/components/research/FundView";
import { DcfView } from "@/components/research/DcfView";
import {
  currencyOf, defaultDcf, fmtPrice, fmtSignedPct, fmtSignedPrice, fundamentalsFor, tr,
  type DcfInputs, type RLang,
} from "@/lib/research";

export interface ResearchPosition { id: string; ticker: string; name: string; kind: "stock" | "option" | "cash"; price: number; cost: number; qty: number; sector?: string }

type Tab = "tech" | "fund" | "dcf";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticker: string | null;
  tickers: ResearchPosition[];
  onTicker: (t: string) => void;
  lang: "zh" | "ja";
  theme: "kikyo" | "shigure";
  container: HTMLElement | null;
  initialTab?: "tech" | "fund" | "dcf";
}

const TABS: { k: Tab; zh: string; ja: string }[] = [
  { k: "tech", zh: "技術走勢", ja: "テクニカル" },
  { k: "fund", zh: "財務品質", ja: "ファンダメンタルズ" },
  { k: "dcf", zh: "DCF 估值", ja: "DCF 評価" },
];

const DEFAULT_TECH: TechSettings = { range: "6mo", from: "", to: "", mode: "line", overlays: { boll: false, ma20: true, ma50: false, ma200: false } };
const DEFAULT_FUND: FundSettings = { metric: "freeCashFlow", period: "q", kind: "bar" };

/**
 * 個股研究：技術走勢／財務品質／DCF 估值。
 * 桌機為右側大型抽屜（min(1100px, 94vw)），手機（≤760px）為全螢幕；Esc、點背景或關閉鈕可關閉。
 * 標的可由父層控制（ticker＋onTicker），父層不處理 onTicker 時也會在內部切換。
 */
export default function ResearchSheet(props: {
  open: boolean; onOpenChange: (v: boolean) => void;
  ticker: string | null;
  tickers: ResearchPosition[];
  onTicker: (t: string) => void;
  lang: "zh" | "ja"; theme: "kikyo" | "shigure";
  container: HTMLElement | null;
  initialTab?: "tech" | "fund" | "dcf";
}): JSX.Element {
  const { open, onOpenChange, ticker, initialTab, theme, lang, container } = props;
  const [tab, setTab] = useState<Tab>(initialTab ?? "tech");
  const [picked, setPicked] = useState<string | null>(null);
  const [sync, setSync] = useState({ open, initialTab, ticker });
  // 每次打開時回到指定分頁與標的；父層改變 ticker 時以父層為準
  if (sync.open !== open || sync.initialTab !== initialTab || sync.ticker !== ticker) {
    const opening = open && !sync.open;
    if (opening || sync.initialTab !== initialTab) setTab(initialTab ?? "tech");
    if (opening || sync.ticker !== ticker) setPicked(null);
    setSync({ open, initialTab, ticker });
  }

  // 跨標的保留的檢視設定（關閉後再開仍保留）
  const [tech, setTech] = useState<TechSettings>(DEFAULT_TECH);
  const [fund, setFund] = useState<FundSettings>(DEFAULT_FUND);
  const [dcfEdits, setDcfEdits] = useState<Record<string, DcfInputs>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dlg.Root open={open} onOpenChange={onOpenChange}>
      <Dlg.Portal container={container ?? undefined}>
        <Dlg.Overlay className="rs-overlay" />
        <Dlg.Content
          ref={contentRef}
          className={`rs-sheet wa-${theme}`}
          data-theme={theme}
          lang={lang === "ja" ? "ja" : "zh-Hant"}
          // 開啟時把焦點放在抽屜本身（仍在焦點陷阱內），避免關閉鈕一打開就出現焦點框
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(e) => {
            // 在輸入欄按 Esc 先離開欄位，再按一次才關閉
            const a = document.activeElement;
            if (a instanceof HTMLInputElement || a instanceof HTMLSelectElement) {
              e.preventDefault();
              a.blur();
            }
          }}
        >
          <SheetBody
            {...props}
            tab={tab}
            onTab={setTab}
            selected={picked ?? ticker}
            onPick={(t) => { setPicked(t); props.onTicker(t); }}
            tech={tech}
            onTech={setTech}
            fund={fund}
            onFund={setFund}
            dcfEdits={dcfEdits}
            setDcfEdits={setDcfEdits}
          />
        </Dlg.Content>
      </Dlg.Portal>
    </Dlg.Root>
  );
}

function SheetBody({ tickers, lang, tab, onTab, selected, onPick, tech, onTech, fund, onFund, dcfEdits, setDcfEdits }: Props & {
  tab: Tab;
  onTab: (t: Tab) => void;
  selected: string | null;
  onPick: (t: string) => void;
  tech: TechSettings;
  onTech: (s: TechSettings) => void;
  fund: FundSettings;
  onFund: (s: FundSettings) => void;
  dcfEdits: Record<string, DcfInputs>;
  setDcfEdits: (fn: (m: Record<string, DcfInputs>) => Record<string, DcfInputs>) => void;
}) {
  const L = lang as RLang;
  // 同代號只顯示一顆；有股票部位時以股票為準
  const chips = useMemo(() => {
    const out: ResearchPosition[] = [];
    for (const p of tickers) {
      const i = out.findIndex((x) => x.ticker === p.ticker);
      if (i < 0) out.push(p);
      else if (out[i].kind !== "stock" && p.kind === "stock") out[i] = p;
    }
    return out.sort((a, b) => Number(b.kind === "stock") - Number(a.kind === "stock"));
  }, [tickers]);
  const stocks = chips.filter((p) => p.kind === "stock");
  const sel = selected ?? stocks[0]?.ticker ?? null;
  const pos = sel ? stocks.find((p) => p.ticker === sel) ?? null : null;
  const other = sel && !pos ? chips.find((p) => p.ticker === sel) ?? null : null;

  const ticker = pos?.ticker ?? "";
  const price = pos?.price ?? 0;
  const name = pos?.name || ticker;
  const f = useMemo(() => (ticker ? fundamentalsFor(ticker, price, pos?.sector) : null), [ticker, price, pos?.sector]);
  const edited = ticker ? dcfEdits[ticker] : undefined;
  const dcfDefaults = useMemo(() => (f ? defaultDcf(ticker, price, f) : null), [ticker, price, f]);
  const dcfInputs = edited ?? dcfDefaults;
  const onDcf = useCallback((next: DcfInputs) => setDcfEdits((m) => ({ ...m, [ticker]: next })), [ticker, setDcfEdits]);
  const onDcfReset = useCallback(() => setDcfEdits((m) => {
    const next = { ...m };
    delete next[ticker];
    return next;
  }), [ticker, setDcfEdits]);
  const openDcf = useCallback(() => onTab("dcf"), [onTab]);

  const cur = currencyOf(ticker);
  const pnl = pos ? (pos.price - pos.cost) * pos.qty : 0;
  const pnlPct = pos && pos.cost > 0 ? pos.price / pos.cost - 1 : null;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next = -1;
    if (dir) next = (i + dir + TABS.length) % TABS.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onTab(TABS[next].k);
    document.getElementById(`rs-tab-${TABS[next].k}`)?.focus();
  };

  return (
    <>
      <div className="rs-bar">
        <div className="rs-bar-text">
          <Dlg.Title className="rs-title">
            <span className="rs-title-k">{tr(L, "個股研究", "銘柄リサーチ")}</span>
            {sel && <span className="rs-title-t">{sel}</span>}
          </Dlg.Title>
          <Dlg.Description className="rs-sub">
            {pos ? (
              <>
                <span className="rs-sub-name">{name}</span>
                {pos.qty > 0 && (
                  <>
                    <span className="rs-dot">·</span>{tr(L, `持有 ${pos.qty} 股`, `保有 ${pos.qty} 株`)}
                    <span className="rs-dot">·</span>{tr(L, "均價", "平均取得")} {fmtPrice(pos.cost, cur)}
                    <span className="rs-dot">·</span>
                    <span className={pnl >= 0 ? "rs-up" : "rs-down"}>{tr(L, "未實現", "含み損益")} {fmtSignedPrice(pnl, cur)}{pnlPct != null ? `（${fmtSignedPct(pnlPct)}）` : ""}</span>
                  </>
                )}
              </>
            ) : tr(L, "技術走勢、財務品質與 DCF 估值", "テクニカル・ファンダメンタルズ・DCF 評価")}
          </Dlg.Description>
        </div>
        <Dlg.Close className="rs-close" aria-label={tr(L, "關閉", "閉じる")}>
          <RIcon name="close" size={18} />
        </Dlg.Close>
      </div>

      {chips.length > 0 && (
        <div className="rs-chips" role="group" aria-label={tr(L, "選擇持股", "保有銘柄を選択")}>
          {chips.map((p) => {
            const isStock = p.kind === "stock";
            const on = isStock && p.ticker === ticker;
            const ch = isStock && p.cost > 0 ? p.price / p.cost - 1 : null;
            return (
              <button
                key={p.id}
                type="button"
                className={`rs-chip${on ? " on" : ""}${isStock ? "" : " is-off"}`}
                aria-pressed={on}
                disabled={!isStock}
                title={isStock ? `${p.ticker} · ${p.name}` : tr(L, `${p.ticker}：${p.kind === "option" ? "選擇權" : "現金"}部位不提供個股研究`, `${p.ticker}：${p.kind === "option" ? "オプション" : "現金"}はリサーチ対象外です`)}
                onClick={() => { if (isStock && p.ticker !== ticker) onPick(p.ticker); }}
              >
                <b>{p.ticker}</b>
                {isStock
                  ? ch != null && <small className={ch >= 0 ? "rs-up" : "rs-down"}>{fmtSignedPct(ch, 1)}</small>
                  : <small>{p.kind === "option" ? tr(L, "選擇權", "オプション") : tr(L, "現金", "現金")}</small>}
              </button>
            );
          })}
        </div>
      )}

      <div className="rs-tabs" role="tablist" aria-label={tr(L, "研究分頁", "リサーチのタブ")}>
        {TABS.map((t, i) => (
          <button
            key={t.k}
            id={`rs-tab-${t.k}`}
            type="button"
            role="tab"
            className="rs-tab"
            aria-selected={tab === t.k}
            aria-controls="rs-tabpanel"
            tabIndex={tab === t.k ? 0 : -1}
            onClick={() => onTab(t.k)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {L === "ja" ? t.ja : t.zh}
          </button>
        ))}
      </div>

      <div className="rs-body" id="rs-tabpanel" role="tabpanel" aria-labelledby={`rs-tab-${tab}`}>
        {pos && f && dcfInputs ? (
          <div key={`${tab}:${ticker}`} className="rs-pane">
            {tab === "tech" && <TechView ticker={ticker} name={name} price={price} lang={L} settings={tech} onSettings={onTech} />}
            {tab === "fund" && <FundView f={f} name={name} lang={L} settings={fund} onSettings={onFund} onOpenDcf={openDcf} />}
            {tab === "dcf" && (
              <DcfView ticker={ticker} name={name} price={price} lang={L} f={f} inputs={dcfInputs} edited={!!edited} onInputs={onDcf} onReset={onDcfReset} />
            )}
          </div>
        ) : (
          <div className="rs-empty rs-empty-big">
            <p>
              {other
                ? tr(L, `${other.ticker} 目前是${other.kind === "option" ? "選擇權" : "現金"}部位，個股研究只支援股票；請從上方選擇一檔股票。`, `${other.ticker} は${other.kind === "option" ? "オプション" : "現金"}のため対象外です。上から株式を選んでください。`)
                : sel
                  ? tr(L, `持倉中找不到 ${sel} 的股票部位；請從上方選擇。`, `保有銘柄に ${sel} の株式がありません。上から選んでください。`)
                  : tr(L, "目前沒有可研究的股票持倉。", "リサーチできる株式の保有がありません。")}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
