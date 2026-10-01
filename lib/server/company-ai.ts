import Anthropic from '@anthropic-ai/sdk';
import { claudeExtras, claudeWebSearch, openAiReasoning } from '@/lib/ai-models';
import type { AiCompanyPayload } from '@/lib/company-ai';
import type { AiProvider } from '@/lib/earnings';
import { exchangeTodayKey } from '@/lib/earnings';
import { parseDateKey } from '@/lib/market-calendar';
import { cleanSources } from '@/lib/server/ai-earnings';

/**
 * Company figures from ChatGPT or Claude with web search, for when Yahoo has nothing for a symbol.
 * The model answers in a fixed JSON shape (money in millions); every value is checked here and
 * anything unusable becomes null, never a guess. Ratios are worked out here from the raw figures,
 * the same way /api/company does, so the panels can show the answer as they show Yahoo's.
 */
/** Token estimate the free-quota check uses (web search results included). */
export const companyLookupEstimate = 45_000;
const requestTimeoutMs = 150_000;
const maxPauseResumes = 3;

function prompt(symbol: string, today: string) {
  const japan = symbol.endsWith('.T');
  const listing = japan ? `Tokyo Stock Exchange code ${symbol.slice(0, -2)}` : `US-listed ticker ${symbol}`;
  return [
    `Look up the latest reported financial figures for ${listing}. Today is ${today}.`,
    japan
      ? 'Search the web. Prefer the company\'s latest 決算短信 (TDnet), securities report (EDINET) or investor-relations pages.'
      : 'Search the web. Prefer the company\'s latest 10-Q / 10-K on SEC EDGAR or its investor-relations earnings release.',
    'For the share price and market capitalisation use a recent quote from a major financial site.',
    'TTM means the sum of the last four reported quarters. Give money in MILLIONS of the reporting currency (281724 means 281.724 billion) and share counts in MILLIONS.',
    'Reply with a single JSON object and nothing else:',
    '{"name": company name, "currency": "USD" or "JPY", "price": latest share price, "price_date": "YYYY-MM-DD",',
    ' "market_cap_m", "shares_diluted_m" (weighted-average diluted shares),',
    ' "revenue_ttm_m", "net_income_ttm_m", "operating_income_ttm_m", "operating_cash_flow_ttm_m", "capex_ttm_m" (as a positive number), "free_cash_flow_ttm_m", "sbc_ttm_m" (stock-based compensation),',
    ' "cash_and_st_investments_m", "total_debt_m" (both from the latest balance sheet),',
    ' "revenue_growth_yoy", "earnings_growth_yoy" (latest quarter against the same quarter a year earlier, as decimals: 0.12 = 12%),',
    ' "pe_ttm", "pe_forward", "price_to_book", "ev_to_ebitda",',
    ' "dividend_per_share_annual", "latest_dividend_date": "YYYY-MM-DD", "latest_dividend_amount",',
    ' "fiscal_period_end": "YYYY-MM-DD" (end of the latest quarter these figures come from),',
    ' "annual": up to the last 5 fiscal years, oldest first: [{"fiscal_year_end": "YYYY-MM-DD", "revenue_m", "net_income_m", "operating_income_m", "operating_cash_flow_m", "free_cash_flow_m"}],',
    ' "note": one short sentence in Traditional Chinese on where the figures come from}',
    'Use null for anything you cannot find. Never estimate or invent a number you did not find in a source.',
  ].join('\n');
}

type Raw = Record<string, unknown>;
type Series = Array<{ date: string; value: number }>;

const number = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.replace(/[,$¥\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const millions = (value: unknown) => { const n = number(value); return n === null ? null : n * 1e6; };
const dateOf = (value: unknown) => typeof value === 'string' && parseDateKey(value) ? value : null;
const positive = (value: number | null) => value !== null && value > 0 ? value : null;
const ratio = (numerator: number | null, denominator: number | null) => numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
/** A growth given as 12 (percent) instead of 0.12; growth beyond ±300% is taken as a percent figure. */
const growth = (value: unknown) => { const n = number(value); return n === null ? null : Math.abs(n) > 3 ? n / 100 : n; };
/** Multiples outside a sane band are dropped rather than shown. */
const multiple = (value: unknown, low: number, high: number) => { const n = number(value); return n !== null && n >= low && n <= high ? n : null; };

/** Reads the model's JSON into the /api/company shape; throws when the reply has no usable object. */
export function companyFromAnswer(symbol: string, text: string, info: Omit<AiCompanyPayload['ai'], 'asOf' | 'priceDate' | 'note'>): AiCompanyPayload {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 回覆中找不到可讀的財務資料。');
  let raw: Raw;
  try {
    raw = JSON.parse(match[0]) as Raw;
  } catch {
    throw new Error('AI 回覆的資料格式無法解析，請再試一次。');
  }
  const japan = symbol.endsWith('.T');
  const currency = raw.currency === 'JPY' || (japan && raw.currency !== 'USD') ? 'JPY' : 'USD';
  const price = positive(number(raw.price));
  const dilutedShares = positive(millions(raw.shares_diluted_m));
  // Market cap from price × shares when the model's figure is missing or disagrees by more than half.
  const implied = price !== null && dilutedShares !== null ? price * dilutedShares : null;
  const statedCap = positive(millions(raw.market_cap_m));
  const marketCap = statedCap !== null && (implied === null || (statedCap / implied > 0.5 && statedCap / implied < 1.5)) ? statedCap : implied;
  const revenue = millions(raw.revenue_ttm_m);
  const netIncome = millions(raw.net_income_ttm_m);
  const operatingIncome = millions(raw.operating_income_ttm_m);
  const operatingCashFlow = millions(raw.operating_cash_flow_ttm_m);
  const capex = millions(raw.capex_ttm_m);
  const statedFcf = millions(raw.free_cash_flow_ttm_m);
  const freeCashFlow = statedFcf ?? (operatingCashFlow !== null && capex !== null ? operatingCashFlow - Math.abs(capex) : null);
  const sbc = millions(raw.sbc_ttm_m);
  const cash = millions(raw.cash_and_st_investments_m);
  const debt = millions(raw.total_debt_m);
  const adjustedFreeCashFlow = freeCashFlow === null ? null : freeCashFlow - (sbc ?? 0);
  const dividendPerShare = number(raw.dividend_per_share_annual);
  const dividendsPaid = dividendPerShare !== null && dividendPerShare > 0 && dilutedShares !== null ? dividendPerShare * dilutedShares : null;

  const annualRows = (Array.isArray(raw.annual) ? raw.annual : []).flatMap((row) => {
    const item = row as Raw;
    const date = dateOf(item?.fiscal_year_end);
    return date ? [{ date, item }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  const series = (field: string): Series => annualRows.flatMap(({ date, item }) => { const value = millions(item[field]); return value === null ? [] : [{ date, value }]; });
  const combine = (left: Series, right: Series, calculate: (a: number, b: number) => number | null): Series => {
    const byDate = new Map(right.map((point) => [point.date, point.value]));
    return left.flatMap((point) => { const other = byDate.get(point.date); const value = other === undefined ? null : calculate(point.value, other); return value === null || !Number.isFinite(value) ? [] : [{ date: point.date, value }]; });
  };
  const annualRevenue = series('revenue_m');
  const annualNetIncome = series('net_income_m');
  const annualOperatingIncome = series('operating_income_m');

  return {
    symbol,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : symbol,
    currency,
    exchange: japan ? '東京證券交易所' : '',
    instrumentType: 'EQUITY',
    price,
    updatedAt: new Date().toISOString(),
    metrics: {
      marketCap,
      trailingPe: multiple(raw.pe_ttm, -5000, 5000),
      forwardPe: multiple(raw.pe_forward, -5000, 5000),
      priceToSales: ratio(marketCap, revenue !== null && revenue > 0 ? revenue : null),
      evToEbitda: multiple(raw.ev_to_ebitda, -5000, 5000),
      priceToBook: multiple(raw.price_to_book, -1000, 1000),
      freeCashFlow,
      quarterlyFreeCashFlow: null,
      freeCashFlowYield: ratio(freeCashFlow, marketCap),
      adjustedFreeCashFlow,
      adjustedFreeCashFlowYield: ratio(adjustedFreeCashFlow, marketCap),
      stockBasedCompensation: sbc,
      stockBasedCompensationImpact: freeCashFlow === null || freeCashFlow === 0 || sbc === null ? null : -sbc / Math.abs(freeCashFlow),
      profitMargin: ratio(netIncome, revenue),
      operatingMargin: ratio(operatingIncome, revenue),
      quarterlyEarningsGrowth: growth(raw.earnings_growth_yoy),
      quarterlyRevenueGrowth: growth(raw.revenue_growth_yoy),
      cash,
      debt,
      netCash: cash === null || debt === null ? null : cash - debt,
      dividendYield: dividendPerShare !== null && dividendPerShare >= 0 && price !== null ? dividendPerShare / price : null,
      payoutRatio: netIncome === null || netIncome <= 0 ? null : ratio(dividendsPaid, netIncome),
      latestDividendDate: dateOf(raw.latest_dividend_date),
      latestDividendAmount: positive(number(raw.latest_dividend_amount)),
      dilutedShares,
    },
    history: {
      quarterly: {},
      annual: {
        revenue: annualRevenue,
        netIncome: annualNetIncome,
        operatingIncome: annualOperatingIncome,
        operatingCashFlow: series('operating_cash_flow_m'),
        freeCashFlow: series('free_cash_flow_m'),
        profitMargin: combine(annualNetIncome, annualRevenue, (income, sales) => sales === 0 ? null : income / sales),
        operatingMargin: combine(annualOperatingIncome, annualRevenue, (income, sales) => sales === 0 ? null : income / sales),
      },
    },
    ai: {
      ...info,
      asOf: dateOf(raw.fiscal_period_end),
      priceDate: dateOf(raw.price_date),
      note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
    },
  };
}

export type SearchAnswer = { text: string; sources: Array<{ url: string; title: string }>; model: string; usageTokens: number };

async function askClaude(apiKey: string, model: string, question: string, maxSearches: number): Promise<SearchAnswer> {
  const client = new Anthropic({ apiKey, timeout: requestTimeoutMs, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question }];
  let response: Anthropic.Beta.BetaMessage | null = null;
  // Web search runs server-side; a long search can pause and is resumed by sending the turn back.
  for (let attempt = 0; attempt <= maxPauseResumes; attempt += 1) {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      ...claudeExtras(model),
      output_config: { effort: 'medium' },
      tools: [{ type: claudeWebSearch(model), name: 'web_search', max_uses: maxSearches }],
      messages,
    });
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  if (!response) throw new Error('Claude 沒有回覆。');
  if (response.stop_reason === 'refusal') throw new Error('Claude 拒絕了這次查詢。');
  if (response.stop_reason === 'pause_turn') throw new Error('搜尋時間過長，請稍後再試。');
  // Claude splits text at each citation, sometimes inside a JSON string: join without separators.
  const text = response.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('');
  const sources = response.content.flatMap((block) => {
    if (block.type === 'text') return (block.citations ?? []).flatMap((citation) => citation.type === 'web_search_result_location' ? [{ url: citation.url, title: citation.title }] : []);
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) return block.content.map((result) => ({ url: result.url, title: result.title }));
    return [];
  });
  return { text, sources: cleanSources(sources), model: response.model, usageTokens: 0 };
}

type OpenAiContent = { type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> };
type OpenAiResponse = { model?: string; status?: string; output?: Array<{ type?: string; content?: OpenAiContent[] }>; usage?: { total_tokens?: number } | null; error?: { message?: string } | null };

async function askChatGpt(apiKey: string, model: string, question: string): Promise<SearchAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: question, tools: [{ type: 'web_search', search_context_size: 'medium' }], ...openAiReasoning(model, 6000) }),
      signal: controller.signal,
    });
    const payload = await response.json() as OpenAiResponse;
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}: ${payload.error?.message ?? 'request failed'}`.slice(0, 300));
    const parts = (payload.output ?? []).flatMap((item) => item.type === 'message' ? item.content ?? [] : []).filter((part) => part.type === 'output_text');
    const text = parts.map((part) => part.text ?? '').join('\n');
    if (!text.trim()) throw new Error(payload.status === 'incomplete' ? '回覆在完成前被截斷，請再試一次。' : 'ChatGPT 沒有回覆內容。');
    const sources = parts.flatMap((part) => (part.annotations ?? []).filter((annotation) => annotation.type === 'url_citation').map((annotation) => ({ url: annotation.url, title: annotation.title })));
    return { text, sources: cleanSources(sources), model: payload.model ?? model, usageTokens: payload.usage?.total_tokens ?? 0 };
  } finally {
    clearTimeout(timeout);
  }
}

/** A question answered by ChatGPT or Claude with web search: the reply text, its sources and the tokens used. */
export function askWithSearch(provider: AiProvider, apiKey: string, model: string, question: string, maxSearches = 6) {
  return provider === 'anthropic' ? askClaude(apiKey, model, question, maxSearches) : askChatGpt(apiKey, model, question);
}

/** The figures, plus the tokens a ChatGPT call used (for the free-quota record). */
export async function findCompanyFigures(provider: AiProvider, apiKey: string, model: string, symbol: string): Promise<{ company: AiCompanyPayload; usageTokens: number }> {
  const today = exchangeTodayKey(symbol, Date.now());
  const answer = await askWithSearch(provider, apiKey, model, prompt(symbol, today));
  return { company: companyFromAnswer(symbol, answer.text, { provider, model: answer.model, sources: answer.sources }), usageTokens: answer.usageTokens };
}
