import type { AiEntryContext } from '@/components/AiTradeEntry';
import { requestModel } from '@/lib/ai-models';
import type { AiProvider } from '@/lib/earnings';
import { aiKeyHeaders } from '@/lib/filings';

/** Where an AI-found set of company figures came from; shown with the figures as 「AI 查詢・請核對」. */
export type AiCompanyInfo = {
  provider: AiProvider;
  model: string;
  /** End of the latest reported quarter the figures come from. */
  asOf: string | null;
  priceDate: string | null;
  note: string;
  sources: Array<{ url: string; title: string }>;
};
type Series = Array<{ date: string; value: number }>;
/** The same shape as /api/company, so the fundamentals panel and the DCF tab can show it as is. */
export type AiCompanyPayload = {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  instrumentType: string;
  price: number | null;
  updatedAt: string;
  metrics: Record<string, number | string | null> & { freeCashFlow: number | null; dilutedShares: number | null; netCash: number | null };
  history: { quarterly: Record<string, Series>; annual: Record<string, Series> };
  ai: AiCompanyInfo;
};

export const companyAiProviderName = (provider: AiProvider) => provider === 'anthropic' ? 'Claude' : 'ChatGPT';

// Answers found in this visit, so the 基本面 and DCF tabs share one lookup instead of paying twice.
const found = new Map<string, AiCompanyPayload>();
export const cachedCompanyAi = (symbol: string) => found.get(symbol.toUpperCase()) ?? null;

/**
 * Asks ChatGPT or Claude (with web search, through /api/ai) for a company's latest figures when the
 * usual market-data source has none. Runs only when the user asks; the server checks the numbers.
 */
export async function askCompanyAi(symbol: string, ai: AiEntryContext, provider: AiProvider): Promise<AiCompanyPayload> {
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aiKeyHeaders(ai.keys) },
      body: JSON.stringify({ task: 'company-figures', symbol, provider, model: requestModel(provider, ai.openAiModel, ai.claudeModel), usageTier: ai.usageTier }),
    });
    const payload = await response.json().catch(() => ({})) as { company?: AiCompanyPayload; error?: string };
    if (!response.ok || !payload.company) throw new Error(payload.error ?? `${companyAiProviderName(provider)} 查詢失敗（${response.status}），請稍後再試。`);
    found.set(payload.company.symbol, payload.company);
    return payload.company;
  } finally {
    ai.onUsed();
  }
}
