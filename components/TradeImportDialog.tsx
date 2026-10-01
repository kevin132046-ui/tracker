'use client';

import type { DragEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AiEntryContext, AiEntryResult } from '@/components/AiTradeEntry';
import AiTradeEntry from '@/components/AiTradeEntry';
import { claudeModelLabel } from '@/lib/ai-models';
import type { AiCloseUpdate } from '@/lib/ai-trade-entry';
import { planAiImport } from '@/lib/ai-trade-entry';
import { autoMapHeaders, decodeCsv, defaultImportSelection, importFields, mapImportRows, parseCsvTable } from '@/lib/trade-csv';
import type { CsvEncoding, CsvTrade, ImportField, ImportRow } from '@/lib/trade-csv';
import { likelyTradeLines, linesToTsv } from '@/lib/pdf-table';

/** What the table came from: a CSV file (its encoding can be changed), or text made from an Excel sheet, a PDF or a paste. */
type LoadedFile = { name: string; size: number; bytes: ArrayBuffer; source: 'csv' | 'xlsx' | 'text' };
/** An Excel workbook kept so another sheet can be chosen. */
type Workbook = { name: string; size: number; bytes: ArrayBuffer; sheets: string[]; sheet: number };
/** A PDF's extracted lines, all of them and the ones that look like trades. */
type PdfLines = { name: string; pages: number; all: string[][]; likely: string[][] };
type Outcome = { imported: number; updated?: number; total: number; failedLine?: number; failedLabel?: string; error?: string };
type RowState = 'imported' | 'error' | 'merged' | 'duplicate' | 'ready';
type Mode = 'csv' | 'paste' | 'ai';
/** An AI reply frozen at the moment it arrived, so importing does not reshuffle it. */
type AiPlan = { result: AiEntryResult; rows: ImportRow[]; closes: AiCloseUpdate[] };

const maxFileBytes = 5 * 1024 * 1024;
const maxBinaryBytes = 20 * 1024 * 1024;
const utf8 = new TextEncoder();
const startsWith = (bytes: ArrayBuffer, ...magic: number[]) => { const head = new Uint8Array(bytes, 0, Math.min(magic.length, bytes.byteLength)); return magic.every((value, index) => head[index] === value); };
const maxRows = 2_000;
const delimiterLabels: Record<string, string> = { ',': '逗號', '\t': 'Tab', ';': '分號' };
const stateLabels: Record<RowState, string> = { imported: '已匯入', error: '錯誤', merged: '已合併', duplicate: '重複', ready: '可匯入' };
const requiredFields: ReadonlyArray<[ImportField, string]> = [['openDate', '開倉日'], ['ticker', '代號'], ['quantity', '數量'], ['price', '成交價']];
const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const typeLabel = (trade: CsvTrade) => trade.type === 'CASH' ? '現金' : trade.type === 'SDI' ? '股票' : trade.type === 'Sell' ? '賣方' : trade.type === 'Buy' ? '買方' : trade.type;
const contractLabel = (trade: CsvTrade) => trade.type === 'SDI' ? `${trade.ticker} 股票` : `${trade.ticker} ${trade.strike ?? ''} ${trade.event}${trade.expiryDate ? ` · ${trade.expiryDate}` : ''}`;
const stateOfRow = (row: ImportRow, imported: ReadonlySet<number>): RowState => imported.has(row.line) ? 'imported' : row.mergedInto !== null ? 'merged' : !row.trade ? 'error' : row.duplicateOf !== null ? 'duplicate' : 'ready';
const without = (set: ReadonlySet<number>, value: number) => { const next = new Set(set); next.delete(value); return next; };

async function postTrade(trade: CsvTrade) {
  const response = await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
  const payload = await response.json().catch(() => ({})) as { trade?: unknown; error?: string };
  if (!response.ok || !payload.trade) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
}

async function putTrade(trade: CsvTrade) {
  const response = await fetch('/api/trades', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
  const payload = await response.json().catch(() => ({})) as { trade?: unknown; error?: string };
  if (!response.ok || !payload.trade) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
}

/** The checked rows of a file or an AI reply, with each row's checks. */
function ImportPreview({ titleId, rows, selected, imported, importing, lineLabel, onToggle, onSuggested, onClear }: {
  titleId: string;
  rows: readonly ImportRow[];
  selected: ReadonlySet<number>;
  imported: ReadonlySet<number>;
  importing: boolean;
  lineLabel: (line: number) => string;
  onToggle: (line: number) => void;
  onSuggested: () => void;
  onClear: () => void;
}) {
  const counts = rows.reduce((total, row) => ({ ...total, [stateOfRow(row, imported)]: total[stateOfRow(row, imported)] + 1 }), { imported: 0, error: 0, merged: 0, duplicate: 0, ready: 0 } as Record<RowState, number>);
  return <section className="import-preview" aria-labelledby={`${titleId}-preview`}>
    <div className="import-section-heading">
      <h3 id={`${titleId}-preview`}>預覽與檢查</h3>
      <div className="import-counts">
        <span className="ready">可匯入 {counts.ready}</span>
        <span className="duplicate">重複 {counts.duplicate}</span>
        <span className="error">錯誤 {counts.error}</span>
        {counts.merged > 0 && <span className="merged">已合併 {counts.merged}</span>}
        {counts.imported > 0 && <span className="imported">已匯入 {counts.imported}</span>}
      </div>
      <div className="import-selection-actions">
        <button type="button" disabled={importing} onClick={onSuggested}>勾選建議列</button>
        <button type="button" disabled={importing} onClick={onClear}>全部取消</button>
      </div>
    </div>
    <div className="import-preview-wrap">
      <table className="import-preview-table">
        <thead><tr><th scope="col"><span className="visually-hidden">匯入</span></th><th scope="col">列</th><th scope="col">狀態</th><th scope="col">標的</th><th scope="col">類型</th><th scope="col">策略</th><th scope="col">履約價</th><th scope="col">到期日</th><th scope="col">數量</th><th scope="col">成交價</th><th scope="col">開倉日</th><th scope="col">平倉日</th><th scope="col">平倉／目前價</th><th scope="col">手續費</th><th scope="col">擔保金</th><th scope="col">檢查結果</th></tr></thead>
        <tbody>{rows.map((row) => {
          const state = stateOfRow(row, imported);
          const trade = row.trade;
          return <tr key={row.line} className={`is-${state}`}>
            <td><input type="checkbox" aria-label={`匯入第 ${lineLabel(row.line)} 列`} checked={selected.has(row.line) && state !== 'imported'} disabled={!trade || state === 'imported' || importing} onChange={() => onToggle(row.line)} /></td>
            <td>{lineLabel(row.line)}</td>
            <td><span className={`import-state ${state}`}>{stateLabels[state]}</span></td>
            <td>{trade?.ticker ?? '—'}</td>
            <td>{trade ? typeLabel(trade) : '—'}</td>
            <td>{trade?.event ?? '—'}</td>
            <td>{trade?.strike ?? '—'}</td>
            <td>{trade?.expiryDate ?? '—'}</td>
            <td>{trade ? money.format(trade.quantity) : '—'}</td>
            <td>{trade && trade.type !== 'CASH' ? money.format(trade.entryPrice) : '—'}</td>
            <td>{trade?.openDate || '—'}</td>
            <td>{trade?.closeDate ?? '—'}</td>
            <td>{trade && trade.type !== 'CASH' && trade.currentPrice !== null ? money.format(trade.currentPrice) : '—'}</td>
            <td>{trade && trade.type !== 'CASH' ? money.format(trade.fees) : '—'}</td>
            <td>{trade ? money.format(trade.collateral) : '—'}</td>
            <td className="import-messages">
              {row.mergedInto !== null && <span className="merged">已併入第 {lineLabel(row.mergedInto)} 列（平倉成交）</span>}
              {row.errors.map((message) => <span className="error" key={message}>{message}</span>)}
              {row.warnings.map((message) => <span className="warning" key={message}>{message}</span>)}
              {state === 'ready' && !row.warnings.length && <span className="ok">OK</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

/** Closing fills from an AI reply that update one of the user's open trades. */
function CloseUpdates({ titleId, closes, selected, applied, importing, onToggle }: {
  titleId: string;
  closes: readonly AiCloseUpdate[];
  selected: ReadonlySet<number>;
  applied: ReadonlySet<number>;
  importing: boolean;
  onToggle: (index: number) => void;
}) {
  return <section className="import-preview import-closes" aria-labelledby={`${titleId}-closes`}>
    <div className="import-section-heading">
      <h3 id={`${titleId}-closes`}>平倉：更新現有交易</h3>
      <div className="import-counts">
        <span className="ready">可更新 {closes.filter((close) => close.next && !applied.has(close.index)).length}</span>
        {closes.some((close) => !close.next) && <span className="error">無法更新 {closes.filter((close) => !close.next).length}</span>}
        {applied.size > 0 && <span className="imported">已更新 {applied.size}</span>}
      </div>
    </div>
    <div className="import-preview-wrap">
      <table className="import-preview-table import-closes-table">
        <thead><tr><th scope="col"><span className="visually-hidden">更新</span></th><th scope="col">交易</th><th scope="col">合約</th><th scope="col">數量</th><th scope="col">開倉日</th><th scope="col">成交價</th><th scope="col">平倉日</th><th scope="col">平倉價</th><th scope="col">手續費</th><th scope="col">檢查結果</th></tr></thead>
        <tbody>{closes.map((close) => {
          const done = applied.has(close.index);
          return <tr key={close.index} className={done ? 'is-imported' : close.next ? 'is-ready' : 'is-error'}>
            <td><input type="checkbox" aria-label={`平倉交易 #${close.target.id}`} checked={selected.has(close.index) && !done} disabled={!close.next || done || importing} onChange={() => onToggle(close.index)} /></td>
            <td>#{close.target.id}</td>
            <td>{contractLabel(close.target)}</td>
            <td>{money.format(close.target.quantity)}</td>
            <td>{close.target.openDate}</td>
            <td>{money.format(close.target.entryPrice)}</td>
            <td>{close.row.date ?? '—'}</td>
            <td>{close.row.price === null ? '—' : money.format(close.row.price)}</td>
            <td>{close.next ? `${money.format(close.target.fees)} → ${money.format(close.next.fees)}` : '—'}</td>
            <td className="import-messages">
              {done ? <span className="ok">已平倉</span> : close.error ? <span className="error">{close.error}</span> : <span className="ok">將標為已平倉</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

/**
 * Modal for importing trades: a CSV file (pick or drop it, check the column mapping and preview,
 * import the chosen rows) or, when AI is available, a sentence or screenshot read by Claude / ChatGPT
 * into the same preview. Closing fills from the AI become updates to the open trade they close.
 */
export default function TradeImportDialog({ existingTrades, onClose, onImported, ai }: {
  existingTrades: readonly CsvTrade[];
  onClose: () => void;
  onImported: (count: number, updated?: number) => void;
  ai?: AiEntryContext;
}) {
  const [mode, setMode] = useState<Mode>('csv');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>('auto');
  const [mapping, setMapping] = useState<Array<ImportField | ''>>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [imported, setImported] = useState<Set<number>>(new Set());
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null);
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set());
  const [aiImported, setAiImported] = useState<Set<number>>(new Set());
  const [closeSelected, setCloseSelected] = useState<Set<number>>(new Set());
  const [closeApplied, setCloseApplied] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState('');
  const [reading, setReading] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [pdf, setPdf] = useState<PdfLines | null>(null);
  const [pdfAll, setPdfAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const decoded = useMemo(() => file ? decodeCsv(file.bytes, encoding) : null, [encoding, file]);
  const table = useMemo(() => decoded ? parseCsvTable(decoded.text) : null, [decoded]);
  const rows = useMemo(() => table && mapping.length ? mapImportRows(table, mapping, { existing: existingTrades }) : [], [existingTrades, mapping, table]);
  const queue = rows.filter((row) => row.trade && selected.has(row.line) && !imported.has(row.line));
  const missingFields = mapping.length ? requiredFields.filter(([field]) => !mapping.includes(field)).map(([, label]) => label) : [];
  const aiQueue = aiPlan ? aiPlan.rows.filter((row) => row.trade && aiSelected.has(row.line) && !aiImported.has(row.line)) : [];
  const closeQueue = aiPlan ? aiPlan.closes.filter((close) => close.next && closeSelected.has(close.index) && !closeApplied.has(close.index)) : [];
  const pending = mode !== 'ai' ? queue.length : aiQueue.length + closeQueue.length;

  useEffect(() => {
    pickRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || importing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [importing, onClose]);

  // Defaults after the file, encoding or mapping changes: importable, non-duplicate rows not yet imported.
  const reset = (next: { bytes: ArrayBuffer; encoding: CsvEncoding; mapping?: Array<ImportField | ''> }, keepImported: boolean) => {
    const nextTable = parseCsvTable(decodeCsv(next.bytes, next.encoding).text);
    const nextMapping = next.mapping ?? autoMapHeaders(nextTable.header);
    const importedLines = keepImported ? imported : new Set<number>();
    setEncoding(next.encoding);
    setMapping(nextMapping);
    setSelected(new Set([...defaultImportSelection(mapImportRows(nextTable, nextMapping, { existing: existingTrades }))].filter((line) => !importedLines.has(line))));
    if (!keepImported) setImported(new Set());
    return nextTable;
  };

  // Any table text (a CSV file, an Excel sheet, a PDF's lines, a paste) goes through the same mapping.
  const loadTable = (name: string, size: number, bytes: ArrayBuffer, source: LoadedFile['source']) => {
    const nextTable = parseCsvTable(decodeCsv(bytes, source === 'csv' ? 'auto' : 'utf-8').text);
    if (!nextTable.header.length || !nextTable.rows.length) return setReadError('找不到資料列：第一列需為欄位標題，之後每列一筆交易。');
    if (nextTable.rows.length > maxRows) return setReadError(`資料列超過 ${maxRows} 列，請分批匯入。`);
    setFile({ name, size, bytes, source });
    reset({ bytes, encoding: source === 'csv' ? 'auto' : 'utf-8' }, false);
  };
  const loadText = (name: string, text: string, source: LoadedFile['source'] = 'text') => {
    const bytes = utf8.encode(text).buffer as ArrayBuffer;
    loadTable(name, bytes.byteLength, bytes, source);
  };

  const openSheet = async (book: Omit<Workbook, 'sheets' | 'sheet'>, sheet: number) => {
    const { readXlsx, rowsToCsv } = await import('@/lib/xlsx-read');
    const { sheets, sheet: read } = await readXlsx(book.bytes, sheet);
    setWorkbook({ ...book, sheets, sheet });
    if (!read.rows.length) return setReadError(`工作表「${read.name}」是空的。`);
    loadText(`${book.name} · ${read.name}`, rowsToCsv(read.rows), 'xlsx');
  };

  const loadFile = async (picked: File | undefined) => {
    if (!picked || importing) return;
    setReadError('');
    setOutcome(null);
    const lower = picked.name.toLowerCase();
    if (lower.endsWith('.xls')) return setReadError('不支援舊版 Excel（.xls），請在 Excel 另存為 .xlsx 或 CSV。');
    if (picked.size > maxBinaryBytes) return setReadError('檔案超過 20 MB，請分批匯入。');
    let bytes: ArrayBuffer;
    try {
      bytes = await picked.arrayBuffer();
    } catch {
      return setReadError('無法讀取這個檔案。');
    }
    // %PDF
    if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46)) {
      setReading('正在讀取 PDF…');
      try {
        const { readPdfTable } = await import('@/lib/pdf-table');
        const read = await readPdfTable(bytes);
        const likely = likelyTradeLines(read.lines);
        setPdf({ name: picked.name, pages: read.pages, all: read.lines, likely });
        setPdfAll(!likely.length);
        setPasteText(linesToTsv(likely.length ? likely : read.lines));
        setFile(null);
        setMode('paste');
      } catch (error) {
        setReadError(error instanceof Error ? error.message : '無法讀取這份 PDF。');
      } finally {
        setReading('');
      }
      return;
    }
    // PK.. (a ZIP: .xlsx)
    if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) {
      setReading('正在讀取 Excel…');
      try {
        await openSheet({ name: picked.name, size: picked.size, bytes }, 0);
      } catch (error) {
        setReadError(error instanceof Error ? error.message : '無法讀取這個 Excel 檔。');
      } finally {
        setReading('');
      }
      return;
    }
    if (picked.size > maxFileBytes) return setReadError('檔案超過 5 MB，請分批匯入。');
    setWorkbook(null);
    loadTable(picked.name, picked.size, bytes, 'csv');
  };

  const readPaste = () => {
    setReadError('');
    setOutcome(null);
    if (!pasteText.trim()) return setReadError('先貼上表格內容：第一列是欄位標題，之後每列一筆交易。');
    setWorkbook(null);
    loadText(pdf ? `${pdf.name}（PDF 擷取）` : '貼上的表格', pasteText);
  };

  const changeMapping = (column: number, field: ImportField | '') => {
    if (!file) return;
    // A field maps from one column only; choosing it here clears it elsewhere.
    const next = mapping.map((current, index) => index === column ? field : field && current === field ? '' : current);
    reset({ bytes: file.bytes, encoding, mapping: next }, true);
  };

  const toggle = (line: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(line)) next.delete(line);
    else next.add(line);
    return next;
  });
  const toggleIn = (setter: typeof setSelected) => (value: number) => setter((current) => current.has(value) ? without(current, value) : new Set(current).add(value));

  // A new reply replaces the previous one; rows and closes are checked by default when usable.
  const receiveAi = (result: AiEntryResult) => {
    const plan = planAiImport(result, existingTrades);
    const aiRows = plan.table.rows.length ? mapImportRows(plan.table, plan.mapping, { existing: existingTrades }) : [];
    setOutcome(null);
    setAiPlan({ result, rows: aiRows, closes: plan.closes });
    setAiSelected(defaultImportSelection(aiRows));
    setAiImported(new Set());
    setCloseSelected(new Set(plan.closes.filter((close) => close.next).map((close) => close.index)));
    setCloseApplied(new Set());
  };

  const runImport = async () => {
    if (!pending || importing) return;
    setImporting(true);
    setOutcome(null);
    setProgress({ done: 0, total: pending });
    let done = 0;
    let created = 0;
    let updated = 0;
    let failure: Outcome | null = null;
    const step = () => { done += 1; setProgress({ done, total: pending }); };
    if (mode !== 'ai') {
      for (const row of queue) {
        try {
          await postTrade(row.trade!);
          created += 1;
          setImported((current) => new Set(current).add(row.line));
          setSelected((current) => without(current, row.line));
          step();
        } catch (error) {
          failure = { imported: created, total: pending, failedLine: row.line, error: error instanceof Error ? error.message : '匯入失敗' };
          break;
        }
      }
    } else {
      for (const row of aiQueue) {
        try {
          await postTrade(row.trade!);
          created += 1;
          setAiImported((current) => new Set(current).add(row.line));
          setAiSelected((current) => without(current, row.line));
          step();
        } catch (error) {
          failure = { imported: created, updated, total: pending, failedLabel: `第 ${row.line - 1} 筆`, error: error instanceof Error ? error.message : '匯入失敗' };
          break;
        }
      }
      if (!failure) for (const close of closeQueue) {
        try {
          await putTrade(close.next!);
          updated += 1;
          setCloseApplied((current) => new Set(current).add(close.index));
          setCloseSelected((current) => without(current, close.index));
          step();
        } catch (error) {
          failure = { imported: created, updated, total: pending, failedLabel: `交易 #${close.target.id} 平倉`, error: error instanceof Error ? error.message : '更新失敗' };
          break;
        }
      }
    }
    setOutcome(failure ?? { imported: created, updated, total: pending });
    setImporting(false);
    if (created || updated) onImported(created, updated);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  };

  const switchMode = (next: Mode) => {
    if (importing || next === mode) return;
    setMode(next);
    setOutcome(null);
  };

  const idleStatus = mode !== 'ai'
    ? file ? <span>已勾選 {queue.length} 筆；重複列預設不勾選，可逐列勾選。</span> : null
    : aiPlan ? <span>已勾選新增 {aiQueue.length} 筆、平倉 {closeQueue.length} 筆；按下「匯入」前不會寫入。</span> : null;
  const outcomeText = (result: Outcome) => {
    const parts = [`已匯入 ${result.imported} 筆交易`, ...(result.updated ? [`平倉 ${result.updated} 筆`] : [])].join('、');
    if (result.error && result.failedLine !== undefined) return `第 ${result.failedLine} 列匯入失敗：${result.error}。已匯入 ${result.imported} 筆，其餘 ${result.total - result.imported} 筆未匯入。`;
    if (result.error) return `${result.failedLabel}處理失敗：${result.error}。${parts}，其餘 ${result.total - result.imported - (result.updated ?? 0)} 筆未處理。`;
    return `${parts}，持倉與圖表已更新。`;
  };

  return <div className="confirm-backdrop import-backdrop" role="presentation" onMouseDown={(event) => { if (!importing && event.target === event.currentTarget) onClose(); }}>
    <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header>
        <div><p className="eyebrow">{mode === 'ai' ? 'AI entry' : 'Import trades'}</p><h2 id={titleId}>{mode === 'ai' ? '用 AI 記錄交易' : '匯入交易'}</h2></div>
        <button type="button" className="close-button" onClick={onClose} disabled={importing} aria-label="關閉匯入視窗">×</button>
      </header>
      <div className="import-body">
        <div className="import-mode-tabs" role="tablist" aria-label="匯入方式">
          <button type="button" role="tab" aria-selected={mode === 'csv'} className={mode === 'csv' ? 'active' : ''} disabled={importing} onClick={() => switchMode('csv')}>檔案（CSV／Excel／PDF）</button>
          <button type="button" role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'active' : ''} disabled={importing} onClick={() => switchMode('paste')}>貼上表格</button>
          {ai && <button type="button" role="tab" aria-selected={mode === 'ai'} className={mode === 'ai' ? 'active' : ''} disabled={importing} onClick={() => switchMode('ai')}>AI 輸入（一句話／截圖）</button>}
        </div>

        {mode === 'csv' && <>
          <div
            className={`import-dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(event) => { event.preventDefault(); if (!importing) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="import-dropzone-icon" aria-hidden="true">⇪</span>
            <div>
              <strong>{reading || (file && file.source !== 'text' ? file.name : '拖放 CSV、Excel 或 PDF 到這裡')}</strong>
              <small>{file && file.source !== 'text' && table ? `${table.rows.length} 列資料 · 分隔符號：${delimiterLabels[table.delimiter]} ${file.source === 'csv' ? ` · 編碼：${decoded?.encoding === 'utf-8' ? 'UTF-8' : decoded?.encoding === 'shift_jis' ? 'Shift_JIS' : 'Big5'}` : ''}` : 'CSV（逗號、Tab、分號）、Excel（.xlsx）與券商 PDF 對帳單；檔案只在你的瀏覽器裡讀取，不會上傳。也能辨識常見券商欄位（英文／中文／日本語）。'}</small>
            </div>
            <button ref={pickRef} type="button" className="import-pick-button" disabled={importing || Boolean(reading)} onClick={() => inputRef.current?.click()}>{file ? '換一個檔案' : '選擇檔案'}</button>
            <input ref={inputRef} className="visually-hidden" type="file" accept=".csv,.tsv,.txt,.xlsx,.pdf,text/csv,text/tab-separated-values,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" tabIndex={-1} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ''; void loadFile(picked); }} />
          </div>
          {workbook && workbook.sheets.length > 1 && file?.source === 'xlsx' && <label className="import-sheet-pick">工作表<select value={workbook.sheet} disabled={importing} onChange={(event) => { setReadError(''); void openSheet(workbook, Number(event.target.value)).catch((error: unknown) => setReadError(error instanceof Error ? error.message : '讀不到這張工作表。')); }}>{workbook.sheets.map((name, index) => <option key={`${index}-${name}`} value={index}>{name || `工作表 ${index + 1}`}</option>)}</select></label>}
        </>}

        {mode === 'paste' && <section className="import-paste" aria-labelledby={`${titleId}-paste`}>
          <div className="import-section-heading"><h3 id={`${titleId}-paste`}>{pdf ? 'PDF 擷取的表格' : '貼上表格'}</h3>
            {pdf && <label className="import-pdf-all"><input type="checkbox" checked={pdfAll} disabled={importing || !pdf.likely.length} onChange={(event) => { setPdfAll(event.target.checked); setPasteText(linesToTsv(event.target.checked ? pdf.all : pdf.likely)); }} />顯示全部擷取內容</label>}
          </div>
          <p className="import-hint">{pdf
            ? `已從「${pdf.name}」（${pdf.pages} 頁）擷取${pdfAll ? `全部 ${pdf.all.length} 行` : ` ${pdf.likely.length} 行看起來像交易的內容（含上方的欄位標題）`}。第一行要是欄位標題；刪掉不是交易的行後按「讀取表格」。`
            : '從 Excel、Google 試算表或券商網頁複製表格後貼上。第一列是欄位標題，之後每列一筆交易；Tab 或逗號分隔都可以。'}</p>
          <textarea className="import-paste-text" rows={10} value={pasteText} disabled={importing} spellCheck={false} placeholder={'例：\n日期\t代號\t類型\t數量\t價格\n2026-03-14\tMSFT\t賣 PUT\t1\t2.35'} onChange={(event) => setPasteText(event.target.value)} />
          <div className="import-paste-actions">
            {(pasteText || pdf) && <button type="button" className="cancel-button" disabled={importing} onClick={() => { setPasteText(''); setPdf(null); setFile(null); }}>清除</button>}
            <button type="button" className="import-pick-button" disabled={importing || !pasteText.trim()} onClick={readPaste}>讀取表格</button>
          </div>
        </section>}

        {mode !== 'ai' && <>
          {readError && <p className="import-alert is-error" role="alert">{readError}</p>}
          {decoded?.utf8Failed && encoding === 'auto' && <p className="import-alert">檔案不是 UTF-8，已改用 Shift_JIS 解讀；若文字顯示錯誤，請在下方改選編碼。</p>}

          {file && table && <>
            <section className="import-mapping" aria-labelledby={`${titleId}-mapping`}>
              <div className="import-section-heading">
                <h3 id={`${titleId}-mapping`}>欄位對應</h3>
                {file.source === 'csv' && <label className="import-encoding">編碼<select value={encoding} disabled={importing} onChange={(event) => reset({ bytes: file.bytes, encoding: event.target.value as CsvEncoding }, false)}><option value="auto">自動（UTF-8）</option><option value="utf-8">UTF-8</option><option value="shift_jis">Shift_JIS</option><option value="big5">Big5</option></select></label>}
              </div>
              {missingFields.length > 0 && <p className="import-alert">尚未對應：{missingFields.join('、')}（現金列不需代號與成交價）。</p>}
              <div className="import-mapping-grid">
                {table.header.map((name, column) => {
                  const sample = table.rows.find((cells) => cells[column]?.trim())?.[column]?.trim() ?? '';
                  return <label key={`${column}-${name}`}>
                    <span className="import-column-name" title={name}>{name || `第 ${column + 1} 欄`}</span>
                    <select value={mapping[column] ?? ''} disabled={importing} aria-label={`「${name || `第 ${column + 1} 欄`}」對應到`} onChange={(event) => changeMapping(column, event.target.value as ImportField | '')}>
                      <option value="">（略過）</option>
                      {importFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </select>
                    <small title={sample}>{sample ? `例：${sample}` : '（空白）'}</small>
                  </label>;
                })}
              </div>
            </section>

            <ImportPreview titleId={titleId} rows={rows} selected={selected} imported={imported} importing={importing} lineLabel={String} onToggle={toggle}
              onSuggested={() => setSelected(new Set([...defaultImportSelection(rows)].filter((line) => !imported.has(line))))} onClear={() => setSelected(new Set())} />
          </>}
        </>}

        {mode === 'ai' && ai && <>
          <AiTradeEntry ai={ai} existingTrades={existingTrades} disabled={importing} onResult={receiveAi} />
          {aiPlan && <>
            <p className="ai-entry-source">
              AI：{aiPlan.result.provider === 'anthropic' ? claudeModelLabel(aiPlan.result.model) : `ChatGPT（${aiPlan.result.model}）`} · {aiPlan.result.rows.length} 筆
            </p>
            {aiPlan.result.questions.length > 0 && <div className="import-alert ai-entry-questions" role="status">
              <b>AI 需要你確認：</b>
              <ul>{aiPlan.result.questions.map((question) => <li key={question}>{question}</li>)}</ul>
            </div>}
            {aiPlan.closes.length > 0 && <CloseUpdates titleId={titleId} closes={aiPlan.closes} selected={closeSelected} applied={closeApplied} importing={importing} onToggle={toggleIn(setCloseSelected)} />}
            {aiPlan.rows.length > 0 && <ImportPreview titleId={titleId} rows={aiPlan.rows} selected={aiSelected} imported={aiImported} importing={importing} lineLabel={(line) => String(line - 1)} onToggle={toggleIn(setAiSelected)}
              onSuggested={() => setAiSelected(new Set([...defaultImportSelection(aiPlan.rows)].filter((line) => !aiImported.has(line))))} onClear={() => setAiSelected(new Set())} />}
          </>}
        </>}
      </div>
      <footer className="import-footer">
        <div className="import-status" aria-live="polite">
          {importing && <><progress max={progress.total} value={progress.done} /><span>匯入中 {progress.done} / {progress.total}…</span></>}
          {!importing && outcome && <span className={outcome.error ? 'is-error' : 'is-success'} role={outcome.error ? 'alert' : undefined}>{outcomeText(outcome)}</span>}
          {!importing && !outcome && idleStatus}
        </div>
        <button type="button" className="cancel-button" disabled={importing} onClick={onClose}>{outcome?.imported || outcome?.updated ? '完成' : '取消'}</button>
        <button type="button" className="primary-button" disabled={importing || !pending} onClick={() => void runImport()}>{importing ? '匯入中…' : mode === 'ai' && closeQueue.length ? `匯入 ${aiQueue.length} 筆、平倉 ${closeQueue.length} 筆` : `匯入 ${pending} 筆`}</button>
      </footer>
    </section>
  </div>;
}
