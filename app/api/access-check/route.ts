import { NextResponse } from 'next/server';
import { verifyAccess } from '@/lib/server/access';

export const dynamic = 'force-dynamic';

/**
 * Whether this request's Cloudflare Access token passes the site's own check, and if not, which check
 * failed. Runs even with DATA_ACCESS=open, so a broken Access setting can be diagnosed while the data
 * routes are temporarily open. It returns no data and nothing secret (AUD tags appear in Access's own
 * login URLs; only their first 8 characters are shown).
 */
export async function GET(request: Request) {
  const access = await verifyAccess(request);
  const body = access.ok ? { ok: true } : { ok: false, code: access.code, ...(access.failure ? { check: access.failure } : {}) };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
