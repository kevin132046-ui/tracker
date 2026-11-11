import type { AccountFreeTier } from '@/lib/openai-free-tier';
import { accountFreeTierHeader, parseAccountFreeTier } from '@/lib/openai-free-tier';

/**
 * The free-tier offer pasted from the organisation's OpenAI data-sharing page, kept in this browser
 * (and in the full backup, like the other optionflow- settings). It is OpenAI's own wording of the
 * offer, not a key. Every AI request carries the parsed list (see aiKeyHeaders) so the server's
 * quota check uses it instead of the help article.
 */
export const accountTierKey = 'optionflow-openai-free-tier';

export type SavedAccountTier = { text: string; savedAt: number; parsed: AccountFreeTier };

let cache: { raw: string | null; value: SavedAccountTier | null } | null = null;
const listeners = new Set<() => void>();

function read(raw: string | null): SavedAccountTier | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as { text?: unknown; savedAt?: unknown };
    if (typeof stored.text !== 'string') return null;
    const parsed = parseAccountFreeTier(stored.text);
    return typeof parsed === 'string' ? null : { text: stored.text, savedAt: Number(stored.savedAt) || 0, parsed };
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

/** Saves pasted text that parses (returns the parse error otherwise), or clears it with null. */
export function saveAccountTier(text: string | null, now = Date.now()): string | null {
  if (text !== null) {
    const parsed = parseAccountFreeTier(text);
    if (typeof parsed === 'string') return parsed;
  }
  try {
    if (text === null) window.localStorage.removeItem(accountTierKey);
    else window.localStorage.setItem(accountTierKey, JSON.stringify({ text: text.trim(), savedAt: now }));
  } catch {
    return '這個瀏覽器無法儲存設定。';
  }
  listeners.forEach((listener) => listener());
  return null;
}

export function watchAccountTier(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === accountTierKey) listener(); };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/** The header every AI request carries while an offer is saved (nothing on the server or before hydration). */
export function accountTierHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const saved = loadAccountTier();
  return saved ? { 'X-OpenAI-Free-Tier': accountFreeTierHeader(saved.parsed.groups) } : {};
}
