'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ClaudeModel, KeyCheck, ModelDetection } from '@/lib/ai-models';
import { claudeChoices, keyStateLabel, loadModelDetection, resolveClaudeModel, saveModelDetection, watchModelDetection } from '@/lib/ai-models';
import type { AiProvider } from '@/lib/earnings';
import type { AiKeys } from '@/lib/filings';
import { aiKeyHeaders, defaultAnalysisQuestions, emptyAiKeys, maxQuestionLength, maxQuestions } from '@/lib/filings';
import type { QuotaReport, UsageTier } from '@/lib/openai-free-tier';
import { FreeQuotaTable, freeQuotaLine } from '@/components/FreeQuota';

export type AiStatus = { state: 'ok'; mode: 'access' | 'byok'; note: string | null; providers: Record<AiProvider, boolean>; openAiModel: string | null; sec: boolean; quota: QuotaReport | null } | { state: 'error'; message: string } | null;

type Props = {
  /** The master switch for every AI feature. */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  status: AiStatus;
  keys: AiKeys;
  onKeysChange: (keys: AiKeys) => void;
  defaultProvider: AiProvider;
  onDefaultProviderChange: (provider: AiProvider) => void;
  openAiModel: string;
  onOpenAiModelChange: (model: string) => void;
  claudeModel: ClaudeModel;
  onClaudeModelChange: (model: ClaudeModel) => void;
  usageTier: UsageTier;
  onUsageTierChange: (tier: UsageTier) => void;
  questions: string[];
  onQuestionsChange: (questions: string[]) => void;
};

const links = [
  ['Claude API 金鑰', 'https://platform.claude.com/settings/keys'],
  ['OpenAI API 金鑰', 'https://platform.openai.com/api-keys'],
  ['OpenAI 管理金鑰', 'https://platform.openai.com/settings/organization/admin-keys'],
  ['OpenAI 模型清單', 'https://platform.openai.com/docs/models'],
  ['Cloudflare 後台', 'https://dash.cloudflare.com/?to=/:account/workers-and-pages'],
  ['Access 設定說明', 'https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#manage-access-to-workersdev'],
] as const;

type Detect = { state: 'idle' } | { state: 'checking' } | { state: 'error'; message: string };

/** The badge after a key field: 有效 / 無效 / 權限不足 …, with the details as a tooltip. */
function KeyBadge({ check, checking }: { check: KeyCheck | undefined; checking: boolean }) {
  if (checking && !check) return <span className="ai-key-badge is-checking">檢查中…</span>;
  if (!check) return null;
  const source = check.source === 'server' ? '（伺服器金鑰）' : '';
  const mark = check.state === 'ok' ? '✓ ' : check.state === 'missing' ? '' : '✗ ';
  return <span className={`ai-key-badge is-${check.state}`} title={check.message}>{`${mark}${keyStateLabel[check.state]}${source}`}</span>;
}

/** Keys, default model and the analysis question list for the AI features. Everything stays in this browser. */
export default function AiSettingsCard({ enabled, onEnabledChange, status, keys, onKeysChange, defaultProvider, onDefaultProviderChange, openAiModel, onOpenAiModelChange, claudeModel, onClaudeModelChange, usageTier, onUsageTierChange, questions, onQuestionsChange }: Props) {
  const quota = status?.state === 'ok' ? status.quota : null;
  const freeGroups = quota?.list.groups ?? [];
  const [showKeys, setShowKeys] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const detection = useSyncExternalStore(watchModelDetection, loadModelDetection, () => null);
  const [detect, setDetect] = useState<Detect>({ state: 'idle' });
  const [recheck, setRecheck] = useState(0);
  const questionText = draft ?? questions.join('\n');
  const serverKey = (provider: AiProvider) => status?.state === 'ok' && status.providers[provider];
  const keyState = (provider: AiProvider) => keys[provider].trim() ? '使用瀏覽器金鑰' : serverKey(provider) ? '使用伺服器金鑰' : '未設定';
  const statusLine = status === null ? '確認 AI 狀態中…'
    : status.state === 'error' ? status.message
    : `${status.mode === 'access' ? '已通過 Cloudflare Access（可使用伺服器金鑰）。' : status.note ?? '自備金鑰模式。'}ChatGPT：${keyState('openai')}；Claude：${keyState('anthropic')}${status.sec ? '' : '；SEC_CONTACT 尚未設定，財報解讀停用'}。`;

  // Checks the keys and lists their models: on open, shortly after a key changes, and on request.
  // Listing models costs no tokens.
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = recheck > 0;
    const timer = window.setTimeout(() => {
      setDetect({ state: 'checking' });
      fetch(`/api/ai/models${refresh ? '?refresh=1' : ''}`, { cache: 'no-store', headers: aiKeyHeaders(keys), signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as ModelDetection & { error?: string };
          if (!response.ok || !payload.openai) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
          saveModelDetection(payload);
          setDetect({ state: 'idle' });
        })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setDetect({ state: 'error', message: reason instanceof Error ? reason.message : '無法檢查金鑰。' }); });
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, keys, recheck]);

  const checking = detect.state === 'checking';
  // ChatGPT: the free-tier models first (those this key can use, when known), then the key's other chat models.
  const detectedOpenAi = detection?.openai.state === 'ok' ? detection.openai.models.map((model) => model.id) : null;
  const freeModels = freeGroups.map((group) => ({ ...group, models: detectedOpenAi ? group.models.filter((model) => detectedOpenAi.includes(model)) : group.models })).filter((group) => group.models.length);
  const freeIds = new Set(freeGroups.flatMap((group) => group.models));
  const otherModels = (detectedOpenAi ?? []).filter((model) => !freeIds.has(model));
  const enforced = quota?.enforced !== false;
  const currentOpenAi = openAiModel.trim();
  const listed = freeModels.some((group) => group.models.includes(currentOpenAi)) || otherModels.includes(currentOpenAi);
  const claudeList = claudeChoices(detection);
  const claudeListed = claudeList.some((model) => model.id === claudeModel);

  if (!enabled) {
    return <section className="settings-feature-card ai-settings-card">
      <div className="settings-feature-heading"><span className="settings-feature-icon ai" aria-hidden="true">AI</span><div><p>AI assistant</p><h3>AI 設定</h3></div><span className="settings-feature-status">已關閉</span></div>
      <p>AI 功能已關閉：不顯示財報解讀、AI 查財報日、AI 記錄交易與 AI 助理，也不會送出任何 AI 請求。其他功能照常。</p>
      <div className="settings-feature-actions">
        <span>開啟後可用 Claude 或 ChatGPT；金鑰只存在這個瀏覽器。</span>
        <button type="button" className="settings-toggle" role="switch" aria-checked={false} onClick={() => onEnabledChange(true)}><i /><b>關閉</b></button>
      </div>
    </section>;
  }

  const commitQuestions = () => {
    if (draft === null) return;
    onQuestionsChange(draft.split('\n').map((line) => line.trim().slice(0, maxQuestionLength)).filter(Boolean).slice(0, maxQuestions));
    setDraft(null);
  };

  const ready = status?.state === 'ok' && (Boolean(keys.openai || keys.anthropic) || status.providers.openai || status.providers.anthropic);
  return <section className="settings-feature-card ai-settings-card is-enabled">
    <div className="settings-feature-heading"><span className="settings-feature-icon ai" aria-hidden="true">AI</span><div><p>AI assistant</p><h3>AI 設定</h3></div><span className="settings-feature-status">{ready ? status.mode === 'byok' ? '自備金鑰' : '可使用' : '待設定金鑰'}</span></div>
    <p>用於查財報日、產生財報解讀和追問，在「匯入」用一句話或截圖記錄交易，以及 AI 助理。每次使用都會花費你的 API 額度；結果僅供參考，不是投資建議。</p>
    <div className="settings-feature-actions ai-settings-switch">
      <span>AI 功能總開關：關閉後所有 AI 按鈕都會隱藏，不送出任何 AI 請求。</span>
      <button type="button" className="settings-toggle is-on" role="switch" aria-checked onClick={() => onEnabledChange(false)}><i /><b>開啟</b></button>
    </div>
    <p className="ai-settings-status">{statusLine}</p>

    <nav className="earnings-ai-links" aria-label="AI 查詢設定連結">
      <span>設定連結</span>
      {links.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noreferrer noopener">{label}</a>)}
    </nav>

    <div className="ai-settings-grid">
      <label><span>OpenAI 金鑰 <KeyBadge check={detection?.openai} checking={checking} /></span>
        <input type={showKeys ? 'text' : 'password'} value={keys.openai} spellCheck={false} autoComplete="off" placeholder={status?.state === 'ok' && status.mode === 'byok' ? 'sk-…' : 'sk-…（留空則用伺服器金鑰）'} onChange={(event) => onKeysChange({ ...keys, openai: event.target.value.trim() })} />
      </label>
      <label><span>Claude 金鑰 <KeyBadge check={detection?.anthropic} checking={checking} /></span>
        <input type={showKeys ? 'text' : 'password'} value={keys.anthropic} spellCheck={false} autoComplete="off" placeholder={status?.state === 'ok' && status.mode === 'byok' ? 'sk-ant-…' : 'sk-ant-…（留空則用伺服器金鑰）'} onChange={(event) => onKeysChange({ ...keys, anthropic: event.target.value.trim() })} />
      </label>
      <label className="ai-settings-wide"><span>OpenAI 管理金鑰（選填，只用來讀今日用量、檢查免費額度） <KeyBadge check={detection?.openaiAdmin} checking={checking} /></span>
        <input type={showKeys ? 'text' : 'password'} value={keys.openaiAdmin} spellCheck={false} autoComplete="off" placeholder={status?.state === 'ok' && status.mode === 'access' ? 'sk-admin-…（留空則用伺服器的 OPENAI_ADMIN_KEY）' : 'sk-admin-…'} onChange={(event) => onKeysChange({ ...keys, openaiAdmin: event.target.value.trim() })} />
      </label>
    </div>
    <div className="ai-settings-key-actions">
      <small>{detect.state === 'error' ? `無法檢查金鑰：${detect.message}` : checking ? '正在檢查金鑰並偵測可用模型…' : detection ? `金鑰與模型清單檢查於 ${new Intl.DateTimeFormat('zh-TW', { timeStyle: 'short' }).format(new Date(detection.checkedAt))}（列出模型不花 token）。` : '輸入金鑰後會自動檢查是否有效，並偵測可用的模型。'}</small>
      <button type="button" disabled={checking} onClick={() => setRecheck((value) => value + 1)}>重新檢查金鑰</button>
    </div>

    <div className="ai-settings-grid">
      <label><span>預設 AI</span>
        <select value={defaultProvider} onChange={(event) => onDefaultProviderChange(event.target.value === 'anthropic' ? 'anthropic' : 'openai')}>
          <option value="openai">ChatGPT</option>
          <option value="anthropic">Claude</option>
        </select>
      </label>
      <label><span>ChatGPT 模型{detectedOpenAi ? `（偵測到 ${detectedOpenAi.length} 個）` : ''}</span>
        {freeModels.length || otherModels.length ? <select value={currentOpenAi} onChange={(event) => onOpenAiModelChange(event.target.value)}>
          <option value="">{status?.state === 'ok' && status.openAiModel ? `伺服器預設（${status.openAiModel}）` : '請選擇模型'}</option>
          {currentOpenAi && !listed && <option value={currentOpenAi}>{currentOpenAi}（{detectedOpenAi ? '這把金鑰不能用' : '不在免費清單'}）</option>}
          {freeModels.map((group) => <optgroup key={group.id} label={`免費額度內 · ${group.label}`}>{group.models.map((model) => <option key={model} value={model}>{model}</option>)}</optgroup>)}
          {otherModels.length > 0 && <optgroup label={enforced ? '其他可用（不在免費額度，會被擋下）' : '其他可用（會計費）'}>{otherModels.map((model) => <option key={model} value={model} disabled={enforced}>{model}</option>)}</optgroup>}
        </select>
          : <input type="text" value={openAiModel} maxLength={64} spellCheck={false} autoComplete="off" placeholder={status?.state === 'ok' && status.openAiModel ? `預設 ${status.openAiModel}` : '輸入 OpenAI 模型名稱'} onChange={(event) => onOpenAiModelChange(event.target.value)} />}
      </label>
      <label><span>Claude 模型{detection?.anthropic.state === 'ok' ? '（依金鑰偵測）' : ''}</span>
        <select value={claudeModel} onChange={(event) => onClaudeModelChange(resolveClaudeModel(event.target.value))}>
          {!claudeListed && <option value={claudeModel}>{claudeModel}</option>}
          {claudeList.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      <label><span>OpenAI 使用層級</span>
        <select value={usageTier} onChange={(event) => onUsageTierChange(event.target.value === 'high' ? 'high' : 'low')}>
          <option value="low">Tier 1–2（較小額度，預設）</option>
          <option value="high">Tier 3 以上</option>
        </select>
      </label>
    </div>
    {status?.state === 'ok' && <>
      <p className="free-quota-line">{freeQuotaLine(quota)}</p>
      {enforced && <FreeQuotaTable quota={quota} />}
    </>}
    <div className="ai-settings-key-actions">
      <small>金鑰只存在這個瀏覽器，使用時經 HTTPS 送到本站伺服器轉呼叫，伺服器不保存。任何能在此網頁執行的程式都讀得到它；共用電腦請勿保存。</small>
      <button type="button" onClick={() => setShowKeys((current) => !current)}>{showKeys ? '隱藏金鑰' : '顯示金鑰'}</button>
      <button type="button" disabled={!keys.openai && !keys.anthropic && !keys.openaiAdmin} onClick={() => { onKeysChange(emptyAiKeys); saveModelDetection(null); }}>清除金鑰</button>
    </div>

    <label className="ai-settings-questions"><span>財報解讀問題清單（每行一題，最多 {maxQuestions} 題）</span>
      <textarea rows={6} value={questionText} onChange={(event) => setDraft(event.target.value)} onBlur={commitQuestions} />
    </label>
    <div className="ai-settings-key-actions">
      <small>每次產生財報解讀時，AI 會逐題回答這些問題。</small>
      <button type="button" onClick={() => { setDraft(null); onQuestionsChange(defaultAnalysisQuestions); }}>還原預設問題</button>
    </div>
  </section>;
}
