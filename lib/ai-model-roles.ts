/**
 * Which ChatGPT model each kind of AI work uses:
 * - chat: what you ask yourself (the AI assistant, filing analysis and its follow-ups);
 * - lookup: what the site looks up for you (earnings dates, company figures, DCF assumptions, AI trade entry).
 * An empty choice falls back to the server default (OPENAI_MODEL). Kept in the site's database so every
 * device (and, later, the daily digest) uses the same choice. Pure: shared by the server and the browser.
 */
export type ModelRole = 'chat' | 'lookup';
export type ModelRoles = { chat: string; lookup: string };

export const emptyModelRoles: ModelRoles = { chat: '', lookup: '' };
export const modelNamePattern = /^[a-z0-9][a-z0-9.:-]{0,63}$/i;

/** The role of each AI task the server runs. */
export const roleOfTask: Record<string, ModelRole> = {
  'portfolio-chat': 'chat',
  'earnings-analysis': 'chat',
  'filing-question': 'chat',
  'earnings-date': 'lookup',
  'company-figures': 'lookup',
  'dcf-assumptions': 'lookup',
  'parse-trades': 'lookup',
};

/** A role's model name, or '' (server default) when it is missing or not a model name. */
const cleanName = (value: unknown) => typeof value === 'string' && modelNamePattern.test(value.trim()) ? value.trim() : '';

/** Roles from stored or sent JSON, with anything unusable left empty. */
export function cleanModelRoles(value: unknown): ModelRoles {
  const input = value && typeof value === 'object' ? value as Partial<Record<ModelRole, unknown>> : {};
  return { chat: cleanName(input.chat), lookup: cleanName(input.lookup) };
}
