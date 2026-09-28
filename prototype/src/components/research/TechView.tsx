import { memo, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { PanelHead, Seg } from "./common";
import { useElementWidth } from "./util";
import {
  DAY, MINUS, bandPath, buildDataset, clamp, currencyOf, dateWithWeek, fmtNum, fmtPrice, fmtSignedPct, fmtSignedPrice, hhmm,
  intervalLabel, isoOf, linePath, mdOf, parseIso, selectRange, ticksWithin, tr, ymdOf,
  type Currency, type Interval, type RLang, type RangeView, type TechPoint, type TechRange,
} from "@/lib/research";

export type OverlayKey = "boll" | "ma20" | "ma50" | "ma200";
export interface TechSettings {
  range: TechRange;
  from: string;
  to: string;
  mode: "line" | "candle";
  overlays: Record<OverlayKey, boolean>;
}

const RANGES: { v: Exclude<TechRange, "custom">; zh: string; ja: string }[] = [
  { v: "1d", zh: "1日", ja: "1日" },
  { v: "1w", zh: "1週", ja: "1週" },
  { v: "1mo", zh: "1月", ja: "1ヶ月" },
  { v: "3mo", zh: "3月", ja: "3ヶ月" },
  { v: "6mo", zh: "6月", ja: "6ヶ月" },
  { v: "1y", zh: "1年", ja: "1年" },
];

const OVERLAYS: { k: OverlayKey; label: string }[] = [
  { k: "boll", label: "Boll(20,2)" },
  { k: "ma20", label: "MA20" },
  { k: "ma50", label: "MA50" },
  { k: "ma200", label: "MA200" },
];

export const TechView = memo(function TechView({ ticker, name, price, lang, settings, onSettings }: {
  ticker: string;
  name: string;
  price: number;
  lang: RLang;
  settings: TechSettings;
  onSettings: (next: TechSettings) => void;
}) {
  const cur = currencyOf(ticker);
  const ds = useMemo(() => buildDataset(ticker, price), [ticker, price]);
  const view = useMemo(() => selectRange(ds, settings.range, settings.from, settings.to), [ds, settings.range, settings.from, settings.to]);
  const [customOpen, setCustomOpen] = useState(settings.range === "custom");
  const [draftFrom, setDraftFrom] = useState(settings.from || isoOf(ds.lastDay - 183 * DAY));
  const [draftTo, setDraftTo] = useState(settings.to || isoOf(ds.lastDay));
  const f = parseIso(draftFrom);
  const t = parseIso(draftTo);
  const draftError = f == null || t == null
    ? tr(lang, "請選擇開始與結束日期", "開始日と終了日を選んでください")
    : f >= t ? tr(lang, "開始日需早於結束日", "開始日は終了日より前にしてください")
      : t < ds.firstDay || f > ds.lastDay ? tr(lang, `可選範圍 ${ymdOf(ds.firstDay)} – ${ymdOf(ds.lastDay)}`, `選択可能範囲 ${ymdOf(ds.firstDay)} – ${ymdOf(ds.lastDay)}`)
        : "";
  const up = (view?.change ?? 0) >= 0;
  const iv: Interval = view?.interval ?? "1d";
  const rangeKey = `${settings.range}|${settings.range === "custom" ? `${settings.from}~${settings.to}` : ""}`;
  const set = (patch: Partial<TechSettings>) => onSettings({ ...settings, ...patch });

  return (
    <section className="rs-panel" aria-labelledby="rs-tech-title">
      <PanelHead
        eyebrow="Technical view"
        id="rs-tech-title"
        title={<>{ticker} <span className="rs-h-sub">{tr(lang, "股票走勢", "株価チャート")}</span></>}
        meta={<>{name}<span className="rs-dot">·</span>{intervalLabel(iv, lang)}<span className="rs-dot">·</span>RSI 14<span className="rs-dot">·</span>MACD 12/26/9</>}
        aside={
          <div className="rs-quote">
            <span>{tr(lang, "最新價格", "最新値")}</span>
            <strong>{view ? fmtPrice(view.latest, cur) : "—"}</strong>
            <b className={view ? (up ? "rs-up" : "rs-down") : ""}>{view ? `${fmtSignedPrice(view.change, cur)} · ${fmtSignedPct(view.changePct)}` : "—"}</b>
            <small>{tr(lang, "前收", "前日終値")} {view ? fmtPrice(view.prevClose, cur) : "—"}</small>
          </div>
        }
      />

      <div className="rs-toolbar">
        <div className="rs-seg rs-range" role="group" aria-label={tr(lang, "技術走勢期間", "チャート期間")}>
          {RANGES.map((r) => (
            <button key={r.v} type="button" className={settings.range === r.v ? "on" : ""} aria-pressed={settings.range === r.v}
              onClick={() => { setCustomOpen(false); set({ range: r.v }); }}>
              {lang === "ja" ? r.ja : r.zh}
            </button>
          ))}
          <button type="button" className={settings.range === "custom" ? "on" : ""} aria-pressed={settings.range === "custom"} aria-expanded={customOpen}
            onClick={() => setCustomOpen((v) => !v)}>
            {tr(lang, "自訂", "期間指定")}
          </button>
        </div>
        {view && <span className="rs-range-note">{rangeNote(view, lang)}</span>}
      </div>

      {customOpen && (
        <form className="rs-custom" noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!draftError) set({ range: "custom", from: draftFrom, to: draftTo });
        }}>
          <span className="rs-custom-cap">{tr(lang, "自由調整期間", "期間を指定")}</span>
          <label className="rs-date">
            <span>{tr(lang, "開始", "開始")}</span>
            <input className="rs-input" type="date" required value={draftFrom} min={isoOf(ds.firstDay)} max={draftTo || isoOf(ds.lastDay)} onChange={(e) => setDraftFrom(e.target.value)} />
          </label>
          <i className="rs-custom-dash" aria-hidden="true">—</i>
          <label className="rs-date">
            <span>{tr(lang, "結束", "終了")}</span>
            <input className="rs-input" type="date" required value={draftTo} min={draftFrom || isoOf(ds.firstDay)} max={isoOf(ds.lastDay)} onChange={(e) => setDraftTo(e.target.value)} />
          </label>
          <button type="submit" className="rs-btn primary" disabled={!!draftError}>{tr(lang, "套用", "適用")}</button>
          {draftError && <span className="rs-field-err" role="alert">{draftError}</span>}
        </form>
      )}

      <article className="rs-card rs-chart-card">
        <div className="rs-card-head">
          <div>
            <span className="rs-kicker">Price trend</span>
            <h4>{tr(lang, "價格走勢", "価格推移")}</h4>
          </div>
          <div className="rs-hilo">
            <p><strong>{view ? fmtPrice(view.high, cur) : "—"}</strong><span>{tr(lang, "期間高點", "期間高値")}</span></p>
            <p><strong>{view ? fmtPrice(view.low, cur) : "—"}</strong><span>{tr(lang, "期間低點", "期間安値")}</span></p>
          </div>
        </div>
        <div className="rs-chart-tools">
          <Seg
            small
            label={tr(lang, "價格圖表類型", "チャートの種類")}
            value={settings.mode}
            options={[{ v: "line", label: tr(lang, "折線", "ライン") }, { v: "candle", label: tr(lang, "蠟燭", "ローソク足") }]}
            onChange={(v) => set({ mode: v })}
          />
          <div className="rs-overlays" role="group" aria-label={tr(lang, "技術線疊圖", "テクニカル指標の重ね表示")}>
            {OVERLAYS.map((o) => (
              <button key={o.k} type="button" className={`rs-ov rs-ov-${o.k}${settings.overlays[o.k] ? " on" : ""}`} aria-pressed={settings.overlays[o.k]}
                onClick={() => set({ overlays: { ...settings.overlays, [o.k]: !settings.overlays[o.k] } })}>
                <i aria-hidden="true" />{o.label}
              </button>
            ))}
          </div>
        </div>
        {view ? (
          <TechCharts key={rangeKey} view={view} mode={settings.mode} overlays={settings.overlays} lang={lang} cur={cur} ticker={ticker} />
        ) : (
          <p className="rs-empty">{tr(lang, "所選期間沒有交易日資料，請調整日期。", "選択した期間に取引日がありません。日付を調整してください。")}</p>
        )}
      </article>

      <p className="rs-foot">
        {tr(lang,
          "示意資料：日 K 以固定種子的隨機漫步產生並對齊目前持倉價格；1 日／1 週為合成的 5 分／30 分 K（美東時間）。指標先以完整序列計算再截取期間，所以 MA200 在短期間也有效。正式站使用 Yahoo 行情。",
          "サンプルデータ：日足は固定シードのランダムウォークで生成し、現在の保有価格に合わせています。1日／1週は合成の5分足／30分足（米東部時間）。指標は全期間で計算してから表示期間を切り出すため、短い期間でも MA200 が有効です。本番サイトは Yahoo の相場を使用します。")}
      </p>
    </section>
  );
});

function rangeNote(v: RangeView, lang: RLang) {
  const first = v.points[0];
  const last = v.points[v.points.length - 1];
  const n = v.points.length;
  if (v.interval === "5m") return `${ymdOf(last.day)} · ${hhmm(first.min)}–${hhmm(last.min + 5)} ET · ${n} ${tr(lang, "根", "本")}`;
  return `${ymdOf(first.day)} – ${ymdOf(last.day)} · ${n} ${tr(lang, "根", "本")}`;
}

// ———————————————————— 圖表 ————————————————————

interface Geo { W: number; padL: number; axisW: number; iw: number; slot: number; n: number; X: (i: number) => number }

function priceDp(step: number, cur: Currency) {
  if (cur === "JPY") return 0;
  return step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
}

function pointLabel(p: TechPoint, iv: Interval, lang: RLang) {
  return iv === "1d" ? dateWithWeek(p.day, lang) : `${mdOf(p.day)} ${hhmm(p.min)} ET`;
}

/** X 軸刻度：日 K 均分、5 分 K 取整點、30 分 K 取每日第一根 */
function dateTicks(pts: TechPoint[], iv: Interval, geo: Geo) {
  const maxCount = Math.max(2, Math.floor(geo.iw / 88));
  let idx: number[] = [];
  if (iv === "5m") idx = pts.flatMap((p, i) => (p.min % 60 === 0 ? [i] : []));
  else if (iv === "30m") idx = pts.flatMap((p, i) => (i === 0 || p.day !== pts[i - 1].day ? [i] : []));
  if (iv === "1d" || idx.length === 0) {
    const n = pts.length;
    const count = Math.min(n, maxCount);
    idx = count <= 1 ? [0] : Array.from({ length: count }, (_, k) => Math.round((k * (n - 1)) / (count - 1)));
  } else if (idx.length > maxCount) {
    const every = Math.ceil(idx.length / maxCount);
    idx = idx.filter((_, k) => k % every === 0);
  }
  const crossesYear = new Date(pts[0].day).getUTCFullYear() !== new Date(pts[pts.length - 1].day).getUTCFullYear();
  let prevYear = -1;
  return [...new Set(idx)].map((i) => {
    const p = pts[i];
    const y = new Date(p.day).getUTCFullYear();
    let label = iv === "5m" ? hhmm(p.min) : mdOf(p.day);
    if (iv !== "5m" && crossesYear && y !== prevYear) label = ymdOf(p.day);
    prevYear = y;
    return { i, label };
  });
}

function TechCharts({ view, mode, overlays, lang, cur, ticker }: {
  view: RangeView;
  mode: "line" | "candle";
  overlays: Record<OverlayKey, boolean>;
  lang: RLang;
  cur: Currency;
  ticker: string;
}) {
  const [setEl, W] = useElementWidth(260);
  const [hover, setHover] = useState<number | null>(null);
  const viaKeyboard = useRef(false);
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const pts = view.points;
  const n = pts.length;
  const compact = W > 0 && W < 520;

  // 價格座標
  const price = useMemo(() => {
    const vals: number[] = [];
    for (const p of pts) {
      if (mode === "candle") vals.push(p.h, p.l);
      else vals.push(p.c);
      if (overlays.ma20 && p.ma20 != null) vals.push(p.ma20);
      if (overlays.ma50 && p.ma50 != null) vals.push(p.ma50);
      if (overlays.ma200 && p.ma200 != null) vals.push(p.ma200);
      if (overlays.boll && p.bu != null && p.bl != null) vals.push(p.bu, p.bl);
    }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < Math.abs(hi) * 0.002) {
      const e = Math.max(Math.abs(hi) * 0.002, 0.01);
      lo -= e;
      hi += e;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const { ticks, step } = ticksWithin(lo, hi, compact ? 3 : 4);
    const dp = priceDp(step, cur);
    return { lo, hi, ticks, labels: ticks.map((v) => fmtPrice(v, cur, dp)) };
  }, [pts, mode, overlays, cur, compact]);

  const last = pts[n - 1];
  const lastLabel = fmtPrice(last.c, cur);
  const axisW = clamp(Math.max(lastLabel.length, ...price.labels.map((s) => s.length)) * 7 + 18, 52, 104);
  const padL = compact ? 2 : 4;
  const iw = Math.max(40, W - padL - axisW);
  const slot = iw / n;
  const geo: Geo = { W, padL, axisW, iw, slot, n, X: (i: number) => padL + slot * (i + 0.5) };

  const H = compact ? 214 : clamp(Math.round(W * 0.34), 240, 340);
  const pt = 12;
  const pb = 26;
  const Y = (v: number) => pt + ((price.hi - v) / (price.hi - price.lo || 1)) * (H - pt - pb);
  const axisX = W - axisW + 8;

  // RSI
  const Hr = compact ? 94 : 108;
  const Yr = (v: number) => 6 + ((100 - v) / 100) * (Hr - 12);

  // MACD 座標
  const macdDom = useMemo(() => {
    const vals: number[] = [0];
    for (const p of pts) for (const v of [p.macd, p.sig, p.hist]) if (v != null) vals.push(v);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12;
    return { lo: lo - pad, hi: hi + pad };
  }, [pts]);
  const Hm = compact ? 104 : 122;
  const Ym = (v: number) => 6 + ((macdDom.hi - v) / (macdDom.hi - macdDom.lo || 1)) * (Hm - 12);
  const macdTicks = ticksWithin(macdDom.lo, macdDom.hi, 2);

  // 靜態圖層：與游標無關，避免滑動時重建上百個節點
  const priceLayer = useMemo(() => {
    if (W <= 0) return null;
    const X = geo.X;
    const bottom = H - pb;
    const closes = pts.map((p) => p.c);
    const line = linePath(closes, X, Y);
    const els: ReactNode[] = [];
    if (overlays.boll) {
      els.push(<path key="bb" className="rs-boll-band" d={bandPath(pts.map((p) => p.bu), pts.map((p) => p.bl), X, Y)} />);
      els.push(<path key="bbu" className="rs-boll-line" d={linePath(pts.map((p) => p.bu), X, Y)} />);
      els.push(<path key="bbl" className="rs-boll-line" d={linePath(pts.map((p) => p.bl), X, Y)} />);
    }
    if (mode === "line") {
      els.push(<path key="area" className="rs-area" d={`${line}L${X(n - 1).toFixed(1)} ${bottom}L${X(0).toFixed(1)} ${bottom}Z`} fill={`url(#${gid}-fill)`} />);
      els.push(<path key="line" className="rs-price-line rs-draw" pathLength={1} d={line} />);
    } else {
      // 棒寬過窄時合併成較粗的 K 棒（僅影響繪圖，游標仍對應原始資料）
      const bucket = Math.max(1, Math.ceil(2.6 / slot));
      const bw = Math.max(1, Math.min(slot * bucket * 0.64, 14));
      for (let s = 0; s < n; s += bucket) {
        const group = pts.slice(s, s + bucket);
        const o = group[0].o;
        const c = group[group.length - 1].c;
        let h = -Infinity;
        let l = Infinity;
        for (const g of group) { h = Math.max(h, g.h); l = Math.min(l, g.l); }
        const cx = (X(s) + X(s + group.length - 1)) / 2;
        const rising = c >= o;
        const yTop = Y(Math.max(o, c));
        const yBot = Y(Math.min(o, c));
        els.push(
          <g key={`k${s}`} className={rising ? "rs-candle up" : "rs-candle down"}>
            <line x1={cx} x2={cx} y1={Y(h)} y2={Y(l)} />
            <rect x={cx - bw / 2} y={yTop} width={bw} height={Math.max(1, yBot - yTop)} />
          </g>,
        );
      }
    }
    if (overlays.ma200) els.push(<path key="m200" className="rs-ma rs-ma200" d={linePath(pts.map((p) => p.ma200), X, Y)} />);
    if (overlays.ma50) els.push(<path key="m50" className="rs-ma rs-ma50" d={linePath(pts.map((p) => p.ma50), X, Y)} />);
    if (overlays.ma20) els.push(<path key="m20" className="rs-ma rs-ma20" d={linePath(pts.map((p) => p.ma20), X, Y)} />);
    return els;
    // geo / Y 皆由下列依賴推導
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, mode, overlays, W, H, axisW, price, gid]);

  const indLayer = useMemo(() => {
    if (W <= 0) return null;
    const X = geo.X;
    const zero = Ym(0);
    const bw = Math.max(1, Math.min(slot * 0.62, 10));
    return {
      rsi: <path className="rs-rsi-line rs-draw" pathLength={1} d={linePath(pts.map((p) => p.rsi), X, Yr)} />,
      macd: (
        <>
          {pts.map((p, i) => {
            if (p.hist == null) return null;
            const y = Ym(p.hist);
            return <rect key={i} className={p.hist >= 0 ? "rs-hist up" : "rs-hist down"} x={X(i) - bw / 2} y={Math.min(y, zero)} width={bw} height={Math.max(0.8, Math.abs(zero - y))} />;
          })}
          <path className="rs-macd-line" d={linePath(pts.map((p) => p.macd), X, Ym)} />
          <path className="rs-sig-line" d={linePath(pts.map((p) => p.sig), X, Ym)} />
        </>
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, W, axisW, macdDom, Hr, Hm]);

  const ticks = useMemo(() => (W > 0 ? dateTicks(pts, view.interval, geo) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pts, view.interval, W, axisW]);

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const i = Math.floor((clientX - r.left - padL) / slot);
    setHover(clamp(i, 0, n - 1));
  };
  // 觸控：水平拖曳檢視數值、垂直滑動仍可捲動（touch-action: pan-y）
  const pointerProps = {
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget),
    onPointerDown: (e: PointerEvent<SVGSVGElement>) => { viaKeyboard.current = false; pick(e.clientX, e.currentTarget); },
    onPointerLeave: (e: PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") setHover(null); },
    onPointerCancel: () => setHover(null),
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    viaKeyboard.current = true;
    const curIdx = hover ?? n - 1;
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = curIdx;
    if (e.key === "ArrowLeft") next = Math.max(0, curIdx - step);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, curIdx + step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setHover(next);
  };

  const hp = hover != null && hover < n ? pts[hover] : null;
  const focusPt = hp ?? last;
  const rsiVal = focusPt.rsi;
  const rsiState = rsiVal == null ? "" : rsiVal >= 70 ? "hot" : rsiVal <= 30 ? "cool" : "mid";
  const lastTagY = Math.round(clamp(Y(last.c), pt + 9, H - pb - 9));
  const hoverTagY = hp ? Math.round(clamp(Y(hp.c), pt + 9, H - pb - 9)) : null;
  const hx = hp && hover != null ? geo.X(hover) : 0;
  const prevC = hp && hover != null ? (hover > 0 ? pts[hover - 1].c : hp.o) : 0;
  const focusIdx = hp && hover != null ? hover : n - 1;
  const stripPrev = focusIdx > 0 ? pts[focusIdx - 1].c : focusPt.o;
  const tipStyle: CSSProperties = {};
  if (hp && !compact) {
    if (hx > W / 2) tipStyle.right = Math.round(W - hx + 14);
    else tipStyle.left = Math.round(hx + 14);
  }
  const O = tr(lang, "開", "始");
  const Hh = tr(lang, "高", "高");
  const L = tr(lang, "低", "安");
  const C = tr(lang, "收", "終");
  const pdp = cur === "JPY" ? 0 : 2;
  const svgCommon = pointerProps;
  // 只有價格圖是 Tab 停駐點；以鍵盤離開時才清除十字線（避免點擊副圖時被 blur 清掉）
  const focusProps = {
    tabIndex: 0,
    onKeyDown: onKey,
    onKeyUp: () => { viaKeyboard.current = true; },
    onBlur: () => { if (viaKeyboard.current) setHover(null); },
  };

  return (
    <div className="rs-charts" ref={setEl}>
      {W > 0 && (
        <>
          <div className="rs-plot">
            <svg className="rs-svg rs-svg-price" width={W} height={H} role="img"
              aria-label={`${ticker} ${intervalLabel(view.interval, lang)} ${tr(lang, "價格走勢；可用方向鍵查看各時點", "価格推移。矢印キーで各時点を表示")}`}
              {...svgCommon} {...focusProps}>
              <defs>
                <linearGradient id={`${gid}-fill`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" className="rs-stop-a" />
                  <stop offset="100%" className="rs-stop-b" />
                </linearGradient>
              </defs>
              {price.ticks.map((v, k) => {
                // 與最新價／游標價標籤重疊的刻度文字不顯示
                const ty = Y(v);
                const hidden = Math.abs(ty - lastTagY) < 15 || (hoverTagY != null && Math.abs(ty - hoverTagY) < 15);
                return (
                  <g key={v}>
                    <line className="rs-grid" x1={padL} x2={W - axisW} y1={Math.round(ty) + 0.5} y2={Math.round(ty) + 0.5} />
                    {!hidden && <text className="rs-ax" x={axisX} y={ty} dominantBaseline="middle">{price.labels[k]}</text>}
                  </g>
                );
              })}
              <line className="rs-axis-line" x1={W - axisW + 0.5} x2={W - axisW + 0.5} y1={pt} y2={H - pb} />
              {ticks.map(({ i, label }, k) => (
                <text key={i} className="rs-ax" x={geo.X(i)} y={H - 8} textAnchor={k === 0 && geo.X(i) < 40 ? "start" : k === ticks.length - 1 && geo.X(i) > W - axisW - 40 ? "end" : "middle"}>{label}</text>
              ))}
              {priceLayer}
              {mode === "line" && hover == null && (
                <g className="rs-endpoint" transform={`translate(${geo.X(n - 1).toFixed(1)} ${Y(last.c).toFixed(1)})`}>
                  <circle className="rs-endpoint-ring" r={8} />
                  <circle className="rs-endpoint-dot" r={3.4} />
                </g>
              )}
              <g className="rs-last-tag" transform={`translate(${W - axisW + 2} ${lastTagY})`}>
                <rect x={0} y={-10} width={axisW - 2} height={20} rx={3} />
                <text x={6} y={0} dominantBaseline="middle">{lastLabel}</text>
              </g>
              {hp && (
                <g className="rs-cross" pointerEvents="none">
                  <line x1={Math.round(hx) + 0.5} x2={Math.round(hx) + 0.5} y1={pt} y2={H - pb} />
                  <line x1={padL} x2={W - axisW} y1={Math.round(Y(hp.c)) + 0.5} y2={Math.round(Y(hp.c)) + 0.5} />
                  <circle className="rs-cross-dot" cx={hx} cy={Y(hp.c)} r={4} />
                  <g className="rs-hover-tag" transform={`translate(${W - axisW + 2} ${hoverTagY ?? 0})`}>
                    <rect x={0} y={-10} width={axisW - 2} height={20} rx={3} />
                    <text x={6} y={0} dominantBaseline="middle">{fmtPrice(hp.c, cur)}</text>
                  </g>
                </g>
              )}
            </svg>
            {hp && !compact && (
              <div className="rs-tip" style={tipStyle} aria-live="polite">
                <b>{pointLabel(hp, view.interval, lang)}</b>
                <div className="rs-tip-ohlc">
                  <span>{O}<em>{fmtNum(hp.o, pdp)}</em></span>
                  <span>{Hh}<em>{fmtNum(hp.h, pdp)}</em></span>
                  <span>{L}<em>{fmtNum(hp.l, pdp)}</em></span>
                  <span>{C}<em>{fmtNum(hp.c, pdp)}</em></span>
                </div>
                <p className={hp.c >= prevC ? "rs-up" : "rs-down"}>{tr(lang, "漲跌", "騰落")} {fmtSignedPct(prevC ? hp.c / prevC - 1 : 0)}</p>
                {overlays.ma20 && hp.ma20 != null && <p><i className="k-ma20" />MA20<em>{fmtNum(hp.ma20, pdp)}</em></p>}
                {overlays.ma50 && hp.ma50 != null && <p><i className="k-ma50" />MA50<em>{fmtNum(hp.ma50, pdp)}</em></p>}
                {overlays.ma200 && hp.ma200 != null && <p><i className="k-ma200" />MA200<em>{fmtNum(hp.ma200, pdp)}</em></p>}
                {overlays.boll && hp.bu != null && hp.bl != null && <p><i className="k-boll" />Boll<em>{fmtNum(hp.bu, pdp)} / {fmtNum(hp.bl, pdp)}</em></p>}
                <p className="rs-tip-sep"><i className="k-rsi" />RSI<em>{fmtNum(hp.rsi, 1)}</em></p>
                <p><i className="k-macd" />MACD<em>{fmtNum(hp.macd)} / {fmtNum(hp.sig)}</em></p>
              </div>
            )}
          </div>
          {compact && (
            // 手機：固定資料列（不遮住圖），未觸控時顯示最新一根
            <div className={`rs-strip${hp ? " is-live" : ""}`} aria-live="polite">
              <div className="rs-strip-head">
                <b>{hp ? pointLabel(focusPt, view.interval, lang) : `${tr(lang, "最新", "最新")} · ${pointLabel(focusPt, view.interval, lang)}`}</b>
                <span className={focusPt.c >= stripPrev ? "rs-up" : "rs-down"}>{fmtSignedPct(stripPrev ? focusPt.c / stripPrev - 1 : 0)}</span>
              </div>
              <div className="rs-strip-ohlc">
                <span>{O}<em>{fmtNum(focusPt.o, pdp)}</em></span>
                <span>{Hh}<em>{fmtNum(focusPt.h, pdp)}</em></span>
                <span>{L}<em>{fmtNum(focusPt.l, pdp)}</em></span>
                <span>{C}<em>{fmtNum(focusPt.c, pdp)}</em></span>
              </div>
              <div className="rs-strip-ind">
                {overlays.ma20 && <span><i className="k-ma20" />MA20 <em>{fmtNum(focusPt.ma20, pdp)}</em></span>}
                {overlays.ma50 && <span><i className="k-ma50" />MA50 <em>{fmtNum(focusPt.ma50, pdp)}</em></span>}
                {overlays.ma200 && <span><i className="k-ma200" />MA200 <em>{fmtNum(focusPt.ma200, pdp)}</em></span>}
                {overlays.boll && <span><i className="k-boll" />Boll <em>{fmtNum(focusPt.bu, pdp)} / {fmtNum(focusPt.bl, pdp)}</em></span>}
              </div>
            </div>
          )}

          <div className="rs-ind-head">
            <div>
              <span className="rs-kicker">Momentum</span>
              <h4>RSI（14）</h4>
            </div>
            <p className={rsiState === "hot" ? "rs-down" : rsiState === "cool" ? "rs-up" : ""}>
              <strong>{fmtNum(rsiVal, 1)}</strong>
              <span>{rsiState === "hot" ? tr(lang, "超買", "買われすぎ") : rsiState === "cool" ? tr(lang, "超賣", "売られすぎ") : rsiState ? tr(lang, "中性區間", "中立圏") : "—"}</span>
            </p>
          </div>
          <div className="rs-plot">
            <svg className="rs-svg" width={W} height={Hr} role="img" aria-label={`RSI 14：${fmtNum(last.rsi, 1)}`} {...svgCommon}>
              <rect className="rs-zone-hot" x={padL} y={Yr(100)} width={iw} height={Yr(70) - Yr(100)} />
              <rect className="rs-zone-cool" x={padL} y={Yr(30)} width={iw} height={Yr(0) - Yr(30)} />
              <line className="rs-thr" x1={padL} x2={W - axisW} y1={Math.round(Yr(70)) + 0.5} y2={Math.round(Yr(70)) + 0.5} />
              <line className="rs-thr" x1={padL} x2={W - axisW} y1={Math.round(Yr(30)) + 0.5} y2={Math.round(Yr(30)) + 0.5} />
              <line className="rs-grid" x1={padL} x2={W - axisW} y1={Math.round(Yr(50)) + 0.5} y2={Math.round(Yr(50)) + 0.5} />
              <line className="rs-axis-line" x1={W - axisW + 0.5} x2={W - axisW + 0.5} y1={Yr(100)} y2={Yr(0)} />
              <text className="rs-ax rs-ax-hot" x={axisX} y={Yr(70)} dominantBaseline="middle">70</text>
              <text className="rs-ax" x={axisX} y={Yr(50)} dominantBaseline="middle">50</text>
              <text className="rs-ax rs-ax-cool" x={axisX} y={Yr(30)} dominantBaseline="middle">30</text>
              {indLayer?.rsi}
              {hp && hp.rsi != null && (
                <g className="rs-cross" pointerEvents="none">
                  <line x1={Math.round(hx) + 0.5} x2={Math.round(hx) + 0.5} y1={Yr(100)} y2={Yr(0)} />
                  <circle className="rs-cross-dot rs-dot-rsi" cx={hx} cy={Yr(hp.rsi)} r={3.5} />
                </g>
              )}
            </svg>
          </div>

          <div className="rs-ind-head">
            <div>
              <span className="rs-kicker">Trend signal</span>
              <h4>MACD（12/26/9）</h4>
            </div>
            <p>
              <strong className={focusPt.macd != null && focusPt.sig != null ? (focusPt.macd >= focusPt.sig ? "rs-up" : "rs-down") : ""}>{fmtNum(focusPt.macd)}</strong>
              <span>Signal {fmtNum(focusPt.sig)}</span>
            </p>
          </div>
          <div className="rs-plot">
            <svg className="rs-svg" width={W} height={Hm} role="img" aria-label={`MACD ${fmtNum(last.macd)}，Signal ${fmtNum(last.sig)}`} {...svgCommon}>
              {macdTicks.ticks.map((v) => (
                <g key={v}>
                  <line className={v === 0 ? "rs-zero" : "rs-grid"} x1={padL} x2={W - axisW} y1={Math.round(Ym(v)) + 0.5} y2={Math.round(Ym(v)) + 0.5} />
                  <text className="rs-ax" x={axisX} y={Ym(v)} dominantBaseline="middle">{v === 0 ? "0" : `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(macdTicks.step >= 1 ? 0 : macdTicks.step >= 0.1 ? 1 : 2)}`}</text>
                </g>
              ))}
              {!macdTicks.ticks.includes(0) && <line className="rs-zero" x1={padL} x2={W - axisW} y1={Math.round(Ym(0)) + 0.5} y2={Math.round(Ym(0)) + 0.5} />}
              <line className="rs-axis-line" x1={W - axisW + 0.5} x2={W - axisW + 0.5} y1={6} y2={Hm - 6} />
              {indLayer?.macd}
              {hp && (
                <g className="rs-cross" pointerEvents="none">
                  <line x1={Math.round(hx) + 0.5} x2={Math.round(hx) + 0.5} y1={6} y2={Hm - 6} />
                  {hp.macd != null && <circle className="rs-cross-dot" cx={hx} cy={Ym(hp.macd)} r={3.5} />}
                  {hp.sig != null && <circle className="rs-cross-dot rs-dot-sig" cx={hx} cy={Ym(hp.sig)} r={3} />}
                </g>
              )}
            </svg>
          </div>
          <div className="rs-legend">
            <span><i className="k-macd" />MACD</span>
            <span><i className="k-sig" />Signal</span>
            <span><i className="k-hist" />Histogram</span>
          </div>
        </>
      )}
      {W <= 0 && <div className="rs-chart-ph" />}
    </div>
  );
}
