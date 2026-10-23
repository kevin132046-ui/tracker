import { env } from 'cloudflare:workers';
import { normalizeTeamUrl, verifyAccess } from '@/lib/server/access';
import { crossSiteWrite } from '@/lib/server/same-origin';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The routes that read or write the owner's data (trades, cash flows, uploaded art, settings) answer
 * only requests signed in through Cloudflare Access (ACCESS_TEAM_DOMAIN and ACCESS_AUD), and accept
 * writes only from the site's own pages (lib/server/same-origin). A preview URL or path left outside
 * the Access application then still cannot hand the data out.
 *
 * Without Access configured, only local development (localhost) stays open; anywhere else the data is
 * held back, so a deleted or renamed secret closes the routes instead of opening them.
 * DATA_ACCESS=open opens them on purpose (for example while an Access setting is being repaired).
 */
export async function dataGate(request: Request): Promise<Response | null> {
  const crossSite = crossSiteWrite(request);
  if (crossSite) return crossSite;
  if (String(env.DATA_ACCESS ?? '').trim().toLowerCase() === 'open') return null;
  const configured = Boolean(normalizeTeamUrl(env.ACCESS_TEAM_DOMAIN)) && String(env.ACCESS_AUD ?? '').split(',').some((value) => value.trim());
  if (!configured) {
    if (localHosts.has(new URL(request.url).hostname)) return null;
    return Response.json(
      { error: '伺服器尚未設定 Cloudflare Access（ACCESS_TEAM_DOMAIN、ACCESS_AUD），資料暫不開放。', code: 'access-not-configured' },
      { status: 503, headers: noStore },
    );
  }
  const access = await verifyAccess(request);
  if (access.ok) return null;
  return Response.json(
    { error: '需要先透過 Cloudflare Access 登入才能讀寫資料', code: access.code, ...(access.failure ? { check: access.failure } : {}) },
    { status: access.status, headers: noStore },
  );
}

type Handler = (request: Request, ...rest: never[]) => Response | Promise<Response>;

/** A route handler that runs only past dataGate. */
export function guarded<T extends Handler>(handler: T): T {
  return (async (request: Request, ...rest: never[]) => (await dataGate(request)) ?? handler(request, ...rest)) as T;
}
