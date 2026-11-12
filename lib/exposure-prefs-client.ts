import { defaultCashLike, exposureCashLikeKey, exposureEventsKey, exposureThemesKey, parseCashLike } from '@/lib/exposure';
import type { ExposurePrefs } from '@/lib/exposure-prefs';
import { cleanExposurePrefs, planExposureSync } from '@/lib/exposure-prefs';

/**
 * The 持倉風險 settings as this browser knows them. The site's database (/api/exposure-prefs) holds the
 * copy every device and the daily digest share; this browser keeps its own in localStorage (the keys
 * the panel always used) to start from and for when the database can't be reached (no Access sign-in).
 */
const endpoint = '/api/exposure-prefs';
/** Fired on `window` after the database's copy replaced this browser's: the panel and the page reload theirs. */
export const exposurePrefsChanged = 'optionflow-exposure-prefs-changed';

let edits = 0;

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** This browser's copy. The cash-like list is stored as text ("BOXX,SGOV"); no entry means the built-in list. */
export function localExposurePrefs(): ExposurePrefs {
  let cashLike: string[] | null = null;
  try {
    const stored = window.localStorage.getItem(exposureCashLikeKey);
    if (stored !== null) cashLike = parseCashLike(stored);
  } catch { /* storage unavailable */ }
  return cleanExposurePrefs({ themes: readJson(exposureThemesKey), events: readJson(exposureEventsKey), cashLike });
}

function keepLocally(prefs: ExposurePrefs) {
  const set = (key: string, value: string | null) => {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  };
  try {
    set(exposureThemesKey, Object.keys(prefs.themes).length ? JSON.stringify(prefs.themes) : null);
    set(exposureEventsKey, prefs.events.length ? JSON.stringify(prefs.events) : null);
    set(exposureCashLikeKey, prefs.cashLike === null || prefs.cashLike.join(',') === defaultCashLike.join(',') ? null : prefs.cashLike.join(','));
  } catch { /* storage unavailable: the page keeps what it has for this visit */ }
}

/**
 * Takes the database's copy; when the database has none yet, this browser's settings are saved there,
 * so the first device to open the page fills it. Without database access nothing changes.
 */
export async function syncExposurePrefs(signal?: AbortSignal): Promise<'adopt' | 'seed' | 'none'> {
  const editsBefore = edits;
  const response = await fetch(endpoint, { cache: 'no-store', signal }).catch(() => null);
  if (!response?.ok) return 'none';
  const payload = await response.json().catch(() => null) as { prefs?: unknown } | null;
  if (!payload || payload.prefs === undefined) return 'none';
  // Something was changed here while the answer was on its way: that change is newer than the answer.
  if (edits !== editsBefore) return 'none';
  const local = localExposurePrefs();
  const server = payload.prefs ? cleanExposurePrefs(payload.prefs) : null;
  const plan = planExposureSync(server, local);
  if (plan === 'adopt' && server) {
    if (JSON.stringify(server) === JSON.stringify(local)) return 'none';
    keepLocally(server);
    window.dispatchEvent(new Event(exposurePrefsChanged));
  } else if (plan === 'seed') {
    await pushExposurePrefs(local);
  }
  return plan;
}

/** Saves the named parts to the database. The caller has already stored them in this browser. */
export async function pushExposurePrefs(patch: Partial<ExposurePrefs>): Promise<boolean> {
  edits += 1;
  const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => null);
  return Boolean(response?.ok);
}
