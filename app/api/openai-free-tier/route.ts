import { NextResponse } from 'next/server';
import { ensureDatabase } from '@/lib/server/database';
import { guarded } from '@/lib/server/data-gate';
import { checkFreeTierText, readFreeTier, writeFreeTier, type StoredFreeTier } from '@/lib/server/openai-free-tier-store';

export const dynamic = 'force-dynamic';

/**
 * The OpenAI free-tier offer pasted from the data-sharing page (lib/server/openai-free-tier-store):
 * GET reads it, PUT { text } replaces it, DELETE removes it. Owner's data, so behind the data gate.
 */
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (value: StoredFreeTier | null) => NextResponse.json(
  { offer: value ? { text: value.text, savedAt: value.savedAt, status: value.parsed.status, groups: value.parsed.groups } : null },
  { headers: noStore },
);
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

async function handleGET() {
  try {
    return reply(await readFreeTier(await ensureDatabase()));
  } catch {
    return fail('暫時讀不到免費資格設定。', 500);
  }
}

async function handlePUT(request: Request) {
  let body: { text?: unknown };
  try {
    body = await request.json() as { text?: unknown };
  } catch {
    return fail('請求格式錯誤。', 400);
  }
  const value = checkFreeTierText(body.text);
  if (typeof value === 'string') return fail(value, 400);
  try {
    await writeFreeTier(await ensureDatabase(), value);
    return reply(value);
  } catch {
    return fail('免費資格沒有存成功，請稍後再試。', 500);
  }
}

async function handleDELETE() {
  try {
    await writeFreeTier(await ensureDatabase(), null);
    return reply(null);
  } catch {
    return fail('免費資格沒有清除成功，請稍後再試。', 500);
  }
}

export const GET = guarded(handleGET);
export const PUT = guarded(handlePUT);
export const DELETE = guarded(handleDELETE);
