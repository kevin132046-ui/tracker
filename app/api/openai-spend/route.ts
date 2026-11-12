import { NextResponse } from 'next/server';
import { cleanBalance, estimateBalance, summarizeSpend } from '@/lib/openai-spend';
import { aiGate, openAiUsageScope } from '@/lib/server/ai-gate';
import { ensureDatabase } from '@/lib/server/database';
import { guarded } from '@/lib/server/data-gate';
import { readBalance, readCosts, writeBalance } from '@/lib/server/openai-spend-store';

export const dynamic = 'force-dynamic';

/**
 * What the OpenAI account paid today and this month (Costs API, admin key), and the prepaid balance
 * estimate: GET reads both; PUT { amount } records the balance as of now; DELETE forgets it.
 */
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

async function report(request: Request) {
  const db = await ensureDatabase();
  const saved = await readBalance(db);
  const now = Date.now();
  try {
    const scope = await openAiUsageScope(request, await aiGate(request));
    const spend = summarizeSpend(await readCosts(scope, now, saved?.at ?? null), now, saved?.at ?? null);
    return NextResponse.json({ spend, costsError: null, saved, balance: estimateBalance(saved, spend.sinceBalance) }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ spend: null, costsError: error instanceof Error ? error.message : '讀不到 OpenAI 費用。', saved, balance: null }, { headers: noStore });
  }
}

async function handleGET(request: Request) {
  try {
    return await report(request);
  } catch {
    return fail('暫時讀不到費用資料。', 500);
  }
}

async function handlePUT(request: Request) {
  let body: { amount?: unknown };
  try {
    body = await request.json() as { amount?: unknown };
  } catch {
    return fail('請求格式錯誤。', 400);
  }
  const value = cleanBalance(body.amount);
  if (typeof value === 'string') return fail(value, 400);
  try {
    await writeBalance(await ensureDatabase(), value);
    return await report(request);
  } catch {
    return fail('餘額沒有存成功，請稍後再試。', 500);
  }
}

async function handleDELETE(request: Request) {
  try {
    await writeBalance(await ensureDatabase(), null);
    return await report(request);
  } catch {
    return fail('餘額沒有清除成功，請稍後再試。', 500);
  }
}

export const GET = guarded(handleGET);
export const PUT = guarded(handlePUT);
export const DELETE = guarded(handleDELETE);
