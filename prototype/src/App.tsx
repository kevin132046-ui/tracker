import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Dlg from "@radix-ui/react-dialog";
import Opening from "@/components/Opening";
import Backdrop from "@/components/Backdrop";
import { Crest, ElementTile, Icon } from "@/components/Marks";
import HaloIcon, { haloTiltScale } from "@/components/HaloIcon";
import Settings from "@/components/Settings";
import Assistant from "@/components/Assistant";
import ImportDialogBody from "@/components/ImportDialog";
import NotifyCenter, { ClosureHint } from "@/components/NotifyCenter";
import HomeBar, { type QuickAction } from "@/components/HomeBar";
import ResearchSheet, { type ResearchPosition } from "@/components/Research";
import { playSfx } from "@/lib/audio";
import { upcomingClosures } from "@/lib/calendar";
import { ANALYSES, EARNINGS } from "@/lib/alerts";
import { Bars, Donut, Sparkline, type Slice } from "@/components/Charts";
import { MetricsGrid, MonthlyHeatmap, PerfChart, type PerfMode } from "@/components/Perf";
import { buckets, computeMetrics, greeks } from "@/lib/perf";
import { openAnnual, weightedRoc, type RocRow } from "@/lib/roc";
import TradeForm, { type NewTrade } from "@/components/TradeForm";
import { useTween } from "@/lib/hooks";
import { THEMES, pickTheme, t, type ThemeId, type ThemePref } from "@/lib/theme";
import {
  MACRO_COMMOD, MACRO_RATES, SECTORS, SECTORS_JA, SEED_POSITIONS, SEED_TRADES, exposureValue, investedCapital, marketValue, realizedPnl, unrealized,
  type Kind, type Period, type Position, type Trade,
} from "@/lib/data";
import { clock, jikan, marketState, num, pct, prefersReducedMotion, safeGet, safeSet, seeded, signedUsd, usd, wafuDate, type Lang } from "@/lib/wa";

const PortalCtx = createContext<HTMLElement | null>(null);

type Filter = "open" | "closed" | "option" | "stock" | "cash" | "all";
type Nav = "overview" | "positions" | "returns";

export default function App() {
  const reduced = useMemo(prefersReducedMotion, []);
  const [pref, setPref] = useState<ThemePref>(() => (safeGet("wa-theme-pref") as ThemePref) || "random");
  const [theme, setTheme] = useState<ThemeId>(() => pickTheme((safeGet("wa-theme-pref") as ThemePref) || "random"));
  const [introOn, setIntroOn] = useState(() => safeGet("wa-intro") !== "0");
  const [showIntro, setShowIntro] = useState(introOn);
  const [revealed, setRevealed] = useState(!introOn);
  // The doors reveal a still page; the dashboard animates in only once they have finished opening,
  // so the door slide and the entrance animations never compete for the same frames.
  const [entered, setEntered] = useState(!introOn);
  const [introKey, setIntroKey] = useState(0);
  const [lang, setLang] = useState<Lang>("zh");
  const [now, setNow] = useState(() => new Date());
  const [positions, setPositions] = useState<Position[]>(SEED_POSITIONS);
  const [trades, setTrades] = useState<Trade[]>(SEED_TRADES);
  const [lastUpdate, setLastUpdate] = useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<ThemeId, string>>({ kikyo: "桐生桔梗", shigure: "間宵時雨" });
  const [nav, setNav] = useState<Nav>("overview");
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [valOpen, setValOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [research, setResearch] = useState<{ open: boolean; ticker: string | null; tab: "tech" | "fund" | "dcf" }>({ open: false, ticker: null, tab: "tech" });
  const [homebar, setHomebar] = useState(() => safeGet("wa-homebar") !== "0");
  const [toast, setToast] = useState<string | null>(null);
  const spec = THEMES[theme];
  const fileRef = useRef<HTMLInputElement>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // 每 60 秒模擬更新報價
  useEffect(() => {
    const id = window.setInterval(() => refresh(true), 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 面板上的游標光暈（細節：光隨手移動）
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = (e.target as Element | null)?.closest?.(".panel, .metric") as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, [reduced]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  function refresh(silent = false) {
    setRefreshing(true);
    window.setTimeout(() => {
      setPositions((ps) => ps.map((p) => (p.source === "api" ? { ...p, price: +(p.price * (1 + (Math.random() - 0.5) * 0.006)).toFixed(2) } : p)));
      setLastUpdate(new Date());
      setRefreshing(false);
      if (!silent) setToast(lang === "ja" ? "株価を更新しました" : "報價已更新");
    }, 650);
  }

  const openPos = positions.filter((p) => p.open);
  const tracked = openPos.reduce((a, p) => a + exposureValue(p), 0);
  const unreal = openPos.reduce((a, p) => a + unrealized(p), 0);
  const invested = openPos.filter((p) => p.kind !== "cash").reduce((a, p) => a + investedCapital(p), 0);
  const trackedT = useTween(tracked, { from: introOn ? 0 : tracked, start: entered });
  const unrealT = useTween(unreal, { from: introOn ? 0 : unreal, start: entered });
  const investedT = useTween(invested, { from: introOn ? 0 : invested, start: entered });
  const rocYear = now.getFullYear();
  const rocSummary = useMemo(() => weightedRoc(positions, rocYear), [positions, rocYear]);
  const roc = rocSummary.value == null ? null : rocSummary.value * 100;
  const [rocOpen, setRocOpen] = useState(false);
  const ms = marketState(now);

  const wd = wafuDate(now, lang);

  function changeTheme(next: ThemePref) {
    setPref(next);
    safeSet("wa-theme-pref", next);
    setTheme(pickTheme(next));
  }

  function replay() {
    setSettingsOpen(false);
    setIntroKey((k) => k + 1);
    setRevealed(false);
    setEntered(false);
    setShowIntro(true);
  }

  function onBgFile(f: File | undefined) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setCustomBg(String(reader.result)); setToast(lang === "ja" ? "背景を変更しました" : "已套用自訂背景"); };
    reader.readAsDataURL(f);
  }

  function addTrade(input: NewTrade) {
    applyTrade(input);
    setAddOpen(false);
    setToast(lang === "ja" ? `${input.ticker.trim().toUpperCase() || "NEW"} の取引を追加しました` : `已新增 ${input.ticker.trim().toUpperCase() || "NEW"} 交易`);
  }

  function importTrades(list: NewTrade[]) {
    list.forEach(applyTrade);
    setImportOpen(false);
    setToast(lang === "ja" ? `${list.length} 件の取引を取り込みました` : `已匯入 ${list.length} 筆交易`);
  }

  function applyTrade(input: NewTrade) {
    const ticker = input.ticker.trim().toUpperCase() || "NEW";
    const sign = input.side === "sell" ? 1 : -1;
    const mult = input.kind === "option" ? 100 : 1;
    setTrades((ts) => [{
      date: input.date, ticker, kind: input.kind,
      action: input.kind === "option" ? `${input.side === "sell" ? "賣出" : "買入"} ${input.strike}${input.optionType === "PUT" ? "P" : "C"}` : input.kind === "cash" ? (input.side === "sell" ? "提出" : "存入") : input.side === "sell" ? "賣出" : "買入",
      qty: input.qty, price: input.price,
      amount: input.kind === "cash" ? (input.side === "sell" ? -1 : 1) * input.price : sign * input.qty * input.price * mult - input.fees,
      status: "open", note: input.note || (input.kind === "option" ? `${input.expiry.slice(5).replace("-", "/")} 到期` : ""),
    }, ...ts]);
    setPositions((ps) => {
      const next = [...ps];
      if (input.kind === "cash") {
        const i = next.findIndex((p) => p.kind === "cash" && p.ticker === ticker);
        const delta = (input.side === "sell" ? -1 : 1) * input.price;
        if (i >= 0) { next[i] = { ...next[i], price: next[i].price + delta, cost: next[i].cost + delta, trades: next[i].trades + 1 }; return next; }
      }
      const i = next.findIndex((p) => p.ticker === ticker && p.kind === "stock" && p.open);
      if (i >= 0 && input.kind === "stock") {
        const p = next[i];
        if (input.side === "buy") {
          const q = p.qty + input.qty;
          next[i] = { ...p, qty: q, cost: +((p.cost * p.qty + input.price * input.qty) / q).toFixed(4), fees: (p.fees ?? 0) + input.fees, trades: p.trades + 1 };
        } else {
          const sold = Math.min(input.qty, p.qty);
          const rest = p.qty - sold;
          // 賣出的部分拆成一筆已平倉紀錄，保留原建倉日以正確計算持有天數與年化
          next.push({ ...p, id: "c" + Date.now(), qty: sold, open: false, closeDate: input.date, exitPrice: input.price, fees: input.fees, trades: 1 });
          if (rest > 0) next[i] = { ...p, qty: rest, trades: p.trades + 1 };
          else next.splice(i, 1);
        }
        return next;
      }
      const r = seeded(ticker.length * 97 + input.qty);
      const known = ps.find((p) => p.ticker === ticker);
      const base: Position = {
        id: "n" + Date.now(), ticker, name: known?.name ?? (input.kind === "cash" ? "現金" : ticker), kind: input.kind,
        source: input.kind === "stock" ? "api" : input.kind === "cash" ? "cash" : "manual",
        open: true, qty: input.kind === "option" && input.side === "sell" ? -input.qty : input.qty, trades: 1,
        cost: input.price, price: input.price, prevClose: input.price, sector: known?.sector ?? Math.floor(r() * 5),
        openDate: input.date, fees: input.fees,
        spark: Array.from({ length: 24 }, (_, k) => input.price * (1 + Math.sin(k / 3 + r() * 3) * 0.02)),
        note: input.note,
      };
      if (input.kind === "option") {
        const under = known?.kind === "option" ? known.underlying : known?.price;
        Object.assign(base, { optionType: input.optionType, strike: input.strike, expiry: input.expiry, underlying: under, iv: 0.3, collateral: input.side === "sell" && input.optionType === "PUT" ? input.strike * 100 * input.qty : 0 });
      }
      if (input.kind === "cash") Object.assign(base, { price: input.price, cost: input.price, qty: 1, sector: 5 });
      return [...next, base];
    });
  }

  const researchList: ResearchPosition[] = useMemo(() => positions.filter((p) => p.open).map((p) => ({
    id: p.id, ticker: p.ticker, name: p.name, kind: p.kind, price: p.price, cost: p.cost, qty: p.qty, sector: SECTORS[p.sector],
  })), [positions]);
  const openResearch = (ticker: string | null, tab: "tech" | "fund" | "dcf" = "tech") => setResearch({ open: true, ticker, tab });
  const held = useMemo(() => [...new Set(positions.filter((p) => p.open && p.kind === "stock").map((p) => p.ticker))], [positions]);
  const openAi = (seed?: string) => { setAiSeed(seed ?? null); setAiOpen(true); };

  // 給 AI 的頁面背景（精簡、只放這頁看得到的資料）
  const aiContext = useMemo(() => {
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const lines = positions.filter((p) => p.open).map((p) => {
      const pnl = unrealized(p);
      return p.kind === "option"
        ? `${p.ticker} ${p.qty < 0 ? "賣出" : "買入"} ${p.optionType} ${p.strike} 到期 ${p.expiry} ${Math.abs(p.qty)}口 權利金 ${p.cost} 現價 ${p.price} 擔保 ${p.collateral ?? 0} 未實現 ${pnl.toFixed(2)}`
        : p.kind === "cash" ? `${p.ticker} 現金 ${p.price.toFixed(2)}`
        : `${p.ticker} ${p.qty}股 成本 ${p.cost} 現價 ${p.price} 未實現 ${pnl.toFixed(2)} 權重 ${((exposureValue(p) / (tracked || 1)) * 100).toFixed(1)}% β ${p.beta ?? "?"}`;
    });
    const closed = rocSummary.rows.map((r) => `${r.ticker} ${r.label} ${r.openDate}→${r.closeDate} ${r.days}天 資本 ${r.capital.toFixed(0)} 損益 ${r.pnl.toFixed(2)}`);
    const hol = upcomingClosures(iso, 30).map((c) => `${c.date} ${c.market === "US" ? "美股" : "日股"} ${c.kind === "early" ? "提前收盤" : "休市"} ${c.name.zh}`);
    const earn = EARNINGS.filter((e) => held.includes(e.ticker)).map((e) => `${e.ticker} ${e.date} ${e.when === "pre" ? "盤前" : "盤後"}（預估）`);
    const ana = ANALYSES.map((a) => `${a.title.zh}：${a.metrics.map((m) => `${m.k.zh} ${m.v}${m.d ? `（${m.d}）` : ""}`).join("；")}`);
    return [`今天 ${iso}。追蹤市值 ${tracked.toFixed(2)}，未實現 ${unreal.toFixed(2)}，投入資本 ${invested.toFixed(2)}，本年度加權年化 ROC ${roc == null ? "—" : roc.toFixed(2) + "%"}。`,
      "未平倉：", ...lines, "本年度已平倉：", ...closed, "未來 30 天休市：", ...(hol.length ? hol : ["無"]), "財報日曆：", ...earn, "已公布財報重點：", ...ana].join("\n");
  }, [positions, rocSummary, tracked, unreal, invested, roc, now, held]);

  function quick(a: QuickAction) {
    if (a === "add") setAddOpen(true);
    else if (a === "import") setImportOpen(true);
    else if (a === "ai") openAi();
    else if (a === "research") openResearch(null);
    else if (a === "notify") { window.scrollTo({ top: 0, behavior: "smooth" }); window.setTimeout(() => (document.querySelector(".ntc") as HTMLButtonElement | null)?.click(), 350); }
    else if (a === "settings") setSettingsOpen(true);
  }

  const goto = (id: Nav) => {
    setNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  return (
    <PortalCtx.Provider value={rootEl}>
    <div ref={setRootEl} className={`wa wa-${theme}${showIntro && !revealed ? " is-veiled" : ""}${revealed && !entered ? " is-staged" : ""}${revealed && introOn ? " bd-in" : ""}${entered && introOn ? " reveal" : ""}`} data-wa={theme} lang={lang === "ja" ? "ja" : "zh-Hant"}>
      <Backdrop theme={theme} customBg={customBg} reduced={reduced} paused={showIntro && !revealed} />

      <header className="topbar">
        <a className="brand" href="#overview" onClick={(e) => { e.preventDefault(); goto("overview"); }}>
          <span className="brand-mark"><Crest theme={theme} size={30} /></span>
          <span className="brand-text">
            <b>OPTIONFLOW</b>
            <small>{wd.era} {wd.md}{wd.week} · {wd.sekki}<ClosureHint lang={lang} now={now} /></small>
          </span>
        </a>
        <NotifyCenter lang={lang} now={now} container={rootEl} held={held} onAskAi={(prompt) => openAi(prompt)} />
        <div className="top-actions">
          <div className="seg seg-lang" role="group" aria-label="介面語言">
            <button type="button" className={lang === "zh" ? "on" : ""} aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>中文</button>
            <button type="button" className={lang === "ja" ? "on" : ""} aria-pressed={lang === "ja"} onClick={() => setLang("ja")}>日本語</button>
          </div>
          <span className={`lantern lantern-${ms}`} title={t(ms, lang)}><i />{t(ms, lang)}</span>
          <button type="button" className={`btn ghost${refreshing ? " spinning" : ""}`} onClick={() => refresh()}>
            <Icon.refresh size={16} /><span className="hide-sm">{t("refresh", lang)}</span>
          </button>
          <button type="button" className="btn primary" onClick={() => setAddOpen(true)}>
            <Icon.plus size={16} /><span className="hide-sm">{t("addTrade", lang)}</span>
          </button>
        </div>
      </header>

      <div className="frame">
        <nav className="rail" aria-label="頁面切換">
          <RailBtn theme={theme} icon={<span className={`gear${settingsOpen ? " spin" : ""}`}><Icon.settings /></span>} label={t("settings", lang)} onClick={() => { setSettingsOpen(true); playSfx("open", theme); }} />
          <RailBtn theme={theme} icon={<Icon.overview />} label={t("overview", lang)} active={nav === "overview"} onClick={() => goto("overview")} />
          <RailBtn theme={theme} icon={<Icon.positions />} label={t("positions", lang)} active={nav === "positions"} onClick={() => goto("positions")} />
          <RailBtn theme={theme} icon={<Icon.returns />} label={t("returns", lang)} active={nav === "returns"} onClick={() => goto("returns")} />
          <RailBtn theme={theme} icon={<Icon.valuation />} label={t("valuation", lang)} active={research.open} onClick={() => openResearch(null, "dcf")} />
          <RailBtn theme={theme} selfHalo icon={<HaloIcon theme={theme} size={26} spin={aiOpen} minStrokePx={1.1} className="rail-ai-halo" />} label="AI" active={aiOpen} onClick={() => openAi()} />
          <RailBtn theme={theme} icon={<Icon.background />} label={t("background", lang)} onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} id="bg-file" className="sr-only" type="file" accept="image/*" onChange={(e) => onBgFile(e.target.files?.[0])} />
        </nav>

        <main className="dash">
          <Hero theme={theme} lang={lang} now={now} lastUpdate={lastUpdate} title={titles[theme]} onTitle={(v) => setTitles((s) => ({ ...s, [theme]: v }))} />

          <section className="metrics" aria-label="投資組合摘要">
            <article className="metric featured">
              <p>{t("tracked", lang)}</p>
              <strong className={refreshing ? "shimmer" : ""}>{usd(trackedT)}</strong>
              <span>{openPos.length} {t("openCount", lang)}</span>
            </article>
            <article className="metric">
              <p>{t("unreal", lang)}</p>
              <strong className={unreal >= 0 ? "up" : "down"}>{signedUsd(unrealT)}</strong>
              <span className={unreal >= 0 ? "up" : "down"}>{pct((unreal / invested) * 100)}</span>
            </article>
            <article className="metric">
              <p>{t("collateral", lang)}</p>
              <strong>{usd(investedT)}</strong>
              <span>{t("collateralNote", lang)}</span>
            </article>
            <button type="button" className="metric metric-btn" onClick={() => setRocOpen(true)} title="本年度已實現損益 ÷ Σ（投入資本 × 持有天數 ÷ 365）· 點擊查看計算明細">
              <p>{t("roc", lang)}</p>
              <strong className={roc == null ? "" : roc >= 0 ? "up" : "down"}>{roc == null ? "—" : pct(roc, 1)}</strong>
              <span>{rocYear} · {rocSummary.rows.length} {t("closedTrades", lang)} · <u>{lang === "ja" ? "明細" : "看明細"}</u></span>
            </button>
          </section>

          <PerfPanel lang={lang} theme={theme} />

          <section className="grid-2">
            <AllocationPanel lang={lang} theme={theme} positions={positions} total={tracked} />
            <MacroSection lang={lang} theme={theme} now={now} />
          </section>

          <PositionsPanel lang={lang} theme={theme} positions={positions} trades={trades} total={tracked} onAdd={() => setAddOpen(true)}
            onImport={() => setImportOpen(true)} onManual={() => setValOpen(true)} onResearch={(tk) => openResearch(tk)} />
        </main>
      </div>

      <Modal open={addOpen} onOpenChange={setAddOpen} title={t("addTrade", lang)} wide>
        <TradeForm lang={lang} positions={positions} onSubmit={addTrade} palette={spec.palette} />
      </Modal>
      <RocDialog open={rocOpen} onOpenChange={setRocOpen} lang={lang} year={rocYear} summary={rocSummary} />
      <Settings
        open={settingsOpen} onOpenChange={(v) => { setSettingsOpen(v); if (!v) playSfx("close", theme); }} lang={lang} pref={pref} theme={theme}
        onPref={changeTheme} introOn={introOn}
        onIntro={(v) => { setIntroOn(v); safeSet("wa-intro", v ? "1" : "0"); }}
        onReplay={replay} customBg={customBg} onClearBg={() => setCustomBg(null)}
        homebar={homebar} onHomebar={(v) => { setHomebar(v); safeSet("wa-homebar", v ? "1" : "0"); }}
        container={rootEl} now={now}
        onImport={() => { setSettingsOpen(false); setImportOpen(true); }}
        onAssistant={() => { setSettingsOpen(false); openAi(); }}
      />
      <Modal open={importOpen} onOpenChange={setImportOpen} title={lang === "ja" ? "取引を取り込む" : "匯入交易"} wide>
        <ImportDialogBody lang={lang} onImport={importTrades} today={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`} />
      </Modal>
      <Assistant open={aiOpen} onOpenChange={setAiOpen} lang={lang} theme={theme} container={rootEl} context={aiContext} seed={aiSeed} onSeedUsed={() => setAiSeed(null)} />
      <ResearchSheet open={research.open} onOpenChange={(v) => setResearch((r) => ({ ...r, open: v }))} ticker={research.ticker} tickers={researchList}
        onTicker={(tk) => setResearch((r) => ({ ...r, ticker: tk }))} lang={lang} theme={theme} container={rootEl} initialTab={research.tab} />
      {homebar && (
        <HomeBar lang={lang} theme={theme} container={rootEl} current={nav}
          sections={[{ id: "overview", label: t("overview", lang) }, { id: "returns", label: t("returns", lang) }, { id: "positions", label: t("positions", lang) }]}
          onGo={(id) => goto(id as Nav)} onAction={quick} />
      )}
      <ValuationDialog open={valOpen} onOpenChange={setValOpen} lang={lang} positions={positions}
        onSet={(id, price) => setPositions((ps) => ps.map((p) => (p.id === id ? { ...p, price } : p)))} />

      {toast && <div className="toast" role="status">{toast}</div>}

      {showIntro && (
        <Opening key={introKey} theme={theme} lang={lang} reduced={reduced} onReveal={() => setRevealed(true)} onDone={() => { setRevealed(true); setEntered(true); setShowIntro(false); }} />
      )}
    </div>
    </PortalCtx.Provider>
  );
}

// 側欄光環：尺寸、傾斜與和圖示的間距（px）；位置由實際圖形量出來，每個選項都正對圖示上方
const RAIL_HALO = { size: 34, tilt: 64, gap: 2 } as const;

/** selfHalo：圖示本身就是光環（AI），選取時讓它旋轉發光，不再在上方另外浮一個光環。 */
function RailBtn({ icon, label, active, onClick, theme, selfHalo = false }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; theme: ThemeId; selfHalo?: boolean }) {
  const icoRef = useRef<HTMLSpanElement>(null);
  const [haloAt, setHaloAt] = useState<{ x: number; y: number } | null>(null);
  const floatHalo = active && !selfHalo;
  useLayoutEffect(() => {
    const box = icoRef.current;
    if (!floatHalo || !box) return;
    const place = () => {
      const glyph = box.querySelector(":scope > :not(.rail-halo-wrap)");
      const drawn = glyph?.querySelector("svg") ?? glyph;
      if (!drawn) return;
      const b = box.getBoundingClientRect();
      const g = drawn.getBoundingClientRect();
      // The ring spans 2 of the view box's 2.28 units; tilted, its height shrinks by cos(tilt).
      const ringHeight = RAIL_HALO.size * (2 / 2.28) * haloTiltScale(RAIL_HALO.tilt);
      // Whole pixels keep the vector lines sharp.
      setHaloAt({ x: Math.round(g.left + g.width / 2 - b.left), y: Math.round(g.top - b.top - RAIL_HALO.gap - ringHeight / 2) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [floatHalo]);
  return (
    <button type="button" className={`rail-btn${active ? " on" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="rail-ico" ref={icoRef}>{floatHalo && <span className="rail-halo-wrap" aria-hidden="true" style={haloAt ? { left: haloAt.x, top: haloAt.y } : undefined}><HaloIcon theme={theme} size={RAIL_HALO.size} tilt={RAIL_HALO.tilt} /></span>}{icon}</span>
      <span className="rail-label">{label}</span>
    </button>
  );
}

function Hero({ theme, lang, now, lastUpdate, title, onTitle }: { theme: ThemeId; lang: Lang; now: Date; lastUpdate: Date; title: string; onTitle: (v: string) => void }) {
  const spec = THEMES[theme];
  const [zone, setZone] = useState<"et" | "jst">("et");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const first = title.slice(0, 2), rest = title.slice(2);
  return (
    <section className="hero" id="overview">
      <div className="hero-clock">
        <div className="clock-head">
          <span>{t("liveClock", lang)}</span>
          <div className="seg seg-sm" role="group" aria-label="切換即時時區">
            <button type="button" className={zone === "et" ? "on" : ""} aria-pressed={zone === "et"} onClick={() => setZone("et")}>{t("et", lang)}</button>
            <button type="button" className={zone === "jst" ? "on" : ""} aria-pressed={zone === "jst"} onClick={() => setZone("jst")}>{t("jst", lang)}</button>
          </div>
        </div>
        <div className="clock-face">
          <strong>{clock(now, zone === "et" ? "America/New_York" : "Asia/Tokyo")}</strong>
          <b>{zone === "et" ? "ET" : "JST"}</b>
        </div>
        <div className="clock-sub">
          <span>{zone === "et" ? `JST ${clock(now, "Asia/Tokyo")}` : `ET ${clock(now, "America/New_York")}`}</span>
          <span className="jikan">{jikan(now)}</span>
        </div>
        <p className="clock-note">{t("quoteEvery", lang)} {clock(lastUpdate, "Asia/Taipei").slice(0, 5)}</p>
      </div>

      <div className="hero-title">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); onTitle(draft.trim() || title); setEditing(false); }}>
            <input id="hero-title-input" autoFocus value={draft} maxLength={12} onChange={(e) => setDraft(e.target.value)} onBlur={() => { onTitle(draft.trim() || title); setEditing(false); }} aria-label="網頁標題" />
          </form>
        ) : (
          <button type="button" className="title-btn" onClick={() => { setDraft(title); setEditing(true); }} title="點擊編輯網頁標題">
            <h1 aria-label={title}>
              <span aria-hidden="true">{[...first].map((c, i) => <i key={i} className="ch" style={{ ["--i" as string]: i }}>{c}</i>)}</span>
              <em aria-hidden="true">{[...rest].map((c, i) => <i key={i} className="ch" style={{ ["--i" as string]: i + first.length }}>{c}</i>)}</em>
            </h1>
            <span className="title-edit"><Icon.pencil size={14} /></span>
          </button>
        )}
        <p className="hero-sub">{spec.subtitle[lang]}</p>
      </div>
    </section>
  );
}

function PerfPanel({ lang, theme }: { lang: Lang; theme: ThemeId }) {
  const spec = THEMES[theme];
  const ja = lang === "ja";
  const [period, setPeriod] = useState<Period>("month");
  const [mode, setMode] = useState<PerfMode>("cum");
  const [vis, setVis] = useState({ mine: true, spy: true, boxx: true });
  const effPeriod: Period = mode === "heat" ? "month" : period;
  const data = useMemo(() => buckets(effPeriod), [effPeriod]);
  const m = useMemo(() => computeMetrics(data, effPeriod), [data, effPeriod]);
  const last = data[data.length - 1];
  const colors = { mine: spec.series.portfolio, spy: spec.series.spy, boxx: spec.series.boxx };
  const labels = { mine: t("mine", lang), spy: "SPY", boxx: "BOXX" };
  const unit = t(effPeriod, lang);
  const win = effPeriod === "day" ? (ja ? "直近60営業日" : "近 60 個交易日") : effPeriod === "week" ? (ja ? "直近52週" : "近 52 週") : effPeriod === "month" ? (ja ? "直近36か月" : "近 36 個月") : `${data[0].label}–${last.label}`;
  const f = (v: number, dp = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`;
  const modes: { k: PerfMode; zh: string; ja: string }[] = [
    { k: "cum", zh: "累積", ja: "累積" }, { k: "period", zh: "單期", ja: "期間" }, { k: "dd", zh: "回撤", ja: "DD" }, { k: "heat", zh: "月曆", ja: "月次" },
  ];
  return (
    <article className="panel perf" id="returns">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{t("returnAnalytics", lang)}</p>
          <h2>{ja ? "リターン分析" : "收益分析"}</h2>
        </div>
        <div className="perf-controls">
          <div className="seg" role="group" aria-label="圖表模式">
            {modes.map((o) => (
              <button key={o.k} type="button" className={mode === o.k ? "on" : ""} aria-pressed={mode === o.k} onClick={() => setMode(o.k)}>{ja ? o.ja : o.zh}</button>
            ))}
          </div>
          {mode !== "heat" && (
            <div className="seg seg-sm" role="group" aria-label="收益率期間">
              {(["day", "week", "month", "year"] as Period[]).map((p) => (
                <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)}>{t(p, lang)}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="ret-summary">
        <div>
          <strong className={m.cum >= 0 ? "up" : "down"}>{f(m.cum)}</strong>
          <span>{win}{ja ? "累積" : "累積報酬"}</span>
        </div>
        <p className="insight">
          {ja ? "SPY比" : "相對 SPY"} <b className={m.cum - m.cumSpy >= 0 ? "up" : "down"}>{f(m.cum - m.cumSpy)}</b>
          <span className="dot-sep">·</span>{ja ? `直近1${unit}` : `最新一${unit}`} <b className={last.mine >= 0 ? "up" : "down"}>{f(last.mine, 2)}</b>
          <span className="dot-sep">·</span>{ja ? "最大DD" : "最大回撤"} <b className="down">{f(m.mdd)}</b>{m.mddAt && <span className="muted">（{m.mddAt}）</span>}
        </p>
        {mode !== "heat" && (
          <div className="legend" role="group" aria-label="圖例（點擊切換）">
            {(["mine", "spy", "boxx"] as const).filter((k) => !(mode === "dd" && k === "boxx")).map((k) => (
              <button key={k} type="button" className={vis[k] ? "" : "off"} aria-pressed={vis[k]} onClick={() => setVis((v) => ({ ...v, [k]: !v[k] }))}>
                <i className={`key key-${k}`} style={{ color: mode === "dd" && k === "mine" ? "var(--down)" : colors[k] }} />{labels[k]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`perf-body${mode === "heat" ? " is-heat" : ""}`}>
        <div className="perf-main">
          {mode === "heat" ? <MonthlyHeatmap lang={lang} /> : <PerfChart mode={mode} data={data} colors={colors} labels={labels} visible={vis} lang={lang} />}
        </div>
        <MetricsGrid m={m} period={effPeriod} lang={lang} />
      </div>
      <p className="note">{ja ? "示範データ：日次リターンから集計。実装時は取引履歴と終値から日次の評価額（時間加重リターン）を再構成します。" : "示範資料：由日報酬彙總。正式版會用交易紀錄＋每日收盤價重建每日淨值（時間加權報酬）來計算。"}</p>
    </article>
  );
}

function MacroSection({ lang, theme, now }: { lang: Lang; theme: ThemeId; now: Date }) {
  const ja = lang === "ja";
  const [range, setRange] = useState<Period>("month");
  const [spin, setSpin] = useState(false);
  const spec = THEMES[theme];
  const n = range === "day" ? 8 : range === "week" ? 14 : range === "month" ? 22 : 30;
  const us10 = MACRO_RATES.find((m) => m.key === "us10")!;
  const us30 = MACRO_RATES.find((m) => m.key === "us30")!;
  const spread = (us30.value - us10.value) * 100;
  const spreadPrev = (us30.value - us30.change / 100 - (us10.value - us10.change / 100)) * 100;
  const card = (m: typeof MACRO_RATES[number]) => {
    const up = m.change >= 0;
    return (
      <article key={m.key} className="macro-card">
        <div className="macro-top">
          <span title={ja ? m.labelJa ?? m.label : m.label}>{ja ? m.labelJa ?? m.label : m.label}</span>
          <small>{ja ? m.subJa ?? m.sub : m.sub}</small>
        </div>
        <strong>{m.unit === "$" ? "$" : ""}{num(m.value, m.dp)}{m.unit === "%" ? "%" : ""}</strong>
        <span className={`macro-chg ${up ? "up" : "down"}`}>
          {m.bp ? `${up ? "+" : "−"}${Math.abs(m.change).toFixed(1)} bp` : `${up ? "+" : "−"}${num(Math.abs(m.change), m.dp)}`} · {pct(m.changePct)}
        </span>
        <Sparkline data={m.series.slice(-n)} color={up ? "var(--up)" : "var(--down)"} />
      </article>
    );
  };
  return (
    <article className="panel macro" aria-labelledby="macro-title">
      <div className="macro-head">
        <div>
          <p className="eyebrow">Macro price monitor</p>
          <h2 id="macro-title">{ja ? "マクロ指標" : "宏觀行情"}</h2>
        </div>
        <div className="macro-actions">
          <div className="seg seg-sm" role="group" aria-label="宏觀歷史期間">
            {(["day", "week", "month", "year"] as Period[]).map((p) => (
              <button key={p} type="button" className={range === p ? "on" : ""} aria-pressed={range === p} onClick={() => setRange(p)}>{t(p, lang)}</button>
            ))}
          </div>
          <button type="button" className={`chip-btn${spin ? " spinning" : ""}`} onClick={() => { setSpin(true); setTimeout(() => setSpin(false), 700); }}>
            <Icon.refresh size={14} />{t("update", lang)}
          </button>
          <span className="macro-time">{t("et", lang)} {clock(now, "America/New_York").slice(0, 5)} · 60s</span>
        </div>
      </div>
      <h3 className="macro-sub">{t("macroTitle", lang)}</h3>
      <div className="macro-grid n3">{MACRO_RATES.map(card)}</div>
      <h3 className="macro-sub">{ja ? "商品・イールド" : "商品與殖利率曲線"}</h3>
      <div className="macro-grid n3">
        {MACRO_COMMOD.map(card)}
        <article className="macro-card spread-card" title="30 年期減 10 年期殖利率；正值代表曲線正斜率">
          <div className="macro-top"><span>{ja ? "30年−10年 スプレッド" : "30Y − 10Y 利差"}</span><small>{ja ? "イールドカーブ" : "殖利率曲線"}</small></div>
          <strong>{spread >= 0 ? "+" : "−"}{Math.abs(spread).toFixed(1)} bp</strong>
          <span className={`macro-chg ${spread - spreadPrev >= 0 ? "up" : "down"}`}>{spread - spreadPrev >= 0 ? "+" : "−"}{Math.abs(spread - spreadPrev).toFixed(1)} bp · {spread > 0 ? (ja ? "順イールド" : "正斜率") : (ja ? "逆イールド" : "倒掛")}</span>
          <svg className="curve" viewBox="0 0 120 36" aria-hidden="true">
            <path d="M4 30 L40 22 L80 16 L116 10" fill="none" stroke="var(--line-2)" strokeWidth="1" strokeDasharray="3 3" />
            <path d={`M4 30 L40 ${24 - us10.value} L80 ${20 - us10.value * 1.2} L116 ${20 - us30.value * 2}`} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
            {[["3M", 4], ["2Y", 40], ["10Y", 80], ["30Y", 116]].map(([l, x]) => <text key={l} x={x as number} y={35} textAnchor="middle" className="curve-lb">{l}</text>)}
          </svg>
        </article>
      </div>
      <p className="note">{t("macroNote", lang)} <span className="muted">· {spec.crestName[lang]}</span></p>
    </article>
  );
}

function AllocationPanel({ lang, theme, positions, total }: { lang: Lang; theme: ThemeId; positions: Position[]; total: number }) {
  const spec = THEMES[theme];
  const [mode, setMode] = useState<"donut" | "bars">("donut");
  const [hist, setHist] = useState<"now" | "m1" | "m3" | "y1">("now");
  const [active, setActive] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const slices: Slice[] = useMemo(() => {
    const r = seeded(hist.length * 13 + (hist === "now" ? 0 : hist.charCodeAt(1)));
    const open = positions.filter((p) => p.open)
      .map((p) => ({ p, v: exposureValue(p) * (hist === "now" ? 1 : 0.7 + r() * 0.6) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    return open.map(({ p, v }, i) => ({ key: p.id, label: p.ticker === "USD" ? "USD 現金" : p.ticker, value: v, color: spec.palette[i % spec.palette.length] }));
  }, [positions, hist, spec.palette]);
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const top3 = slices.slice(0, 3).reduce((a, s) => a + s.value, 0) / (sum || 1) * 100;
  return (
    <article className="panel alloc">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Holdings</p>
          <h2>{t("holdings", lang)}</h2>
        </div>
        <div className="alloc-actions">
          <div className="seg seg-sm" role="group" aria-label="持倉配置圖表類型">
            <button type="button" className={mode === "donut" ? "on" : ""} aria-pressed={mode === "donut"} onClick={() => setMode("donut")}>{t("donut", lang)}</button>
            <button type="button" className={mode === "bars" ? "on" : ""} aria-pressed={mode === "bars"} onClick={() => setMode("bars")}>{t("bars", lang)}</button>
          </div>
          <span className="count">{slices.length} positions</span>
        </div>
      </div>
      <div className="alloc-hist">
        <div className="seg seg-sm" role="group" aria-label="持倉配置歷史">
          {(["now", "m1", "m3", "y1"] as const).map((h) => (
            <button key={h} type="button" className={hist === h ? "on" : ""} aria-pressed={hist === h} onClick={() => setHist(h)}>{t(h, lang)}</button>
          ))}
        </div>
        <label className="date-field" htmlFor="alloc-date">
          <span>{t("historyDate", lang)}</span>
          <input id="alloc-date" type="date" defaultValue={today} max={today} />
        </label>
      </div>
      <p className="insight">{lang === "ja" ? `上位3銘柄で ${top3.toFixed(0)}%` : `前三大部位占 ${top3.toFixed(0)}%`}{top3 > 70 ? (lang === "ja" ? " · 集中度高め" : " · 集中度偏高") : ""}</p>
      <div className={`alloc-body mode-${mode}`}>
        {mode === "donut" ? (
          <Donut slices={slices} total={hist === "now" ? total : sum} centerLabel={t("exposure", lang)} onHover={setActive} active={active} />
        ) : (
          <Bars slices={slices} onHover={setActive} active={active} />
        )}
        <ul className="alloc-legend">
          {slices.map((s) => (
            <li key={s.key} className={active === s.key ? "on" : ""} onPointerEnter={() => setActive(s.key)} onPointerLeave={() => setActive(null)}>
              <i style={{ background: s.color }} />
              <span className="l-name">{s.label}</span>
              <span className="l-val">{usd(s.value, 0)}</span>
              <span className="l-pct">{((s.value / (sum || 1)) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="note">{t("allocNote", lang)}</p>
    </article>
  );
}

function PositionsPanel({ lang, theme, positions, trades, total, onAdd, onImport, onManual, onResearch }: {
  lang: Lang; theme: ThemeId; positions: Position[]; trades: Trade[]; total: number; onAdd: () => void;
  onImport: () => void; onManual: () => void; onResearch: (ticker: string) => void;
}) {
  const spec = THEMES[theme];
  const [view, setView] = useState<"visual" | "ledger">("visual");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [cols, setColsState] = useState<ColKey[]>(() => {
    try { const v = JSON.parse(safeGet("wa-cols") ?? "null"); if (Array.isArray(v) && v.length) return v.filter((k: string) => COLS.some((c) => c.key === k)); } catch { /* 忽略 */ }
    return PRESETS.std.keys;
  });
  const setCols = (next: ColKey[]) => { setColsState(next); safeSet("wa-cols", JSON.stringify(next)); };
  const activeCols = COLS.filter((c) => cols.includes(c.key));
  const gridCols = `minmax(236px, 2.2fr) ${activeCols.map((c) => `minmax(0, ${c.fr}fr)`).join(" ")}`;
  const match = (p: { ticker: string; note?: string; name?: string }) => {
    const s = q.trim().toLowerCase();
    return !s || p.ticker.toLowerCase().includes(s) || (p.note ?? "").toLowerCase().includes(s) || (p.name ?? "").toLowerCase().includes(s);
  };
  const fp = (p: Position, f: Filter) =>
    f === "all" ? true : f === "open" ? p.open : f === "closed" ? !p.open : p.kind === (f as Kind);
  const counts: Record<Filter, number> = {
    open: positions.filter((p) => fp(p, "open")).length,
    closed: positions.filter((p) => fp(p, "closed")).length,
    option: positions.filter((p) => fp(p, "option")).length,
    stock: positions.filter((p) => fp(p, "stock")).length,
    cash: positions.filter((p) => fp(p, "cash")).length,
    all: positions.length,
  };
  const rows = positions.filter((p) => fp(p, filter) && match(p))
    .sort((a, b) => Number(b.open) - Number(a.open) || exposureValue(b) - exposureValue(a));
  const tradeRows = trades.filter((tr) => match(tr) && (filter === "all" || (filter === "open" ? tr.status === "open" : filter === "closed" ? tr.status === "closed" : tr.kind === filter)));
  const sectorColor = (p: Position) => spec.palette[p.sector % spec.palette.length];
  const filters: Filter[] = ["open", "closed", "option", "stock", "cash", "all"];
  const fKey: Record<Filter, string> = { open: "fOpen", closed: "fClosed", option: "fOption", stock: "fStock", cash: "fCash", all: "fAll" };

  return (
    <section className="panel pos" id="positions">
      <div className="pos-toolbar">
        <div>
          <p className="eyebrow">{t("activeBook", lang)}</p>
          <h2>{t("tradesTitle", lang)}</h2>
        </div>
        <div className="pos-actions">
          <div className="seg" role="group" aria-label="持倉顯示方式">
            <button type="button" className={view === "visual" ? "on" : ""} aria-pressed={view === "visual"} onClick={() => setView("visual")}>{t("visual", lang)}</button>
            <button type="button" className={view === "ledger" ? "on" : ""} aria-pressed={view === "ledger"} onClick={() => setView("ledger")}>{t("ledger", lang)}</button>
          </div>
          <ColumnPicker lang={lang} selected={cols} onChange={setCols} />
          <label className="search" htmlFor="pos-search">
            <Icon.search size={16} />
            <input id="pos-search" placeholder={t("search", lang)} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn ghost" onClick={onImport} title={lang === "ja" ? "CSV・スクリーンショットを取り込む" : "匯入 CSV 或截圖"}>⇪ <span className="hide-sm">{lang === "ja" ? "取込" : "匯入"}</span></button>
          <button type="button" className="btn ghost" onClick={onManual} title={lang === "ja" ? "API で取得できない価格を手動入力" : "手動輸入無法自動報價的價格"}>✎ <span className="hide-sm">{lang === "ja" ? "手動評価" : "手動報價"}</span></button>
          <button type="button" className="btn primary" onClick={onAdd}><Icon.plus size={16} />{t("add", lang)}</button>
        </div>
      </div>
      <div className="filters" role="group" aria-label="篩選">
        {filters.map((f) => (
          <button key={f} type="button" className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(fKey[f], lang)}<span>{counts[f]}</span>
          </button>
        ))}
      </div>

      <OptionRisk positions={positions} total={total} lang={lang} />

      {view === "visual" ? (
        <div className="vlist-scroll">
          <div className="vlist" style={{ ["--vl-min" as string]: `${250 + activeCols.length * 96}px` }}>
            <div className="vhead" aria-hidden="true" style={{ gridTemplateColumns: gridCols }}>
              <span>{t("hTicker", lang)}</span>
              {activeCols.map((c) => <span key={c.key} title={c.hint}>{lang === "ja" ? c.ja : c.zh}</span>)}
            </div>
            {rows.length === 0 && <p className="empty">{t("empty", lang)}</p>}
            {rows.map((p, i) => {
              const meta =
                p.kind === "stock" ? `${p.trades} 筆 · ${p.qty} 股`
                  : p.kind === "option" ? `${p.trades} 筆 · ${p.optionType} ${p.strike} · ${p.expiry?.slice(5).replace("-", "/")} 到期`
                    : `${p.trades} 筆 · 含稅後股息`;
              const ctx = { total, lang, color: sectorColor(p) };
              return (
                <article key={p.id} className={`vrow${p.open ? "" : " closed"}${p.kind === "stock" ? " can-open" : ""}`} style={{ gridTemplateColumns: gridCols, ["--row-c" as string]: sectorColor(p) }}
                  onClick={p.kind === "stock" ? () => onResearch(p.ticker) : undefined}
                  onKeyDown={p.kind === "stock" ? (e) => { if (e.key === "Enter") onResearch(p.ticker); } : undefined}
                  tabIndex={p.kind === "stock" ? 0 : undefined} aria-label={p.kind === "stock" ? `${p.ticker} ${lang === "ja" ? "リサーチを開く" : "開啟個股研究"}` : undefined}>
                  <div className="who">
                    <ElementTile
                      no={i + 1}
                      symbol={tileSymbol(p.ticker)}
                      tag={p.kind === "option" ? (p.optionType === "PUT" ? "P" : "C") : p.kind === "cash" ? "現" : p.ticker.endsWith(".T") ? "JP" : "US"}
                      name={p.kind === "option" ? `${p.optionType} ${p.strike}` : (lang === "ja" ? SECTORS_JA : SECTORS)[p.sector] ?? ""}
                      color={sectorColor(p)}
                      hot={p.kind === "option" && p.open}
                    />
                    <div>
                      <b>{p.ticker}</b>
                      <span className="nm">{p.name}</span>
                      <span className="meta">{meta}</span>
                      <span className={`src src-${p.source}`}><i />{p.source === "api" ? "API · 最近收盤" : p.source === "manual" ? "權利金手動" : "現金"}{!p.open && " · 已平倉"}</span>
                    </div>
                  </div>
                  {activeCols.map((c) => (
                    <div key={c.key} className={`cell c-${c.key}`} data-l={lang === "ja" ? c.ja : c.zh}>{c.render(p, ctx)}</div>
                  ))}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="ledger-wrap">
          <table className="ledger">
            <thead>
              <tr><th>日期</th><th>標的</th><th>類型</th><th>動作</th><th className="r">數量</th><th className="r">價格</th><th className="r">金額</th><th>狀態</th><th>備註</th></tr>
            </thead>
            <tbody>
              {tradeRows.map((tr, i) => (
                <tr key={i}>
                  <td className="mono">{tr.date}</td>
                  <td><b>{tr.ticker}</b></td>
                  <td>{tr.kind === "stock" ? "股票" : tr.kind === "option" ? "選擇權" : "現金"}</td>
                  <td>{tr.action}</td>
                  <td className="r mono">{tr.qty}</td>
                  <td className="r mono">{usd(tr.price)}</td>
                  <td className={`r mono ${tr.amount >= 0 ? "up" : "down"}`}>{signedUsd(tr.amount)}</td>
                  <td><span className={`status ${tr.status}`}>{tr.status === "open" ? "未平倉" : "已平倉"}</span></td>
                  <td className="muted">{tr.note || "—"}</td>
                </tr>
              ))}
              {tradeRows.length === 0 && <tr><td colSpan={9} className="empty">{t("empty", lang)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <footer className="pos-foot">
        <span><i className="dot api" />{t("apiQuote", lang)}</span>
        <span><i className="dot manual" />{t("manual", lang)}</span>
        <span><i className="dot cash" />{t("cashDiv", lang)}</span>
        <p>{t("footNote", lang)}</p>
      </footer>
    </section>
  );
}

// ——— 持倉欄位（交易員可自選） ———
type ColKey = "value" | "cost" | "day" | "pnl" | "weight" | "held" | "annual" | "range" | "dte" | "delta" | "theta" | "moneyness" | "assign" | "yield" | "beta";
interface Ctx { total: number; lang: Lang; color: string }
interface ColDef { key: ColKey; zh: string; ja: string; group: "base" | "perf" | "opt" | "fund"; fr: number; hint: string; render: (p: Position, c: Ctx) => React.ReactNode }

const dash = <span className="muted">—</span>;
const optInfo = (p: Position) => {
  if (p.kind !== "option" || !p.open || !p.underlying || !p.strike || !p.expiry) return null;
  const days = Math.max(0, Math.round((new Date(p.expiry + "T16:00:00-04:00").getTime() - Date.now()) / 864e5));
  return { days, g: greeks(p.optionType as "PUT" | "CALL", p.underlying, p.strike, days, p.iv ?? 0.3) };
};
const fp = (v: number, dp = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`;

const COLS: ColDef[] = [
  { key: "value", zh: "持倉市值", ja: "評価額", group: "base", fr: 1, hint: "股票＝現價×股數；賣方選擇權＝擔保金", render: (p) => !p.open ? dash : <><strong>{usd(marketValue(p))}</strong>{p.kind === "option" && <small>擔保金</small>}</> },
  { key: "cost", zh: "成本／現價", ja: "取得／現在", group: "base", fr: 1, hint: "成本均價與最新價格", render: (p) => p.kind === "cash" ? <strong>{usd(p.price)}</strong> : <><small>{usd(p.cost)}</small><strong>{usd(p.open ? p.price : p.exitPrice ?? p.price)}</strong></> },
  { key: "day", zh: "今日漲跌", ja: "本日騰落", group: "base", fr: 1.25, hint: "相對前一交易日收盤", render: (p) => {
    const d = p.prevClose ? ((p.price - p.prevClose) / p.prevClose) * 100 : 0;
    return p.kind === "cash" || !p.open ? dash : <span className="move-in"><Sparkline data={p.spark} color={d >= 0 ? "var(--up)" : "var(--down)"} height={26} /><span className={d >= 0 ? "up" : "down"}>{pct(d)}</span></span>;
  } },
  { key: "pnl", zh: "損益／報酬率", ja: "損益／リターン", group: "base", fr: 1, hint: "未平倉為未實現、已平倉為已實現（已扣手續費）", render: (p) => {
    if (p.kind === "cash") return dash;
    const v = p.open ? unrealized(p) : realizedPnl(p);
    const cap = investedCapital(p);
    return <><strong className={v >= 0 ? "up" : "down"}>{signedUsd(v)}</strong><small className={v >= 0 ? "up" : "down"}>{cap ? fp(v / cap, 2) : ""}</small></>;
  } },
  { key: "weight", zh: "組合占比", ja: "構成比", group: "base", fr: 1, hint: "占目前曝險的比例", render: (p, c) => {
    if (!p.open) return dash;
    const w = c.total ? (exposureValue(p) / c.total) * 100 : 0;
    return <><span className="wbar"><i style={{ width: `${Math.min(100, w)}%`, background: c.color }} /></span><small>{w.toFixed(1)}%</small></>;
  } },
  { key: "held", zh: "持有天數", ja: "保有日数", group: "perf", fr: 0.8, hint: "自首次建倉起算；已平倉為建倉到平倉", render: (p) => {
    if (p.kind === "cash") return dash;
    const d = Math.max(1, Math.round(((p.closeDate ? new Date(p.closeDate + "T00:00:00Z").getTime() : Date.now()) - new Date(p.openDate + "T00:00:00Z").getTime()) / 864e5));
    return <><strong>{d} 天</strong><small>{p.openDate.slice(5).replace("-", "/")} 起</small></>;
  } },
  { key: "annual", zh: "年化報酬", ja: "年率リターン", group: "perf", fr: 1, hint: "單利 ＝ 報酬 × 365 ÷ 天數；下方為複利。未滿 30 天僅供參考", render: (p) => {
    if (p.kind === "cash") return dash;
    const a = p.open ? openAnnual(p) : (() => { const d = Math.max(1, Math.round((new Date(p.closeDate + "T00:00:00Z").getTime() - new Date(p.openDate + "T00:00:00Z").getTime()) / 864e5)); const r = realizedPnl(p) / investedCapital(p); return { days: d, r, simple: (r * 365) / d, compound: Math.pow(1 + r, 365 / d) - 1, short: d < 30 }; })();
    return <><strong className={a.simple >= 0 ? "up" : "down"}>{fp(a.simple)}</strong><small>{a.short ? "未滿30天·參考" : `複利 ${fp(a.compound)}`}</small></>;
  } },
  { key: "range", zh: "52 週位置", ja: "52週レンジ", group: "perf", fr: 1.3, hint: "現價落在 52 週高低區間的位置", render: (p) => {
    if (!p.hi52 || !p.lo52 || p.kind !== "stock") return dash;
    const x = Math.min(1, Math.max(0, (p.price - p.lo52) / (p.hi52 - p.lo52)));
    return <><span className="range52"><i style={{ left: `${x * 100}%` }} /></span><small>距高點 {fp(p.price / p.hi52 - 1)}</small></>;
  } },
  { key: "dte", zh: "到期天數", ja: "残存日数", group: "opt", fr: 0.8, hint: "距到期日的日曆天數（DTE）", render: (p) => { const o = optInfo(p); return o ? <><strong className={o.days <= 7 ? "down" : ""}>{o.days} 天</strong><small>{p.expiry?.slice(5).replace("-", "/")}</small></> : dash; } },
  { key: "delta", zh: "Delta", ja: "デルタ", group: "opt", fr: 0.9, hint: "部位 Delta（股數等值）；下方為每口 Delta", render: (p) => { const o = optInfo(p); return o ? <><strong>{(o.g.delta * p.qty * 100).toFixed(1)}</strong><small>每口 {o.g.delta.toFixed(2)}</small></> : dash; } },
  { key: "theta", zh: "Theta／日", ja: "セータ/日", group: "opt", fr: 0.9, hint: "每天時間價值變化（賣方為正）", render: (p) => { const o = optInfo(p); if (!o) return dash; const v = o.g.theta * p.qty * 100; return <strong className={v >= 0 ? "up" : "down"}>{v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}</strong>; } },
  { key: "moneyness", zh: "距履約價", ja: "行使価格まで", group: "opt", fr: 0.9, hint: "標的現價與履約價的距離", render: (p) => {
    const o = optInfo(p); if (!o) return dash;
    const d = (p.underlying! - p.strike!) / p.underlying!;
    const otm = p.optionType === "PUT" ? d > 0 : d < 0;
    return <><strong className={otm ? "up" : "down"}>{otm ? "價外" : "價內"} {Math.abs(d * 100).toFixed(1)}%</strong><small>標的 {usd(p.underlying!)}</small></>;
  } },
  { key: "assign", zh: "被指派機率", ja: "ITM 確率", group: "opt", fr: 0.9, hint: "Black-Scholes 估算到期價內機率（IV 手動）", render: (p) => { const o = optInfo(p); return o ? <><strong className={o.g.pItm > 0.35 ? "down" : ""}>{(o.g.pItm * 100).toFixed(0)}%</strong><small>IV {((p.iv ?? 0.3) * 100).toFixed(0)}%</small></> : dash; } },
  { key: "yield", zh: "殖利率", ja: "配当利回り", group: "fund", fr: 0.9, hint: "年化股息殖利率與預估年股息", render: (p) => p.divYield == null || p.kind !== "stock" ? dash : <><strong>{(p.divYield * 100).toFixed(2)}%</strong><small>年息 ≈ {usd(p.price * p.qty * p.divYield)}</small></> },
  { key: "beta", zh: "Beta", ja: "ベータ", group: "fund", fr: 0.8, hint: "對 SPY 的敏感度；下方為 β 加權曝險", render: (p) => p.beta == null || !p.open ? dash : <><strong>{p.beta.toFixed(2)}</strong><small>β 曝險 {usd(marketValue(p) * p.beta, 0)}</small></> },
];

const PRESETS: Record<string, { zh: string; ja: string; keys: ColKey[] }> = {
  lite: { zh: "精簡", ja: "シンプル", keys: ["value", "pnl", "weight"] },
  std: { zh: "標準", ja: "標準", keys: ["value", "cost", "day", "pnl", "weight"] },
  swing: { zh: "波段交易", ja: "スイング", keys: ["cost", "day", "pnl", "held", "annual", "range", "weight"] },
  seller: { zh: "選擇權賣方", ja: "オプション売り", keys: ["value", "pnl", "dte", "delta", "theta", "moneyness", "assign"] },
  income: { zh: "收息", ja: "インカム", keys: ["value", "pnl", "yield", "beta", "weight"] },
  all: { zh: "全部", ja: "すべて", keys: COLS.map((c) => c.key) },
};
const GROUPS: { k: ColDef["group"]; zh: string; ja: string }[] = [
  { k: "base", zh: "基本", ja: "基本" }, { k: "perf", zh: "績效", ja: "パフォーマンス" }, { k: "opt", zh: "選擇權", ja: "オプション" }, { k: "fund", zh: "基本面", ja: "ファンダメンタル" },
];

function ColumnPicker({ lang, selected, onChange }: { lang: Lang; selected: ColKey[]; onChange: (v: ColKey[]) => void }) {
  const ja = lang === "ja";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = (k: ColKey) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : COLS.filter((c) => selected.includes(c.key) || c.key === k).map((c) => c.key));
  const same = (a: ColKey[], b: ColKey[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <div className="colpick" ref={ref}>
      <button type="button" className="btn ghost" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M9.5 4.5v15M15 4.5v15" /></svg>
        {ja ? "列" : "欄位"}<span className="colpick-n">{selected.length}</span>
      </button>
      {open && (
        <div className="colpick-pop" role="dialog" aria-label={ja ? "表示する列" : "顯示欄位"}>
          <p className="colpick-cap">{ja ? "プリセット" : "常用組合"}</p>
          <div className="quick">
            {Object.entries(PRESETS).map(([k, v]) => (
              <button key={k} type="button" className={same(selected, v.keys) ? "on" : ""} onClick={() => onChange(v.keys)}>{ja ? v.ja : v.zh}</button>
            ))}
          </div>
          {GROUPS.map((g) => (
            <fieldset key={g.k} className="colpick-group">
              <legend>{ja ? g.ja : g.zh}</legend>
              {COLS.filter((c) => c.group === g.k).map((c) => (
                <label key={c.key} className="colpick-item" htmlFor={`col-${c.key}`}>
                  <input id={`col-${c.key}`} type="checkbox" checked={selected.includes(c.key)} onChange={() => toggle(c.key)} />
                  <span><b>{ja ? c.ja : c.zh}</b><small>{c.hint}</small></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

/** 方塊中的代號：日股去掉 .T、現金以幣別符號呈現 */
function tileSymbol(ticker: string) {
  if (ticker === "USD") return "$";
  if (ticker === "JPY") return "¥";
  return ticker.replace(/\.T$/, "");
}

/** 選擇權風險概覽：以 Black-Scholes 估算希臘值（IV 為手動設定） */
function OptionRisk({ positions, total, lang }: { positions: Position[]; total: number; lang: Lang }) {
  const ja = lang === "ja";
  const opts = positions.filter((p) => p.kind === "option" && p.open && p.underlying && p.strike && p.expiry);
  if (!opts.length) return null;
  const today = new Date();
  let delta = 0, theta = 0, vega = 0, collateral = 0;
  let nearest: { t: string; days: number; pItm: number } | null = null;
  for (const p of opts) {
    const days = Math.max(0, Math.round((new Date(p.expiry + "T16:00:00-04:00").getTime() - today.getTime()) / 864e5));
    const g = greeks(p.optionType as "PUT" | "CALL", p.underlying!, p.strike!, days, p.iv ?? 0.3);
    const q = p.qty * 100; // 賣方 qty 為負
    delta += g.delta * q; theta += g.theta * q; vega += g.vega * q;
    collateral += p.collateral ?? 0;
    if (!nearest || days < nearest.days) nearest = { t: `${p.ticker} ${p.strike}${p.optionType === "PUT" ? "P" : "C"}`, days, pItm: g.pItm };
  }
  const premium = 92 + 46; // 示範：本年度賣方權利金收入
  const items = [
    { k: ja ? "純デルタ" : "淨 Delta", v: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} ${ja ? "株" : "股"}`, s: ja ? "株数換算" : "股數等值", tone: "" },
    { k: ja ? "日次セータ" : "每日 Theta", v: `${theta >= 0 ? "+" : "−"}$${Math.abs(theta).toFixed(2)}`, s: ja ? "時間価値の受取" : "時間價值收入", tone: theta >= 0 ? "up" : "down" },
    { k: "Vega", v: `${vega >= 0 ? "+" : "−"}$${Math.abs(vega).toFixed(2)}`, s: ja ? "IV +1pt あたり" : "IV 每 +1 點", tone: vega >= 0 ? "up" : "down" },
    { k: ja ? "最短満期" : "最近到期", v: nearest ? `${nearest.days} ${ja ? "日" : "天"}` : "—", s: nearest?.t ?? "", tone: "" },
    { k: ja ? "ITM 確率" : "被指派機率", v: nearest ? `${(nearest.pItm * 100).toFixed(0)}%` : "—", s: ja ? "満期時 ITM" : "到期價內機率", tone: nearest && nearest.pItm > 0.35 ? "down" : "" },
    { k: ja ? "担保使用" : "擔保占比", v: `${total ? ((collateral / total) * 100).toFixed(0) : 0}%`, s: `$${collateral.toLocaleString()}`, tone: "" },
    { k: ja ? "年初来プレミアム" : "本年權利金", v: `+$${premium}`, s: ja ? "売り建て受取" : "賣方收入", tone: "up" },
  ];
  return (
    <div className="greeks" role="group" aria-label={ja ? "オプションリスク" : "選擇權風險概覽"}>
      <span className="greeks-title">{ja ? "オプション" : "選擇權風險"}<small>BS · IV {ja ? "手動" : "手動"}</small></span>
      {items.map((it) => (
        <div key={it.k} className="greek">
          <span>{it.k}</span>
          <b className={it.tone}>{it.v}</b>
          <small>{it.s}</small>
        </div>
      ))}
    </div>
  );
}

// ——— 對話框 ———

function Modal({ open, onOpenChange, title, children, side, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: React.ReactNode; side?: boolean; wide?: boolean }) {
  const container = useContext(PortalCtx);
  return (
    <Dlg.Root open={open} onOpenChange={onOpenChange}>
      <Dlg.Portal container={container ?? undefined}>
        <Dlg.Overlay className="modal-overlay" />
        <Dlg.Content className={side ? "modal sheet" : wide ? "modal wide" : "modal"} aria-describedby={undefined}
          onEscapeKeyDown={(e) => { if (document.querySelector(".modal .cal-pop, .modal .combo-list")) e.preventDefault(); }}>
          <div className="modal-head">
            <Dlg.Title>{title}</Dlg.Title>
            <Dlg.Close className="icon-btn" aria-label="關閉"><Icon.close size={16} /></Dlg.Close>
          </div>
          {children}
        </Dlg.Content>
      </Dlg.Portal>
    </Dlg.Root>
  );
}

function RocDialog({ open, onOpenChange, lang, year, summary }: {
  open: boolean; onOpenChange: (v: boolean) => void; lang: Lang; year: number;
  summary: { rows: RocRow[]; pnl: number; capitalYears: number; value: number | null };
}) {
  const ja = lang === "ja";
  const f = (v: number, dp = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={ja ? `${year} 年 加重年率 ROC の内訳` : `${year} 年度加權年化 ROC 計算明細`} wide>
      <div className="roc-formula">
        <p><b>{ja ? "加重年率 ROC" : "加權年化 ROC"}</b> ＝ Σ {ja ? "実現損益" : "已實現損益"} ÷ Σ（{ja ? "投下資本 × 保有日数 ÷ 365" : "投入資本 × 持有天數 ÷ 365"}）</p>
        <p className="mono">＝ {signedUsd(summary.pnl)} ÷ {usd(summary.capitalYears)} ＝ <b className={summary.value != null && summary.value >= 0 ? "up" : "down"}>{summary.value == null ? "—" : f(summary.value, 2)}</b></p>
      </div>
      <div className="ledger-wrap">
        <table className="ledger roc-table">
          <thead>
            <tr><th>{ja ? "銘柄" : "標的"}</th><th>{ja ? "建玉→決済" : "開倉 → 平倉"}</th><th className="r">{ja ? "日数" : "天數"}</th><th className="r">{ja ? "投下資本" : "投入資本"}</th><th className="r">{ja ? "損益" : "損益"}</th><th className="r">ROC</th><th className="r">{ja ? "単利年率" : "單利年化"}</th><th className="r">{ja ? "複利年率" : "複利年化"}</th><th className="r">{ja ? "資本×年" : "資金×年"}</th></tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.ticker}</b> <span className="muted">{r.label}</span></td>
                <td className="mono">{r.openDate.slice(5)} → {r.closeDate.slice(5)}</td>
                <td className={`r mono${r.days < 30 ? " warn" : ""}`}>{r.days}</td>
                <td className="r mono">{usd(r.capital)}</td>
                <td className={`r mono ${r.pnl >= 0 ? "up" : "down"}`}>{signedUsd(r.pnl)}</td>
                <td className={`r mono ${r.roc >= 0 ? "up" : "down"}`}>{f(r.roc, 2)}</td>
                <td className={`r mono ${r.simple >= 0 ? "up" : "down"}`}>{f(r.simple)}</td>
                <td className={`r mono ${r.compound >= 0 ? "up" : "down"}`}>{f(r.compound)}</td>
                <td className="r mono">{usd(r.capitalYears)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}>{ja ? "合計" : "合計"}</td><td className={`r mono ${summary.pnl >= 0 ? "up" : "down"}`}>{signedUsd(summary.pnl)}</td><td colSpan={3} /><td className="r mono">{usd(summary.capitalYears)}</td></tr>
          </tfoot>
        </table>
      </div>
      <ul className="roc-notes">
        <li>{ja ? "単利年率 ＝ ROC × 365 ÷ 日数；複利年率 ＝ (1 + ROC)^(365 ÷ 日数) − 1。" : "單利年化 ＝ ROC × 365 ÷ 天數；複利年化 ＝ (1 + ROC)^(365 ÷ 天數) − 1。"}</li>
        <li>{ja ? "投下資本：売りオプション＝担保金、買いオプション＝プレミアム＋手数料、株式＝取得額＋手数料。" : "投入資本：賣方選擇權＝擔保金；買方選擇權＝權利金＋手續費；股票＝買入金額＋手續費。"}</li>
        <li>{ja ? "保有 30 日未満（黄色）は年率が大きく振れるため参考値です。加重値は資本×期間で平均するので影響は小さくなります。" : "持有未滿 30 天（黃字）的單筆年化會被放大，僅供參考；加權值以「資金 × 時間」平均，短單的影響會自然變小。"}</li>
      </ul>
    </Modal>
  );
}

function ValuationDialog({ open, onOpenChange, lang, positions, onSet }: { open: boolean; onOpenChange: (v: boolean) => void; lang: Lang; positions: Position[]; onSet: (id: string, price: number) => void }) {
  const manual = positions.filter((p) => p.source === "manual" && p.open);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={lang === "ja" ? "手動評価" : "手動估值"}>
      <p className="muted small">{lang === "ja" ? "API で取得できない価格（オプション等）を手動で入力します。" : "無法由 API 取得報價的部位（如選擇權）可在此手動輸入現價。"}</p>
      <div className="val-list">
        {manual.map((p) => (
          <label key={p.id} className="val-row" htmlFor={`val-${p.id}`}>
            <ElementTile symbol={tileSymbol(p.ticker)} tag={p.optionType === "PUT" ? "P" : "C"} name={`${p.optionType} ${p.strike}`} color="var(--accent)" size={40} />
            <span><b>{p.ticker} {p.optionType} {p.strike}</b><small>到期 {p.expiry} · 成本 {usd(p.cost)}</small></span>
            <input id={`val-${p.id}`} type="number" step="0.01" min={0} defaultValue={p.price} onChange={(e) => onSet(p.id, +e.target.value)} />
          </label>
        ))}
        {manual.length === 0 && <p className="empty">{t("empty", lang)}</p>}
      </div>
    </Modal>
  );
}
