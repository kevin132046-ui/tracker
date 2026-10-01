import type { DcfAiSuggestion, DcfAssumptionKey } from '@/lib/dcf-ai';
import { clampDcfAssumptions, dcfAssumptionKeys } from '@/lib/dcf-ai';
import type { AiProvider } from '@/lib/earnings';
import { exchangeTodayKey } from '@/lib/earnings';
import { askWithSearch } from '@/lib/server/company-ai';

/** Token estimate the free-quota check uses (web search results included). */
export const dcfLookupEstimate = 35_000;

function prompt(symbol: string, today: string) {
  const japan = symbol.endsWith('.T');
  const listing = japan ? `Tokyo Stock Exchange code ${symbol.slice(0, -2)}` : `US-listed ticker ${symbol}`;
  return [
    `You are setting the assumptions of a simple free-cash-flow DCF for ${listing}. Today is ${today}.`,
    'Search the web for: the last 3–5 years of free cash flow and revenue growth, analysts\' growth expectations, beta, debt, size and the business\'s risks.',
    japan ? 'Use Japanese market conditions (low risk-free rate and long-run growth).' : 'Use US market conditions (current 10-year Treasury yield as the risk-free rate).',
    'Judge these five numbers (percent figures as plain numbers: 9 means 9%):',
    '- growth: annual FCF growth over the forecast years (conservative, between the recent track record and analyst expectations);',
    '- years: forecast years, 3–10 (longer only for durable, still-growing businesses);',
    '- wacc: weighted average cost of capital, 4–25 (CAPM cost of equity with the beta, blended with after-tax cost of debt);',
    '- terminalGrowth: perpetual growth after the forecast, at most 3.5 and at least 1 below wacc;',
    '- marginOfSafety: 0–90 (higher for cyclical, indebted or hard-to-forecast companies).',
    'Reply with a single JSON object and nothing else:',
    '{"growth": 0, "years": 0, "wacc": 0, "terminalGrowth": 0, "marginOfSafety": 0,',
    ' "reasons": {"growth": "", "years": "", "wacc": "", "terminalGrowth": "", "marginOfSafety": ""},',
    ' "summary": ""}',
    'Each reason is one short sentence in Traditional Chinese naming the evidence (for example 近 3 年 FCF 年均成長 11%，分析師預估放緩). summary is one sentence in Traditional Chinese.',
  ].join('\n');
}

const text = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const num = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(/[%,\s]/g, '')) : NaN;
  if (!Number.isFinite(n)) return undefined;
  // A rate given as a fraction (0.09) instead of a percent (9).
  return Math.abs(n) > 0 && Math.abs(n) < 0.5 ? n * 100 : n;
};

export function suggestionFromAnswer(symbol: string, answer: string): Pick<DcfAiSuggestion, 'values' | 'reasons' | 'summary'> {
  const match = answer.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 回覆中找不到可讀的估值假設。');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error('AI 回覆的格式無法解析，請再試一次。');
  }
  const given = Object.fromEntries(dcfAssumptionKeys.map((key) => [key, key === 'years' ? (typeof raw.years === 'number' ? raw.years : Number(raw.years)) : num(raw[key])])) as Partial<Record<DcfAssumptionKey, number>>;
  if (dcfAssumptionKeys.filter((key) => Number.isFinite(given[key])).length < 3) throw new Error('AI 沒有給出足夠的估值假設，請再試一次。');
  const reasons = (raw.reasons && typeof raw.reasons === 'object' ? raw.reasons : {}) as Record<string, unknown>;
  return {
    values: clampDcfAssumptions(given, symbol.endsWith('.T')),
    reasons: Object.fromEntries(dcfAssumptionKeys.map((key) => [key, Number.isFinite(given[key]) ? text(reasons[key], 120) : '未提供，沿用預設'])) as Record<DcfAssumptionKey, string>,
    summary: text(raw.summary, 200),
  };
}

export async function judgeDcfAssumptions(provider: AiProvider, apiKey: string, model: string, symbol: string): Promise<{ suggestion: DcfAiSuggestion; usageTokens: number }> {
  const today = exchangeTodayKey(symbol, Date.now());
  const answer = await askWithSearch(provider, apiKey, model, prompt(symbol, today), 5);
  return { suggestion: { symbol, ...suggestionFromAnswer(symbol, answer.text), provider, model: answer.model, asOf: today, sources: answer.sources }, usageTokens: answer.usageTokens };
}
