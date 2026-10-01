import type { AiEntryContext } from '@/components/AiTradeEntry';
import { requestModel } from '@/lib/ai-models';
import type { AiProvider } from '@/lib/earnings';
import { aiKeyHeaders } from '@/lib/filings';

/**
 * AI 預填 for the DCF's 預測與折現 inputs: ChatGPT or Claude (with web search) judges the five
 * assumptions for one company, each with a one-line reason. Asked only when the user presses the
 * button; kept in this browser for 7 days per symbol and model so reopening costs nothing.
 */
export type DcfAssumptionKey = 'growth' | 'years' | 'wacc' | 'terminalGrowth' | 'marginOfSafety';
export const dcfAssumptionKeys: readonly DcfAssumptionKey[] = ['growth', 'years', 'wacc', 'terminalGrowth', 'marginOfSafety'];
export type DcfAiSuggestion = {
  symbol: string;
  values: Record<DcfAssumptionKey, number>;
  reasons: Record<DcfAssumptionKey, string>;
  summary: string;
  provider: AiProvider;
  model: string;
  asOf: string;
  sources: Array<{ url: string; title: string }>;
};

/** AI prose without the citations ChatGPT inlines ("([sec.gov](https://…))"), bare links or markdown marks. */
export const plainAiText = (text: string) => text
  .replace(/\s*\(?\[[^\]]{0,120}\]\(https?:\/\/[^)\s]*\)\)?/g, '')
  .replace(/\s*\(?https?:\/\/\S+\)?/g, '')
  .replace(/\*\*/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

/** The calculator's own limits (percent figures); the server and the page both apply them. */
export function clampDcfAssumptions(input: Partial<Record<DcfAssumptionKey, number>>, japan: boolean): Record<DcfAssumptionKey, number> {
  const clamp = (value: number | undefined, low: number, high: number, fallback: number) => Number.isFinite(value) ? Math.min(high, Math.max(low, value as number)) : fallback;
  const round = (value: number) => Math.round(value * 10) / 10;
  const wacc = round(clamp(input.wacc, 4, 25, japan ? 7 : 9));
  return {
    growth: round(clamp(input.growth, -50, 50, japan ? 5 : 9)),
    years: Math.round(clamp(input.years, 3, 10, 5)),
    wacc,
    terminalGrowth: round(clamp(input.terminalGrowth, -2, Math.min(3.5, wacc - 1), japan ? 1 : 2.5)),
    marginOfSafety: Math.round(clamp(input.marginOfSafety, 0, 90, 20)),
  };
}

const cacheKey = 'optionflow-dcf-ai';
const keepMs = 7 * 86_400_000;
type Saved = Record<string, { at: number; suggestion: DcfAiSuggestion }>;
const readSaved = (): Saved => { try { return JSON.parse(window.localStorage.getItem(cacheKey) ?? '{}') as Saved; } catch { return {}; } };
const entryKey = (symbol: string, provider: AiProvider, model: string) => `${symbol.toUpperCase()}|${provider}|${model}`;

/** A suggestion for this symbol from the last 7 days (any model when none is named). */
export function savedDcfSuggestion(symbol: string, provider?: AiProvider, model?: string): DcfAiSuggestion | null {
  const saved = readSaved();
  const now = Date.now();
  const matches = Object.entries(saved).filter(([key, entry]) => now - entry.at < keepMs && (provider && model !== undefined ? key === entryKey(symbol, provider, model) : key.startsWith(`${symbol.toUpperCase()}|`)));
  return matches.sort((a, b) => b[1].at - a[1].at)[0]?.[1].suggestion ?? null;
}

function saveSuggestion(suggestion: DcfAiSuggestion, requested: string) {
  try {
    const now = Date.now();
    const saved = Object.fromEntries(Object.entries(readSaved()).filter(([, entry]) => now - entry.at < keepMs).slice(-40));
    saved[entryKey(suggestion.symbol, suggestion.provider, requested)] = { at: now, suggestion };
    window.localStorage.setItem(cacheKey, JSON.stringify(saved));
  } catch { /* storage unavailable */ }
}

export async function askDcfAssumptions(symbol: string, ai: AiEntryContext, provider: AiProvider, fresh: boolean): Promise<DcfAiSuggestion> {
  // The requested model ('' lets the server choose) keys the browser's copy.
  const model = requestModel(provider, ai.openAiModel, ai.claudeModel) ?? '';
  if (!fresh) {
    const saved = savedDcfSuggestion(symbol, provider, model);
    if (saved) return saved;
  }
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aiKeyHeaders(ai.keys) },
      body: JSON.stringify({ task: 'dcf-assumptions', symbol, provider, model: model || undefined, usageTier: ai.usageTier, fresh }),
    });
    const payload = await response.json().catch(() => ({})) as { suggestion?: DcfAiSuggestion; error?: string };
    if (!response.ok || !payload.suggestion) throw new Error(payload.error ?? `AI 判斷失敗（${response.status}），請稍後再試。`);
    saveSuggestion(payload.suggestion, model);
    return payload.suggestion;
  } finally {
    ai.onUsed();
  }
}
