import type { AccountFreeTier } from '@/lib/openai-free-tier';
import { parseAccountFreeTier } from '@/lib/openai-free-tier';

/**
 * The free-tier offer pasted from the organisation's OpenAI data-sharing page, kept in app_meta so every
 * device signed in to the site shares one copy (and the full backup carries it). Read and written only
 * past the data gate; the quota check reads it directly, so no browser has to send it.
 */
export const freeTierKey = 'openai_free_tier_v1';
export const maxFreeTierText = 4_000;

export type StoredFreeTier = { text: string; savedAt: string; parsed: AccountFreeTier };

/** A stored value, re-parsed (a value that no longer parses counts as none). */
export function parseStoredFreeTier(raw: string | null | undefined): StoredFreeTier | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { text?: unknown; savedAt?: unknown };
    if (typeof value.text !== 'string') return null;
    const parsed = parseAccountFreeTier(value.text);
    return typeof parsed === 'string' ? null : { text: value.text, savedAt: typeof value.savedAt === 'string' ? value.savedAt : '', parsed };
  } catch {
    return null;
  }
}

/** Checks pasted text: the stored copy, or an error message. */
export function checkFreeTierText(value: unknown, now = new Date()): StoredFreeTier | string {
  if (typeof value !== 'string' || !value.trim()) return '請貼上 Sharing 頁的文字。';
  const text = value.trim();
  if (text.length > maxFreeTierText) return `文字太長（上限 ${maxFreeTierText} 字），請只複製免費資格那一段。`;
  const parsed = parseAccountFreeTier(text);
  return typeof parsed === 'string' ? parsed : { text, savedAt: now.toISOString(), parsed };
}

// Read on every AI status check and AI call; a short per-isolate cache saves the query. A write in this
// isolate replaces it at once; another isolate catches up within the cache time.
const freshMs = 60_000;
let cache: { value: StoredFreeTier | null; at: number } | null = null;

export async function readFreeTier(db: D1Database, now = Date.now()): Promise<StoredFreeTier | null> {
  if (cache && now - cache.at < freshMs) return cache.value;
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(freeTierKey).first<{ value: string }>();
  cache = { value: parseStoredFreeTier(row?.value), at: now };
  return cache.value;
}

export async function writeFreeTier(db: D1Database, value: StoredFreeTier | null, now = Date.now()) {
  if (value) {
    await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(freeTierKey, JSON.stringify({ text: value.text, savedAt: value.savedAt })).run();
  } else {
    await db.prepare('DELETE FROM app_meta WHERE key = ?').bind(freeTierKey).run();
  }
  cache = { value, at: now };
}

/** Drops the cache (tests; a restore replaces app_meta wholesale). */
export const forgetFreeTierCache = () => { cache = null; };
