'use client';

import type { DragEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { autoMapHeaders, decodeCsv, defaultImportSelection, importFields, mapImportRows, parseCsvTable } from '@/lib/trade-csv';
import type { CsvEncoding, CsvTrade, ImportField, ImportRow } from '@/lib/trade-csv';

type LoadedFile = { name: string; size: number; bytes: ArrayBuffer };
type Outcome = { imported: number; total: number; failedLine?: number; error?: string };
type RowState = 'imported' | 'error' | 'merged' | 'duplicate' | 'ready';

const maxFileBytes = 5 * 1024 * 1024;
const maxRows = 2_000;
const delimiterLabels: Record<string, string> = { ',': '逗號', '\t': 'Tab', ';': '分號' };
const stateLabels: Record<RowState, string> = { imported: '已匯入', error: '錯誤', merged: '已合併', duplicate: '重複', ready: '可匯入' };
const requiredFields: ReadonlyArray<[ImportField, string]> = [['openDate', '開倉日'], ['ticker', '代號'], ['quantity', '數量'], ['price', '成交價']];
const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const typeLabel = (trade: CsvTrade) => trade.type === 'CASH' ? '現金' : trade.type === 'SDI' ? '股票' : trade.type === 'Sell' ? '賣方' : trade.type === 'Buy' ? '買方' : trade.type;

/** Modal for importing trades from a CSV file: pick or drop a file, check the column mapping and preview, import the chosen rows. */
export default function TradeImportDialog({ existingTrades, onClose, onImported }: {
  existingTrades: readonly CsvTrade[];
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>('auto');
  const [mapping, setMapping] = useState<Array<ImportField | ''>>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [imported, setImported] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const decoded = useMemo(() => file ? decodeCsv(file.bytes, encoding) : null, [encoding, file]);
  const table = useMemo(() => decoded ? parseCsvTable(decoded.text) : null, [decoded]);
  const rows = useMemo(() => table && mapping.length ? mapImportRows(table, mapping, { existing: existingTrades }) : [], [existingTrades, mapping, table]);
  const stateOf = (row: ImportRow): RowState => imported.has(row.line) ? 'imported' : row.mergedInto !== null ? 'merged' : !row.trade ? 'error' : row.duplicateOf !== null ? 'duplicate' : 'ready';
  const counts = rows.reduce((total, row) => ({ ...total, [stateOf(row)]: total[stateOf(row)] + 1 }), { imported: 0, error: 0, merged: 0, duplicate: 0, ready: 0 } as Record<RowState, number>);
  const queue = rows.filter((row) => row.trade && selected.has(row.line) && !imported.has(row.line));
  const missingFields = mapping.length ? requiredFields.filter(([field]) => !mapping.includes(field)).map(([, label]) => label) : [];

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

  const loadFile = async (picked: File | undefined) => {
    if (!picked || importing) return;
    setReadError('');
    setOutcome(null);
    if (picked.size > maxFileBytes) return setReadError('檔案超過 5 MB，請分批匯入。');
    let bytes: ArrayBuffer;
    try {
      bytes = await picked.arrayBuffer();
    } catch {
      return setReadError('無法讀取這個檔案。');
    }
    const nextTable = parseCsvTable(decodeCsv(bytes, 'auto').text);
    if (!nextTable.header.length || !nextTable.rows.length) return setReadError('找不到資料列：第一列需為欄位標題，之後每列一筆交易。');
    if (nextTable.rows.length > maxRows) return setReadError(`資料列超過 ${maxRows} 列，請分批匯入。`);
    setFile({ name: picked.name, size: picked.size, bytes });
    reset({ bytes, encoding: 'auto' }, false);
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

  const runImport = async () => {
    if (!queue.length || importing) return;
    setImporting(true);
    setOutcome(null);
    setProgress({ done: 0, total: queue.length });
    let done = 0;
    let failure: Outcome | null = null;
    for (const row of queue) {
      try {
        const response = await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row.trade) });
        const payload = await response.json().catch(() => ({})) as { trade?: unknown; error?: string };
        if (!response.ok || !payload.trade) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
        done += 1;
        setImported((current) => new Set(current).add(row.line));
        setSelected((current) => {
          const next = new Set(current);
          next.delete(row.line);
          return next;
        });
        setProgress({ done, total: queue.length });
      } catch (error) {
        failure = { imported: done, total: queue.length, failedLine: row.line, error: error instanceof Error ? error.message : '匯入失敗' };
        break;
      }
    }
    setOutcome(failure ?? { imported: done, total: queue.length });
    setImporting(false);
    if (done) onImported(done);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void loadFile(event.dataTransfer.files?.[0]);
  };

  return <div className="confirm-backdrop import-backdrop" role="presentation" onMouseDown={(event) => { if (!importing && event.target === event.currentTarget) onClose(); }}>
    <section className="import-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header>
        <div><p className="eyebrow">CSV import</p><h2 id={titleId}>匯入交易 CSV</h2></div>
        <button type="button" className="close-button" onClick={onClose} disabled={importing} aria-label="關閉匯入視窗">×</button>
      </header>
      <div className="import-body">
        <div
          className={`import-dropzone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={(event) => { event.preventDefault(); if (!importing) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="import-dropzone-icon" aria-hidden="true">⇪</span>
          <div>
            <strong>{file ? file.name : '拖放 CSV 檔到這裡'}</strong>
            <small>{file && table ? `${table.rows.length} 列資料 · 分隔符號：${delimiterLabels[table.delimiter]} · 編碼：${decoded?.encoding === 'utf-8' ? 'UTF-8' : decoded?.encoding === 'shift_jis' ? 'Shift_JIS' : 'Big5'}` : '支援逗號、Tab、分號分隔與引號欄位；可直接匯入本工具「匯出 CSV」的檔案，也能辨識常見券商欄位（英文／中文／日本語）。'}</small>
          </div>
          <button ref={pickRef} type="button" className="import-pick-button" disabled={importing} onClick={() => inputRef.current?.click()}>{file ? '換一個檔案' : '選擇檔案'}</button>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" tabIndex={-1} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ''; void loadFile(picked); }} />
        </div>
        {readError && <p className="import-alert is-error" role="alert">{readError}</p>}
        {decoded?.utf8Failed && encoding === 'auto' && <p className="import-alert">檔案不是 UTF-8，已改用 Shift_JIS 解讀；若文字顯示錯誤，請在下方改選編碼。</p>}

        {file && table && <>
          <section className="import-mapping" aria-labelledby={`${titleId}-mapping`}>
            <div className="import-section-heading">
              <h3 id={`${titleId}-mapping`}>欄位對應</h3>
              <label className="import-encoding">編碼<select value={encoding} disabled={importing} onChange={(event) => reset({ bytes: file.bytes, encoding: event.target.value as CsvEncoding }, false)}><option value="auto">自動（UTF-8）</option><option value="utf-8">UTF-8</option><option value="shift_jis">Shift_JIS</option><option value="big5">Big5</option></select></label>
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

          <section className="import-preview" aria-labelledby={`${titleId}-preview`}>
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
                <button type="button" disabled={importing} onClick={() => setSelected(new Set([...defaultImportSelection(rows)].filter((line) => !imported.has(line))))}>勾選建議列</button>
                <button type="button" disabled={importing} onClick={() => setSelected(new Set())}>全部取消</button>
              </div>
            </div>
            <div className="import-preview-wrap">
              <table className="import-preview-table">
                <thead><tr><th scope="col"><span className="visually-hidden">匯入</span></th><th scope="col">列</th><th scope="col">狀態</th><th scope="col">標的</th><th scope="col">類型</th><th scope="col">策略</th><th scope="col">履約價</th><th scope="col">到期日</th><th scope="col">數量</th><th scope="col">成交價</th><th scope="col">開倉日</th><th scope="col">平倉日</th><th scope="col">平倉／目前價</th><th scope="col">手續費</th><th scope="col">擔保金</th><th scope="col">檢查結果</th></tr></thead>
                <tbody>{rows.map((row) => {
                  const state = stateOf(row);
                  const trade = row.trade;
                  return <tr key={row.line} className={`is-${state}`}>
                    <td><input type="checkbox" aria-label={`匯入第 ${row.line} 列`} checked={selected.has(row.line) && state !== 'imported'} disabled={!trade || state === 'imported' || importing} onChange={() => toggle(row.line)} /></td>
                    <td>{row.line}</td>
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
                      {row.mergedInto !== null && <span className="merged">已併入第 {row.mergedInto} 列（平倉成交）</span>}
                      {row.errors.map((message) => <span className="error" key={message}>{message}</span>)}
                      {row.warnings.map((message) => <span className="warning" key={message}>{message}</span>)}
                      {state === 'ready' && !row.warnings.length && <span className="ok">OK</span>}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
      <footer className="import-footer">
        <div className="import-status" aria-live="polite">
          {importing && <><progress max={progress.total} value={progress.done} /><span>匯入中 {progress.done} / {progress.total}…</span></>}
          {!importing && outcome && (outcome.error
            ? <span className="is-error" role="alert">第 {outcome.failedLine} 列匯入失敗：{outcome.error}。已匯入 {outcome.imported} 筆，其餘 {outcome.total - outcome.imported} 筆未匯入。</span>
            : <span className="is-success">已匯入 {outcome.imported} 筆交易，持倉與圖表已更新。</span>)}
          {!importing && !outcome && file && <span>已勾選 {queue.length} 筆；重複列預設不勾選，可逐列勾選。</span>}
        </div>
        <button type="button" className="cancel-button" disabled={importing} onClick={onClose}>{outcome?.imported ? '完成' : '取消'}</button>
        <button type="button" className="primary-button" disabled={importing || !queue.length} onClick={() => void runImport()}>{importing ? '匯入中…' : `匯入 ${queue.length} 筆`}</button>
      </footer>
    </section>
  </div>;
}
