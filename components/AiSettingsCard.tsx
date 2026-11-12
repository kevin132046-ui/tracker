'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ClaudeModel, KeyCheck, ModelDetection } from '@/lib/ai-models';
import { claudeChoices, keyStateLabel, loadModelDetection, resolveClaudeModel, saveModelDetection, watchModelDetection } from '@/lib/ai-models';
import type { AiProvider } from '@/lib/earnings';
import type { AiKeys } from '@/lib/filings';
import { aiKeyHeaders, defaultAnalysisQuestions, emptyAiKeys, maxQuestionLength, maxQuestions } from '@/lib/filings';
import type { QuotaReport, UsageTier } from '@/lib/openai-free-tier';
import { groupOfModel, limitLabel, sharingSettingsUrl, tierOfAccount, usageTierLabel } from '@/lib/openai-free-tier';
import { loadAccountTier, saveAccountTier, watchAccountTier } from '@/lib/openai-account-tier';
import { FreeQuotaTable, freeQuotaLine, lookupQuota } from '@/components/FreeQuota';

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
  /** The 對話 role's ChatGPT model (lib/ai-model-roles). */
  openAiModel: string;
  onOpenAiModelChange: (model: string) => void;
  /** The 自動找資料 role's ChatGPT model. */
  lookupModel: string;
  onLookupModelChange: (model: string) => void;
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
export default function AiSettingsCard({ enabled, onEnabledChange, status, keys, onKeysChange, defaultProvider, onDefaultProviderChange, openAiModel, onOpenAiModelChange, lookupModel, onLookupModelChange, claudeModel, onClaudeModelChange, usageTier, onUsageTierChange, questions, onQuestionsChange }: Props) {
  const quota = status?.state === 'ok' ? status.quota : null;
  const freeGroups = quota?.list.groups ?? [];
  const [showKeys, setShowKeys] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const detection = useSyncExternalStore(watchModelDetection, loadModelDetection, () => null);
  const [detect, setDetect] = useState<Detect>({ state: 'idle' });
  const [recheck, setRecheck] = useState(0);
  const accountTier = useSyncExternalStore(watchAccountTier, loadAccountTier, () => null);
  // Text typed or pasted into the free-tier box that has not been saved yet (null: show the saved text).
  const [tierDraft, setTierDraft] = useState<string | null>(null);
  const [tierError, setTierError] = useState<string | null>(null);
  const [tierSaving, setTierSaving] = useState(false);
  const saveTier = (text: string | null) => {
    setTierSaving(true);
    void saveAccountTier(text).then((error) => {
      setTierError(error);
      if (!error) setTierDraft(null);
    }).finally(() => setTierSaving(false));
  };
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
  // A list may name a family ("gpt-5.4"): its dated snapshots belong to it too (see groupOfModel).
  const detectedOpenAi = detection?.openai.state === 'ok' ? detection.openai.models.map((model) => model.id) : null;
  const freeModels = freeGroups.map((group) => ({ ...group, models: detectedOpenAi ? detectedOpenAi.filter((model) => groupOfModel(freeGroups, model) === group) : group.models })).filter((group) => group.models.length);
  const freeIds = new Set(freeModels.flatMap((group) => group.models));
  const otherModels = (detectedOpenAi ?? []).filter((model) => !freeIds.has(model));
  const enforced = quota?.enforced !== false;
  const serverDefault = status?.state === 'ok' ? status.openAiModel : null;
  /** A ChatGPT model menu for one role: free-tier models first, then the key's others. */
  const modelPicker = (label: string, hint: string, value: string, onChange: (model: string) => void) => {
    const current = value.trim();
    const listed = freeModels.some((group) => group.models.includes(current)) || otherModels.includes(current);
    return <label><span>{label}{detectedOpenAi ? `（偵測到 ${detectedOpenAi.length} 個）` : ''}</span>
      {freeModels.length || otherModels.length ? <select value={current} onChange={(event) => onChange(event.target.value)}>
        <option value="">{serverDefault ? `伺服器預設（${serverDefault}）` : '請選擇模型'}</option>
        {current && !listed && <option value={current}>{current}（{detectedOpenAi ? '這把金鑰不能用' : '不在免費清單'}）</option>}
        {freeModels.map((group) => <optgroup key={group.id} label={`免費額度內 · ${group.label}`}>{group.models.map((model) => <option key={model} value={model}>{model}</option>)}</optgroup>)}
        {otherModels.length > 0 && <optgroup label={enforced ? '其他可用（不在免費額度，會被擋下）' : '其他可用（會計費）'}>{otherModels.map((model) => <option key={model} value={model} disabled={enforced}>{model}</option>)}</optgroup>}
      </select>
        : <input type="text" value={value} maxLength={64} spellCheck={false} autoComplete="off" placeholder={serverDefault ? `預設 ${serverDefault}` : '輸入 OpenAI 模型名稱'} onChange={(event) => onChange(event.target.value)} />}
      <small className="ai-settings-hint">{hint}</small>
    </label>;
  };
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

    <section className="ai-free-tier" aria-labelledby="ai-free-tier-title">
      <div className="ai-free-tier-head">
        <h4 id="ai-free-tier-title">我的 OpenAI 免費資格</h4>
        <a href={sharingSettingsUrl} target="_blank" rel="noreferrer noopener">開啟 OpenAI Sharing 頁</a>
      </div>
      <label className="ai-settings-wide"><span>{"從 Sharing 頁複製「You're eligible / enrolled …」整段貼上（不含金鑰；存在網站資料庫，登入後每台裝置共用）"}</span>
        <textarea rows={4} value={tierDraft ?? accountTier?.text ?? ''} spellCheck={false} disabled={tierSaving} placeholder={"You're eligible for free daily usage on traffic shared with OpenAI.\nUp to 250 thousand tokens per day across …\nUp to 2.5 million tokens per day across …"}
          onChange={(event) => { setTierDraft(event.target.value); setTierError(null); }}
          onBlur={() => { if (tierDraft !== null) saveTier(tierDraft.trim() ? tierDraft : null); }} />
      </label>
      {tierError && <p className="ai-free-tier-error" role="alert">{tierError}</p>}
      {accountTier ? <>
        <div className="ai-free-tier-summary">
          <span className="ai-key-badge is-ok">已讀取 · {accountTier.parsed.groups.length} 組 · {accountTier.parsed.groups.reduce((sum, group) => sum + group.models.length, 0)} 個模型</span>
          <span className="ai-key-badge">{accountTier.parsed.status === 'enrolled' ? '已加入（enrolled）' : accountTier.parsed.status === 'eligible' ? '有資格（尚未 enrolled）' : '狀態不明'}</span>
          {accountTier.savedAt > 0 && <span className="ai-key-badge">{new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(new Date(accountTier.savedAt))} 貼上</span>}
          <span className="ai-key-badge">{accountTier.where === 'server' ? '已存到網站資料庫（所有裝置共用）' : '只存在這個瀏覽器（未通過 Access 登入）'}</span>
          <button type="button" disabled={tierSaving} onClick={() => { setTierDraft(null); saveTier(null); }}>清除，改用說明頁清單</button>
        </div>
        <div className="ai-free-tier-groups">
          {[...accountTier.parsed.groups].sort((a, b) => a.limit - b.limit).map((group) => <div key={group.limit}>
            <small>{limitLabel(group.limit)} · 每日、組內共用</small>
            <p>{group.models.map((model) => <code key={model}>{model}</code>)}</p>
          </div>)}
        </div>
        {accountTier.parsed.status !== 'enrolled' && <p className="ai-free-tier-note">還沒 enrolled：到 Sharing 頁打開「Share inputs and outputs with OpenAI」後，額度才會真的免費；開好之後把新的文字再貼一次。</p>}
      </> : <p className="ai-free-tier-note">沒貼的話，用 OpenAI 說明頁的清單判斷；說明頁和帳號頁不一定同步，說明頁常常列得比較多，建議貼上。</p>}
      {quota?.accountRejected && <p className="ai-free-tier-error" role="alert">伺服器沒有接受貼上的清單（格式超出範圍），這次改用說明頁清單。</p>}
    </section>

    <div className="ai-settings-grid">
      <label><span>預設 AI</span>
        <select value={defaultProvider} onChange={(event) => onDefaultProviderChange(event.target.value === 'anthropic' ? 'anthropic' : 'openai')}>
          <option value="openai">ChatGPT</option>
          <option value="anthropic">Claude</option>
        </select>
      </label>
      <label><span>Claude 模型{detection?.anthropic.state === 'ok' ? '（依金鑰偵測）' : ''}</span>
        <select value={claudeModel} onChange={(event) => onClaudeModelChange(resolveClaudeModel(event.target.value))}>
          {!claudeListed && <option value={claudeModel}>{claudeModel}</option>}
          {claudeList.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      {modelPicker('對話用 ChatGPT 模型', 'AI 助理、財報解讀與追問', openAiModel, onOpenAiModelChange)}
      {modelPicker('自動找資料用 ChatGPT 模型', '查財報日、公司資料、DCF 預填、AI 記錄交易', lookupModel, onLookupModelChange)}
      {accountTier ? <div className="ai-settings-field"><span>OpenAI 使用層級</span>
        <p className="ai-settings-fixed">{usageTierLabel[tierOfAccount(accountTier.parsed.groups)]}（依貼上的免費資格）</p>
      </div> : <label><span>OpenAI 使用層級</span>
        <select value={usageTier} onChange={(event) => onUsageTierChange(event.target.value === 'high' ? 'high' : 'low')}>
          <option value="low">Build（較小額度，預設）</option>
          <option value="high">Launch／Grow</option>
        </select>
      </label>}
    </div>
    {status?.state === 'ok' && <>
      <p className="free-quota-line"><b>對話用</b>　{freeQuotaLine(quota)}</p>
      <p className="free-quota-line"><b>自動找資料用</b>　{freeQuotaLine(lookupQuota(quota))}</p>
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
