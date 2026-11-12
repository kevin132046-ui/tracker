import { NextResponse } from 'next/server';
import { cleanModelRoles } from '@/lib/ai-model-roles';
import { ensureDatabase } from '@/lib/server/database';
import { guarded } from '@/lib/server/data-gate';
import { readModelRoles, writeModelRoles } from '@/lib/server/ai-model-roles-store';

export const dynamic = 'force-dynamic';

/**
 * The ChatGPT model for each role (lib/ai-model-roles): GET reads it, PUT { chat, lookup } replaces it
 * (an empty name means the server default). Owner's settings, so behind the data gate.
 */
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

async function handleGET() {
  try {
    return NextResponse.json({ roles: await readModelRoles(await ensureDatabase()) }, { headers: noStore });
  } catch {
    return fail('暫時讀不到模型設定。', 500);
  }
}

async function handlePUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('請求格式錯誤。', 400);
  }
  try {
    return NextResponse.json({ roles: await writeModelRoles(await ensureDatabase(), cleanModelRoles(body)) }, { headers: noStore });
  } catch {
    return fail('模型設定沒有存成功，請稍後再試。', 500);
  }
}

export const GET = guarded(handleGET);
export const PUT = guarded(handlePUT);
