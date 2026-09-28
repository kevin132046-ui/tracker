/**
 * Yahoo Finance quoteSummary, which needs a consent cookie and a crumb issued for that cookie.
 * The session is shared by every caller in the isolate and renewed once when Yahoo rejects it.
 */
export type RequestBudget = { remaining: number };
type YahooSession = { cookie: string; crumb: string; fetchedAt: number };

const sessionFreshMs = 60 * 60_000;
const yahooTimeoutMs = 5_000;
const yahooHost = 'query2.finance.yahoo.com';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let yahooSession: YahooSession | null = null;
let sessionRequest: Promise<YahooSession> | null = null;

class CrumbRejected extends Error {}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), yahooTimeoutMs);
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function openYahooSession(budget: RequestBudget): Promise<YahooSession> {
  if (yahooSession && Date.now() - yahooSession.fetchedAt < sessionFreshMs) return yahooSession;
  if (sessionRequest) return sessionRequest;
  if (budget.remaining < 2) throw new Error('Yahoo request budget exhausted.');
  budget.remaining -= 2;
  sessionRequest = (async () => {
    const consent = await fetchWithTimeout('https://fc.yahoo.com/', { headers: { 'User-Agent': userAgent }, redirect: 'manual' });
    const cookie = consent.headers.getSetCookie().map((value) => value.split(';')[0]).filter(Boolean).join('; ');
    if (!cookie) throw new Error('Yahoo did not issue a session cookie.');
    const crumbResponse = await fetchWithTimeout(`https://${yahooHost}/v1/test/getcrumb`, { headers: { 'User-Agent': userAgent, Cookie: cookie } });
    const crumb = (await crumbResponse.text()).trim();
    if (!crumbResponse.ok || !crumb || crumb.length > 64 || /[<{\s]/.test(crumb)) throw new Error(`Yahoo crumb request returned ${crumbResponse.status}.`);
    yahooSession = { cookie, crumb, fetchedAt: Date.now() };
    return yahooSession;
  })().finally(() => { sessionRequest = null; });
  return sessionRequest;
}

/** The quoteSummary payload for the given modules, or null when Yahoo has no summary (404). */
export async function quoteSummary<T>(symbol: string, modules: string, budget: RequestBudget): Promise<T | null> {
  let lastError: unknown = null;
  // A rejected crumb gets one fresh session and one retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const session = await openYahooSession(budget);
      if (budget.remaining <= 0) break;
      budget.remaining -= 1;
      const response = await fetchWithTimeout(
        `https://${yahooHost}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(session.crumb)}`,
        { headers: { Accept: 'application/json', 'User-Agent': userAgent, Cookie: session.cookie } },
      );
      if (response.status === 401 || response.status === 403) throw new CrumbRejected(`${symbol} quoteSummary returned ${response.status}.`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${symbol} quoteSummary returned ${response.status}.`);
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (!(error instanceof CrumbRejected)) break;
      yahooSession = null;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${symbol} quoteSummary is unavailable.`);
}
