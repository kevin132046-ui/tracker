import type { AiProvider } from '@/lib/earnings';

/**
 * The Claude models the AI features may use. The first one is the default and matches what the
 * app used before the choice existed; the server accepts only ids from this list.
 */
export const claudeModels = [
  { id: 'claude-opus-5', label: 'Claude Opus 5（預設）' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（最強）' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5（較快、較省）' },
] as const;

/** A Claude model id: one from the list above, or one detected with the user's key (see claudeCompatible). */
export type ClaudeModel = string;
export const defaultClaudeModel: ClaudeModel = claudeModels[0].id;
export const claudeModelKey = 'optionflow-claude-model';

/**
 * Detected models the app can call with its request shape (adaptive thinking, effort, web search):
 * the Fable, Opus and Sonnet lines from 4.6 on. Haiku and older models reject `effort`.
 */
const compatiblePattern = /^claude-(?:fable|opus|sonnet)-(?:5|4-[6-9])(?:-\d{1,2})?$/;
export const claudeCompatible = (id: string) => compatiblePattern.test(id);
/** Models the server-side refusal fallback (`fallbacks: 'default'`) accepts. */
const fallbackModels = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5']);
/** The request fields that depend on the model: the refusal fallback where it is offered. */
export const claudeExtras = (model: string) => fallbackModels.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {};
/** Web search with dynamic filtering needs Opus or Sonnet 4.6+; others get the basic tool. */
export const claudeWebSearch = (model: string) => /^claude-(?:opus|sonnet)-/.test(model) ? 'web_search_20260209' as const : 'web_search_20250305' as const;

export const isClaudeModel = (value: unknown): value is ClaudeModel => typeof value === 'string' && (claudeModels.some((model) => model.id === value) || claudeCompatible(value));
export const resolveClaudeModel = (value: unknown): ClaudeModel => isClaudeModel(value) ? value : defaultClaudeModel;
export const claudeModelLabel = (id: string) => claudeModels.find((model) => model.id === id)?.label.replace(/（.*）$/, '') ?? claudeDisplayName(id);
/** claude-opus-5-5 → Claude Opus 5.5 */
export const claudeDisplayName = (id: string) => id.replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/-(\w)/g, (_, c: string) => ` ${c.toUpperCase()}`).replace(/Claude (\w)/, (_, c: string) => `Claude ${c.toUpperCase()}`);

/** The model field an AI request sends: the ChatGPT model name, or the Claude model id. */
export const requestModel = (provider: AiProvider, openAiModel: string, claudeModel: string) => provider === 'openai' ? openAiModel.trim() || undefined : claudeModel;

export function loadClaudeModel(): ClaudeModel {
  try {
    return resolveClaudeModel(window.localStorage.getItem(claudeModelKey));
  } catch {
    return defaultClaudeModel;
  }
}

export function saveClaudeModel(model: ClaudeModel) {
  try { window.localStorage.setItem(claudeModelKey, model); } catch { /* storage unavailable */ }
}

/** What a key check found: whether the key works, and (for API keys) the models it can use. */
export type KeyState = 'ok' | 'invalid' | 'forbidden' | 'limited' | 'missing' | 'error';
export type KeyCheck = { state: KeyState; source: 'browser' | 'server' | 'none'; message: string; models: Array<{ id: string; label: string }> };
export type ModelDetection = { openai: KeyCheck; anthropic: KeyCheck; openaiAdmin: KeyCheck; checkedAt: number };

export const keyStateLabel: Record<KeyState, string> = {
  ok: '有效', invalid: '無效', forbidden: '權限不足', limited: '額度或速率受限', missing: '未設定', error: '無法確認',
};

/**
 * ChatGPT models the app's text requests (Responses API) can use: the GPT and o-series chat models,
 * without audio, image, embedding, speech or search-only variants.
 */
export const openAiChatModel = (id: string) => /^(?:gpt-|o\d|chatgpt-)/.test(id)
  && !/(?:audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct|dall-e|whisper|computer-use)/.test(id);

// The last detection, so model lists show at once on the next visit (model ids only, never keys).
const detectionKey = 'optionflow-ai-models';
let detection: ModelDetection | null = null;
const listeners = new Set<() => void>();
export function loadModelDetection(): ModelDetection | null {
  if (detection) return detection;
  try {
    const stored = JSON.parse(window.localStorage.getItem(detectionKey) ?? 'null') as ModelDetection | null;
    if (stored?.openai && stored.anthropic && stored.openaiAdmin) detection = stored;
  } catch { /* storage unavailable */ }
  return detection;
}
export function saveModelDetection(next: ModelDetection | null) {
  detection = next;
  try {
    if (next) window.localStorage.setItem(detectionKey, JSON.stringify(next));
    else window.localStorage.removeItem(detectionKey);
  } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}
export function watchModelDetection(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The Claude models to offer: detected ones the app can call, else the built-in list. */
export function claudeChoices(found: ModelDetection | null): Array<{ id: string; label: string }> {
  const detected = found?.anthropic.state === 'ok' ? found.anthropic.models.filter((model) => claudeCompatible(model.id) || claudeModels.some((known) => known.id === model.id)) : [];
  if (!detected.length) return claudeModels.map((model) => ({ id: model.id, label: model.label }));
  return detected.map((model) => ({ id: model.id, label: model.id === defaultClaudeModel ? `${model.label}（預設）` : model.label }));
}
