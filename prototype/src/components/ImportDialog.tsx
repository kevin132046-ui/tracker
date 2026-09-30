import { useEffect, useMemo, useRef, useState } from "react";
import type { NewTrade } from "./TradeForm";
import { errorCopy, getSample, type SampleErrorLike, type SampleFn } from "@/lib/ai";
import type { Lang } from "@/lib/wa";

type Field = "date" | "ticker" | "kind" | "side" | "qty" | "price" | "optionType" | "strike" | "expiry" | "fees" | "note";
const FIELDS: { k: Field; zh: string; ja: string; req?: boolean }[] = [
  { k: "date", zh: "成交日", ja: "約定日", req: true }, { k: "ticker", zh: "代號", ja: "銘柄", req: true },
  { k: "side", zh: "買／賣", ja: "売買", req: true }, { k: "qty", zh: "數量", ja: "数量", req: true },
  { k: "price", zh: "價格", ja: "価格", req: true }, { k: "kind", zh: "類型", ja: "種類" },
  { k: "optionType", zh: "PUT／CALL", ja: "プット／コール" }, { k: "strike", zh: "履約價", ja: "権利行使価格" },
  { k: "expiry", zh: "到期日", ja: "満期日" }, { k: "fees", zh: "手續費", ja: "手数料" }, { k: "note", zh: "備註", ja: "メモ" },
];
const SYN: Record<Field, string[]> = {
  date: ["date", "trade date", "日期", "成交日", "交易日", "約定日", "成交日期"],
  ticker: ["ticker", "symbol", "code", "代號", "代碼", "標的", "股票代號", "銘柄", "銘柄コード"],
  side: ["side", "action", "buy/sell", "買賣", "買/賣", "動作", "売買", "買賣別"],
  qty: ["qty", "quantity", "shares", "contracts", "數量", "股數", "口數", "数量"],
  price: ["price", "fill price", "avg price", "價格", "成交價", "單價", "均價", "約定単価", "単価"],
  kind: ["kind", "type", "asset", "asset type", "類型", "類別", "商品", "種類"],
  optionType: ["put/call", "right", "cp", "option type", "權利", "買權/賣權", "オプション種別"],
  strike: ["strike", "strike price", "履約價", "行使価格", "権利行使価格"],
  expiry: ["expiry", "expiration", "exp", "到期", "到期日", "満期", "満期日"],
  fees: ["fees", "fee", "commission", "手續費", "費用", "手数料"],
  note: ["note", "notes", "memo", "備註", "メモ"],
};

function detectDelimiter(line: string) {
  const c = { ",": 0, "\t": 0, ";": 0 } as Record<string, number>;
  let q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const num = (s: string) => { const v = Number(String(s ?? "").replace(/[$¥,\s]/g, "").replace(/^\((.*)\)$/, "-$1")); return Number.isFinite(v) ? v : NaN; };
function isoDate(s: string) {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; // 美式 MM/DD/YYYY
  return "";
}
function sideOf(s: string): "buy" | "sell" | "" {
  const t = String(s ?? "").trim().toLowerCase();
  if (/^(s|sell|sld|sto|stc|short|賣|賣出|売|売り|提出|withdraw)$/.test(t) || /sell|賣|売/.test(t)) return "sell";
  if (/^(b|buy|bot|bto|btc|long|買|買入|買進|買い|存入|deposit)$/.test(t) || /buy|買/.test(t)) return "buy";
  return "";
}

export interface ImportRow { trade: NewTrade | null; error: string; raw: string[] }

export function rowsToTrades(rows: string[][], map: Partial<Record<Field, number>>, today: string): ImportRow[] {
  return rows.map((r) => {
    const g = (f: Field) => (map[f] == null ? "" : String(r[map[f]!] ?? "").trim());
    const date = isoDate(g("date")) || (map.date == null ? today : "");
    const ticker = g("ticker").toUpperCase().replace(/\s+/g, "");
    const side = sideOf(g("side"));
    const qty = Math.abs(num(g("qty")));
    const price = Math.abs(num(g("price")));
    const strike = num(g("strike"));
    const expiry = isoDate(g("expiry"));
    const ot = /p/i.test(g("optionType")) ? "PUT" : /c/i.test(g("optionType")) ? "CALL" : "";
    const kindRaw = g("kind").toLowerCase();
    const kind: NewTrade["kind"] = /cash|現金/.test(kindRaw) ? "cash" : /opt|選擇權|オプション|put|call/.test(kindRaw) || (ot && Number.isFinite(strike)) ? "option" : "stock";
    const err: string[] = [];
    if (!date) err.push("日期");
    if (!ticker && kind !== "cash") err.push("代號");
    if (!side) err.push("買賣");
    if (!(qty > 0)) err.push("數量");
    if (!(price >= 0) || Number.isNaN(price)) err.push("價格");
    if (kind === "option" && (!ot || !Number.isFinite(strike) || !expiry)) err.push("選擇權欄位");
    if (err.length) return { trade: null, error: err.join("、"), raw: r };
    return {
      trade: {
        kind, ticker: ticker || "USD", side: side as "buy" | "sell", qty, price, date,
        optionType: (ot || "PUT") as "PUT" | "CALL", strike: Number.isFinite(strike) ? strike : 0, expiry: expiry || date,
        fees: Math.abs(num(g("fees"))) || 0, note: g("note"),
      }, error: "", raw: r,
    };
  });
}

export function guessMap(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const t = h.trim().toLowerCase();
    for (const f of Object.keys(SYN) as Field[]) if (out[f] == null && SYN[f].some((s) => t === s || t.includes(s))) { out[f] = i; break; }
  });
  return out;
}

/** 匯入交易：CSV 讀檔（自動對應欄位、逐列檢查）與券商截圖辨識（由 Claude 讀圖轉成交易列） */
export default function ImportDialogBody({ lang, onImport, today }: { lang: Lang; onImport: (t: NewTrade[]) => void; today: string }) {
  const ja = lang === "ja";
  const [tab, setTab] = useState<"csv" | "image">("csv");
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [drag, setDrag] = useState(false);
  const [sample, setSample] = useState<SampleFn | null | undefined>(undefined);
  const [imgOk, setImgOk] = useState(false);
  const [img, setImg] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [aiRows, setAiRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    void getSample().then(async (s) => {
      setSample(s);
      if (s) { const lim = await s.limits().catch(() => null); setImgOk(!!lim?.images); }
    });
  }, []);
  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);

  const header = hasHeader ? rows[0] ?? [] : (rows[0] ?? []).map((_, i) => `${ja ? "列" : "欄"} ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const parsed = useMemo(() => rowsToTrades(body, map, today), [body, map, today]);
  const ok = parsed.filter((p) => p.trade);

  async function readFile(f: File) {
    setMsg("");
    const text = await f.text();
    const r = parseCsv(text);
    setRows(r);
    setFileName(f.name);
    setMap(guessMap(r[0] ?? []));
  }

  async function recognize() {
    if (!sample || !img || busy) return;
    setBusy(true); setMsg(""); setAiRows([]);
    const c = new AbortController(); ctl.current = c;
    const prompt = [
      "This image is a screenshot of a brokerage account (positions, order history or trade confirmations). Extract every trade or position row you can read.",
      'Reply with ONLY a JSON array. Each element: {"date":"YYYY-MM-DD or empty","ticker":"US or JP symbol (JP 4-digit codes as e.g. 7203.T)","kind":"stock|option|cash","side":"buy|sell","qty":number,"price":number,"optionType":"PUT|CALL|","strike":number|null,"expiry":"YYYY-MM-DD|","fees":number|null,"note":"short text"}.',
      "For positions without a trade date use an empty date. For short options side is sell. Use the per-share option premium as price. Do not invent rows you cannot read.",
      'Example: [{"date":"2026-05-06","ticker":"KO","kind":"option","side":"sell","qty":1,"price":2.0,"optionType":"PUT","strike":72.5,"expiry":"2026-11-20","fees":0.65,"note":""}]',
    ].join("\n");
    try {
      const data = await sample.json<Record<string, unknown>[]>(prompt, { images: img, signal: c.signal });
      const arr = Array.isArray(data) ? data : [];
      const asRows = arr.map((d) => [d.date, d.ticker, d.kind, d.side, d.qty, d.price, d.optionType, d.strike, d.expiry, d.fees, d.note].map((v) => (v == null ? "" : String(v))));
      const m: Partial<Record<Field, number>> = { date: 0, ticker: 1, kind: 2, side: 3, qty: 4, price: 5, optionType: 6, strike: 7, expiry: 8, fees: 9, note: 10 };
      setAiRows(rowsToTrades(asRows, m, today));
      if (!arr.length) setMsg(ja ? "取引が見つかりませんでした。" : "圖中沒有辨識到交易。");
    } catch (err) {
      const e = err as SampleErrorLike;
      if (e.code !== "cancelled") setMsg(errorCopy(e.code, lang));
    } finally { setBusy(false); ctl.current = null; }
  }

  const preview = (list: ImportRow[]) => (
    <div className="imp-table-wrap">
      <table className="imp-table">
        <thead><tr><th>#</th><th>{ja ? "約定日" : "日期"}</th><th>{ja ? "銘柄" : "代號"}</th><th>{ja ? "内容" : "內容"}</th><th className="r">{ja ? "数量" : "數量"}</th><th className="r">{ja ? "価格" : "價格"}</th><th>{ja ? "状態" : "狀態"}</th></tr></thead>
        <tbody>
          {list.slice(0, 60).map((p, i) => (
            <tr key={i} className={p.trade ? "" : "bad"}>
              <td>{i + 1}</td>
              <td>{p.trade?.date ?? "—"}</td>
              <td><b>{p.trade?.ticker ?? p.raw.join(" ").slice(0, 14)}</b></td>
              <td>{p.trade ? (p.trade.kind === "option" ? `${p.trade.side === "sell" ? (ja ? "売" : "賣") : (ja ? "買" : "買")} ${p.trade.strike}${p.trade.optionType === "PUT" ? "P" : "C"} · ${p.trade.expiry}` : p.trade.kind === "cash" ? (ja ? "現金" : "現金") : p.trade.side === "sell" ? (ja ? "売却" : "賣出") : (ja ? "購入" : "買入")) : "—"}</td>
              <td className="r">{p.trade?.qty ?? "—"}</td>
              <td className="r">{p.trade ? p.trade.price.toFixed(2) : "—"}</td>
              <td>{p.trade ? <span className="imp-ok">✓</span> : <span className="imp-bad">{ja ? "不足：" : "缺："}{p.error}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="imp">
      <div className="seg imp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "csv"} className={tab === "csv" ? "on" : ""} onClick={() => setTab("csv")}>{ja ? "CSV ファイル" : "CSV 檔案"}</button>
        <button type="button" role="tab" aria-selected={tab === "image"} className={tab === "image" ? "on" : ""} onClick={() => setTab("image")}>{ja ? "スクリーンショット認識" : "截圖辨識"}</button>
      </div>

      {tab === "csv" ? (
        <>
          <label className={`drop${drag ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}>
            <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
            <b>{fileName || (ja ? "CSV をドロップ、またはクリックして選択" : "拖放 CSV，或點此選擇檔案")}</b>
            <small>{ja ? "券商の取引履歴・自作の表に対応。列は自動で対応付け、あとから変更できます。" : "支援券商成交紀錄或自製表格；欄位會自動對應，也可手動調整。逗號、Tab、分號分隔皆可。"}</small>
          </label>
          {!rows.length && (
            <p className="imp-hint">{ja ? "例：" : "範例："}<code>date,ticker,side,qty,price,type,put/call,strike,expiry,fees</code><br /><code>2026-05-06,KO,sell,1,2.00,option,PUT,72.5,2026-11-20,0.65</code></p>
          )}
          {rows.length > 0 && (
            <>
              <div className="imp-map">
                <label className="mini-switch"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /><i />{ja ? "1行目は見出し" : "第一列是標題"}</label>
                {FIELDS.map((f) => (
                  <label key={f.k} className="imp-field">
                    <span>{ja ? f.ja : f.zh}{f.req && <em>*</em>}</span>
                    <select value={map[f.k] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [f.k]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                      <option value="">{ja ? "（なし）" : "（無）"}</option>
                      {header.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {preview(parsed)}
              <div className="imp-foot">
                <span>{ja ? `読み込み ${parsed.length} 行・取り込み可能 ${ok.length} 行` : `共 ${parsed.length} 列，可匯入 ${ok.length} 列`}</span>
                <button type="button" className="btn primary" disabled={!ok.length} onClick={() => onImport(ok.map((p) => p.trade!))}>{ja ? `${ok.length} 件を取り込む` : `匯入 ${ok.length} 筆`}</button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {sample === null || (sample && !imgOk) ? (
            <p className="imp-hint">{ja ? "このビューでは画像認識を利用できません。正式サイトでは設定の AI（OpenAI／Anthropic のビジョン対応モデル）で認識します。" : "這個檢視無法傳送圖片給 AI。正式站會用設定中的 AI（OpenAI／Anthropic 支援影像的模型）辨識。"}</p>
          ) : (
            <>
              <label className="drop">
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setImg(f); setAiRows([]); setMsg("");
                  setImgUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(f); });
                }} />
                {imgUrl ? <img src={imgUrl} alt="" className="imp-img" /> : <b>{ja ? "証券口座のスクリーンショットを選択" : "選擇券商 App／網頁的截圖"}</b>}
                <small>{ja ? "画像は Claude が読み取り、取引行に変換します。取り込む前に必ず確認してください。" : "圖片由 Claude 讀取並轉成交易列；匯入前請逐列確認數字。"}</small>
              </label>
              <div className="imp-foot">
                <span>{busy ? (ja ? "認識中…" : "辨識中…") : msg}</span>
                {busy
                  ? <button type="button" className="btn ghost" onClick={() => ctl.current?.abort()}>{ja ? "停止" : "停止"}</button>
                  : <button type="button" className="btn primary" disabled={!img || !sample} onClick={() => void recognize()}>{ja ? "認識する" : "開始辨識"}</button>}
              </div>
              {aiRows.length > 0 && (
                <>
                  {preview(aiRows)}
                  <div className="imp-foot">
                    <span>{ja ? `${aiRows.filter((r) => r.trade).length} 件を認識` : `辨識出 ${aiRows.filter((r) => r.trade).length} 筆可匯入`}</span>
                    <button type="button" className="btn primary" disabled={!aiRows.some((r) => r.trade)} onClick={() => onImport(aiRows.filter((r) => r.trade).map((r) => r.trade!))}>{ja ? "取り込む" : "匯入"}</button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      {tab === "csv" && msg && <p className="imp-hint">{msg}</p>}
    </div>
  );
}
