/**
 * Cross-site request forgery guard for the routes that change data or spend AI credit.
 *
 * Cloudflare Access signs the browser in with a cookie that, by default, is also sent on requests other
 * sites make (SameSite=None). Without this check a page on any other site could have the browser POST
 * to /api/trades/batch and change or delete trades while the owner is signed in. Browsers say where a
 * request comes from (Sec-Fetch-Site, or Origin in older ones); a write is accepted only from this site.
 */
const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The response for a write that another site sent, or null when the request may go on. */
export function crossSiteWrite(request: Request): Response | null {
  if (readOnlyMethods.has(request.method.toUpperCase())) return null;
  if (sameSite(request)) return null;
  return Response.json(
    { error: '這個操作只能從網站本身送出。', code: 'cross-site' },
    { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

function sameSite(request: Request) {
  const fetchSite = request.headers.get('Sec-Fetch-Site')?.trim().toLowerCase();
  // same-origin: a page of this site; none: typed or bookmarked by the user, never another site.
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = request.headers.get('Origin')?.trim();
  if (origin) {
    if (origin === 'null') return false;
    let host = '';
    try { host = new URL(origin).host; } catch { return false; }
    return host === new URL(request.url).host || host === request.headers.get('Host');
  }
  // Neither header: not a browser (curl, a script), so there is no signed-in browser session to borrow.
  return true;
}
