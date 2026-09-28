import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import type { AiEarningsSuggestion, AiProvider } from '@/lib/earnings';
import { verifyAccess } from '@/lib/server/access';
import { anthropicModel, findEarningsDate, openAiModelPattern } from '@/lib/server/ai-earnings';

export const dynamic = 'force-dynamic';

const symbolPattern = /^[A-Z0-9.-]{1,15}$/;
// The same question within a few hours returns the earlier answer instead of paying again.
const answerFreshMs = 6 * 60 * 60_000;
const answerCache = new Map<string, { suggestion: AiEarningsSuggestion; fetchedAt: number }>();
const pending = new Map<string, Promise<AiEarningsSuggestion>>();

const accessMessages = {
  'access-not-configured': '伺服器尚未設定 Cloudflare Access（ACCESS_TEAM_DOMAIN、ACCESS_AUD），AI 查詢已停用。',
  'access-required': '需要先通過 Cloudflare Access 登入。',
  'access-invalid': 'Cloudflare Access 登入已失效，請重新整理頁面再登入。',
} as const;

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const access = await verifyAccess(request);
  if (!access.ok) return NextResponse.json({ error: accessMessages[access.code], code: access.code }, { status: access.status, headers: noStore });
  return NextResponse.json({
    email: access.email,
    providers: { anthropic: Boolean(env.ANTHROPIC_API_KEY), openai: Boolean(env.OPENAI_API_KEY) },
    anthropicModel,
    openAiModel: env.OPENAI_MODEL && openAiModelPattern.test(env.OPENAI_MODEL) ? env.OPENAI_MODEL : null,
  }, { headers: noStore });
}

export async function POST(request: Request) {
  const access = await verifyAccess(request);
  if (!access.ok) return NextResponse.json({ error: accessMessages[access.code], code: access.code }, { status: access.status, headers: noStore });

  let body: { task?: unknown; symbol?: unknown; provider?: unknown; model?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: '請求格式錯誤。' }, { status: 400, headers: noStore });
  }
  if (body.task !== 'earnings-date') return NextResponse.json({ error: '不支援的查詢類型。' }, { status: 400, headers: noStore });
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!symbolPattern.test(symbol)) return NextResponse.json({ error: '無效的股票代號。' }, { status: 400, headers: noStore });
  const provider: AiProvider | null = body.provider === 'anthropic' || body.provider === 'openai' ? body.provider : null;
  if (!provider) return NextResponse.json({ error: '請選擇 Claude 或 ChatGPT。' }, { status: 400, headers: noStore });

  const apiKey = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: `伺服器尚未設定 ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}。` }, { status: 503, headers: noStore });
  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  const openAiModel = requestedModel || env.OPENAI_MODEL || '';
  if (provider === 'openai' && !openAiModelPattern.test(openAiModel)) return NextResponse.json({ error: '請先在設定中填入 ChatGPT 模型名稱。' }, { status: 400, headers: noStore });

  const key = `${provider}:${provider === 'openai' ? openAiModel : anthropicModel}:${symbol}`;
  const cached = answerCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < answerFreshMs) return NextResponse.json({ suggestion: cached.suggestion, cached: true }, { headers: noStore });
  try {
    let lookup = pending.get(key);
    if (!lookup) {
      lookup = findEarningsDate(provider, symbol, { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY }, openAiModel)
        .finally(() => pending.delete(key));
      pending.set(key, lookup);
    }
    const suggestion = await lookup;
    answerCache.set(key, { suggestion, fetchedAt: Date.now() });
    return NextResponse.json({ suggestion, cached: false }, { headers: noStore });
  } catch (error) {
    console.warn(`AI earnings lookup failed (${provider} ${symbol}):`, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: `${provider === 'anthropic' ? 'Claude' : 'ChatGPT'} 查詢失敗，請稍後再試。` }, { status: 502, headers: noStore });
  }
}
