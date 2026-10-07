'use client';

import type { DragEvent, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AiEntryContext, AiEntryResult } from '@/components/AiTradeEntry';
import AiTradeEntry from '@/components/AiTradeEntry';
import { claudeModelLabel } from '@/lib/ai-models';
import type { AiCloseUpdate } from '@/lib/ai-trade-entry';
import { planAiImport } from '@/lib/ai-trade-entry';
import { exchangeTodayKey } from '@/lib/earnings';
import { autoMapHeaders, decodeCsv, defaultImportSelection, importFields, importOpsOf, mapImportRows, parseCsvTable } from '@/lib/trade-csv';
import type { CsvEncoding, CsvTable, CsvTrade, ImportField, ImportOp, ImportRow } from '@/lib/trade-csv';
import { likelyTradeLines, linesToTsv } from '@/lib/pdf-table';
import { chunkChanges, maxBatchOperations, postTradeBatch, type BatchChanges } from '@/lib/trade-batch';
import type { FieldDiff } from '@/lib/trade-diff';
import { cashFlowKindLabels, maxCashFlowBatch, type CashFlowInput } from '@/lib/cash-flows';

/** What the table came from: a CSV file (its encoding can be changed), or text made from an Excel sheet, a PDF or a paste. */
type LoadedFile = { name: string; size: number; bytes: ArrayBuffer; source: 'csv' | 'xlsx' | 'text' };
/** An Excel workbook kept so another sheet can be chosen. */
type Workbook = { name: string; size: number; bytes: ArrayBuffer; sheets: string[]; sheet: number };
/** A PDF's extracted lines, all of them and the ones that look like trades. */
type PdfLines = { name: string; pages: number; all: string[][]; likely: string[][] };
type Outcome = { imported: number; updated?: number; deleted?: number; flows?: number; total: number; failedLabel?: string; error?: string };
type RowState = 'new' | 'update' | 'differs' | 'same' | 'merged' | 'error' | 'imported';
type Mode = 'csv' | 'paste' | 'ai';
/** An AI reply frozen at the moment it arrived, so importing does not reshuffle it. */
type AiPlan = { result: AiEntryResult; rows: ImportRow[]; closes: AiCloseUpdate[] };

const maxFileBytes = 5 * 1024 * 1024;
const maxBinaryBytes = 20 * 1024 * 1024;
const utf8 = new TextEncoder();
const startsWith = (bytes: ArrayBuffer, ...magic: number[]) => { const head = new Uint8Array(bytes, 0, Math.min(magic.length, bytes.byteLength)); return magic.every((value, index) => head[index] === value); };
const maxRows = 2_000;
const delimiterLabels: Record<string, string> = { ',': '逗號', '\t': 'Tab', ';': '分號' };
const stateLabels: Record<RowState, string> = { new: '新增', update: '更新', differs: '有差異', same: '相同', merged: '已合併', error: '錯誤', imported: '已匯入' };
const stateOrder: RowState[] = ['new', 'update', 'differs', 'same', 'merged', 'error', 'imported'];
const requiredFields: ReadonlyArray<[ImportField, string]> = [['openDate', '開倉日'], ['ticker', '代號'], ['quantity', '數量'], ['price', '成交價']];
const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const typeLabel = (trade: CsvTrade) => trade.type === 'CASH' ? '現金' : trade.type === 'SDI' ? '股票' : trade.type === 'Sell' ? '賣方' : trade.type === 'Buy' ? '買方' : trade.type;
const contractLabel = (trade: CsvTrade) => trade.type === 'SDI' ? `${trade.ticker} 股票` : `${trade.ticker} ${trade.strike ?? ''} ${trade.event}${trade.expiryDate ? ` · ${trade.expiryDate}` : ''}`;
const stateOfRow = (row: ImportRow, imported: ReadonlySet<number>): RowState => imported.has(row.line) ? 'imported'
  : row.errors.length || (!row.trade && !row.flow) ? 'error'
  : row.mergedInto !== null ? 'merged'
  : !row.ops.length ? 'same'
  : row.minor ? 'differs'
  : row.ops.some((op) => op.kind === 'update' || op.kind === 'delete') ? 'update' : 'new';
const without = (set: ReadonlySet<number>, value: number) => { const next = new Set(set); next.delete(value); return next; };
const opCounts = (ops: readonly ImportOp[]) => ({ create: ops.filter((op) => op.kind === 'create').length, update: ops.filter((op) => op.kind === 'update').length, delete: ops.filter((op) => op.kind === 'delete').length, flow: ops.filter((op) => op.kind === 'flow').length });
const fillLabel = (trade: CsvTrade) => trade.type === 'SDI' ? '賣出（平倉）' : trade.type === 'Buy' ? '買回（平倉）' : '賣出（平倉）';
const diffText = (diffs: readonly FieldDiff[]) => diffs.map((diff) => `${diff.label} ${diff.before} → ${diff.after}`).join('、');

/** A file's rows compared with the stored trades (and deposits / withdrawals with the ledger). */
const fileRows = (table: CsvTable, mapping: ReadonlyArray<ImportField | ''>, existing: readonly CsvTrade[], today: string, existingFlows: readonly CashFlowInput[]) => mapImportRows(table, mapping, { existing, today, updateExisting: true, existingFlows });
const noFlows: readonly CashFlowInput[] = [];

/** The rows' changes as /api/trades/batch requests: whole groups per request where they fit. */
function importBatches(rows: readonly ImportRow[]) {
  const groups = new Map<number, ImportRow[]>();
  for (const row of rows) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
  const batches: Array<{ rows: ImportRow[]; changes: BatchChanges<CsvTrade> }> = [];
  let pending: { rows: ImportRow[]; ops: ImportOp[] } = { rows: [], ops: [] };
  const flush = () => {
    if (!pending.ops.length) return;
    const changes: BatchChanges<CsvTrade> = { updates: [], creates: [], deletes: [] };
    for (const op of pending.ops) {
      if (op.kind === 'create') changes.creates.push(op.trade);
      else if (op.kind === 'update') changes.updates.push({ ...op.trade, id: op.id });
      else if (op.kind === 'delete') changes.deletes.push(op.id);
    }
    // A group larger than one request is split; its rows count as imported with the last part.
    const parts = chunkChanges(changes);
    parts.forEach((part, index) => batches.push({ rows: index === parts.length - 1 ? pending.rows : [], changes: part }));
    pending = { rows: [], ops: [] };
  };
  for (const members of groups.values()) {
    // Deposits and withdrawals are saved to the ledger separately.
    const ops = members.flatMap(importOpsOf).filter((op) => op.kind !== 'flow');
    if (!ops.length) continue;
    if (pending.ops.length && pending.ops.length + ops.length > maxBatchOperations) flush();
    pending.rows.push(...members);
    pending.ops.push(...ops);
  }
  flush();
  return batches;
}

async function putTrade(trade: CsvTrade) {
  const response = await fetch('/api/trades', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
  const payload = await response.json().catch(() => ({})) as { trade?: unknown; error?: string };
  if (!response.ok || !payload.trade) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
}

/** A deposit or withdrawal in the preview's trade columns. */
function FlowCells({ flow }: { flow: CashFlowInput }) {
  return <>
    <td>{flow.currency}</td>
    <td><span className={`import-flow ${flow.kind}`}>{cashFlowKindLabels[flow.kind]}</span></td>
    <td>存提款</td><td>—</td><td>—</td>
    <td>{money.format(flow.amount)}</td>
    <td>—</td>
    <td>{flow.date || '—'}</td>
    <td>—</td><td>—</td><td>—</td><td>—</td>
  </>;
}

/** A cell of the preview; a changed value shows the stored one under it. */
function Cell({ children, diff }: { children: ReactNode; diff?: FieldDiff }) {
  if (!diff) return <td>{children}</td>;
  return <td className="is-changed" title={`現有資料：${diff.before}`}><span className="import-new-value">{children}</span><small className="import-old-value">原 {diff.before}</small></td>;
}

/**
 * The rows of a file or an AI reply, each compared with the stored trades: what importing it does
 * (新增 / 更新 with the values that change / 相同), filterable by result. Rows whose opens and closes
 * depend on each other are checked together.
 */
function ImportPreview({ titleId, rows, selected, imported, importing, lineLabel, compared, onToggle, onSelect }: {
  titleId: string;
  rows: readonly ImportRow[];
  /** Checked groups (ImportRow.group). */
  selected: ReadonlySet<number>;
  imported: ReadonlySet<number>;
  importing: boolean;
  lineLabel: (line: number) => string;
  /** Rows were compared with stored trades (updates, closes of stored positions). */
  compared?: number;
  onToggle: (group: number) => void;
  onSelect: (groups: Set<number>) => void;
}) {
  const [filter, setFilter] = useState<RowState | 'all'>('all');
  const states = useMemo(() => new Map(rows.map((row) => [row.line, stateOfRow(row, imported)] as const)), [rows, imported]);
  const counts = useMemo(() => {
    const total = Object.fromEntries(stateOrder.map((state) => [state, 0])) as Record<RowState, number>;
    for (const state of states.values()) total[state] += 1;
    return total;
  }, [states]);
  const groupSize = useMemo(() => {
    const sizes = new Map<number, number>();
    for (const row of rows) sizes.set(row.group, (sizes.get(row.group) ?? 0) + 1);
    return sizes;
  }, [rows]);
  // Groups with something to import that is not imported yet.
  const actionable = useMemo(() => new Set(rows.filter((row) => !imported.has(row.line) && importOpsOf(row).length).map((row) => row.group)), [rows, imported]);
  const shown = filter === 'all' ? rows : rows.filter((row) => states.get(row.line) === filter);
  const suggested = () => new Set([...defaultImportSelection(rows)].filter((group) => actionable.has(group)));
  return <section className="import-preview" aria-labelledby={`${titleId}-preview`}>
    <div className="import-section-heading">
      <h3 id={`${titleId}-preview`}>{compared ? '預覽與比對' : '預覽與檢查'}</h3>
      <div className="import-counts" role="group" aria-label="依結果篩選">
        <button type="button" className={`all ${filter === 'all' ? 'active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部 {rows.length}</button>
        {stateOrder.filter((state) => counts[state] > 0 || state === 'new').map((state) => <button type="button" key={state} className={`${state} ${filter === state ? 'active' : ''}`} aria-pressed={filter === state} onClick={() => setFilter(filter === state ? 'all' : state)}>{stateLabels[state]} {counts[state]}</button>)}
      </div>
      <div className="import-selection-actions">
        <button type="button" disabled={importing} onClick={() => onSelect(suggested())}>勾選建議列</button>
        {filter !== 'all' && <button type="button" disabled={importing} onClick={() => onSelect(new Set([...selected, ...shown.map((row) => row.group).filter((group) => actionable.has(group))]))}>勾選這些列</button>}
        <button type="button" disabled={importing} onClick={() => onSelect(new Set())}>全部取消</button>
      </div>
    </div>
    {compared !== undefined && compared > 0 && <p className="import-compare-note">已和現有的 {compared} 筆交易逐筆比對：<b>更新</b>會把現有交易改成檔案內容（例如補上平倉、刪除重複的平倉成交）；<b>相同</b>已在資料中，不會重複匯入；<b>有差異</b>是其他欄位不同（可能是你手動改過），預設不覆寫。變動的欄位以顏色標示，小字是現有的值。開倉與平倉互相關聯的列會一起勾選。</p>}
    <div className="import-preview-wrap">
      <table className="import-preview-table">
        <thead><tr><th scope="col"><span className="visually-hidden">匯入</span></th><th scope="col">列</th><th scope="col">結果</th><th scope="col">標的</th><th scope="col">類型</th><th scope="col">策略</th><th scope="col">履約價</th><th scope="col">到期日</th><th scope="col">數量</th><th scope="col">成交價</th><th scope="col">開倉日</th><th scope="col">平倉日</th><th scope="col">平倉／目前價</th><th scope="col">手續費</th><th scope="col">擔保金</th><th scope="col">比對與檢查</th></tr></thead>
        <tbody>{shown.map((row) => {
          const state = states.get(row.line)!;
          const trade = row.trade;
          const main = row.ops.find((op): op is Extract<ImportOp, { kind: 'update' }> => op.kind === 'update' && op.trade === trade);
          const diff = new Map((main ? row.diffs : []).map((item) => [item.field, item] as const));
          const others = row.ops.filter((op) => op.kind === 'delete' || ((op.kind === 'create' || op.kind === 'update') && op.trade !== trade));
          const status = diff.get('status');
          const linked = (groupSize.get(row.group) ?? 1) > 1;
          const canToggle = actionable.has(row.group) && !importing;
          const cash = trade?.type === 'CASH';
          return <tr key={row.line} className={`is-${state}${linked ? ' is-linked' : ''}`}>
            <td><input type="checkbox" aria-label={`匯入${lineLabel(row.line)}`} checked={selected.has(row.group) && actionable.has(row.group)} disabled={!canToggle} onChange={() => onToggle(row.group)} /></td>
            <td>{lineLabel(row.line).replace(/^第 |\s?[列筆]$/g, '')}{linked && <small className="import-link" title="與這些列一起匯入">{row.group === row.line ? `連動 ${groupSize.get(row.group)} 列` : `↳ ${lineLabel(row.group)}`}</small>}</td>
            <td><span className={`import-state ${state}`}>{stateLabels[state]}</span></td>
            {row.flow ? <FlowCells flow={row.flow} /> : <>
            <Cell diff={diff.get('ticker')}>{trade?.ticker ?? '—'}</Cell>
            <Cell diff={diff.get('type')}>{!trade ? '—' : row.fill ? fillLabel(trade) : typeLabel(trade)}</Cell>
            <Cell diff={diff.get('event')}>{trade?.event ?? '—'}</Cell>
            <Cell diff={diff.get('strike')}>{trade?.strike ?? '—'}</Cell>
            <Cell diff={diff.get('expiryDate')}>{trade?.expiryDate ?? '—'}</Cell>
            <Cell diff={diff.get('quantity')}>{trade ? money.format(trade.quantity) : '—'}</Cell>
            <Cell diff={diff.get('entryPrice')}>{trade && !cash && !row.fill ? money.format(trade.entryPrice) : '—'}</Cell>
            <Cell diff={diff.get('openDate')}>{trade && !row.fill ? trade.openDate || '—' : '—'}</Cell>
            <Cell diff={diff.get('closeDate')}>{!trade ? '—' : row.fill ? trade.openDate : trade.closeDate ?? '—'}</Cell>
            <Cell diff={diff.get('currentPrice')}>{!trade || cash ? '—' : row.fill ? money.format(trade.entryPrice) : trade.currentPrice !== null ? money.format(trade.currentPrice) : '—'}</Cell>
            <Cell diff={diff.get('fees')}>{trade && !cash ? money.format(trade.fees) : '—'}</Cell>
            <Cell diff={diff.get('collateral')}>{trade && !row.fill ? money.format(trade.collateral) : '—'}</Cell>
            </>}
            <td className="import-messages">
              {row.errors.map((message) => <span className="error" key={message}>{message}</span>)}
              {main && <span className="change">更新現有交易 #{main.id}{status ? `：${status.before} → ${status.after}` : ''}</span>}
              {others.map((op, index) => <span className={`op-${op.kind}`} key={`${op.kind}-${index}`}>{op.kind === 'create' ? `＋ 新增：${op.note || `${contractLabel(op.trade)} ${money.format(op.trade.quantity)}`}` : op.kind === 'update' ? `↻ 更新現有 #${op.id}（${contractLabel(op.before)}）：${diffText(op.diffs)}` : op.kind === 'delete' ? `－ ${op.note}` : ''}</span>)}
              {row.warnings.map((message) => <span className={state === 'same' || state === 'merged' || state === 'imported' ? 'note' : 'warning'} key={message}>{message}</span>)}
              {state === 'new' && !row.warnings.length && <span className="ok">OK</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
      {!shown.length && <p className="import-empty">沒有符合的列。</p>}
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
export default function TradeImportDialog({ existingTrades, existingFlows, onClose, onImported, ai }: {
  existingTrades: readonly CsvTrade[];
  /** Stored deposits and withdrawals (null while unknown): file rows repeating one are not added. */
  existingFlows?: readonly CashFlowInput[] | null;
  onClose: () => void;
  onImported: (count: number, updated?: number, deleted?: number, flows?: number) => void;
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

  // Options past expiry close as of today at the exchange.
  const [today] = useState(() => exchangeTodayKey('SPY', Date.now()));
  const storedCount = useMemo(() => existingTrades.filter((trade) => !trade.derived).length, [existingTrades]);
  const decoded = useMemo(() => file ? decodeCsv(file.bytes, encoding) : null, [encoding, file]);
  const table = useMemo(() => decoded ? parseCsvTable(decoded.text) : null, [decoded]);
  const flowsKnown = existingFlows ?? noFlows;
  const rows = useMemo(() => table && mapping.length ? fileRows(table, mapping, existingTrades, today, flowsKnown) : [], [existingTrades, flowsKnown, mapping, table, today]);
  const inQueue = (list: readonly ImportRow[], chosen: ReadonlySet<number>, done: ReadonlySet<number>) => list.filter((row) => chosen.has(row.group) && !done.has(row.line) && importOpsOf(row).length);
  const queue = inQueue(rows, selected, imported);
  const missingFields = mapping.length ? requiredFields.filter(([field]) => !mapping.includes(field)).map(([, label]) => label) : [];
  const aiQueue = aiPlan ? inQueue(aiPlan.rows, aiSelected, aiImported) : [];
  const closeQueue = aiPlan ? aiPlan.closes.filter((close) => close.next && closeSelected.has(close.index) && !closeApplied.has(close.index)) : [];
  const queued = opCounts((mode !== 'ai' ? queue : aiQueue).flatMap(importOpsOf));
  const pending = queued.create + queued.update + queued.delete + queued.flow + (mode === 'ai' ? closeQueue.length : 0);

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

  // Defaults after the file, encoding or mapping changes: new rows, closes and splits not yet imported.
  const reset = (next: { bytes: ArrayBuffer; encoding: CsvEncoding; mapping?: Array<ImportField | ''> }, keepImported: boolean) => {
    const nextTable = parseCsvTable(decodeCsv(next.bytes, next.encoding).text);
    const nextMapping = next.mapping ?? autoMapHeaders(nextTable.header);
    const importedLines = keepImported ? imported : new Set<number>();
    setEncoding(next.encoding);
    setMapping(nextMapping);
    setSelected(new Set([...defaultImportSelection(fileRows(nextTable, nextMapping, existingTrades, today, flowsKnown))].filter((group) => !importedLines.has(group))));
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

  const toggleIn = (setter: typeof setSelected) => (value: number) => setter((current) => current.has(value) ? without(current, value) : new Set(current).add(value));

  // A new reply replaces the previous one; rows and closes are checked by default when usable.
  const receiveAi = (result: AiEntryResult) => {
    const plan = planAiImport(result, existingTrades);
    const aiRows = plan.table.rows.length ? mapImportRows(plan.table, plan.mapping, { existing: existingTrades, today, orphans: 'error', lineLabel: (line) => `第 ${line - 1} 筆` }) : [];
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
    let deleted = 0;
    let failure: Outcome | null = null;
    const label = mode !== 'ai' ? (line: number) => `第 ${line} 列` : (line: number) => `第 ${line - 1} 筆`;
    const markImported = mode !== 'ai' ? setImported : setAiImported;
    const unselect = mode !== 'ai' ? setSelected : setAiSelected;
    // Rows go in batches of whole groups; a batch is saved all together or not at all.
    for (const batch of importBatches(mode !== 'ai' ? queue : aiQueue)) {
      try {
        await postTradeBatch(batch.changes);
      } catch (error) {
        const lines = batch.rows.map((row) => row.line);
        failure = {
          imported: created, updated, deleted, total: pending,
          failedLabel: lines.length ? (lines.length > 1 ? `${label(Math.min(...lines))}～${label(Math.max(...lines))}` : label(lines[0])) : '部分變更',
          error: error instanceof Error ? error.message : '匯入失敗',
        };
        break;
      }
      created += batch.changes.creates.length;
      updated += batch.changes.updates.length;
      deleted += batch.changes.deletes.length;
      done += batch.changes.creates.length + batch.changes.updates.length + batch.changes.deletes.length;
      setProgress({ done, total: pending });
      if (batch.rows.length) {
        markImported((current) => new Set([...current, ...batch.rows.map((row) => row.line)]));
        unselect((current) => { const next = new Set(current); for (const row of batch.rows) next.delete(row.group); return next; });
      }
    }
    // Deposits and withdrawals: to the ledger, in batches.
    let flows = 0;
    const flowRows = (mode !== 'ai' ? queue : aiQueue).filter((row) => row.ops.some((op) => op.kind === 'flow'));
    if (!failure) for (let index = 0; index < flowRows.length; index += maxCashFlowBatch) {
      const part = flowRows.slice(index, index + maxCashFlowBatch);
      try {
        const response = await fetch('/api/cash-flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flows: part.flatMap((row) => row.ops.flatMap((op) => op.kind === 'flow' ? [op.flow] : [])) }) });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
      } catch (error) {
        failure = { imported: created, updated, deleted, flows, total: pending, failedLabel: `存提款紀錄（${label(part[0].line)}起）`, error: error instanceof Error ? error.message : '匯入失敗' };
        break;
      }
      flows += part.length;
      done += part.length;
      setProgress({ done, total: pending });
      markImported((current) => new Set([...current, ...part.map((row) => row.line)]));
      unselect((current) => { const next = new Set(current); for (const row of part) next.delete(row.group); return next; });
    }
    if (mode === 'ai' && !failure) for (const close of closeQueue) {
      try {
        await putTrade(close.next!);
        updated += 1;
        done += 1;
        setProgress({ done, total: pending });
        setCloseApplied((current) => new Set(current).add(close.index));
        setCloseSelected((current) => without(current, close.index));
      } catch (error) {
        failure = { imported: created, updated, deleted, flows, total: pending, failedLabel: `交易 #${close.target.id} 平倉`, error: error instanceof Error ? error.message : '更新失敗' };
        break;
      }
    }
    setOutcome(failure ?? { imported: created, updated, deleted, flows, total: pending });
    setImporting(false);
    if (created || updated || deleted || flows) onImported(created, updated, deleted, flows);
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

  const queuedText = [queued.create ? `新增 ${queued.create}` : '', queued.update ? `更新 ${queued.update}` : '', queued.delete ? `刪除 ${queued.delete}` : '', queued.flow ? `存提款 ${queued.flow}` : ''].filter(Boolean).join('、') || '沒有變更';
  const idleStatus = mode !== 'ai'
    ? file ? <span>已勾選 {queue.length} 列：{queuedText}；相同的列不會重複匯入。按下「匯入」前不會寫入。</span> : null
    : aiPlan ? <span>已勾選新增 {queued.create} 筆、平倉 {closeQueue.length} 筆；按下「匯入」前不會寫入。</span> : null;
  const outcomeText = (result: Outcome) => {
    const parts = [`新增 ${result.imported} 筆`, ...(result.updated ? [`更新 ${result.updated} 筆`] : []), ...(result.deleted ? [`刪除 ${result.deleted} 筆重複紀錄`] : []), ...(result.flows ? [`存提款紀錄 ${result.flows} 筆`] : [])].join('、');
    const handled = result.imported + (result.updated ?? 0) + (result.deleted ?? 0) + (result.flows ?? 0);
    if (result.error) return `${result.failedLabel}匯入失敗：${result.error}。已完成：${parts}；其餘 ${result.total - handled} 項未處理（這一批沒有寫入，可再按一次匯入）。`;
    return `已完成：${parts}，持倉與圖表已更新。`;
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

            <ImportPreview titleId={titleId} rows={rows} selected={selected} imported={imported} importing={importing} lineLabel={(line) => `第 ${line} 列`} compared={storedCount} onToggle={toggleIn(setSelected)} onSelect={setSelected} />
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
            {aiPlan.rows.length > 0 && <ImportPreview titleId={titleId} rows={aiPlan.rows} selected={aiSelected} imported={aiImported} importing={importing} lineLabel={(line) => `第 ${line - 1} 筆`} onToggle={toggleIn(setAiSelected)} onSelect={setAiSelected} />}
          </>}
        </>}
      </div>
      <footer className="import-footer">
        <div className="import-status" aria-live="polite">
          {importing && <><progress max={progress.total} value={progress.done} /><span>匯入中 {progress.done} / {progress.total}…</span></>}
          {!importing && outcome && <span className={outcome.error ? 'is-error' : 'is-success'} role={outcome.error ? 'alert' : undefined}>{outcomeText(outcome)}</span>}
          {!importing && !outcome && idleStatus}
        </div>
        <button type="button" className="cancel-button" disabled={importing} onClick={onClose}>{outcome?.imported || outcome?.updated || outcome?.deleted || outcome?.flows ? '完成' : '取消'}</button>
        <button type="button" className="primary-button" disabled={importing || !pending} onClick={() => void runImport()}>{importing ? '匯入中…' : mode === 'ai' && closeQueue.length ? `匯入 ${queued.create} 筆、平倉 ${closeQueue.length} 筆` : queued.update || queued.delete || queued.flow ? `匯入（${queuedText}）` : `匯入 ${queued.create} 筆`}</button>
      </footer>
    </section>
  </div>;
}
