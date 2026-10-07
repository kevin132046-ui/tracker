import { env } from 'cloudflare:workers';
import { normalizeTeamUrl, verifyAccess } from '@/lib/server/access';

/**
 * The routes that read or write the owner's data (trades, cash flows, uploaded art, settings) answer
 * only requests signed in through Cloudflare Access, once Access is configured (ACCESS_TEAM_DOMAIN and
 * ACCESS_AUD). A preview URL or path left outside the Access application then still cannot hand the
 * data out. Without Access configured (local development, a fresh clone) the routes stay open, as
 * before; DATA_ACCESS=open keeps them open on purpose.
 */
export async function dataGate(request: Request): Promise<Response | null> {
  if (String(env.DATA_ACCESS ?? '').trim().toLowerCase() === 'open') return null;
  const configured = Boolean(normalizeTeamUrl(env.ACCESS_TEAM_DOMAIN)) && String(env.ACCESS_AUD ?? '').split(',').some((value) => value.trim());
  if (!configured) return null;
  const access = await verifyAccess(request);
  if (access.ok) return null;
  return Response.json(
    { error: '需要先透過 Cloudflare Access 登入才能讀寫資料', code: access.code },
    { status: access.status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

type Handler = (request: Request, ...rest: never[]) => Response | Promise<Response>;

/** A route handler that runs only past dataGate. */
export function guarded<T extends Handler>(handler: T): T {
  return (async (request: Request, ...rest: never[]) => (await dataGate(request)) ?? handler(request, ...rest)) as T;
}
