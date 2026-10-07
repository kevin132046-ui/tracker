'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CsvTrade } from '@/lib/trade-csv';
import { tradesToCsv } from '@/lib/trade-csv';
import { clearAllPhrase } from '@/lib/trade-batch';
import { downloadText, localDateKey } from '@/lib/download';

/** Deposits and withdrawals, when the ledger has any: they can go too (off by default). */
export type ClearCashFlows = { count: number; csv: () => string; clear: () => Promise<number> };

const confirmWord = '清除';

/**
 * 清除所有交易資料: deletes every stored trade so a corrected file can be imported from scratch. A CSV
 * backup downloads first and the button only works once 清除 is typed. Settings, uploaded art, DCF
 * scenarios and AI keys are not touched.
 */
export default function ClearTradesDialog({ trades, cashFlows, onClose, onCleared }: {
  trades: readonly CsvTrade[];
  cashFlows?: ClearCashFlows;
  onClose: () => void;
  /** reimport: open the import dialog next. */
  onCleared: (message: string, reimport: boolean) => void;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const stored = trades.filter((trade) => !trade.derived);
  const [typed, setTyped] = useState('');
  const [alsoCash, setAlsoCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = typed.trim() === confirmWord && !busy && (stored.length > 0 || (alsoCash && Boolean(cashFlows?.count)));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);

  const clear = async (reimport: boolean) => {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const stamp = localDateKey();
      if (stored.length) downloadText(`optionflow-backup-before-clear-${stamp}.csv`, tradesToCsv(stored));
      if (alsoCash && cashFlows?.count) downloadText(`optionflow-cash-flows-backup-${stamp}.csv`, cashFlows.csv());
      let deleted = 0;
      if (stored.length) {
        const response = await fetch('/api/trades', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true, confirm: clearAllPhrase }) });
        const payload = await response.json().catch(() => ({})) as { deleted?: number; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `清除失敗（${response.status}）`);
        deleted = payload.deleted ?? stored.length;
      }
      const cash = alsoCash && cashFlows?.count ? await cashFlows.clear() : 0;
      onCleared(`已清除 ${deleted} 筆交易${cash ? `與 ${cash} 筆存提款紀錄` : ''}（已先下載備份 CSV）`, reimport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除失敗，請稍後再試。');
      setBusy(false);
    }
  };

  return <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="delete-confirm clear-trades-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-text`}>
      <div className="delete-confirm-icon" aria-hidden="true">!</div>
      <p className="eyebrow">Clear trades</p>
      <h2 id={titleId}>清除所有交易資料</h2>
      <p id={`${titleId}-text`}>會刪除全部 <b>{stored.length}</b> 筆交易，方便重新匯入更新後的資料。按下清除時會先下載一份備份 CSV（之後可再匯入還原）。</p>
      <ul className="clear-trades-scope">
        <li className="gone">交易紀錄（股票、選擇權、現金）{stored.length} 筆</li>
        {cashFlows && cashFlows.count > 0 && <li className={alsoCash ? 'gone' : 'kept'}>
          <label><input type="checkbox" checked={alsoCash} disabled={busy} onChange={(event) => setAlsoCash(event.target.checked)} />同時清除存提款紀錄（{cashFlows.count} 筆，也會先下載備份）</label>
        </li>}
        <li className="kept">保留：設定、素材、DCF 情境、AI 金鑰{cashFlows && cashFlows.count > 0 && !alsoCash ? '、存提款紀錄' : ''}</li>
      </ul>
      <label className="clear-trades-type">輸入「{confirmWord}」以確認
        <input ref={inputRef} value={typed} disabled={busy} autoComplete="off" spellCheck={false} placeholder={confirmWord} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void clear(false); }} />
      </label>
      {error && <p className="clear-trades-error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="cancel-button" disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="confirm-delete-button" disabled={!ready} onClick={() => void clear(false)}>{busy ? '清除中…' : '清除'}</button>
        <button type="button" className="clear-trades-reimport" disabled={!ready} onClick={() => void clear(true)}>清除後重新匯入</button>
      </footer>
    </section>
  </div>;
}
