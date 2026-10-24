'use client';

import { useRef, useState } from 'react';
import { makeBackup, openBackup, restoreBackup, type BackupProgress, type OpenedBackup } from '@/lib/backup-client';
import { downloadBlob, localDateKey } from '@/lib/download';

type Stage =
  | { kind: 'idle'; message?: string; error?: string }
  | { kind: 'working'; progress: BackupProgress }
  | { kind: 'review'; backup: OpenedBackup; fileName: string; error?: string };

const megabytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '時間不明' : date.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short', hour12: false });
};
const backupName = () => `optionflow-backup-${localDateKey()}.zip`;

/** 設定 → 資料 → 完整備份: one ZIP with every table, the uploaded art and music, and this browser's settings. */
export default function BackupCard() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [saveFirst, setSaveFirst] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = stage.kind === 'working';

  const exportBackup = async () => {
    setStage({ kind: 'working', progress: { label: '準備備份…', ratio: 0 } });
    try {
      const { blob, manifest } = await makeBackup((progress) => setStage({ kind: 'working', progress }));
      downloadBlob(backupName(), blob);
      setStage({ kind: 'idle', message: `已下載備份：交易 ${manifest.counts.trades} 筆、存提款 ${manifest.counts.cash_flows} 筆、素材 ${manifest.files.length} 個（${megabytes(blob.size)}）。` });
    } catch (error) {
      setStage({ kind: 'idle', error: error instanceof Error ? error.message : '備份失敗，請稍後再試。' });
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setStage({ kind: 'working', progress: { label: '讀取備份檔…', ratio: 0 } });
    try {
      setStage({ kind: 'review', backup: await openBackup(file), fileName: file.name });
    } catch (error) {
      setStage({ kind: 'idle', error: error instanceof Error ? error.message : '備份檔無法讀取。' });
    }
  };

  const restore = async (backup: OpenedBackup, fileName: string) => {
    try {
      if (saveFirst) {
        setStage({ kind: 'working', progress: { label: '先備份目前的資料…', ratio: 0 } });
        const { blob } = await makeBackup((progress) => setStage({ kind: 'working', progress: { label: `先備份目前的資料：${progress.label}`, ratio: progress.ratio * 0.3 } }));
        downloadBlob(`optionflow-backup-${localDateKey()}-before-restore.zip`, blob);
      }
      await restoreBackup(backup, (progress) => setStage({ kind: 'working', progress: { label: progress.label, ratio: (saveFirst ? 0.3 : 0) + progress.ratio * (saveFirst ? 0.7 : 1) } }));
      setStage({ kind: 'working', progress: { label: '已還原，重新載入頁面…', ratio: 1 } });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setStage({ kind: 'review', backup, fileName, error: error instanceof Error ? error.message : '還原失敗，請稍後再試。' });
    }
  };

  const review = stage.kind === 'review' ? stage : null;
  const counts = review?.backup.manifest.counts;
  const fileBytes = review?.backup.files.reduce((sum, file) => sum + file.size, 0) ?? 0;

  return <section className="settings-feature-card is-enabled">
    <div className="settings-feature-heading"><span className="settings-feature-icon wafu" aria-hidden="true">藏</span><div><p>Full backup</p><h3>完整備份與還原</h3></div></div>
    <p>把交易、存提款、DCF 情境、跨券商與股息設定、背景圖、和風素材與音樂，以及這個瀏覽器的顯示設定，存成一個 ZIP。可在網站版與桌面版之間搬移。API 金鑰與 AI 對話不會放進備份。</p>
    <div className="settings-data-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => void exportBackup()}>匯出完整備份</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => fileInput.current?.click()}>從備份還原…</button>
      <input ref={fileInput} id="backup-restore-file" type="file" accept=".zip,application/zip" hidden onChange={(event) => void chooseFile(event.target.files?.[0])} />
    </div>

    {stage.kind === 'working' && <div className="settings-backup-progress" role="status" aria-live="polite">
      <span>{stage.progress.label}</span>
      <i style={{ width: `${Math.round(stage.progress.ratio * 100)}%` }} />
    </div>}
    {stage.kind === 'idle' && stage.message && <p className="settings-backup-note" role="status">{stage.message}</p>}
    {stage.kind === 'idle' && stage.error && <p className="settings-backup-error" role="alert">{stage.error}</p>}

    {review && counts && <div className="settings-danger settings-backup-review">
      <div>
        <b>還原「{review.fileName}」</b>
        <span>備份時間 {when(review.backup.manifest.createdAt)}。還原會取代目前所有的資料與素材，完成後重新載入頁面。</span>
        <dl className="settings-backup-summary">
          <div><dt>交易</dt><dd>{counts.trades} 筆</dd></div>
          <div><dt>存提款</dt><dd>{counts.cash_flows} 筆</dd></div>
          <div><dt>DCF 情境</dt><dd>{counts.dcf_scenarios} 個</dd></div>
          <div><dt>素材與音樂</dt><dd>{review.backup.files.length} 個 · {megabytes(fileBytes)}</dd></div>
          <div><dt>顯示設定</dt><dd>{Object.keys(review.backup.prefs).length} 項</dd></div>
        </dl>
        <label className="settings-backup-check" htmlFor="backup-save-first">
          <input id="backup-save-first" type="checkbox" checked={saveFirst} onChange={(event) => setSaveFirst(event.target.checked)} />
          還原前先下載目前資料的備份
        </label>
        {review.error && <span className="settings-backup-error" role="alert">{review.error}</span>}
      </div>
      <div className="settings-backup-buttons">
        <button type="button" className="settings-danger-button" onClick={() => void restore(review.backup, review.fileName)}>還原</button>
        <button type="button" className="secondary-button" onClick={() => setStage({ kind: 'idle' })}>取消</button>
      </div>
    </div>}
  </section>;
}
