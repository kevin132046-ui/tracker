'use client';

import ChatText from '@/components/wafu/ChatText';
import { useEffect, useRef, useState } from 'react';
import type { AiEntryContext } from '@/components/AiTradeEntry';
import { freeQuotaLine, freeQuotaOpen } from '@/components/FreeQuota';
import HaloIcon from '@/components/wafu/HaloIcon';
import type { AssistantMessage, AssistantPersona, PortfolioSnapshot } from '@/lib/ai-assistant';
import { assistantGreeting, assistantPresets, currentAssistantSession, loadAssistantChat, maxAssistantQuestion, maxAssistantTurns, saveAssistantChat } from '@/lib/ai-assistant';
import { claudeModelLabel, requestModel } from '@/lib/ai-models';
import type { AiProvider } from '@/lib/earnings';
import { aiKeyHeaders } from '@/lib/filings';
import type { QuotaReport } from '@/lib/openai-free-tier';
import { introLanguage } from '@/lib/wafu/intro';
import type { WafuTheme } from '@/lib/wafu/theme';

type Status = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; providers: Record<AiProvider, boolean>; openAiModel: string | null; quota: QuotaReport | null };

const providerName = (provider: AiProvider) => provider === 'anthropic' ? 'Claude' : 'ChatGPT';
const names: Record<WafuTheme, string> = { kikyo: '桐生桔梗', shigure: '間宵時雨' };

/**
 * AI assistant panel: ask about your own positions. Each question goes to /api/ai with a summary
 * of the portfolio (built by the page) and the last few turns; nothing here changes a trade.
 * The conversation stays in this browser and can be cleared.
 */
export default function AssistantPanel({ theme, voice, ai, snapshot, onClose }: {
  theme: WafuTheme;
  voice: 'character' | 'neutral';
  ai: AiEntryContext;
  /** Built when a question is sent, so it reflects the page at that moment. */
  snapshot: () => PortfolioSnapshot;
  onClose: () => void;
}) {
  const persona: AssistantPersona = voice === 'character' ? theme : 'neutral';
  const [language] = useState(introLanguage);
  const [messages, setMessages] = useState<AssistantMessage[]>(loadAssistantChat);
  const [provider, setProvider] = useState<AiProvider>(ai.defaultProvider);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState(0);
  const request = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { saveAssistantChat(messages); }, [messages]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Which providers work, and today's free ChatGPT tokens.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ai?model=${encodeURIComponent(ai.openAiModel.trim())}&tier=${ai.usageTier}`, { cache: 'no-store', headers: aiKeyHeaders(ai.keys), signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { providers?: Record<AiProvider, boolean>; openAiModel?: string | null; quota?: QuotaReport; error?: string };
        if (!response.ok || !payload.providers) throw new Error(payload.error ?? 'AI 暫時無法使用。');
        setStatus({ state: 'ok', providers: payload.providers, openAiModel: payload.openAiModel ?? null, quota: payload.quota ?? null });
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setStatus({ state: 'error', message: reason instanceof Error ? reason.message : 'AI 暫時無法使用。' }); });
    return () => controller.abort();
  }, [ai.keys, ai.openAiModel, ai.usageTier, checks]);

  const quota = status.state === 'ok' ? status.quota : null;
  const ready = status.state === 'ok' && (Boolean(ai.keys[provider].trim()) || status.providers[provider]);
  const chatGptModel = ai.openAiModel.trim() || (status.state === 'ok' ? status.openAiModel ?? '' : '');
  const blockedReason = status.state === 'loading' ? '確認 AI 設定中…'
    : status.state === 'error' ? status.message
    : !ready ? `尚未設定 ${providerName(provider)} 金鑰：請在「設定 → AI 設定」輸入，或在伺服器設定。`
    : provider === 'openai' && !chatGptModel ? '請先在「設定 → AI 設定」選擇 ChatGPT 模型。'
    : provider === 'openai' && !freeQuotaOpen(quota) ? freeQuotaLine(quota)
    : '';

  const ask = async (text: string) => {
    const question = text.trim().slice(0, maxAssistantQuestion);
    if (!question || busy || blockedReason) return;
    const history = messages.filter((message) => !message.error).slice(-maxAssistantTurns).map(({ role, text: turn }) => ({ role, text: turn }));
    const asked: AssistantMessage = { role: 'user', text: question, at: Date.now(), session: currentAssistantSession() };
    setMessages((current) => [...current, asked]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiKeyHeaders(ai.keys) },
        body: JSON.stringify({
          task: 'portfolio-chat',
          provider,
          model: requestModel(provider, ai.openAiModel, ai.claudeModel),
          usageTier: ai.usageTier,
          persona,
          language,
          question,
          turns: history,
          snapshot: snapshot(),
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { text?: string; model?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error ?? `伺服器回應 ${response.status}`);
      setMessages((current) => [...current, { role: 'assistant', text: payload.text!, provider, model: payload.model, at: Date.now(), session: currentAssistantSession() }]);
    } catch (reason) {
      if (!controller.signal.aborted) setMessages((current) => [...current, { role: 'assistant', text: reason instanceof Error ? reason.message : '回覆失敗，請稍後再試。', at: Date.now(), error: true, session: currentAssistantSession() }]);
    } finally {
      request.current = null;
      setBusy(false);
      setChecks((value) => value + 1);
      ai.onUsed();
    }
  };

  const title = persona === 'neutral' ? 'AI 助理' : `AI 助理 · ${names[theme]}`;
  const modelLine = provider === 'anthropic' ? `${claudeModelLabel(ai.claudeModel)} · 使用你的 Claude API 額度` : freeQuotaLine(quota);

  return <div className="wafu-assistant-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={`wafu-assistant is-${theme}`} role="dialog" aria-modal="true" aria-labelledby="wafu-assistant-title">
      <header>
        <span className="wafu-assistant-halo" aria-hidden="true"><HaloIcon theme={theme} size={34} tilt={58} minStrokePx={1} /></span>
        <div><h2 id="wafu-assistant-title">{title}</h2><small>只提供分析，不會更動任何交易；不是投資建議。</small></div>
        <button type="button" className="wafu-assistant-close" onClick={onClose} aria-label="關閉 AI 助理">×</button>
      </header>

      <div className="wafu-assistant-log" ref={listRef} aria-live="polite">
        <p className="wafu-assistant-msg is-assistant is-greeting" data-i18n-skip="">{assistantGreeting[persona][language]}</p>
        {messages.map((message) => <div key={`${message.at}-${message.role}`} className={`wafu-assistant-msg is-${message.role}${message.error ? ' is-error' : ''}`}>
          {message.role === 'assistant' && !message.error ? <ChatText text={message.text} /> : <p>{message.text}</p>}
          {message.role === 'assistant' && message.model && <small>{message.model}</small>}
        </div>)}
        {busy && <div className="wafu-assistant-msg is-assistant is-thinking" aria-label="思考中"><i /><i /><i /></div>}
      </div>

      <div className="wafu-assistant-presets" data-i18n-skip="">
        {assistantPresets[language].map((preset) => <button key={preset} type="button" disabled={busy || Boolean(blockedReason)} onClick={() => void ask(preset)}>{preset}</button>)}
      </div>

      <form className="wafu-assistant-input" onSubmit={(event) => { event.preventDefault(); void ask(input); }}>
        <textarea ref={inputRef} rows={2} value={input} maxLength={maxAssistantQuestion} disabled={busy} placeholder="問問你的持倉…（Enter 送出，Shift+Enter 換行）" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(input); } }} />
        {busy
          ? <button type="button" className="is-stop" onClick={() => request.current?.abort()}>停止</button>
          : <button type="submit" disabled={!input.trim() || Boolean(blockedReason)}>送出</button>}
      </form>
      <footer>
        <label><span>AI</span>
          <select value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value === 'anthropic' ? 'anthropic' : 'openai')}>
            <option value="openai">ChatGPT</option>
            <option value="anthropic">Claude</option>
          </select>
        </label>
        <small className={blockedReason ? 'is-blocked' : ''}>{blockedReason || modelLine}</small>
        <button type="button" disabled={busy || !messages.length} onClick={() => setMessages([])}>清除對話</button>
      </footer>
    </aside>
  </div>;
}
