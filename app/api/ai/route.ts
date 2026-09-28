import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import type { AiEarningsSuggestion, AiProvider } from '@/lib/earnings';
import type { FilingExchange, QuarterRow } from '@/lib/filings';
import { cleanQuestions, maxFollowUps, maxQuestionLength } from '@/lib/filings';
import { verifyAccess } from '@/lib/server/access';
import { anthropicModel, findEarningsDate, openAiModelPattern } from '@/lib/server/ai-earnings';
import { analyzeFiling, answerFilingQuestion, type FilingContext } from '@/lib/server/filing-analysis';
import { SecNotConfigured, filingText, findFiling, isAccession, lookupCik, quarterlyFigures } from '@/lib/server/sec';

export const dynamic = 'force-dynamic';

const symbolPattern = /^[A-Z0-9.-]{1,15}$/;
// Keys typed into the browser: printable, no spaces, bounded. Never logged or stored here.
const apiKeyPattern = /^[\x21-\x7e]{20,300}$/;
// The same question within a few hours returns the earlier answer instead of paying again.
const answerFreshMs = 6 * 60 * 60_000;
const answerCache = new Map<string, { suggestion: AiEarningsSuggestion; fetchedAt: number }>();
const pending = new Map<string, Promise<AiEarningsSuggestion>>();
const analysisForms = new Set(['8-K', '8-K/A', '10-Q', '10-K']);

const accessMessages = {
  'access-not-configured': '伺服器尚未設定 Cloudflare Access（ACCESS_TEAM_DOMAIN、ACCESS_AUD），AI 查詢已停用。',
  'access-required': '需要先通過 Cloudflare Access 登入。',
  'access-invalid': 'Cloudflare Access 登入已失效，請重新整理頁面再登入。',
} as const;

const noStore = { 'Cache-Control': 'no-store' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });
const providerName = (provider: AiProvider) => provider === 'anthropic' ? 'Claude' : 'ChatGPT';

/** A key sent from the browser wins over the Worker secret. */
function apiKeyFor(request: Request, provider: AiProvider) {
  const header = request.headers.get(provider === 'anthropic' ? 'X-Anthropic-Key' : 'X-OpenAI-Key')?.trim() ?? '';
  if (header) return apiKeyPattern.test(header) ? header : null;
  return (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ?? null;
}

export async function GET(request: Request) {
  const access = await verifyAccess(request);
  if (!access.ok) return NextResponse.json({ error: accessMessages[access.code], code: access.code }, { status: access.status, headers: noStore });
  return NextResponse.json({
    email: access.email,
    providers: { anthropic: Boolean(env.ANTHROPIC_API_KEY), openai: Boolean(env.OPENAI_API_KEY) },
    anthropicModel,
    openAiModel: env.OPENAI_MODEL && openAiModelPattern.test(env.OPENAI_MODEL) ? env.OPENAI_MODEL : null,
    sec: Boolean(env.SEC_CONTACT),
  }, { headers: noStore });
}

type Body = { task?: unknown; symbol?: unknown; provider?: unknown; model?: unknown; accession?: unknown; questions?: unknown; history?: unknown; question?: unknown };

async function filingContext(symbol: string, accession: string): Promise<FilingContext | string> {
  const company = await lookupCik(symbol);
  if (!company) return '找不到這個代號在 SEC 的公司資料。';
  const filing = await findFiling(company.cik, accession);
  if (!filing || !analysisForms.has(filing.form)) return '這份文件不是這家公司最近的財報申報。';
  const document = await filingText(company.cik, accession, filing.primaryDocument);
  // XBRL figures are a supplement; the analysis still runs without them.
  const figures: QuarterRow[] = await quarterlyFigures(company.cik).catch(() => []);
  return { symbol, company: company.name, form: filing.form, filed: filing.filed, documentUrl: document.url, text: document.text, truncated: document.truncated, figures };
}

function cleanHistory(value: unknown): FilingExchange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).flatMap((entry) => {
    const exchange = entry as Partial<FilingExchange>;
    return typeof exchange.question === 'string' && typeof exchange.answer === 'string'
      ? [{ question: exchange.question.slice(0, maxQuestionLength * 2), answer: exchange.answer.slice(0, 4000), provider: exchange.provider === 'anthropic' ? 'anthropic' : 'openai', model: String(exchange.model ?? '').slice(0, 64), at: Number(exchange.at) || 0 } as FilingExchange]
      : [];
  });
}

export async function POST(request: Request) {
  const access = await verifyAccess(request);
  if (!access.ok) return NextResponse.json({ error: accessMessages[access.code], code: access.code }, { status: access.status, headers: noStore });

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return fail('請求格式錯誤。', 400);
  }
  const task = body.task;
  if (task !== 'earnings-date' && task !== 'earnings-analysis' && task !== 'filing-question') return fail('不支援的查詢類型。', 400);
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!symbolPattern.test(symbol)) return fail('無效的股票代號。', 400);
  const provider: AiProvider | null = body.provider === 'anthropic' || body.provider === 'openai' ? body.provider : null;
  if (!provider) return fail('請選擇 Claude 或 ChatGPT。', 400);

  const apiKey = apiKeyFor(request, provider);
  if (apiKey === null) return fail(request.headers.has(provider === 'anthropic' ? 'X-Anthropic-Key' : 'X-OpenAI-Key') ? `設定中的 ${providerName(provider)} 金鑰格式不正確。` : `尚未設定 ${providerName(provider)} 金鑰：請在「AI 設定」輸入，或在伺服器設定 ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}。`, 503);
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  const openAiModel = requestedModel || env.OPENAI_MODEL || '';
  if (provider === 'openai' && !openAiModelPattern.test(openAiModel)) return fail('請先在設定中填入 ChatGPT 模型名稱。', 400);

  if (task === 'earnings-date') {
    const key = `${provider}:${provider === 'openai' ? openAiModel : anthropicModel}:${symbol}`;
    const cached = answerCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < answerFreshMs) return NextResponse.json({ suggestion: cached.suggestion, cached: true }, { headers: noStore });
    try {
      let lookup = pending.get(key);
      if (!lookup) {
        lookup = findEarningsDate(provider, symbol, { [provider]: apiKey }, openAiModel).finally(() => pending.delete(key));
        pending.set(key, lookup);
      }
      const suggestion = await lookup;
      answerCache.set(key, { suggestion, fetchedAt: Date.now() });
      return NextResponse.json({ suggestion, cached: false }, { headers: noStore });
    } catch (error) {
      console.warn(`AI earnings lookup failed (${provider} ${symbol}):`, error instanceof Error ? error.message : error);
      return fail(`${providerName(provider)} 查詢失敗，請稍後再試。`, 502);
    }
  }

  // Filing analysis and follow-up questions.
  if (symbol.endsWith('.T')) return fail('日股沒有 SEC 財報，暫不支援。', 400);
  const accession = String(body.accession ?? '');
  if (!isAccession(accession)) return fail('無效的 SEC 文件編號。', 400);
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, maxQuestionLength * 2) : '';
  const history = cleanHistory(body.history);
  if (task === 'filing-question' && !question) return fail('請輸入問題。', 400);
  if (task === 'filing-question' && Array.isArray(body.history) && body.history.length >= maxFollowUps) return fail(`每份財報最多追問 ${maxFollowUps} 次。`, 400);

  let context: FilingContext | string;
  try {
    context = await filingContext(symbol, accession);
  } catch (error) {
    if (error instanceof SecNotConfigured) return fail('伺服器尚未設定 SEC_CONTACT（SEC 要求的聯絡 Email），SEC 財報功能已停用。', 503);
    console.warn(`SEC filing read failed (${symbol} ${accession}):`, error instanceof Error ? error.message : error);
    return fail('暫時無法從 SEC 讀取這份財報，請稍後再試。', 502);
  }
  if (typeof context === 'string') return fail(context, 404);

  try {
    const result = task === 'earnings-analysis'
      ? await analyzeFiling(provider, apiKey, openAiModel, context, cleanQuestions(body.questions))
      : await answerFilingQuestion(provider, apiKey, openAiModel, context, history, question);
    return NextResponse.json({
      provider,
      model: result.model,
      text: result.text,
      form: context.form,
      filed: context.filed,
      documentUrl: context.documentUrl,
      truncated: context.truncated,
      figures: context.figures,
    }, { headers: noStore });
  } catch (error) {
    console.warn(`Filing ${task} failed (${provider} ${symbol}):`, error instanceof Error ? error.message : error);
    return fail(`${providerName(provider)} 產生失敗，請稍後再試。`, 502);
  }
}
