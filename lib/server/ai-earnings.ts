import Anthropic from '@anthropic-ai/sdk';
import type { AiEarningsSuggestion, AiProvider } from '@/lib/earnings';
import { exchangeTodayKey } from '@/lib/earnings';
import { addDaysToKey, parseDateKey } from '@/lib/market-calendar';
import { defaultClaudeModel } from '@/lib/ai-models';

/**
 * Asks Claude or ChatGPT, with web search, for a symbol's next earnings date. The answer is
 * parsed from a JSON object in the reply and checked; anything unusable becomes date: null.
 */
/** Claude model used when a request does not choose one (the first of lib/ai-models). */
export const anthropicModel = defaultClaudeModel;
export const openAiModelPattern = /^[a-z0-9][a-z0-9.:-]{0,63}$/i;
/** Output cap and the token estimate the free-quota check uses for a date lookup (web search results included). */
export const dateLookupMaxOutput = 4_000;
export const dateLookupEstimate = 30_000;
const requestTimeoutMs = 120_000;
const maxPauseResumes = 3;

type ParsedAnswer = { date: string | null; timing: 'pre' | 'post' | null; confirmed: boolean; note: string };

function prompt(symbol: string, today: string) {
  const exchange = symbol.endsWith('.T') ? `Tokyo Stock Exchange code ${symbol.slice(0, -2)}` : `US-listed ticker ${symbol}`;
  return [
    `Find the next scheduled quarterly or annual earnings release date for ${exchange}, on or after ${today} (exchange-local date).`,
    'Search the web. Prefer the company\'s investor-relations site or an official exchange filing; use financial news sites only if the company has not announced it.',
    'Reply with a single JSON object and nothing else:',
    '{"date": "YYYY-MM-DD" or null, "timing": "pre" (before the market opens), "post" (after the close) or null, "confirmed": true only if the company itself announced the date, "note": one short sentence in Traditional Chinese on where the date comes from}',
    'If you cannot find a date, return "date": null and say why in "note".',
  ].join('\n');
}

function parseAnswer(text: string, today: string): ParsedAnswer {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { date: null, timing: null, confirmed: false, note: '回覆中找不到可讀的日期。' };
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const date = typeof raw.date === 'string' && parseDateKey(raw.date) ? raw.date : null;
    // A past date or one more than ~13 months out is not the next report.
    const usable = date && date >= today && date <= addDaysToKey(today, 400) ? date : null;
    return {
      date: usable,
      timing: usable && (raw.timing === 'pre' || raw.timing === 'post') ? raw.timing : null,
      confirmed: usable ? raw.confirmed === true : false,
      note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
    };
  } catch {
    return { date: null, timing: null, confirmed: false, note: '回覆中的日期格式無法解析。' };
  }
}

const cleanSources = (sources: Array<{ url?: string; title?: string | null }>) => {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (!source.url || !/^https?:\/\//.test(source.url) || seen.has(source.url)) return [];
    seen.add(source.url);
    return [{ url: source.url.slice(0, 500), title: String(source.title ?? source.url).slice(0, 160) }];
  }).slice(0, 5);
};

async function askClaude(apiKey: string, model: string, symbol: string, today: string): Promise<Omit<AiEarningsSuggestion, 'symbol' | 'provider'>> {
  const client = new Anthropic({ apiKey, timeout: requestTimeoutMs, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt(symbol, today) }];
  let response: Anthropic.Beta.BetaMessage | null = null;
  // Web search runs server-side; a long search can pause and is resumed by sending the turn back.
  for (let attempt = 0; attempt <= maxPauseResumes; attempt += 1) {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  if (!response) throw new Error('Claude returned no response.');
  if (response.stop_reason === 'refusal') return { model: response.model, date: null, timing: null, confirmed: false, note: 'Claude 拒絕了這次查詢。', sources: [] };
  if (response.stop_reason === 'pause_turn') return { model: response.model, date: null, timing: null, confirmed: false, note: '搜尋時間過長，請稍後再試。', sources: [] };

  const text = response.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n');
  const sources = response.content.flatMap((block) => {
    if (block.type === 'text') return (block.citations ?? []).flatMap((citation) => citation.type === 'web_search_result_location' ? [{ url: citation.url, title: citation.title }] : []);
    // A search error comes back as an object instead of a result list.
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) return block.content.map((result) => ({ url: result.url, title: result.title }));
    return [];
  });
  return { model: response.model, ...parseAnswer(text, today), sources: cleanSources(sources) };
}

type OpenAiContent = { type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> };
type OpenAiResponse = { model?: string; status?: string; output?: Array<{ type?: string; content?: OpenAiContent[] }>; usage?: { total_tokens?: number } | null; error?: { message?: string } | null };

async function askChatGpt(apiKey: string, model: string, symbol: string, today: string): Promise<Omit<AiEarningsSuggestion, 'symbol' | 'provider'> & { usageTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: prompt(symbol, today), tools: [{ type: 'web_search', search_context_size: 'low' }], max_output_tokens: dateLookupMaxOutput }),
      signal: controller.signal,
    });
    const payload = await response.json() as OpenAiResponse;
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}: ${payload.error?.message ?? 'request failed'}`.slice(0, 300));
    const parts = (payload.output ?? []).flatMap((item) => item.type === 'message' ? item.content ?? [] : []).filter((part) => part.type === 'output_text');
    const text = parts.map((part) => part.text ?? '').join('\n');
    const sources = parts.flatMap((part) => (part.annotations ?? []).filter((annotation) => annotation.type === 'url_citation').map((annotation) => ({ url: annotation.url, title: annotation.title })));
    return { model: payload.model ?? model, ...parseAnswer(text, today), sources: cleanSources(sources), usageTokens: payload.usage?.total_tokens ?? 0 };
  } finally {
    clearTimeout(timeout);
  }
}

/** The suggestion, plus the tokens a ChatGPT call used (for the free-quota record). */
export async function findEarningsDate(provider: AiProvider, symbol: string, keys: { anthropic?: string; openai?: string }, openAiModel: string, claudeModel: string = anthropicModel): Promise<{ suggestion: AiEarningsSuggestion; usageTokens: number }> {
  const today = exchangeTodayKey(symbol, Date.now());
  if (provider === 'anthropic') return { suggestion: { symbol, provider, ...(await askClaude(keys.anthropic!, claudeModel, symbol, today)) }, usageTokens: 0 };
  const { usageTokens, ...result } = await askChatGpt(keys.openai!, openAiModel, symbol, today);
  return { suggestion: { symbol, provider, ...result }, usageTokens };
}
