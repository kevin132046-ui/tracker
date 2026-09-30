import { memo, useRef, useState, type PointerEvent } from "react";
import { PanelHead, RIcon, Seg } from "./common";
import { prefersReducedMotion, useElementWidth } from "./util";
import {
  HIST_META, MINUS, fmtAmount, fmtAmountTick, fmtMultiple, fmtPct, parseIso, ticksWithin, tr, ymdOf,
  type Currency, type Fundamentals, type HistKey, type HistPeriod, type HistPoint, type RLang,
} from "@/lib/research";

export interface FundSettings { metric: HistKey; period: HistPeriod; kind: "bar" | "line" }

interface Row { label: string; value: string; tone?: "up" | "down"; hist?: HistKey }

const toneOf = (v: number | null) => (v == null ? undefined : v >= 0 ? "up" : "down");

export const FundView = memo(function FundView({ f, name, lang, settings, onSettings, onOpenDcf }: {
  f: Fundamentals;
  name: string;
  lang: RLang;
  settings: FundSettings;
  onSettings: (next: FundSettings) => void;
  onOpenDcf: () => void;
}) {
  const [preview, setPreview] = useState<HistKey | null>(null);
  const histRef = useRef<HTMLElement | null>(null);
  const cur = f.currency;
  const active = preview ?? settings.metric;
  const meta = HIST_META[active];
  const series = f.history[settings.period][active];
  const latest = series[series.length - 1];
  const label = lang === "ja" ? meta.ja : meta.zh;
  const amount = (v: number | null) => fmtAmount(v, cur);

  const select = (k: HistKey) => {
    setPreview(null);
    onSettings({ ...settings, metric: k, kind: HIST_META[k].chart });
    const el = histRef.current;
    if (!el) return;
    let narrow = false;
    try { narrow = window.matchMedia("(max-width: 760px)").matches; } catch { narrow = false; }
    const r = el.getBoundingClientRect();
    if (narrow && (r.top > window.innerHeight - 160 || r.bottom < 120)) {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
  };

  const cards: { key: string; en: string; zh: string; ja: string; rows: Row[] }[] = [
    {
      key: "val", en: "Valuation", zh: "估值", ja: "バリュエーション", rows: [
        { label: tr(lang, "市值", "時価総額"), value: amount(f.marketCap) },
        { label: tr(lang, "P/E（TTM）", "PER（実績）"), value: fmtMultiple(f.peTtm) },
        { label: tr(lang, "P/E（Forward）", "PER（予想）"), value: fmtMultiple(f.peFwd) },
        { label: "Price / Sales", value: fmtMultiple(f.ps) },
        { label: "EV / EBITDA", value: fmtMultiple(f.evEbitda) },
        { label: "Price / Book", value: fmtMultiple(f.pb) },
      ],
    },
    {
      key: "cf", en: "Cash Flow", zh: "現金流", ja: "キャッシュフロー", rows: [
        { label: tr(lang, "最近季度自由現金流", "直近四半期 FCF"), value: amount(f.fcfQuarter), hist: "freeCashFlow" },
        { label: tr(lang, "自由現金流（TTM）", "FCF（TTM）"), value: amount(f.fcfTtm) },
        { label: "FCF Yield", value: fmtPct(f.fcfYield) },
        { label: tr(lang, "SBC 調整後 FCF", "SBC 控除後 FCF"), value: amount(f.sbcAdjFcf), hist: "adjustedFreeCashFlow" },
        { label: tr(lang, "SBC 調整後 FCF Yield", "SBC 控除後 FCF 利回り"), value: fmtPct(f.sbcAdjYield) },
        { label: tr(lang, "SBC 對 FCF 影響", "SBC の FCF への影響"), value: fmtPct(f.sbcImpact), tone: f.sbcImpact != null && f.sbcImpact < 0 ? "down" : undefined, hist: "sbcImpact" },
      ],
    },
    {
      key: "mg", en: "Margins & Growth", zh: "利潤與成長", ja: "利益率と成長", rows: [
        { label: tr(lang, "淨利率", "純利益率"), value: fmtPct(f.profitMargin), hist: "profitMargin" },
        { label: tr(lang, "營業利益率", "営業利益率"), value: fmtPct(f.operatingMargin), hist: "operatingMargin" },
        { label: tr(lang, "季獲利 YoY", "四半期純利益 YoY"), value: fmtPct(f.earningsYoY), tone: toneOf(f.earningsYoY), hist: "netIncome" },
        { label: tr(lang, "季營收 YoY", "四半期売上高 YoY"), value: fmtPct(f.revenueYoY), tone: toneOf(f.revenueYoY), hist: "revenue" },
      ],
    },
    {
      key: "bal", en: "Balance", zh: "資產負債", ja: "財務体質", rows: [
        { label: tr(lang, "現金與短期投資", "現金・短期投資"), value: amount(f.cash), hist: "cash" },
        { label: tr(lang, "總負債", "有利子負債"), value: amount(f.debt), hist: "debt" },
        { label: tr(lang, "淨現金／（淨負債）", "ネットキャッシュ／（純負債）"), value: amount(f.netCash), tone: toneOf(f.netCash), hist: "netCash" },
      ],
    },
    {
      key: "div", en: "Dividend", zh: "股息", ja: "配当", rows: [
        { label: tr(lang, "股息殖利率", "配当利回り"), value: fmtPct(f.divYield) },
        { label: tr(lang, "配息率", "配当性向"), value: fmtPct(f.payout) },
        { label: tr(lang, "最近除息日", "直近の権利落ち日"), value: f.exDate ?? "—" },
        { label: tr(lang, "最近每股股息", "直近の1株配当"), value: f.dividend != null ? new Intl.NumberFormat(cur === "JPY" ? "ja-JP" : "en-US", { style: "currency", currency: cur, maximumFractionDigits: 4 }).format(f.dividend) : "—" },
      ],
    },
  ];

  const asOf = parseIso(f.asOf);
  return (
    <section className="rs-panel" aria-labelledby="rs-fund-title">
      <PanelHead
        eyebrow="Company fundamentals"
        id="rs-fund-title"
        title={tr(lang, "公司資訊與財務品質", "企業情報と財務の質")}
        meta={<>
          {name}<span className="rs-dot">·</span>{f.exchange}<span className="rs-dot">·</span>{f.currency}
          <span className="rs-dot">·</span>
          {f.source === "site"
            ? `${tr(lang, "畫面日期", "取得日")} ${asOf != null ? ymdOf(asOf) : f.asOf}`
            : tr(lang, "示意值", "参考値")}
        </>}
        aside={
          <button type="button" className="rs-btn" onClick={onOpenDcf}>
            {tr(lang, "開啟 DCF 估值", "DCF 評価を開く")}<RIcon name="arrow" size={15} />
          </button>
        }
      />

      <div className="rs-fund-grid">
        {cards.map((c) => (
          <article key={c.key} className={`rs-card rs-fcard rs-area-${c.key}`}>
            <h4 className="rs-fcard-title"><span className="rs-card-en">{c.en}</span><span>{lang === "ja" ? c.ja : c.zh}</span></h4>
            <div className="rs-rows">
              {c.rows.map((r) => {
                const content = (
                  <>
                    <span className="rs-row-label">{r.label}{r.hist && <small className="rs-tag">{tr(lang, "歷史", "履歴")}</small>}</span>
                    <strong className={r.tone === "up" ? "rs-up" : r.tone === "down" ? "rs-down" : ""}>{r.value}</strong>
                  </>
                );
                if (!r.hist) return <div key={r.label} className="rs-row">{content}</div>;
                const k = r.hist;
                return (
                  <button
                    key={r.label}
                    type="button"
                    className={`rs-row rs-row-btn${settings.metric === k ? " on" : ""}${preview === k ? " peek" : ""}`}
                    aria-pressed={settings.metric === k}
                    aria-controls="rs-hist"
                    onPointerEnter={(e: PointerEvent<HTMLButtonElement>) => { if (e.pointerType === "mouse") setPreview(k); }}
                    onPointerLeave={(e: PointerEvent<HTMLButtonElement>) => { if (e.pointerType === "mouse") setPreview(null); }}
                    onClick={() => select(k)}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          </article>
        ))}

        <section className="rs-card rs-hist rs-area-hist" id="rs-hist" ref={histRef} aria-labelledby="rs-hist-title">
          <div className="rs-hist-head">
            <div className="rs-hist-titles">
              <span className="rs-kicker">Historical metric · {tr(lang, "歷史指標", "指標の推移")}</span>
              <h4 id="rs-hist-title">{tr(lang, `${label}歷史`, `${label}の推移`)}</h4>
              <p className="rs-hist-cap">
                {preview
                  ? tr(lang, "滑入預覽中；點擊可固定這項指標。", "プレビュー中です。クリックで固定します。")
                  : `${lang === "ja" ? meta.capJa : meta.capZh}${tr(lang, "；點擊上方帶「歷史」標記的指標即可切換。", "。「履歴」タグ付きの指標をクリックで切り替えます。")}`}
              </p>
            </div>
            <div className="rs-hist-sum">
              <span>{latest ? latest.label : "—"}</span>
              <strong>{latest ? (meta.format === "percent" ? fmtPct(latest.value) : fmtAmount(latest.value, cur)) : "—"}</strong>
            </div>
          </div>
          <div className="rs-hist-ctrl">
            <Seg small label={tr(lang, "資料期間", "期間")} value={settings.period}
              options={[{ v: "q", label: tr(lang, "季", "四半期") }, { v: "y", label: tr(lang, "年", "年度") }]}
              onChange={(v) => onSettings({ ...settings, period: v })} />
            <Seg small label={tr(lang, "圖表形式", "グラフ形式")} value={settings.kind}
              options={[{ v: "bar", label: tr(lang, "長條", "棒") }, { v: "line", label: tr(lang, "折線", "折れ線") }]}
              onChange={(v) => onSettings({ ...settings, kind: v })} />
          </div>
          <HistChart key={`${active}-${settings.period}-${settings.kind}`} series={series} percent={meta.format === "percent"} kind={settings.kind} cur={cur} title={label} lang={lang} />
        </section>
      </div>

      <p className="rs-foot rs-foot-strong">
        {tr(lang,
          "示範數據：MSFT 依公開財報整理（2026/9/27），其餘為示意值；正式站由 Yahoo 財務資料更新",
          "サンプルデータ：MSFT は公開決算をもとに整理（2026/9/27）、その他は参考値です。本番サイトでは Yahoo の財務データで更新されます")}
      </p>
    </section>
  );
});

function pctTick(v: number, step: number) {
  if (v === 0) return "0%";
  return `${v < 0 ? MINUS : ""}${Math.abs(v * 100).toFixed(step * 100 >= 1 ? 0 : 1)}%`;
}

function HistChart({ series, percent, kind, cur, title, lang }: {
  series: HistPoint[];
  percent: boolean;
  kind: "bar" | "line";
  cur: Currency;
  title: string;
  lang: RLang;
}) {
  const [setEl, W] = useElementWidth(240);
  const [hover, setHover] = useState<number | null>(null);
  const n = series.length;
  if (!n) {
    return (
      <div className="rs-empty" ref={setEl}>
        {tr(lang, "這個期間暫無可用歷史資料；缺值不以 0 代替。", "この期間の履歴データはありません（欠損値は 0 で補完しません）。")}
      </div>
    );
  }
  const compact = W > 0 && W < 480;
  const H = compact ? 210 : 244;
  const vals = series.map((p) => p.value);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (lo === hi) hi = lo + 1;
  const pad = (hi - lo) * 0.16;
  if (lo < 0) lo -= pad;
  if (hi > 0) hi += pad;
  const { ticks, step } = ticksWithin(lo, hi, compact ? 3 : 4);
  const tickLabel = (v: number) => (percent ? pctTick(v, step) : fmtAmountTick(v, cur));
  const valueLabel = (v: number) => (percent ? fmtPct(v, 1) : fmtAmount(v, cur, 1));
  const axisW = Math.max(40, Math.max(...ticks.map((v) => tickLabel(v).length)) * 7 + 12);
  const padR = 8;
  const pt = 22;
  const pb = 28;
  const iw = Math.max(40, W - axisW - padR);
  const slot = iw / n;
  const X = (i: number) => axisW + slot * (i + 0.5);
  const Y = (v: number) => pt + ((hi - v) / (hi - lo || 1)) * (H - pt - pb);
  const zero = Y(0);
  const bw = Math.min(58, slot * 0.56);
  const line = series.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join("");
  const aria = `${title}：${series.map((p) => `${p.label} ${valueLabel(p.value)}`).join("，")}`;

  return (
    <div className="rs-hist-chart" ref={setEl}>
      {W > 0 && (
        <svg className="rs-svg" width={W} height={H} role="img" aria-label={aria} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "rs-zero" : "rs-grid"} x1={axisW} x2={W - padR} y1={Math.round(Y(v)) + 0.5} y2={Math.round(Y(v)) + 0.5} />
              <text className="rs-ax" x={axisW - 8} y={Y(v)} textAnchor="end" dominantBaseline="middle">{tickLabel(v)}</text>
            </g>
          ))}
          {!ticks.includes(0) && <line className="rs-zero" x1={axisW} x2={W - padR} y1={Math.round(zero) + 0.5} y2={Math.round(zero) + 0.5} />}
          {kind === "bar" ? series.map((p, i) => {
            const y = Y(p.value);
            return (
              <rect key={p.label} className={`rs-hbar${p.value < 0 ? " neg" : ""}${hover === i ? " on" : ""}`} style={{ animationDelay: `${i * 50}ms` }}
                x={X(i) - bw / 2} y={Math.min(y, zero)} width={bw} height={Math.max(1.5, Math.abs(zero - y))} />
            );
          }) : (
            <>
              <path className="rs-hline rs-draw" pathLength={1} d={line} />
              {series.map((p, i) => <circle key={p.label} className={`rs-hpt${hover === i ? " on" : ""}`} cx={X(i)} cy={Y(p.value)} r={hover === i ? 5.5 : 4} />)}
            </>
          )}
          {series.map((p, i) => {
            const y = Y(p.value);
            const below = p.value < 0;
            return (
              <text key={`v${p.label}`} className={`rs-hval${hover === i ? " on" : ""}${below ? " neg" : ""}`} x={X(i)}
                y={kind === "bar" ? (below ? Math.max(y, zero) + 14 : Math.min(y, zero) - 7) : y - 11} textAnchor="middle">
                {valueLabel(p.value)}
              </text>
            );
          })}
          {series.map((p, i) => (
            <text key={`x${p.label}`} className={`rs-ax${hover === i ? " rs-ax-on" : ""}`} x={X(i)} y={H - 8} textAnchor="middle">{p.label}</text>
          ))}
          {series.map((p, i) => (
            <rect key={`hit${p.label}`} className="rs-hit" x={axisW + slot * i} y={pt} width={slot} height={H - pt - pb}
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
          ))}
        </svg>
      )}
    </div>
  );
}
