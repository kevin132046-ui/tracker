import { memo, useMemo, useState } from "react";
import { PanelHead, RIcon } from "./common";
import { useElementWidth } from "./util";
import {
  MINUS, calculateDcf, clamp, dcfFromFundamentals, dcfLimits, dcfModelErrors, fmtNum, fmtPct, fmtPrice, fmtSignedPct, normalizeDcf,
  readScenarios, ticksWithin, tr, writeScenarios,
  type Currency, type DcfField, type DcfInputs, type DcfResult, type DcfScenario, type FieldLimit, type Fundamentals, type RLang,
} from "@/lib/research";

interface FieldDef { k: DcfField; zh: string; ja: string; unit: (cur: Currency, lang: RLang) => string; step: string }

const BASE_FIELDS: FieldDef[] = [
  { k: "currentPrice", zh: "目前股價", ja: "現在の株価", unit: (cur) => cur, step: "0.01" },
  { k: "freeCashFlow", zh: "TTM 自由現金流（十億）", ja: "TTM フリーCF（十億）", unit: () => "B", step: "0.1" },
  { k: "shares", zh: "稀釋後股數（十億股）", ja: "希薄化後株式数（十億株）", unit: () => "B", step: "0.01" },
  { k: "netCash", zh: "淨現金／（淨負債）（十億）", ja: "ネットキャッシュ／（純負債）（十億）", unit: () => "B", step: "0.1" },
];
const MODEL_FIELDS: FieldDef[] = [
  { k: "growth", zh: "FCF 年成長率", ja: "FCF 年成長率", unit: () => "%", step: "0.5" },
  { k: "years", zh: "預測年數", ja: "予測年数", unit: (_c, lang) => tr(lang, "年", "年"), step: "1" },
  { k: "wacc", zh: "WACC", ja: "WACC", unit: () => "%", step: "0.1" },
  { k: "terminalGrowth", zh: "永續成長率", ja: "永続成長率", unit: () => "%", step: "0.1" },
  { k: "marginOfSafety", zh: "安全邊際", ja: "安全マージン", unit: () => "%", step: "1" },
];

const num4 = (v: number) => String(Number(v.toFixed(4)));

function rangeMessage(k: DcfField, lim: FieldLimit, lang: RLang) {
  switch (k) {
    case "currentPrice": return tr(lang, "股價不可為負數", "株価は 0 以上で入力してください");
    case "freeCashFlow": return tr(lang, "自由現金流不可為負數（需大於 0 才能估值）", "FCF は 0 以上で入力してください（評価には 0 超が必要）");
    case "shares": return tr(lang, "股數不可為負數", "株式数は 0 以上で入力してください");
    case "growth": return tr(lang, "FCF 成長率需介於 −50% 至 50%", "FCF 成長率は −50〜50% の範囲で入力してください");
    case "years": return tr(lang, "預測年數需為 3 至 10 的整數", "予測年数は 3〜10 の整数で入力してください");
    case "wacc": return tr(lang, "WACC 需介於 4% 至 25%", "WACC は 4〜25% の範囲で入力してください");
    case "terminalGrowth": {
      const max = num4(lim.max ?? 3.5);
      return tr(lang, `永續成長率需介於 −2% 至 ${max}%（上限 3.5%，且至少低於 WACC 1 個百分點）`, `永続成長率は −2〜${max}% の範囲で入力してください（上限 3.5%、WACC より 1pt 以上低く）`);
    }
    case "marginOfSafety": return tr(lang, "安全邊際需介於 0% 至 90%", "安全マージンは 0〜90% の範囲で入力してください");
    default: return "";
  }
}

function withinLimit(v: number, lim: FieldLimit) {
  if (lim.min != null && v < lim.min) return false;
  if (lim.max != null && v > lim.max) return false;
  if (lim.integer && !Number.isInteger(v)) return false;
  return true;
}

function clampToLimit(v: number, lim: FieldLimit) {
  let x = clamp(v, lim.min ?? -Infinity, lim.max ?? Infinity);
  if (lim.integer) x = Math.round(x);
  return x;
}

/** 數字欄：輸入中即時驗證（有效才更新模型），離開欄位時夾回有效範圍 */
function NumField({ id, def, value, limit, cur, lang, onCommit }: {
  id: string;
  def: FieldDef;
  value: number;
  limit: FieldLimit;
  cur: Currency;
  lang: RLang;
  onCommit: (k: DcfField, v: number) => void;
}) {
  const [draft, setDraft] = useState(num4(value));
  const [focused, setFocused] = useState(false);
  const [synced, setSynced] = useState(value);
  const [note, setNote] = useState("");
  if (!focused && value !== synced) {
    setSynced(value);
    setDraft(num4(value));
  }
  const raw = draft.trim();
  const parsed = raw === "" ? null : Number(raw);
  const invalidNumber = raw !== "" && !Number.isFinite(parsed);
  const outOfRange = parsed != null && Number.isFinite(parsed) && !withinLimit(parsed, limit);
  const error = invalidNumber ? tr(lang, "請輸入數字", "数値を入力してください") : outOfRange ? rangeMessage(def.k, limit, lang) : "";
  const errId = `${id}-msg`;

  return (
    <label className={`rs-field${error ? " has-err" : ""}`} htmlFor={id}>
      <span className="rs-field-label">{lang === "ja" ? def.ja : def.zh}</span>
      <span className="rs-input-shell">
        <input
          id={id}
          className="rs-input"
          type="number"
          inputMode="decimal"
          step={def.step}
          min={limit.min}
          max={limit.max}
          value={draft}
          aria-invalid={!!error}
          aria-describedby={error || note ? errId : undefined}
          onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            setNote("");
            const p = v.trim() === "" ? NaN : Number(v);
            if (Number.isFinite(p) && withinLimit(p, limit)) onCommit(def.k, p);
          }}
          onBlur={() => {
            setFocused(false);
            if (parsed == null || !Number.isFinite(parsed)) {
              setDraft(num4(value));
              return;
            }
            if (!withinLimit(parsed, limit)) {
              const c = clampToLimit(parsed, limit);
              setDraft(num4(c));
              onCommit(def.k, c);
              setNote(tr(lang, `已調整為 ${num4(c)}`, `${num4(c)} に調整しました`));
              return;
            }
            setDraft(num4(parsed));
          }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          onWheel={(e) => { if (document.activeElement === e.currentTarget) e.currentTarget.blur(); }}
        />
        <i>{def.unit(cur, lang)}</i>
      </span>
      {(error || note) && <span id={errId} className={error ? "rs-field-err" : "rs-field-note"} role={error ? "alert" : undefined}>{error || note}</span>}
    </label>
  );
}

export const DcfView = memo(function DcfView({ ticker, name, price, lang, f, inputs, edited, onInputs, onReset }: {
  ticker: string;
  name: string;
  price: number;
  lang: RLang;
  f: Fundamentals;
  inputs: DcfInputs;
  edited: boolean;
  onInputs: (next: DcfInputs) => void;
  onReset: () => void;
}) {
  const cur = f.currency;
  const result = useMemo(() => calculateDcf(inputs), [inputs]);
  const errors = useMemo(() => dcfModelErrors(inputs, lang), [inputs, lang]);
  const limits = dcfLimits(inputs);
  const [scenarios, setScenarios] = useState<DcfScenario[]>(() => readScenarios());
  const mine = scenarios.filter((s) => s.ticker === ticker);
  const [scName, setScName] = useState(`${ticker} Base`);
  const [picked, setPicked] = useState("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const pickedId = mine.some((s) => s.id === picked) ? picked : mine[0]?.id ?? "";
  const commit = (k: DcfField, v: number) => onInputs(normalizeDcf({ ...inputs, [k]: v }));
  const unitB = tr(lang, "十億", "十億");

  const fill = () => {
    const v = dcfFromFundamentals(f);
    const next = normalizeDcf({
      ...inputs,
      currentPrice: price > 0 ? Number(price.toFixed(2)) : inputs.currentPrice,
      freeCashFlow: v.freeCashFlow ?? inputs.freeCashFlow,
      shares: v.shares ?? inputs.shares,
      netCash: v.netCash ?? inputs.netCash,
    });
    onInputs(next);
    setMsg({
      tone: "ok",
      text: tr(lang,
        `已帶入 ${ticker} 財務資料：FCF ${fmtNum(next.freeCashFlow)}、股數 ${fmtNum(next.shares, 3)}、淨現金 ${fmtNum(next.netCash)}（十億）；股價 ${fmtPrice(next.currentPrice, cur)}`,
        `${ticker} の財務データを反映：FCF ${fmtNum(next.freeCashFlow)}・株式数 ${fmtNum(next.shares, 3)}・ネットキャッシュ ${fmtNum(next.netCash)}（十億）、株価 ${fmtPrice(next.currentPrice, cur)}`),
    });
  };

  const save = () => {
    const nm = scName.trim();
    if (!nm) {
      setMsg({ tone: "err", text: tr(lang, "請先輸入情境名稱。", "シナリオ名を入力してください。") });
      return;
    }
    const existing = scenarios.find((s) => s.ticker === ticker && s.name === nm);
    const entry: DcfScenario = {
      id: existing?.id ?? `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: nm, ticker, inputs, savedAt: new Date().toISOString(),
    };
    const next = [entry, ...scenarios.filter((s) => s.id !== entry.id)];
    const ok = writeScenarios(next);
    setScenarios(next);
    setPicked(entry.id);
    setMsg(ok
      ? { tone: "ok", text: existing ? tr(lang, `已更新「${nm}」。`, `「${nm}」を上書き保存しました。`) : tr(lang, `已儲存「${nm}」。`, `「${nm}」を保存しました。`) }
      : { tone: "err", text: tr(lang, "無法寫入瀏覽器儲存空間（可能為無痕模式）；情境只保留到關閉頁面。", "ブラウザのストレージに保存できませんでした（プライベートモードなど）。ページを閉じるまで保持します。") });
  };

  const load = () => {
    const s = mine.find((x) => x.id === pickedId);
    if (!s) return;
    const normalized = normalizeDcf(s.inputs);
    onInputs(normalized);
    setScName(s.name);
    setMsg({ tone: "ok", text: tr(lang, `已載入「${s.name}」。`, `「${s.name}」を読み込みました。`) });
  };

  const remove = () => {
    const s = mine.find((x) => x.id === pickedId);
    if (!s) return;
    const next = scenarios.filter((x) => x.id !== s.id);
    const ok = writeScenarios(next);
    setScenarios(next);
    setPicked("");
    setMsg(ok ? { tone: "ok", text: tr(lang, `已刪除「${s.name}」。`, `「${s.name}」を削除しました。`) } : { tone: "err", text: tr(lang, "無法更新瀏覽器儲存空間。", "ブラウザのストレージを更新できませんでした。") });
  };

  const upside = result?.upside ?? null;
  const share = result?.terminalShare ?? null;
  const warn = share != null && share > 0.75;
  const dateFmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <section className="rs-panel" aria-labelledby="rs-dcf-title">
      <PanelHead
        eyebrow="Valuation workspace"
        id="rs-dcf-title"
        title={tr(lang, "DCF 內在價值試算", "DCF 理論株価の試算")}
        meta={<>{name}<span className="rs-dot">·</span>{tr(lang, "以自由現金流、WACC 與永續成長率估算企業價值", "FCF・WACC・永続成長率から企業価値を推計")}</>}
        aside={
          <div className="rs-head-actions">
            {edited && (
              <button type="button" className="rs-btn ghost" onClick={() => { onReset(); setMsg({ tone: "ok", text: tr(lang, "已恢復預設假設。", "初期値に戻しました。") }); }}>
                <RIcon name="reset" size={15} />{tr(lang, "恢復預設", "初期値に戻す")}
              </button>
            )}
            <button type="button" className="rs-btn primary" onClick={fill}>
              <RIcon name="import" size={15} />{tr(lang, "用財務資料帶入", "財務データを反映")}
            </button>
          </div>
        }
      />

      <div className="rs-scen" role="group" aria-label={tr(lang, "估值情境", "評価シナリオ")}>
        <div className="rs-scen-row">
          <label className="rs-scen-name" htmlFor="rs-scen-name">
            <span>{tr(lang, "情境名稱", "シナリオ名")}</span>
            <input id="rs-scen-name" className="rs-input" value={scName} maxLength={40} onChange={(e) => setScName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
          </label>
          <button type="button" className="rs-btn" onClick={save}><RIcon name="save" size={15} />{tr(lang, "儲存情境", "シナリオを保存")}</button>
        </div>
        <div className="rs-scen-row">
          <label className="rs-scen-list" htmlFor="rs-scen-select">
            <span>{tr(lang, `已儲存（${ticker}）`, `保存済み（${ticker}）`)}</span>
            <select id="rs-scen-select" className="rs-input" value={pickedId} disabled={!mine.length} onChange={(e) => setPicked(e.target.value)}>
              {mine.length ? mine.map((s) => <option key={s.id} value={s.id}>{s.name}{s.savedAt ? ` · ${dateFmt(s.savedAt)}` : ""}</option>)
                : <option value="">{tr(lang, "尚未保存估值情境", "保存済みシナリオはありません")}</option>}
            </select>
          </label>
          <button type="button" className="rs-btn" disabled={!pickedId} onClick={load}><RIcon name="load" size={15} />{tr(lang, "載入", "読み込む")}</button>
          <button type="button" className="rs-btn danger" disabled={!pickedId} onClick={remove}><RIcon name="trash" size={15} />{tr(lang, "刪除", "削除")}</button>
        </div>
      </div>
      {msg && <p className={`rs-status ${msg.tone === "err" ? "is-err" : ""}`} role="status">{msg.text}</p>}

      <div className="rs-sum">
        <article className="rs-card rs-sum-hero">
          <span>{tr(lang, "每股內在價值", "1株あたり理論価値")}</span>
          <strong>{result ? fmtPrice(result.intrinsicValue, cur) : "—"}</strong>
          <small>Base case<span className="rs-dot">·</span>{tr(lang, "目前股價", "現在値")} {fmtPrice(inputs.currentPrice, cur)}</small>
        </article>
        <article className={`rs-card rs-sum-card${upside == null ? "" : upside >= 0 ? " is-up" : " is-down"}`}>
          <span>{upside == null || upside >= 0 ? tr(lang, "相對現價上檔", "現在値からの上値余地") : tr(lang, "相對現價下檔", "現在値からの下値余地")}</span>
          <strong>{upside == null ? "—" : fmtSignedPct(upside, 1)}</strong>
          <small>{tr(lang, "內在價值 ÷ 現價 − 1", "理論価値 ÷ 現在値 − 1")}</small>
        </article>
        <article className="rs-card rs-sum-card">
          <span>{tr(lang, "安全邊際買入價", "安全マージン考慮の買値")}</span>
          <strong>{result ? fmtPrice(result.buyBelow, cur) : "—"}</strong>
          <small>{num4(inputs.marginOfSafety)}% margin of safety</small>
        </article>
        <article className={`rs-card rs-sum-card rs-sum-share${warn ? " is-warn" : ""}`}>
          <span>{tr(lang, "終值占企業價值比例", "企業価値に占める TV")}</span>
          <strong>{share == null ? "—" : fmtPct(share, 1)}</strong>
          <span className="rs-meter" aria-hidden="true"><i style={{ width: `${clamp((share ?? 0) * 100, 0, 100)}%` }} /><b /></span>
          <small>{warn ? <><RIcon name="warn" size={13} />{tr(lang, "偏高：對折現假設敏感", "高め：割引前提に敏感")}</> : tr(lang, "75% 以下較穩健", "75% 以下が目安")}</small>
        </article>
      </div>

      <div className="rs-dcf-main">
        <aside className="rs-card rs-inputs" aria-label={tr(lang, "估值假設", "評価の前提")}>
          <div className="rs-step">
            <b>01</b>
            <span><strong>{tr(lang, "基期資料", "基準データ")}</strong><small>{tr(lang, "金額以十億元、股數以十億股為單位。", "金額は十億、株式数は十億株単位。")}</small></span>
          </div>
          <div className="rs-fields">
            {BASE_FIELDS.map((d) => <NumField key={d.k} id={`rs-f-${d.k}`} def={d} value={inputs[d.k]} limit={limits[d.k]} cur={cur} lang={lang} onCommit={commit} />)}
          </div>
          <div className="rs-step">
            <b>02</b>
            <span><strong>{tr(lang, "預測與折現", "予測と割引")}</strong><small>{tr(lang, "百分比欄位輸入 9 代表 9%。", "% 欄は 9 と入力すると 9% です。")}</small></span>
          </div>
          <div className="rs-fields">
            {MODEL_FIELDS.map((d) => <NumField key={d.k} id={`rs-f-${d.k}`} def={d} value={inputs[d.k]} limit={limits[d.k]} cur={cur} lang={lang} onCommit={commit} />)}
          </div>
          <p className="rs-hint">{tr(lang, "永續成長率上限為 3.5%，並至少低於 WACC 1 個百分點；離開欄位時會自動夾回有效範圍。", "永続成長率の上限は 3.5% で、WACC より 1pt 以上低くする必要があります。欄を離れると有効範囲に自動調整されます。")}</p>
          {!result && <p className="rs-error" role="alert">{errors.length ? errors.join(tr(lang, "；", "。")) : tr(lang, "目前假設無法完成估值。", "現在の前提では評価できません。")}</p>}
          {warn && share != null && (
            <p className="rs-warn"><RIcon name="warn" size={15} />{tr(lang, `終值占企業價值 ${fmtPct(share, 1)}，估值對 WACC 與永續成長率較敏感。`, `ターミナルバリューが企業価値の ${fmtPct(share, 1)} を占めるため、WACC と永続成長率に敏感です。`)}</p>
          )}
        </aside>

        <div className="rs-results">
          <article className="rs-card">
            <div className="rs-card-head">
              <div><span className="rs-kicker">Projected cash flow</span><h4>{tr(lang, "年度自由現金流", "年度別フリーキャッシュフロー")}</h4></div>
              <span className="rs-unit">{tr(lang, `單位：${unitB}${cur === "JPY" ? "日圓" : "美元"}`, `単位：${unitB}${cur === "JPY" ? "円" : "ドル"}`)}</span>
            </div>
            <FcfChart inputs={inputs} result={result} lang={lang} />
            <Bridge inputs={inputs} result={result} cur={cur} lang={lang} />
          </article>

          <article className="rs-card">
            <div className="rs-card-head">
              <div><span className="rs-kicker">Sensitivity</span><h4>{tr(lang, "WACC／永續成長敏感度", "WACC × 永続成長率 感応度")}</h4></div>
              <span className="rs-unit">{tr(lang, "每股價值", "1株価値")}</span>
            </div>
            <Sensitivity inputs={inputs} cur={cur} lang={lang} />
          </article>
        </div>
      </div>

      <p className="rs-foot">
        {tr(lang,
          "簡化 DCF 以 TTM 自由現金流作為基期，採期中折現並以淨現金銜接股權價值；ETF、銀行、保險與負自由現金流公司需使用其他估值模型。試算結果不構成投資建議。情境儲存在這台裝置的瀏覽器（wa-dcf-scenarios）。",
          "簡易 DCF は TTM のフリーキャッシュフローを基準に期中割引で計算し、ネットキャッシュを加えて株主価値を求めます。ETF・銀行・保険・FCF がマイナスの企業には別のモデルが必要です。投資助言ではありません。シナリオはこの端末のブラウザ（wa-dcf-scenarios）に保存されます。")}
      </p>
    </section>
  );
});

function FcfChart({ inputs, result, lang }: { inputs: DcfInputs; result: DcfResult | null; lang: RLang }) {
  const [setEl, W] = useElementWidth(240);
  const items = [
    { key: "ttm", label: "TTM", fcf: inputs.freeCashFlow, pv: null as number | null },
    ...(result?.projections.map((p) => ({ key: `y${p.year}`, label: `Y${p.year}`, fcf: p.fcf, pv: p.presentValue as number | null })) ?? []),
  ];
  const compact = W > 0 && W < 480;
  const H = compact ? 196 : 220;
  const vals = items.flatMap((d) => [d.fcf, d.pv ?? 0]).filter((v) => Number.isFinite(v));
  const hi = Math.max(1, ...vals) * 1.16;
  const lo = Math.min(0, ...vals);
  const { ticks } = ticksWithin(lo, hi, 3);
  const axisW = Math.max(34, Math.max(...ticks.map((t) => fmtNum(t, 0).length)) * 7 + 12);
  const pt = 16;
  const pb = 26;
  const padR = 6;
  const n = items.length;
  const iw = Math.max(40, W - axisW - padR);
  const slot = iw / n;
  const X = (i: number) => axisW + slot * (i + 0.5);
  const Y = (v: number) => pt + ((hi - v) / (hi - lo || 1)) * (H - pt - pb);
  const bw = Math.min(44, slot * 0.58);
  const zero = Y(0);

  return (
    <div className="rs-fcf" ref={setEl}>
      {W > 0 && (
        <svg className="rs-svg" width={W} height={H} role="img"
          aria-label={items.map((d) => `${d.label} FCF ${fmtNum(d.fcf, 1)}${d.pv != null ? `，${tr(lang, "現值", "現在価値")} ${fmtNum(d.pv, 1)}` : ""}`).join("；")}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "rs-zero" : "rs-grid"} x1={axisW} x2={W - padR} y1={Math.round(Y(v)) + 0.5} y2={Math.round(Y(v)) + 0.5} />
              <text className="rs-ax" x={axisW - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle">{v < 0 ? MINUS : ""}{fmtNum(Math.abs(v), 0)}</text>
            </g>
          ))}
          {!ticks.includes(0) && <line className="rs-zero" x1={axisW} x2={W - padR} y1={Math.round(zero) + 0.5} y2={Math.round(zero) + 0.5} />}
          {items.map((d, i) => {
            if (!Number.isFinite(d.fcf)) return null;
            const y = Y(d.fcf);
            return (
              <g key={d.key}>
                <rect className={`rs-fbar${d.key === "ttm" ? " base" : ""}${!result ? " muted" : ""}`} style={{ animationDelay: `${i * 45}ms` }}
                  x={X(i) - bw / 2} y={Math.min(y, zero)} width={bw} height={Math.max(1.5, Math.abs(zero - y))} />
                <text className="rs-hval" x={X(i)} y={Math.min(y, zero) - 6} textAnchor="middle">{fmtNum(d.fcf, 1)}</text>
                {d.pv != null && (
                  <g className="rs-pv" transform={`translate(${X(i).toFixed(1)} ${Y(d.pv).toFixed(1)})`}>
                    <line x1={-bw / 2 - 3} x2={bw / 2 + 3} y1={0} y2={0} />
                    <path d="M0 -4.2L4.2 0L0 4.2L-4.2 0Z" />
                  </g>
                )}
                <text className="rs-ax" x={X(i)} y={H - 8} textAnchor="middle">{d.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="rs-legend">
        <span><i className="k-fcf" />{tr(lang, "預測 FCF", "予測 FCF")}</span>
        <span><i className="k-pv" />{tr(lang, "折現值 PV（期中折現）", "現在価値 PV（期中割引）")}</span>
        {!result && <span className="rs-down">{tr(lang, "請先修正左側假設，預測圖會自動恢復。", "左の前提を修正すると予測が表示されます。")}</span>}
      </div>
    </div>
  );
}

function Bridge({ inputs, result, cur, lang }: { inputs: DcfInputs; result: DcfResult | null; cur: Currency; lang: RLang }) {
  const b = (v: number | null | undefined, dp = 1) => (v == null ? "—" : fmtNum(v, dp));
  const rows: { op: string; label: string; value: string; unit: string; strong?: boolean }[] = [
    { op: "", label: tr(lang, "預測期 FCF 現值", "予測期間 FCF の現在価値"), value: b(result?.forecastPresentValue), unit: "B" },
    { op: "+", label: tr(lang, "終值現值", "ターミナルバリューの現在価値"), value: b(result?.terminalPresentValue), unit: "B" },
    { op: "=", label: tr(lang, "企業價值", "企業価値"), value: b(result?.enterpriseValue), unit: "B", strong: true },
    { op: inputs.netCash >= 0 ? "+" : MINUS, label: tr(lang, "淨現金／（淨負債）", "ネットキャッシュ／（純負債）"), value: b(Math.abs(inputs.netCash)), unit: "B" },
    { op: "=", label: tr(lang, "股權價值", "株主価値"), value: b(result?.equityValue), unit: "B", strong: true },
    { op: "÷", label: tr(lang, "稀釋後股數", "希薄化後株式数"), value: b(inputs.shares, 3), unit: tr(lang, "B 股", "B 株") },
    { op: "=", label: tr(lang, "每股內在價值", "1株あたり理論価値"), value: result ? fmtPrice(result.intrinsicValue, cur) : "—", unit: "", strong: true },
  ];
  return (
    <dl className="rs-bridge">
      {rows.map((r) => (
        <div key={r.label} className={r.strong ? "is-strong" : ""}>
          <dt><i>{r.op}</i>{r.label}</dt>
          <dd>{r.value}{r.unit && <small>{r.unit}</small>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sensitivity({ inputs, cur, lang }: { inputs: DcfInputs; cur: Currency; lang: RLang }) {
  const waccs = [-2, -1, 0, 1, 2].map((o) => Number((inputs.wacc + o).toFixed(4)));
  const tgs = [-1, -0.5, 0, 0.5, 1].map((o) => Number((inputs.terminalGrowth + o).toFixed(4)));
  const pctLabel = (v: number) => `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}%`;
  return (
    <>
      <div className="rs-sens-wrap">
        <table className="rs-sens">
          <thead>
            <tr>
              <th scope="col" className="rs-sens-corner"><span>WACC</span><span>g</span></th>
              {tgs.map((g) => <th key={g} scope="col">{pctLabel(g)}</th>)}
            </tr>
          </thead>
          <tbody>
            {waccs.map((w, wi) => (
              <tr key={w}>
                <th scope="row">{pctLabel(w)}</th>
                {tgs.map((g, gi) => {
                  const r = calculateDcf({ ...inputs, wacc: w, terminalGrowth: g });
                  const base = wi === 2 && gi === 2;
                  const u = r?.upside ?? null;
                  const strength = u == null ? 0 : 7 + Math.min(1, Math.abs(u) / 0.6) * 30;
                  const tint = u == null ? undefined : `color-mix(in srgb, var(${u >= 0 ? "--up" : "--down"}) ${strength.toFixed(0)}%, transparent)`;
                  return (
                    <td key={g} className={`${base ? "is-base" : ""}${r ? "" : " is-na"}`} style={tint ? { background: tint } : undefined}
                      title={r ? `WACC ${pctLabel(w)} · g ${pctLabel(g)} → ${fmtPrice(r.intrinsicValue, cur)}${u != null ? `（${fmtSignedPct(u, 1)}）` : ""}` : tr(lang, "無效：WACC 需高於永續成長率", "無効：WACC は永続成長率より高く")}>
                      <b>{r ? fmtPrice(r.intrinsicValue, cur, r.intrinsicValue >= 1000 ? 0 : 2) : tr(lang, "無效", "無効")}</b>
                      {u != null && <small>{fmtSignedPct(u, 0)}</small>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rs-sens-legend">
        <span><i className="k-up" />{tr(lang, "高於現價", "現在値より上")}</span>
        <span><i className="k-down" />{tr(lang, "低於現價", "現在値より下")}</span>
        <span><i className="k-base" />{tr(lang, "目前假設", "現在の前提")}</span>
        <span className="rs-muted">{tr(lang, "列＝WACC、欄＝永續成長率", "行＝WACC、列＝永続成長率")}</span>
      </p>
    </>
  );
}
