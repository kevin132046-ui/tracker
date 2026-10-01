import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { KeyCheck, KeyState, ModelDetection } from '@/lib/ai-models';
import { claudeDisplayName, openAiChatModel } from '@/lib/ai-models';
import { aiGate, apiKeyPattern, byokLimited, headerKey, providerKey } from '@/lib/server/ai-gate';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

/**
 * Checks the AI keys and lists the models each one can use. Listing models costs no tokens, so it
 * doubles as the key check: 401 = invalid, 403 = not allowed, 429 = rate or quota limited.
 * Keys from the browser win; the Worker's own keys are used only behind Cloudflare Access.
 */
const noStore = { 'Cache-Control': 'no-store' };
const timeoutMs = 8_000;
const freshMs = 10 * 60_000;
const cache = new Map<string, { check: KeyCheck; at: number }>();

const stateOf = (status: number): KeyState => status === 401 ? 'invalid' : status === 403 ? 'forbidden' : status === 429 ? 'limited' : 'error';
const messages: Record<KeyState, string> = {
  ok: '金鑰有效。',
  invalid: '金鑰無效（401）：請確認沒有複製錯，或到平台重新建立。',
  forbidden: '金鑰權限不足（403）：這把金鑰不能列出模型，請檢查它的權限設定。',
  limited: '額度或速率受限（429）：可能是帳戶餘額不足或請求太頻繁。',
  missing: '尚未設定金鑰。',
  error: '暫時無法確認，請稍後再試。',
};
const check = (state: KeyState, source: KeyCheck['source'], models: KeyCheck['models'] = [], message = messages[state]): KeyCheck => ({ state, source, message, models });

async function fingerprint(kind: string, key: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${key}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function cached(kind: string, key: string, refresh: boolean, run: () => Promise<KeyCheck>) {
  const id = await fingerprint(kind, key);
  const hit = cache.get(id);
  if (!refresh && hit && Date.now() - hit.at < freshMs) return hit.check;
  const result = await run();
  // Temporary failures are not kept, so the next check tries again.
  if (result.state !== 'error' && result.state !== 'limited') {
    if (cache.size > 200) cache.clear();
    cache.set(id, { check: result, at: Date.now() });
  }
  return result;
}

async function openAiGet(url: string, key: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkOpenAi(key: string, source: KeyCheck['source']): Promise<KeyCheck> {
  try {
    const response = await openAiGet('https://api.openai.com/v1/models', key);
    if (!response.ok) return check(stateOf(response.status), source);
    const { data = [] } = await response.json() as { data?: Array<{ id?: string; created?: number }> };
    const models = data.filter((model) => typeof model.id === 'string' && openAiChatModel(model.id))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((model) => ({ id: model.id!, label: model.id! }));
    return check('ok', source, models, `金鑰有效，可用 ${models.length} 個對話模型。`);
  } catch {
    return check('error', source);
  }
}

async function checkAnthropic(key: string, source: KeyCheck['source']): Promise<KeyCheck> {
  try {
    const client = new Anthropic({ apiKey: key, timeout: timeoutMs, maxRetries: 0 });
    const models: KeyCheck['models'] = [];
    for await (const model of client.models.list({ limit: 100 })) {
      models.push({ id: model.id, label: model.display_name || claudeDisplayName(model.id) });
      if (models.length >= 100) break;
    }
    return check('ok', source, models, `金鑰有效，可用 ${models.length} 個模型。`);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return check('invalid', source);
    if (error instanceof Anthropic.PermissionDeniedError) return check('forbidden', source);
    if (error instanceof Anthropic.RateLimitError) return check('limited', source);
    if (error instanceof Anthropic.APIError && error.status) return check(stateOf(error.status), source);
    return check('error', source);
  }
}

/** An admin key cannot call models; reading the organisation's projects shows whether it works. */
async function checkOpenAiAdmin(key: string, source: KeyCheck['source']): Promise<KeyCheck> {
  try {
    const response = await openAiGet('https://api.openai.com/v1/organization/projects?limit=1', key);
    if (!response.ok) return check(stateOf(response.status), source, [], response.status === 401 ? '管理金鑰無效（401）：這裡要填 OpenAI 的 Admin key（sk-admin-…），一般 API 金鑰不行。' : undefined);
    return check('ok', source, [], '管理金鑰有效，可讀取今日用量（免費額度檢查）。');
  } catch {
    return check('error', source);
  }
}

export async function GET(request: Request) {
  const gate = await aiGate(request);
  if (byokLimited(request, gate, 'models', 30)) return NextResponse.json({ error: '檢查太頻繁，請稍後再試。' }, { status: 429, headers: noStore });
  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  const sourceOf = (header: string, key: string | null) => key === null ? 'none' as const : headerKey(request, header) ? 'browser' as const : 'server' as const;

  const run = async (kind: 'openai' | 'anthropic', header: string, test: (key: string, source: KeyCheck['source']) => Promise<KeyCheck>) => {
    const key = providerKey(request, gate, kind);
    if (key === 'invalid') return check('invalid', 'browser', [], '金鑰格式不正確（不能有空白，長度 20–300 字元）。');
    if (key === null) return check('missing', 'none');
    return cached(kind, key, refresh, () => test(key, sourceOf(header, key)));
  };
  const adminTyped = headerKey(request, 'X-OpenAI-Admin-Key');
  const adminKey = adminTyped || (gate.mode === 'access' ? env.OPENAI_ADMIN_KEY ?? '' : '');
  const admin = !adminKey ? Promise.resolve(check('missing', 'none', [], '未設定管理金鑰：無法檢查 OpenAI 免費額度。'))
    : !apiKeyPattern.test(adminKey) ? Promise.resolve(check('invalid', 'browser', [], '管理金鑰格式不正確。'))
    : cached('openai-admin', adminKey, refresh, () => checkOpenAiAdmin(adminKey, adminTyped ? 'browser' : 'server'));

  const [openai, anthropic, openaiAdmin] = await Promise.all([
    run('openai', 'X-OpenAI-Key', checkOpenAi),
    run('anthropic', 'X-Anthropic-Key', checkAnthropic),
    admin,
  ]);
  const result: ModelDetection = { openai, anthropic, openaiAdmin, checkedAt: Date.now() };
  return NextResponse.json(result, { headers: noStore });
}
