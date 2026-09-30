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

export type ClaudeModel = typeof claudeModels[number]['id'];
export const defaultClaudeModel: ClaudeModel = claudeModels[0].id;
export const claudeModelKey = 'optionflow-claude-model';

export const isClaudeModel = (value: unknown): value is ClaudeModel => claudeModels.some((model) => model.id === value);
export const resolveClaudeModel = (value: unknown): ClaudeModel => isClaudeModel(value) ? value : defaultClaudeModel;
export const claudeModelLabel = (id: string) => claudeModels.find((model) => model.id === id)?.label.replace(/（.*）$/, '') ?? id;

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
