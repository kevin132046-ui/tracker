import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import type { AiEarningsSuggestion, AiProvider } from '@/lib/earnings';
import type { FilingExchange, QuarterRow } from '@/lib/filings';
import { cleanQuestions, maxFollowUps, maxQuestionLength } from '@/lib/filings';
import { verifyAccess } from '@/lib/server/access';
import type { UsageTier } from '@/lib/openai-free-tier';
import { estimateTokens } from '@/lib/openai-free-tier';
import { anthropicModel, dateLookupEstimate, findEarningsDate, openAiModelPattern } from '@/lib/server/ai-earnings';
import { claudeModels, resolveClaudeModel } from '@/lib/ai-models';
import type { OpenTradeHint } from '@/lib/ai-trade-entry';
import { maxEntryLength, maxOpenTradeHints } from '@/lib/ai-trade-entry';
import { parseEntryImage, parseTrades, tradeParseRequest } from '@/lib/server/trade-parse';
import { parseDateKey } from '@/lib/market-calendar';
import { maxAssistantQuestion } from '@/lib/ai-assistant';
import { chatRequest, cleanSnapshot, cleanTurns, completeChat } from '@/lib/server/portfolio-chat';
import { analysisRequest, completeFilingRequest, followUpRequest, type FilingContext } from '@/lib/server/filing-analysis';
import { checkOpenAiQuota, quotaReport, recordOpenAiUsage } from '@/lib/server/openai-quota';
import { SecNotConfigured, filingText, findFiling, isAccession, lookupCik, quarterlyFigures } from '@/lib/server/sec';

export const dynamic = 'force-dynamic';

const symbolPattern = /^[A-Z0-9.-]{1,15}$/;
// Keys typed into the browser: printable, no spaces, bounded. Never logged or stored here.
const apiKeyPattern = /^[\x21-\x7e]{20,300}$/;
// The same question within a few hours returns the earlier answer instead of paying again.
const answerFreshMs = 6 * 60 * 60_000;
const answerCache = new Map<string, { suggestion: AiEarningsSuggestion; fetchedAt: number }>();
const pending = new Map<string, Promise<{ suggestion: AiEarningsSuggestion; usageTokens: number }>>();
const analysisForms = new Set(['8-K', '8-K/A', '10-Q', '10-K']);

const accessMessages = {
  // A secret added in the dashboard only reaches versions built after it, hence the hint.
  'access-not-configured': '伺服器尚未設定 Cloudflare Access（ACCESS_TEAM_DOMAIN、ACCESS_AUD），AI 查詢已停用。剛在 Cloudflare 新增 Secret 的話，要等下一次部署或重新建置後才會生效。',
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

const tierOf = (value: unknown): UsageTier => value === 'high' ? 'high' : 'low';

export async function GET(request: Request) {
  const access = await verifyAccess(request);
  if (!access.ok) return NextResponse.json({ error: accessMessages[access.code], code: access.code }, { status: access.status, headers: noStore });
  const params = new URL(request.url).searchParams;
  const model = String(params.get('model') ?? '').trim();
  // Asked on every open of the AI settings and the analysis dialog, so the page always shows today's allowance.
  const quota = await quotaReport(openAiModelPattern.test(model) ? model : env.OPENAI_MODEL ?? '', tierOf(params.get('tier')));
  return NextResponse.json({
    quota,
    email: access.email,
    providers: { anthropic: Boolean(env.ANTHROPIC_API_KEY), openai: Boolean(env.OPENAI_API_KEY) },
    anthropicModel,
    claudeModels: claudeModels.map((model) => model.id),
    openAiModel: env.OPENAI_MODEL && openAiModelPattern.test(env.OPENAI_MODEL) ? env.OPENAI_MODEL : null,
    sec: Boolean(env.SEC_CONTACT),
  }, { headers: noStore });
}

type Body = { task?: unknown; symbol?: unknown; provider?: unknown; model?: unknown; accession?: unknown; questions?: unknown; history?: unknown; question?: unknown; usageTier?: unknown; text?: unknown; image?: unknown; today?: unknown; openTrades?: unknown; persona?: unknown; language?: unknown; snapshot?: unknown; turns?: unknown };

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

/** Open positions from the browser, trimmed to the fields the trade parser uses. */
function cleanOpenTrades(value: unknown): OpenTradeHint[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxOpenTradeHints).flatMap((item) => {
    const hint = item as Partial<OpenTradeHint>;
    const id = Number(hint?.id);
    const ticker = String(hint?.ticker ?? '').trim().toUpperCase();
    if (!Number.isInteger(id) || id < 1 || !symbolPattern.test(ticker)) return [];
    return [{
      id, ticker,
      kind: hint.kind === 'option' ? 'option' : 'stock',
      side: hint.side === 'sell' ? 'sell' : 'buy',
      right: hint.right === 'PUT' || hint.right === 'CALL' ? hint.right : null,
      strike: hint.strike ? String(hint.strike).slice(0, 30) : null,
      expiry: typeof hint.expiry === 'string' && parseDateKey(hint.expiry) ? hint.expiry : null,
      quantity: Math.max(0, Number(hint.quantity) || 0),
      openDate: typeof hint.openDate === 'string' && parseDateKey(hint.openDate) ? hint.openDate : '',
    } satisfies OpenTradeHint];
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
  if (task !== 'earnings-date' && task !== 'earnings-analysis' && task !== 'filing-question' && task !== 'parse-trades' && task !== 'portfolio-chat') return fail('不支援的查詢類型。', 400);
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (task !== 'parse-trades' && task !== 'portfolio-chat' && !symbolPattern.test(symbol)) return fail('無效的股票代號。', 400);
  const provider: AiProvider | null = body.provider === 'anthropic' || body.provider === 'openai' ? body.provider : null;
  if (!provider) return fail('請選擇 Claude 或 ChatGPT。', 400);

  const apiKey = apiKeyFor(request, provider);
  if (apiKey === null) return fail(request.headers.has(provider === 'anthropic' ? 'X-Anthropic-Key' : 'X-OpenAI-Key') ? `設定中的 ${providerName(provider)} 金鑰格式不正確。` : `尚未設定 ${providerName(provider)} 金鑰：請在「AI 設定」輸入，或在伺服器設定 ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}。`, 503);
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  const openAiModel = provider === 'openai' ? requestedModel || env.OPENAI_MODEL || '' : '';
  if (provider === 'openai' && !openAiModelPattern.test(openAiModel)) return fail('請先在設定中填入 ChatGPT 模型名稱。', 400);
  // Claude runs only the models on the list; anything else falls back to the default.
  const claudeModel = resolveClaudeModel(requestedModel);
  const model = provider === 'openai' ? openAiModel : claudeModel;
  const usageTier = tierOf(body.usageTier);
  // Every ChatGPT call must fit in today's free tokens for its model; otherwise it is refused.
  const guardQuota = async (estimate: number) => {
    if (provider !== 'openai') return null;
    const check = await checkOpenAiQuota(openAiModel, usageTier, estimate);
    return check.ok ? null : NextResponse.json({ error: check.message, code: 'free-quota', quota: check.report, estimate }, { status: 429, headers: noStore });
  };

  if (task === 'parse-trades') {
    const entry = typeof body.text === 'string' ? body.text.trim() : '';
    if (entry.length > maxEntryLength) return fail(`文字請在 ${maxEntryLength} 字以內。`, 400);
    const image = parseEntryImage(body.image);
    if (typeof image === 'string') return fail(image, 400);
    if (!entry && !image) return fail('請輸入交易內容或附上截圖。', 400);
    // The browser's local date, so 今天／昨天 mean the user's day; a bad value falls back to UTC.
    const today = typeof body.today === 'string' && parseDateKey(body.today) ? body.today : new Date().toISOString().slice(0, 10);
    const aiRequest = tradeParseRequest(entry, image, today, cleanOpenTrades(body.openTrades));
    const blocked = await guardQuota(aiRequest.estimate);
    if (blocked) return blocked;
    try {
      const result = await parseTrades(provider, apiKey, model, aiRequest);
      if (provider === 'openai') recordOpenAiUsage(result.model, result.usageTokens || aiRequest.estimate);
      return NextResponse.json({ provider, model: result.model, rows: result.rows, questions: result.questions }, { headers: noStore });
    } catch (error) {
      console.warn(`Trade parse failed (${provider} ${model}):`, error instanceof Error ? error.message : error);
      return fail(error instanceof Error && error.message.startsWith('AI ') ? `${providerName(provider)} 的回覆格式不正確，請再試一次或換個模型。` : `${providerName(provider)} 解析失敗，請稍後再試。`, 502);
    }
  }

  if (task === 'portfolio-chat') {
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return fail('請輸入問題。', 400);
    if (question.length > maxAssistantQuestion) return fail(`問題請在 ${maxAssistantQuestion} 字以內。`, 400);
    const snapshot = cleanSnapshot(body.snapshot);
    if (!snapshot) return fail('缺少持倉摘要。', 400);
    const persona = body.persona === 'kikyo' || body.persona === 'shigure' ? body.persona : 'neutral';
    const language = body.language === 'ja' || body.language === 'en' ? body.language : 'zh';
    const aiRequest = chatRequest(persona, language, snapshot, cleanTurns(body.turns), question);
    const estimate = estimateTokens(`${aiRequest.system}\n${aiRequest.portfolio}\n${aiRequest.turns.map((turn) => turn.text).join('\n')}\n${aiRequest.question}`) + aiRequest.maxOutput;
    const blocked = await guardQuota(estimate);
    if (blocked) return blocked;
    try {
      const result = await completeChat(provider, apiKey, model, aiRequest);
      if (provider === 'openai') recordOpenAiUsage(result.model, result.usageTokens || estimate);
      return NextResponse.json({ provider, model: result.model, text: result.text }, { headers: noStore });
    } catch (error) {
      console.warn(`Portfolio chat failed (${provider} ${model}):`, error instanceof Error ? error.message : error);
      return fail(`${providerName(provider)} 回覆失敗，請稍後再試。`, 502);
    }
  }

  if (task === 'earnings-date') {
    const key = `${provider}:${model}:${symbol}`;
    const cached = answerCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < answerFreshMs) return NextResponse.json({ suggestion: cached.suggestion, cached: true }, { headers: noStore });
    const blocked = await guardQuota(dateLookupEstimate);
    if (blocked) return blocked;
    try {
      let lookup = pending.get(key);
      if (!lookup) {
        lookup = findEarningsDate(provider, symbol, { [provider]: apiKey }, openAiModel, claudeModel).finally(() => pending.delete(key));
        pending.set(key, lookup);
        void lookup.then(({ suggestion: found, usageTokens }) => { if (provider === 'openai') recordOpenAiUsage(found.model, usageTokens || dateLookupEstimate); }, () => undefined);
      }
      const { suggestion } = await lookup;
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

  const aiRequest = task === 'earnings-analysis' ? analysisRequest(context, cleanQuestions(body.questions)) : followUpRequest(context, history, question);
  const estimate = estimateTokens(`${aiRequest.system}\n${aiRequest.document}\n${aiRequest.prompt}`) + aiRequest.maxOutput;
  const blocked = await guardQuota(estimate);
  if (blocked) return blocked;
  try {
    const result = await completeFilingRequest(provider, apiKey, model, aiRequest);
    if (provider === 'openai') recordOpenAiUsage(result.model, result.usageTokens || estimate);
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
