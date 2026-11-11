import type { AccountFreeTier } from '@/lib/openai-free-tier';
import { accountFreeTierHeader, parseAccountFreeTier } from '@/lib/openai-free-tier';

/**
 * The free-tier offer pasted from the organisation's OpenAI data-sharing page. The copy that counts is
 * the one in the site's database (/api/openai-free-tier), shared by every signed-in device; this browser
 * keeps a copy to show it right away and to send it when the database can't be reached (no Cloudflare
 * Access sign-in: bring-your-own-key mode).
 */
export const accountTierKey = 'optionflow-openai-free-tier';
const endpoint = '/api/openai-free-tier';

/** where: 'server' = in the site's database; 'local' = only in this browser (the database refused). */
export type SavedAccountTier = { text: string; savedAt: number; where: 'server' | 'local'; parsed: AccountFreeTier };

let cache: { raw: string | null; value: SavedAccountTier | null } | null = null;
const listeners = new Set<() => void>();

function read(raw: string | null): SavedAccountTier | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as { text?: unknown; savedAt?: unknown; where?: unknown };
    if (typeof stored.text !== 'string') return null;
    const parsed = parseAccountFreeTier(stored.text);
    return typeof parsed === 'string' ? null : { text: stored.text, savedAt: Number(stored.savedAt) || 0, where: stored.where === 'local' ? 'local' : 'server', parsed };
  } catch {
    return null;
  }
}

/** The saved offer, or null. The same object comes back until the stored text changes (for useSyncExternalStore). */
export function loadAccountTier(): SavedAccountTier | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(accountTierKey);
  } catch { /* storage unavailable */ }
  if (cache?.raw !== raw) cache = { raw, value: read(raw) };
  return cache.value;
}

function keep(value: { text: string; savedAt: number; where: 'server' | 'local' } | null) {
  try {
    if (value) window.localStorage.setItem(accountTierKey, JSON.stringify(value));
    else window.localStorage.removeItem(accountTierKey);
  } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}

export function watchAccountTier(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === accountTierKey) listener(); };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

type Offer = { text: string; savedAt: string } | null;
// The database refuses requests without an Access sign-in (401/403) or when Access isn't set up (503).
const refused = (status: number) => status === 401 || status === 403 || status === 503;

/** Takes the database's copy (another device may have changed it). Leaves this browser's copy alone if the database can't be read. */
export async function syncAccountTier(signal?: AbortSignal) {
  const response = await fetch(endpoint, { cache: 'no-store', signal }).catch(() => null);
  if (!response?.ok) return;
  const { offer } = await response.json().catch(() => ({ offer: undefined })) as { offer?: Offer };
  if (offer === undefined) return;
  const local = loadAccountTier();
  if (offer) keep({ text: offer.text, savedAt: Date.parse(offer.savedAt) || Date.now(), where: 'server' });
  else if (local?.where === 'server') keep(null);
}

/**
 * Saves pasted text to the database (and this browser), or clears it with null. Without database access
 * the text is kept in this browser only. Returns an error message, or null.
 */
export async function saveAccountTier(text: string | null): Promise<string | null> {
  if (text !== null) {
    const parsed = parseAccountFreeTier(text);
    if (typeof parsed === 'string') return parsed;
  }
  const response = await fetch(endpoint, text === null
    ? { method: 'DELETE' }
    : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => null);
  if (response?.ok) {
    const { offer } = await response.json().catch(() => ({ offer: null })) as { offer: Offer };
    keep(offer ? { text: offer.text, savedAt: Date.parse(offer.savedAt) || Date.now(), where: 'server' } : null);
    return null;
  }
  if (response && refused(response.status)) {
    keep(text === null ? null : { text: text.trim(), savedAt: Date.now(), where: 'local' });
    return null;
  }
  const payload = response ? await response.json().catch(() => ({})) as { error?: string } : {};
  return payload.error ?? '沒有存成功，請稍後再試。';
}

/** The header an AI request carries while this browser has a copy (the server uses it only without database access). */
export function accountTierHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const saved = loadAccountTier();
  return saved ? { 'X-OpenAI-Free-Tier': accountFreeTierHeader(saved.parsed.groups) } : {};
}
