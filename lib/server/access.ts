import { env } from 'cloudflare:workers';

/**
 * Verifies the Cloudflare Access token on a request (RS256 JWT, signed with the team's keys).
 * Fails closed: without ACCESS_TEAM_DOMAIN and ACCESS_AUD configured, nothing is allowed.
 */
/** Which check turned a token away. Nothing secret: AUD tags and the team domain appear in Access's own login URLs. */
export type AccessFailure = {
  reason: 'malformed' | 'algorithm' | 'certs-unavailable' | 'unknown-key' | 'bad-signature' | 'wrong-audience' | 'wrong-issuer' | 'expired' | 'not-yet-valid';
  tokenAudience?: string[];
  expectedAudience?: string[];
  tokenIssuer?: string;
  expectedIssuer?: string;
};
export type AccessResult =
  | { ok: true; email: string | null }
  | { ok: false; status: 401 | 503; code: 'access-not-configured' | 'access-required' | 'access-invalid'; failure?: AccessFailure };

class AccessCheckError extends Error {
  readonly failure: AccessFailure;
  constructor(failure: AccessFailure) {
    super(failure.reason);
    this.failure = failure;
  }
}
const fail = (failure: AccessFailure): never => { throw new AccessCheckError(failure); };
/** The first 8 characters of an AUD tag: enough to tell two apart. */
const tagPrefix = (value: unknown) => String(value ?? '').slice(0, 8);

type Jwk = JsonWebKey & { kid?: string };
type JwtHeader = { alg?: string; kid?: string };
type JwtPayload = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };

const keysFreshMs = 60 * 60_000;
let keyCache: { teamUrl: string; keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

const base64UrlBytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
const base64UrlJson = <T>(value: string) => JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;

/** `myteam.cloudflareaccess.com` or a full https URL → `https://myteam.cloudflareaccess.com`. */
export function normalizeTeamUrl(value: string | undefined) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const url = /^https:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url) ? url.toLowerCase() : null;
}

async function signingKeys(teamUrl: string, forceRefresh = false) {
  if (keyCache?.teamUrl === teamUrl) {
    const age = Date.now() - keyCache.fetchedAt;
    // A forced refresh (unknown key id) is limited to once a minute so bogus tokens cannot drive fetches.
    if (age < (forceRefresh ? 60_000 : keysFreshMs)) return keyCache.keys;
  }
  const response = await fetch(`${teamUrl}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Access certs returned ${response.status}.`);
  const { keys = [] } = await response.json() as { keys?: Jwk[] };
  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    imported.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keyCache = { teamUrl, keys: imported, fetchedAt: Date.now() };
  return imported;
}

function tokenFrom(request: Request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header.trim();
  const cookie = request.headers.get('Cookie') ?? '';
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('CF_Authorization='))?.slice('CF_Authorization='.length) ?? null;
}

export async function verifyAccess(request: Request, now = Date.now()): Promise<AccessResult> {
  const teamUrl = normalizeTeamUrl(env.ACCESS_TEAM_DOMAIN);
  // workers.dev and preview URLs are separate Access applications, so several AUD tags may be listed.
  const allowedAudiences = String(env.ACCESS_AUD ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!teamUrl || !allowedAudiences.length) return { ok: false, status: 503, code: 'access-not-configured' };
  const token = tokenFrom(request);
  if (!token) return { ok: false, status: 401, code: 'access-required' };
  try {
    const [headerPart, payloadPart, signaturePart, extra] = token.split('.');
    if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) fail({ reason: 'malformed' });
    let header: JwtHeader = {};
    try { header = base64UrlJson<JwtHeader>(headerPart); } catch { fail({ reason: 'malformed' }); }
    if (header.alg !== 'RS256' || !header.kid) fail({ reason: 'algorithm' });
    const kid = header.kid as string;
    // An unknown key id may mean Access rotated its keys; refetch once.
    let keys: Map<string, CryptoKey> = new Map();
    try { keys = await signingKeys(teamUrl); } catch { fail({ reason: 'certs-unavailable', expectedIssuer: teamUrl }); }
    let key = keys.get(kid);
    if (!key) {
      try { key = (await signingKeys(teamUrl, true)).get(kid); } catch { fail({ reason: 'certs-unavailable', expectedIssuer: teamUrl }); }
    }
    if (!key) fail({ reason: 'unknown-key', expectedIssuer: teamUrl });
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key as CryptoKey, base64UrlBytes(signaturePart), signed))) fail({ reason: 'bad-signature', expectedIssuer: teamUrl });
    let payload: JwtPayload = {};
    try { payload = base64UrlJson<JwtPayload>(payloadPart); } catch { fail({ reason: 'malformed' }); }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const seconds = Math.floor(now / 1000);
    if (!audiences.some((value) => typeof value === 'string' && allowedAudiences.includes(value))) {
      fail({ reason: 'wrong-audience', tokenAudience: audiences.map(tagPrefix), expectedAudience: allowedAudiences.map(tagPrefix) });
    }
    if (payload.iss !== teamUrl) fail({ reason: 'wrong-issuer', tokenIssuer: String(payload.iss ?? ''), expectedIssuer: teamUrl });
    if (typeof payload.exp !== 'number' || payload.exp <= seconds) fail({ reason: 'expired' });
    if (typeof payload.nbf === 'number' && payload.nbf > seconds + 60) fail({ reason: 'not-yet-valid' });
    return { ok: true, email: typeof payload.email === 'string' ? payload.email : null };
  } catch (error) {
    return { ok: false, status: 401, code: 'access-invalid', failure: error instanceof AccessCheckError ? error.failure : { reason: 'malformed' } };
  }
}
