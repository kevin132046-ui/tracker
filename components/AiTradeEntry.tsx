'use client';

import type { ClipboardEvent } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ClaudeModel } from '@/lib/ai-models';
import { claudeChoices, claudeModelLabel, loadModelDetection, requestModel, resolveClaudeModel, watchModelDetection } from '@/lib/ai-models';
import type { AiTradeParse } from '@/lib/ai-trade-entry';
import { entryImageTypes, maxEntryImageBytes, maxEntryLength, openTradeHints } from '@/lib/ai-trade-entry';
import type { AiProvider } from '@/lib/earnings';
import type { AiKeys } from '@/lib/filings';
import { aiKeyHeaders } from '@/lib/filings';
import type { QuotaReport, UsageTier } from '@/lib/openai-free-tier';
import type { CsvTrade } from '@/lib/trade-csv';
import { freeQuotaLine, freeQuotaOpen } from '@/components/FreeQuota';

/** What the import dialog passes down from the AI settings. */
export type AiEntryContext = {
  keys: AiKeys;
  defaultProvider: AiProvider;
  openAiModel: string;
  claudeModel: ClaudeModel;
  usageTier: UsageTier;
  /** Called after every AI request so today's free tokens are read again. */
  onUsed: () => void;
};

export type AiEntryResult = AiTradeParse & { provider: AiProvider; model: string };

type Status = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; providers: Record<AiProvider, boolean>; openAiModel: string | null; quota: QuotaReport | null };
type Image = { name: string; dataUrl: string };

const examples = [
  '今天以 2.30 賣出 KO 11/20 到期 75 PUT 一口',
  '昨天 0.05 買回 KO 75P 平倉，手續費 0.65',
  '9/15 買入 AAPL 10 股，成交價 228.5',
];
const pad = (value: number) => String(value).padStart(2, '0');
const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const providerName = (provider: AiProvider) => provider === 'anthropic' ? 'Claude' : 'ChatGPT';

function readImage(file: File): Promise<Image> {
  return new Promise((resolve, reject) => {
    if (!(entryImageTypes as readonly string[]).includes(file.type)) return reject(new Error('只支援 PNG、JPEG、WebP 或 GIF 圖片。'));
    if (file.size > maxEntryImageBytes) return reject(new Error('圖片超過 4 MB，請裁切或壓縮後再試。'));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name || '貼上的圖片', dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error('無法讀取這張圖片。'));
    reader.readAsDataURL(file);
  });
}

/**
 * Type a trade in a sentence, or attach a broker screenshot, and let the chosen model turn it
 * into rows. Nothing is saved here: the dialog shows the rows for review first.
 */
export default function AiTradeEntry({ ai, existingTrades, disabled, onResult }: {
  ai: AiEntryContext;
  existingTrades: readonly CsvTrade[];
  disabled: boolean;
  onResult: (result: AiEntryResult) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>(ai.defaultProvider);
  const [openAiModel, setOpenAiModel] = useState(ai.openAiModel);
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>(ai.claudeModel);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [text, setText] = useState('');
  const [image, setImage] = useState<Image | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped after each request so today's free tokens are read again.
  const [checks, setChecks] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  // Providers, the server's default ChatGPT model and today's free tokens for the chosen model.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/ai?model=${encodeURIComponent(openAiModel.trim())}&tier=${ai.usageTier}`, { cache: 'no-store', headers: aiKeyHeaders(ai.keys), signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { providers?: Record<AiProvider, boolean>; openAiModel?: string | null; quota?: QuotaReport; error?: string };
          if (!response.ok || !payload.providers) throw new Error(payload.error ?? 'AI 暫時無法使用。');
          if (!controller.signal.aborted) setStatus({ state: 'ok', providers: payload.providers, openAiModel: payload.openAiModel ?? null, quota: payload.quota ?? null });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setStatus({ state: 'error', message: reason instanceof Error ? reason.message : 'AI 暫時無法使用。' });
        });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [ai.keys, ai.usageTier, openAiModel, checks]);

  useEffect(() => () => request.current?.abort(), []);

  const ready = status.state === 'ok' && (Boolean(ai.keys[provider].trim()) || status.providers[provider]);
  const quota = status.state === 'ok' ? status.quota : null;
  // Models detected with the keys in「AI 設定」(when checked there); otherwise the built-in lists.
  const detection = useSyncExternalStore(watchModelDetection, loadModelDetection, () => null);
  const claudeList = claudeChoices(detection);
  const detectedOpenAi = detection?.openai.state === 'ok' ? detection.openai.models.map((model) => model.id) : null;
  const freeGroups = quota?.list.groups ?? [];
  const freeModels = freeGroups.map((group) => ({ ...group, models: detectedOpenAi ? group.models.filter((model) => detectedOpenAi.includes(model)) : group.models })).filter((group) => group.models.length);
  const otherModels = (detectedOpenAi ?? []).filter((model) => !freeGroups.some((group) => group.models.includes(model)));
  const chatGptModel = openAiModel.trim() || (status.state === 'ok' ? status.openAiModel ?? '' : '');
  const blockedReason = status.state === 'loading' ? '確認 AI 設定中…'
    : status.state === 'error' ? status.message
    : !ready ? `尚未設定 ${providerName(provider)} 金鑰：請在「設定 → AI 設定」輸入，或在伺服器設定。`
    : provider === 'openai' && !chatGptModel ? '請選擇 ChatGPT 模型。'
    : provider === 'openai' && !freeQuotaOpen(quota) ? freeQuotaLine(quota)
    : '';

  const attach = async (file: File | undefined | null) => {
    if (!file) return;
    setError('');
    try {
      setImage(await readImage(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法讀取這張圖片。');
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    void attach(file);
  };

  const parse = async () => {
    if (busy || blockedReason || (!text.trim() && !image)) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiKeyHeaders(ai.keys) },
        body: JSON.stringify({
          task: 'parse-trades',
          provider,
          model: requestModel(provider, openAiModel, claudeModel),
          usageTier: ai.usageTier,
          text: text.trim(),
          image: image?.dataUrl,
          today: localToday(),
          openTrades: openTradeHints(existingTrades),
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as Partial<AiTradeParse> & { model?: string; error?: string };
      if (!response.ok || !Array.isArray(payload.rows)) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
      if (!payload.rows.length) setError(payload.questions?.[0] ?? '沒有讀到交易。請寫明標的、買或賣、數量與價格。');
      onResult({ rows: payload.rows, questions: payload.questions ?? [], provider, model: payload.model ?? requestModel(provider, openAiModel, claudeModel) ?? '' });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '解析失敗，請稍後再試。');
    } finally {
      request.current = null;
      setBusy(false);
      setChecks((current) => current + 1);
      ai.onUsed();
    }
  };

  return <section className="ai-entry" aria-label="用 AI 記錄交易">
    <div className="ai-entry-models">
      <label><span>AI</span>
        <select value={provider} disabled={busy || disabled} onChange={(event) => setProvider(event.target.value === 'anthropic' ? 'anthropic' : 'openai')}>
          <option value="openai">ChatGPT</option>
          <option value="anthropic">Claude</option>
        </select>
      </label>
      <label><span>模型</span>
        {provider === 'anthropic'
          ? <select value={claudeModel} disabled={busy || disabled} onChange={(event) => setClaudeModel(resolveClaudeModel(event.target.value))}>
            {!claudeList.some((model) => model.id === claudeModel) && <option value={claudeModel}>{claudeModel}</option>}
            {claudeList.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
          : freeModels.length || otherModels.length
            ? <select value={openAiModel.trim()} disabled={busy || disabled} onChange={(event) => setOpenAiModel(event.target.value)}>
              <option value="">{status.state === 'ok' && status.openAiModel ? `伺服器預設（${status.openAiModel}）` : '請選擇模型'}</option>
              {openAiModel.trim() && !freeModels.some((group) => group.models.includes(openAiModel.trim())) && !otherModels.includes(openAiModel.trim()) && <option value={openAiModel.trim()}>{openAiModel.trim()}</option>}
              {freeModels.map((group) => <optgroup key={group.id} label={`免費額度內 · ${group.label}`}>{group.models.map((model) => <option key={model} value={model}>{model}</option>)}</optgroup>)}
              {otherModels.length > 0 && <optgroup label={quota?.enforced === false ? '其他可用（會計費）' : '其他可用（不在免費額度，會被擋下）'}>{otherModels.map((model) => <option key={model} value={model} disabled={quota?.enforced !== false}>{model}</option>)}</optgroup>}
            </select>
            : <input type="text" value={openAiModel} maxLength={64} spellCheck={false} autoComplete="off" disabled={busy || disabled} placeholder="輸入 OpenAI 模型名稱" onChange={(event) => setOpenAiModel(event.target.value)} />}
      </label>
      <p className="ai-entry-quota">{provider === 'openai' ? freeQuotaLine(quota) : `${claudeModelLabel(claudeModel)} · 每次解析都會使用你的 Claude API 額度`}</p>
    </div>

    <label className="ai-entry-text"><span>用一句話說你做了什麼交易（可以一次寫好幾筆）</span>
      <textarea id="ai-entry-text" rows={4} value={text} maxLength={maxEntryLength} disabled={busy || disabled} placeholder={`例：${examples.join('\n例：')}`} onChange={(event) => setText(event.target.value)} onPaste={onPaste} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void parse(); } }} />
    </label>

    <div className="ai-entry-actions">
      <div className="ai-entry-image">
        <input ref={fileRef} className="visually-hidden" type="file" accept={entryImageTypes.join(',')} tabIndex={-1} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ''; void attach(picked); }} />
        {image
          // eslint-disable-next-line @next/next/no-img-element -- a local data: URL preview, nothing to optimise
          ? <><img src={image.dataUrl} alt="" /><span title={image.name}>{image.name}</span><button type="button" disabled={busy || disabled} onClick={() => setImage(null)}>移除截圖</button></>
          : <button type="button" disabled={busy || disabled} onClick={() => fileRef.current?.click()}>附上券商截圖（選用）</button>}
      </div>
      {busy
        ? <button type="button" className="ai-entry-stop" onClick={() => request.current?.abort()}>停止</button>
        : <button type="button" className="primary-button" disabled={disabled || Boolean(blockedReason) || (!text.trim() && !image)} onClick={() => void parse()}>{`用 ${providerName(provider)} 解析`}</button>}
    </div>
    <p className={`ai-entry-note${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
      {busy ? `${providerName(provider)} 解析中…` : error || blockedReason || 'AI 只會產生預覽；下方逐筆確認後按「匯入」才會寫入。平倉（買回、賣出持股）會對應到你現有的持倉。截圖可以直接貼上（Ctrl／⌘＋V）。'}
    </p>
  </section>;
}
