import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ElementTile, Icon } from "./Marks";
import { SECTORS, type Kind, type Position } from "@/lib/data";
import { greeks } from "@/lib/perf";
import { heldDays, simpleAnnual } from "@/lib/roc";
import { usd, type Lang } from "@/lib/wa";

export interface NewTrade {
  kind: Kind; ticker: string; side: "buy" | "sell"; qty: number; price: number;
  optionType: "PUT" | "CALL"; strike: number; expiry: string; date: string; fees: number; note: string;
}

// ——— 日期工具 ———
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isThirdFriday = (d: Date) => d.getDay() === 5 && d.getDate() >= 15 && d.getDate() <= 21;
function lastTradingDay(from: Date) {
  let d = addDays(from, -1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, -1);
  return d;
}
function nextFridays(from: Date, n: number) {
  const out: Date[] = [];
  let d = addDays(from, 1);
  while (out.length < n) { if (d.getDay() === 5) out.push(d); d = addDays(d, 1); }
  return out;
}
function nextMonthly(from: Date) {
  let d = addDays(from, 1);
  for (let i = 0; i < 70; i++) { if (isThirdFriday(d)) return d; d = addDays(d, 1); }
  return d;
}

const WEEK: Record<Lang, string[]> = { zh: ["日", "一", "二", "三", "四", "五", "六"], ja: ["日", "月", "火", "水", "木", "金", "土"] };

export function Calendar({ value, onChange, min, max, expiryMarks, lang }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; expiryMarks?: boolean; lang: Lang;
}) {
  const sel = value ? parse(value) : new Date();
  const [view, setView] = useState(() => new Date(sel.getFullYear(), sel.getMonth(), 1));
  const [focus, setFocus] = useState(() => iso(sel));
  const gridRef = useRef<HTMLDivElement>(null);
  const today = iso(new Date());
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const disabled = (d: string) => (min != null && d < min) || (max != null && d > max);

  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-d="${focus}"]`);
    if (el && gridRef.current?.contains(document.activeElement)) el.focus();
  }, [focus, view]);

  const move = (n: number) => {
    const next = addDays(parse(focus), n);
    setFocus(iso(next));
    if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) setView(new Date(next.getFullYear(), next.getMonth(), 1));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (map[e.key] != null) { e.preventDefault(); move(map[e.key]); }
    if (e.key === "PageUp") { e.preventDefault(); move(-30); }
    if (e.key === "PageDown") { e.preventDefault(); move(30); }
    if (e.key === "Home") { e.preventDefault(); onChange(today > (max ?? "9999") ? max! : today); }
  };
  const title = lang === "ja" ? `${view.getFullYear()}年 ${view.getMonth() + 1}月` : `${view.getFullYear()} 年 ${view.getMonth() + 1} 月`;
  return (
    <div className="cal" role="application" aria-label={lang === "ja" ? "カレンダー" : "日曆"}>
      <div className="cal-head">
        <button type="button" className="icon-btn" aria-label="上個月" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><Icon.chevron size={14} /></button>
        <b>{title}</b>
        <button type="button" className="icon-btn" aria-label="下個月" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><Icon.chevron size={14} /></button>
      </div>
      <div className="cal-week" aria-hidden="true">{WEEK[lang].map((w, i) => <span key={w} className={i === 0 || i === 6 ? "we" : ""}>{w}</span>)}</div>
      <div className="cal-grid" ref={gridRef} role="grid" onKeyDown={onKey}>
        {days.map((d) => {
          const s = iso(d);
          const out = d.getMonth() !== view.getMonth();
          const dis = disabled(s);
          const cls = [
            "cal-day", out && "out", s === value && "sel", s === today && "today",
            (d.getDay() === 0 || d.getDay() === 6) && "we",
            expiryMarks && d.getDay() === 5 && "fri", expiryMarks && isThirdFriday(d) && "monthly",
          ].filter(Boolean).join(" ");
          return (
            <button key={s} type="button" data-d={s} className={cls} disabled={dis} tabIndex={s === focus ? 0 : -1}
              aria-pressed={s === value} aria-label={s} onClick={() => { setFocus(s); onChange(s); }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      {expiryMarks && <p className="cal-legend"><i className="fri" />{lang === "ja" ? "週次（金）" : "週選（五）"}<i className="monthly" />{lang === "ja" ? "月次（第3金）" : "月選（第三個週五）"}</p>}
    </div>
  );
}

export function DateField({ id, label, value, onChange, min, max, quick, expiryMarks, lang }: {
  id: string; label: string; value: string; onChange: (v: string) => void; min?: string; max?: string;
  quick: { label: string; value: string }[]; expiryMarks?: boolean; lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const d = value ? parse(value) : null;
  const diff = d ? Math.round((d.getTime() - parse(iso(new Date())).getTime()) / 864e5) : 0;
  const rel = !d ? "" : diff === 0 ? (lang === "ja" ? "今日" : "今天") : diff < 0 ? (lang === "ja" ? `${-diff}日前` : `${-diff} 天前`) : (lang === "ja" ? `${diff}日後` : `${diff} 天後`);
  return (
    <div className="datefield" ref={wrap}>
      <span className="f-label" id={`${id}-label`}>{label}</span>
      <button type="button" id={id} className="date-btn" aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`${id}-label ${id}`} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>
        <b>{d ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEK[lang][d.getDay()]}）` : "—"}</b>
        <small>{rel}</small>
      </button>
      <div className="quick">
        {quick.map((q) => (
          <button key={q.label} type="button" className={q.value === value ? "on" : ""} onClick={() => onChange(q.value)}>{q.label}</button>
        ))}
      </div>
      {open && (
        <div className="cal-pop" role="dialog" aria-label={label}>
          <Calendar value={value} min={min} max={max} expiryMarks={expiryMarks} lang={lang} onChange={(v) => { onChange(v); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

// 示範報價（正式站改由 /api/symbols 與 /api/quotes 提供）
const DIRECTORY: { t: string; n: string; p: number; s: number }[] = [
  { t: "AAPL", n: "Apple", p: 228.9, s: 0 }, { t: "AMZN", n: "Amazon", p: 219.4, s: 0 }, { t: "GOOGL", n: "Alphabet", p: 247.1, s: 0 },
  { t: "META", n: "Meta Platforms", p: 745.2, s: 2 }, { t: "TSLA", n: "Tesla", p: 412.3, s: 0 }, { t: "KO", n: "Coca-Cola", p: 69.8, s: 3 },
  { t: "CNC", n: "Centene", p: 33.1, s: 4 }, { t: "SPY", n: "SPDR S&P 500 ETF", p: 661.2, s: 1 }, { t: "BOXX", n: "Alpha Architect 1-3M T-Bill", p: 115.03, s: 5 },
  { t: "7203.T", n: "Toyota Motor", p: 2890, s: 2 }, { t: "6758.T", n: "Sony Group", p: 4120, s: 2 },
];

export default function TradeForm({ lang, positions, onSubmit, palette }: {
  lang: Lang; positions: Position[]; onSubmit: (t: NewTrade) => void; palette: string[];
}) {
  const ja = lang === "ja";
  const todayD = useMemo(() => new Date(), []);
  const today = iso(todayD);
  const [kind, setKind] = useState<Kind>("stock");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [optionType, setOptionType] = useState<"PUT" | "CALL">("PUT");
  const [ticker, setTicker] = useState("");
  const [query, setQuery] = useState("");
  const [suggest, setSuggest] = useState(false);
  const [hi, setHi] = useState(0);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState<number | "">("");
  const [strike, setStrike] = useState<number | "">("");
  const [date, setDate] = useState(today);
  const [expiry, setExpiry] = useState(() => iso(nextFridays(new Date(), 3)[2]));
  const [fees, setFees] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);

  // 可選標的：持倉優先，再加上常用清單
  const universe = useMemo(() => {
    const map = new Map<string, { t: string; n: string; p: number; s: number; held?: Position }>();
    for (const p of positions) {
      if (p.kind === "cash") continue;
      const px = p.kind === "option" ? p.underlying ?? 0 : p.price;
      if (!map.has(p.ticker) || p.open) map.set(p.ticker, { t: p.ticker, n: p.name, p: px || map.get(p.ticker)?.p || 0, s: p.sector, held: p.kind === "stock" && p.open ? p : map.get(p.ticker)?.held });
    }
    for (const d of DIRECTORY) if (!map.has(d.t)) map.set(d.t, d);
    return [...map.values()];
  }, [positions]);
  const matches = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = q ? universe.filter((u) => u.t.startsWith(q) || u.n.toUpperCase().includes(q)) : universe.filter((u) => u.held);
    return list.slice(0, 6);
  }, [query, universe]);
  const info = universe.find((u) => u.t === ticker);
  const S = info?.p ?? 0;
  const yen = ticker.endsWith(".T");
  const money = (v: number) => (yen ? `¥${Math.round(v).toLocaleString()}` : usd(v));

  const choose = (t: string) => {
    const u = universe.find((x) => x.t === t);
    setTicker(t); setQuery(t); setSuggest(false);
    if (u && kind === "stock") setPrice(u.p);
    if (u && kind === "option") {
      const inc = u.p < 25 ? 0.5 : u.p < 100 ? 1 : u.p < 250 ? 2.5 : 5;
      setStrike(optionType === "PUT" ? Math.floor((u.p * 0.95) / inc) * inc : Math.ceil((u.p * 1.05) / inc) * inc);
    }
  };

  // 選擇權：到期日快選與履約價快選
  const fridays = useMemo(() => nextFridays(todayD, 4), [todayD]);
  const monthly = useMemo(() => nextMonthly(addDays(todayD, 20)), [todayD]);
  const inc = S < 25 ? 0.5 : S < 100 ? 1 : S < 250 ? 2.5 : 5;
  const strikes = useMemo(() => {
    if (!S) return [];
    const base = optionType === "PUT" ? Math.floor(S / inc) * inc : Math.ceil(S / inc) * inc;
    return Array.from({ length: 5 }, (_, k) => +(optionType === "PUT" ? base - k * inc : base + k * inc).toFixed(2));
  }, [S, inc, optionType]);
  const dte = kind === "option" && expiry ? Math.max(0, heldDays(today, expiry) ) : 0;
  const K = typeof strike === "number" ? strike : 0;
  const px = typeof price === "number" ? price : 0;
  const fee = typeof fees === "number" ? fees : 0;
  const g = kind === "option" && S && K && dte ? greeks(optionType, S, K, dte, 0.3) : null;
  const fair = useMemo(() => {
    if (!g || !S || !K) return null;
    // 以 Black-Scholes（IV 30%）估算理論價，作為填入權利金的參考
    const T = dte / 365, r = 0.043, iv = 0.3;
    const d1 = (Math.log(S / K) + (r + iv * iv / 2) * T) / (iv * Math.sqrt(T));
    const d2 = d1 - iv * Math.sqrt(T);
    const N = (x: number) => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
    const call = S * N(d1) - K * Math.exp(-r * T) * N(d2);
    const put = call - S + K * Math.exp(-r * T);
    return Math.max(0.01, +(optionType === "CALL" ? call : put).toFixed(2));
  }, [g, S, K, dte, optionType]);

  // 即時試算
  const held = info?.held;
  const summary: { k: string; v: string; tone?: string }[] = [];
  if (kind === "stock" && px && qty) {
    const amount = px * qty + fee;
    summary.push({ k: side === "buy" ? (ja ? "約定金額" : "成交金額") : (ja ? "受取金額" : "收回金額"), v: money(side === "buy" ? amount : px * qty - fee) });
    if (held && side === "buy") summary.push({ k: ja ? "買い増し後の平均単価" : "加碼後均價", v: money((held.cost * held.qty + px * qty) / (held.qty + qty)) });
    if (held && side === "sell") {
      const pnl = (px - held.cost) * Math.min(qty, held.qty) - fee;
      summary.push({ k: ja ? "推定実現損益" : "預估已實現損益", v: `${pnl >= 0 ? "+" : "−"}${money(Math.abs(pnl))}`, tone: pnl >= 0 ? "up" : "down" });
      summary.push({ k: ja ? "保有日数" : "持有天數", v: `${heldDays(held.openDate, date)} ${ja ? "日" : "天"}` });
    }
  }
  if (kind === "option" && px && qty && K) {
    const prem = px * 100 * qty;
    if (side === "sell") {
      const collateral = optionType === "PUT" ? K * 100 * qty : 0;
      summary.push({ k: ja ? "プレミアム受取" : "權利金收入", v: `+${money(prem - fee)}`, tone: "up" });
      if (optionType === "PUT") summary.push({ k: ja ? "担保金" : "擔保金", v: money(collateral) });
      else summary.push({ k: ja ? "カバー" : "備兌", v: held && held.qty >= 100 * qty ? (ja ? "保有株でカバー" : "持股足夠，備兌") : (ja ? "証拠金が必要" : "需保證金（未備兌）"), tone: held && held.qty >= 100 * qty ? "" : "down" });
      summary.push({ k: ja ? "損益分岐点" : "損益兩平", v: money(optionType === "PUT" ? K - px : K + px) });
      if (collateral && dte) summary.push({ k: ja ? "年率 ROC（単利）" : "年化 ROC（單利）", v: `${(simpleAnnual((prem - fee) / collateral, dte) * 100).toFixed(1)}%`, tone: "up" });
      if (g) summary.push({ k: ja ? "ITM 確率" : "被指派機率", v: `${(g.pItm * 100).toFixed(0)}%`, tone: g.pItm > 0.35 ? "down" : "" });
    } else {
      summary.push({ k: ja ? "コスト（最大損失）" : "成本（最大虧損）", v: money(prem + fee), tone: "down" });
      summary.push({ k: ja ? "損益分岐点" : "損益兩平", v: money(optionType === "PUT" ? K - px : K + px) });
      if (g) summary.push({ k: ja ? "ITM 確率" : "到期價內機率", v: `${(g.pItm * 100).toFixed(0)}%` });
    }
    summary.push({ k: ja ? "満期まで" : "距到期", v: `${dte} ${ja ? "日" : "天"}` });
  }
  if (kind === "cash" && px) summary.push({ k: ja ? "USD 換算" : "換算 USD", v: ticker === "JPY" ? usd(px / 147.62) : usd(px) });

  const errors: string[] = [];
  if (kind !== "cash" && !ticker) errors.push(ja ? "銘柄を選択" : "選擇標的");
  if (!px) errors.push(kind === "cash" ? (ja ? "金額を入力" : "輸入金額") : kind === "option" ? (ja ? "プレミアムを入力" : "輸入權利金") : (ja ? "価格を入力" : "輸入成交價"));
  if (kind === "option" && !K) errors.push(ja ? "権利行使価格" : "選擇履約價");
  if (kind === "option" && expiry <= date) errors.push(ja ? "満期日は取引日より後" : "到期日需晚於交易日");
  const valid = errors.length === 0 && qty > 0;

  const verb = side === "buy" ? (kind === "cash" ? (ja ? "入金" : "存入") : ja ? "買い" : "買入") : kind === "cash" ? (ja ? "出金" : "提出") : ja ? "売り" : "賣出";
  const what = kind === "option" ? `${qty} ${ja ? "枚" : "口"} ${ticker || "—"} ${K || "—"}${optionType === "PUT" ? "P" : "C"}` : kind === "stock" ? `${qty} ${ja ? "株" : "股"} ${ticker || "—"}` : `${ticker || "USD"} ${px ? px.toLocaleString() : ""}`;

  const submit = () => {
    if (!valid) return;
    onSubmit({ kind, ticker: kind === "cash" ? ticker || "USD" : ticker, side, qty, price: px, optionType, strike: K, expiry, date, fees: fee, note });
  };

  const setKindSafe = (k: Kind) => {
    setKind(k); setPrice(""); setStrike("");
    if (k === "cash") { setTicker("USD"); setQuery("USD"); setSide("buy"); }
    else if (ticker === "USD" || ticker === "JPY") { setTicker(""); setQuery(""); }
    if (k === "option") setSide("sell");
  };
  const onTickerKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggest || !matches.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % matches.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); }
    if (e.key === "Enter") { e.preventDefault(); choose(matches[hi].t); }
  };

  return (
    <form className="tform" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="tform-row">
        <div className="seg seg-full" role="group" aria-label="類型">
          {(["stock", "option", "cash"] as Kind[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKindSafe(k)}>
              {k === "stock" ? (ja ? "株式" : "股票") : k === "option" ? (ja ? "オプション" : "選擇權") : (ja ? "現金" : "現金")}
            </button>
          ))}
        </div>
      </div>

      {kind === "option" ? (
        <div className="strategy" role="radiogroup" aria-label="策略">
          {([["sell", "PUT"], ["sell", "CALL"], ["buy", "PUT"], ["buy", "CALL"]] as const).map(([sd, ot]) => (
            <button key={sd + ot} type="button" role="radio" aria-checked={side === sd && optionType === ot} className={side === sd && optionType === ot ? "on" : ""}
              onClick={() => { setSide(sd); setOptionType(ot); if (S) { const b = ot === "PUT" ? Math.floor((S * 0.95) / inc) * inc : Math.ceil((S * 1.05) / inc) * inc; setStrike(b); } }}>
              <b>{sd === "sell" ? (ja ? "売り" : "賣出") : (ja ? "買い" : "買入")} {ot}</b>
              <small>{sd === "sell" ? (ot === "PUT" ? (ja ? "キャッシュ担保" : "現金擔保收租") : (ja ? "カバードコール" : "備兌收租")) : ot === "PUT" ? (ja ? "下落ヘッジ" : "避險／看空") : (ja ? "上昇に賭ける" : "看多槓桿")}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="seg seg-full" role="group" aria-label="方向">
          <button type="button" className={side === "buy" ? "on" : ""} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>{kind === "cash" ? (ja ? "入金" : "存入") : (ja ? "買い" : "買入")}</button>
          <button type="button" className={side === "sell" ? "on" : ""} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>{kind === "cash" ? (ja ? "出金" : "提出") : (ja ? "売り" : "賣出")}</button>
        </div>
      )}

      <div className="tform-grid">
        {kind === "cash" ? (
          <label className="field" htmlFor="tf-cur">
            <span className="f-label">{ja ? "通貨" : "幣別"}</span>
            <div className="seg seg-full" id="tf-cur" role="group">
              {["USD", "JPY"].map((c) => <button key={c} type="button" className={ticker === c ? "on" : ""} onClick={() => { setTicker(c); setQuery(c); }}>{c}</button>)}
            </div>
          </label>
        ) : (
          <div className="field combo">
            <label className="f-label" htmlFor="tf-ticker">{kind === "option" ? (ja ? "原資産" : "標的") : (ja ? "銘柄" : "標的")}</label>
            <div className="combo-box">
              <Icon.search size={15} />
              <input id="tf-ticker" autoComplete="off" placeholder={ja ? "例：MSFT、7203" : "輸入代號或名稱，例：MSFT"} value={query}
                role="combobox" aria-expanded={suggest} aria-controls="tf-list"
                onFocus={() => setSuggest(true)} onBlur={() => setTimeout(() => setSuggest(false), 150)}
                onChange={(e) => { setQuery(e.target.value); setTicker(""); setSuggest(true); setHi(0); }} onKeyDown={onTickerKey} />
              {ticker && info && <span className="combo-px">{money(S)}</span>}
            </div>
            {suggest && matches.length > 0 && (
              <ul className="combo-list" id="tf-list" role="listbox">
                {!query.trim() && <li className="combo-cap">{ja ? "保有中" : "目前持有"}</li>}
                {matches.map((m, i) => (
                  <li key={m.t} role="option" aria-selected={i === hi} className={i === hi ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); choose(m.t); }} onMouseEnter={() => setHi(i)}>
                    <ElementTile symbol={m.t.replace(/\.T$/, "")} name={SECTORS[m.s]} color={palette[m.s % palette.length]} size={30} />
                    <span><b>{m.t}</b><small>{m.n}</small></span>
                    <em>{m.t.endsWith(".T") ? `¥${m.p.toLocaleString()}` : usd(m.p)}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DateField id="tf-date" label={kind === "option" ? (ja ? "取引日" : "成交日") : side === "buy" ? (ja ? "購入日" : "買入日期") : (ja ? "売却日" : "賣出日期")} value={date} onChange={setDate} max={today} lang={lang}
          quick={[{ label: ja ? "今日" : "今天", value: today }, { label: ja ? "前営業日" : "上個交易日", value: iso(lastTradingDay(todayD)) }, { label: ja ? "1週間前" : "一週前", value: iso(addDays(todayD, -7)) }]} />

        {kind === "option" && (
          <DateField id="tf-exp" label={ja ? "満期日" : "到期日"} value={expiry} onChange={setExpiry} min={iso(addDays(todayD, 1))} expiryMarks lang={lang}
            quick={[...fridays.map((f) => ({ label: `${f.getMonth() + 1}/${f.getDate()}${isThirdFriday(f) ? (ja ? " 月" : " 月選") : ""}`, value: iso(f) })), ...(fridays.some((f) => iso(f) === iso(monthly)) ? [] : [{ label: `${monthly.getMonth() + 1}/${monthly.getDate()} ${ja ? "月次" : "月選"}`, value: iso(monthly) }])]} />
        )}

        {kind === "option" && (
          <div className="field">
            <label className="f-label" htmlFor="tf-strike">{ja ? "権利行使価格" : "履約價"}{S ? <em className="f-hint">{ja ? "原資産" : "現價"} {money(S)}</em> : null}</label>
            <input id="tf-strike" type="number" inputMode="decimal" step="any" min={0} value={strike} onChange={(e) => setStrike(e.target.value === "" ? "" : +e.target.value)} />
            {strikes.length > 0 && (
              <div className="quick">
                {strikes.map((k) => (
                  <button key={k} type="button" className={k === strike ? "on" : ""} onClick={() => setStrike(k)}>
                    {k}<small>{S ? `${(((k - S) / S) * 100).toFixed(1)}%` : ""}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="field">
          <span className="f-label" id="tf-qty-l">{kind === "option" ? (ja ? "枚数" : "口數") : kind === "cash" ? (ja ? "—" : "—") : (ja ? "株数" : "股數")}</span>
          {kind !== "cash" ? (
            <div className="stepper" role="group" aria-labelledby="tf-qty-l">
              <button type="button" aria-label="減少" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <input id="tf-qty" type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(+e.target.value || 1)))} aria-labelledby="tf-qty-l" />
              <button type="button" aria-label="增加" onClick={() => setQty((q) => q + 1)}>+</button>
            </div>
          ) : <span className="muted small">{ja ? "金額のみ入力" : "只需輸入金額"}</span>}
        </div>

        <div className="field">
          <label className="f-label" htmlFor="tf-price">
            {kind === "option" ? (ja ? "プレミアム（1株）" : "權利金（每股）") : kind === "cash" ? (ja ? "金額" : "金額") : (ja ? "約定価格" : "成交價")}
          </label>
          <div className="price-box">
            <input id="tf-price" type="number" inputMode="decimal" step="any" min={0} value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : +e.target.value)} />
            {kind === "stock" && S > 0 && <button type="button" className="chip-btn" onClick={() => setPrice(S)}>{ja ? "現在値" : "帶入現價"}</button>}
            {kind === "option" && fair && <button type="button" className="chip-btn" onClick={() => setPrice(fair)} title="Black-Scholes · IV 30%">{ja ? "理論値" : "理論價"} {fair}</button>}
          </div>
        </div>
      </div>

      <button type="button" className="more-toggle" aria-expanded={more} onClick={() => setMore((v) => !v)}>
        {more ? "−" : "+"} {ja ? "手数料・メモ" : "手續費與備註（選填）"}
      </button>
      {more && (
        <div className="tform-grid">
          <label className="field" htmlFor="tf-fee"><span className="f-label">{ja ? "手数料" : "手續費"}</span><input id="tf-fee" type="number" inputMode="decimal" step="any" min={0} value={fees} onChange={(e) => setFees(e.target.value === "" ? "" : +e.target.value)} /></label>
          <label className="field wide" htmlFor="tf-note"><span className="f-label">{ja ? "メモ" : "備註"}</span><input id="tf-note" value={note} placeholder={ja ? "戦略・理由" : "策略、進場理由"} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
      )}

      <div className="tsum" aria-live="polite">
        {summary.length ? summary.map((s) => (
          <div key={s.k}><span>{s.k}</span><b className={s.tone}>{s.v}</b></div>
        )) : <p className="muted small">{ja ? "入力すると試算が表示されます" : "填入標的與價格後，這裡會即時試算成本、擔保與年化報酬"}</p>}
      </div>

      <div className="form-foot">
        <span className="muted small">{errors.length ? `${ja ? "未入力" : "尚缺"}：${errors.join("、")}` : ""}</span>
        <button type="submit" className="btn primary" disabled={!valid}>
          <Icon.plus size={16} />{ja ? "追加" : "新增"} · {verb} {what}
        </button>
      </div>
    </form>
  );
}
