import { env } from 'cloudflare:workers';
import type { AiProvider } from '@/lib/earnings';
import { verifyAccess, type AccessResult } from '@/lib/server/access';
import { usageScope } from '@/lib/server/openai-quota';

/**
 * Who may use the AI routes, and with which keys.
 * - access: signed in through Cloudflare Access. The Worker's own keys (secrets) may be used.
 * - byok ("bring your own key"): no Access sign-in. Only keys typed into the browser are used,
 *   never the Worker's secrets, and requests are rate-limited per IP.
 */
export type AiGate =
  | { mode: 'access'; email: string | null }
  | { mode: 'byok'; access: Exclude<AccessResult, { ok: true }>['code'] };

// Keys typed into the browser: printable, no spaces, bounded. Never logged or stored here.
export const apiKeyPattern = /^[\x21-\x7e]{20,300}$/;

const keyHeader: Record<AiProvider, string> = { anthropic: 'X-Anthropic-Key', openai: 'X-OpenAI-Key' };
export const headerKey = (request: Request, name: string) => request.headers.get(name)?.trim() ?? '';

export async function aiGate(request: Request): Promise<AiGate> {
  const access = await verifyAccess(request);
  return access.ok ? { mode: 'access', email: access.email } : { mode: 'byok', access: access.code };
}

/**
 * The key for a provider: the browser's key wins; the Worker secret only behind Access.
 * null = no usable key; 'invalid' = the browser sent a malformed key.
 */
export function providerKey(request: Request, gate: AiGate, provider: AiProvider): string | null | 'invalid' {
  const typed = headerKey(request, keyHeader[provider]);
  if (typed) return apiKeyPattern.test(typed) ? typed : 'invalid';
  if (gate.mode !== 'access') return null;
  return (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY) ?? null;
}

/** Whose OpenAI usage the free-tier check reads: the browser's admin key, else (behind Access) the Worker's. */
export function openAiUsageScope(request: Request, gate: AiGate) {
  const typed = headerKey(request, 'X-OpenAI-Admin-Key');
  if (typed) return usageScope(apiKeyPattern.test(typed) ? typed : null);
  return usageScope(gate.mode === 'access' ? env.OPENAI_ADMIN_KEY : null);
}

/** Server keys usable by this request (for the settings status line). */
export const serverKeys = (gate: AiGate) => ({
  anthropic: gate.mode === 'access' && Boolean(env.ANTHROPIC_API_KEY),
  openai: gate.mode === 'access' && Boolean(env.OPENAI_API_KEY),
});

// A simple per-IP window for byok requests (per Worker isolate; enough to stop casual abuse).
const windowMs = 10 * 60_000;
const hits = new Map<string, number[]>();
export function byokLimited(request: Request, gate: AiGate, bucket: 'status' | 'ask' | 'models', limit: number) {
  if (gate.mode !== 'byok') return false;
  const ip = `${bucket}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`;
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= limit) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}
