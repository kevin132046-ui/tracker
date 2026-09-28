'use client';

import { useState } from 'react';
import type { ClaudeModel } from '@/lib/ai-models';
import { claudeModels, resolveClaudeModel } from '@/lib/ai-models';
import type { AiProvider } from '@/lib/earnings';
import type { AiKeys } from '@/lib/filings';
import { defaultAnalysisQuestions, maxQuestionLength, maxQuestions } from '@/lib/filings';
import type { QuotaReport, UsageTier } from '@/lib/openai-free-tier';
import { FreeQuotaTable, freeQuotaLine } from '@/components/FreeQuota';

export type AiStatus = { state: 'ok'; providers: Record<AiProvider, boolean>; openAiModel: string | null; sec: boolean; quota: QuotaReport | null } | { state: 'error'; message: string } | null;

type Props = {
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
  ['OpenAI 模型清單', 'https://platform.openai.com/docs/models'],
  ['Cloudflare 後台', 'https://dash.cloudflare.com/?to=/:account/workers-and-pages'],
  ['Access 設定說明', 'https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#manage-access-to-workersdev'],
] as const;

/** Keys, default model and the analysis question list for the AI features. Everything stays in this browser. */
export default function AiSettingsCard({ status, keys, onKeysChange, defaultProvider, onDefaultProviderChange, openAiModel, onOpenAiModelChange, claudeModel, onClaudeModelChange, usageTier, onUsageTierChange, questions, onQuestionsChange }: Props) {
  const quota = status?.state === 'ok' ? status.quota : null;
  const freeModels = quota?.list.groups ?? [];
  const listed = freeModels.some((group) => group.models.includes(openAiModel.trim()));
  const [showKeys, setShowKeys] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const questionText = draft ?? questions.join('\n');
  const serverKey = (provider: AiProvider) => status?.state === 'ok' && status.providers[provider];
  const keyState = (provider: AiProvider) => keys[provider].trim() ? '使用瀏覽器金鑰' : serverKey(provider) ? '使用伺服器金鑰' : '未設定';
  const statusLine = status === null ? '確認登入狀態中…'
    : status.state === 'error' ? status.message
    : `已通過 Cloudflare Access。ChatGPT：${keyState('openai')}；Claude：${keyState('anthropic')}${status.sec ? '' : '；SEC_CONTACT 尚未設定，財報解讀停用'}。`;
  const commitQuestions = () => {
    if (draft === null) return;
    onQuestionsChange(draft.split('\n').map((line) => line.trim().slice(0, maxQuestionLength)).filter(Boolean).slice(0, maxQuestions));
    setDraft(null);
  };

  return <section className="settings-feature-card ai-settings-card is-enabled">
    <div className="settings-feature-heading"><span className="settings-feature-icon ai" aria-hidden="true">AI</span><div><p>AI assistant</p><h3>AI 設定</h3></div><span className="settings-feature-status">{status?.state === 'ok' ? '可使用' : '未啟用'}</span></div>
    <p>用於查財報日、產生財報解讀和追問，以及在「匯入」用一句話或截圖記錄交易。每次使用都會花費你的 API 額度；結果僅供參考，不是投資建議。</p>
    <p className="ai-settings-status">{statusLine}</p>

    <nav className="earnings-ai-links" aria-label="AI 查詢設定連結">
      <span>設定連結</span>
      {links.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noreferrer noopener">{label}</a>)}
    </nav>

    <div className="ai-settings-grid">
      <label><span>預設 AI</span>
        <select value={defaultProvider} onChange={(event) => onDefaultProviderChange(event.target.value === 'anthropic' ? 'anthropic' : 'openai')}>
          <option value="openai">ChatGPT</option>
          <option value="anthropic">Claude</option>
        </select>
      </label>
      <label><span>ChatGPT 模型（只列免費額度內的模型）</span>
        {freeModels.length ? <select value={openAiModel.trim()} onChange={(event) => onOpenAiModelChange(event.target.value)}>
          <option value="">{status?.state === 'ok' && status.openAiModel ? `伺服器預設（${status.openAiModel}）` : '請選擇模型'}</option>
          {openAiModel.trim() && !listed && <option value={openAiModel.trim()}>{openAiModel.trim()}（不在免費清單，會被擋下）</option>}
          {freeModels.map((group) => <optgroup key={group.id} label={group.label}>{group.models.map((model) => <option key={model} value={model}>{model}</option>)}</optgroup>)}
        </select>
          : <input type="text" value={openAiModel} maxLength={64} spellCheck={false} autoComplete="off" placeholder={status?.state === 'ok' && status.openAiModel ? `預設 ${status.openAiModel}` : '輸入 OpenAI 模型名稱'} onChange={(event) => onOpenAiModelChange(event.target.value)} />}
      </label>
      <label><span>Claude 模型</span>
        <select value={claudeModel} onChange={(event) => onClaudeModelChange(resolveClaudeModel(event.target.value))}>
          {claudeModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      <label><span>OpenAI 使用層級</span>
        <select value={usageTier} onChange={(event) => onUsageTierChange(event.target.value === 'high' ? 'high' : 'low')}>
          <option value="low">Tier 1–2（較小額度，預設）</option>
          <option value="high">Tier 3 以上</option>
        </select>
      </label>
      <label><span>OpenAI 金鑰</span>
        <input type={showKeys ? 'text' : 'password'} value={keys.openai} spellCheck={false} autoComplete="off" placeholder="sk-…（留空則用伺服器金鑰）" onChange={(event) => onKeysChange({ ...keys, openai: event.target.value.trim() })} />
      </label>
      <label><span>Claude 金鑰</span>
        <input type={showKeys ? 'text' : 'password'} value={keys.anthropic} spellCheck={false} autoComplete="off" placeholder="sk-ant-…（留空則用伺服器金鑰）" onChange={(event) => onKeysChange({ ...keys, anthropic: event.target.value.trim() })} />
      </label>
    </div>
    {status?.state === 'ok' && <>
      <p className="free-quota-line">{freeQuotaLine(quota)}</p>
      <FreeQuotaTable quota={quota} />
    </>}
    <div className="ai-settings-key-actions">
      <small>金鑰只存在這個瀏覽器，使用時經 HTTPS 送到本站伺服器轉呼叫，伺服器不保存。任何能在此網頁執行的程式都讀得到它；共用電腦請勿保存。</small>
      <button type="button" onClick={() => setShowKeys((current) => !current)}>{showKeys ? '隱藏金鑰' : '顯示金鑰'}</button>
      <button type="button" disabled={!keys.openai && !keys.anthropic} onClick={() => onKeysChange({ openai: '', anthropic: '' })}>清除金鑰</button>
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
