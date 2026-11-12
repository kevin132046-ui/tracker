import { NextResponse } from 'next/server';
import { ensureDatabase } from '@/lib/server/database';
import { guarded } from '@/lib/server/data-gate';
import { maxExposurePrefsBytes, readExposurePrefs, writeExposurePrefs } from '@/lib/server/exposure-prefs-store';

export const dynamic = 'force-dynamic';

/**
 * The 持倉風險 panel's themes, custom events and cash-like list (lib/exposure-prefs): GET reads the
 * shared record (null when none was saved yet), PUT replaces the parts it names. Owner's settings, so
 * behind the data gate.
 */
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

async function handleGET() {
  try {
    return NextResponse.json({ prefs: await readExposurePrefs(await ensureDatabase()) }, { headers: noStore });
  } catch {
    return fail('暫時讀不到持倉風險的設定。', 500);
  }
}

async function handlePUT(request: Request) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > maxExposurePrefsBytes) return fail('設定內容太大。', 413);
    body = JSON.parse(text);
  } catch {
    return fail('請求格式錯誤。', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('請求格式錯誤。', 400);
  try {
    return NextResponse.json({ prefs: await writeExposurePrefs(await ensureDatabase(), body) }, { headers: noStore });
  } catch {
    return fail('持倉風險的設定沒有存成功，請稍後再試。', 500);
  }
}

export const GET = guarded(handleGET);
export const PUT = guarded(handlePUT);
