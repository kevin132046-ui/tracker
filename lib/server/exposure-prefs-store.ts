import type { ExposurePrefs, StoredExposurePrefs } from '@/lib/exposure-prefs';
import { cleanExposurePrefs, emptyExposurePrefs, mergeExposurePrefs } from '@/lib/exposure-prefs';

/**
 * The 持倉風險 panel's themes, custom events and cash-like list (lib/exposure-prefs), in app_meta so
 * every device signed in to the site shares one copy, the daily digest can read it, and the full
 * backup carries it. Tickers, theme names, event dates and labels: no quantities or amounts. Read and
 * written only past the data gate.
 */
export const exposurePrefsKey = 'exposure_prefs_v1';
/** Largest request body accepted (a full record is a few kilobytes). */
export const maxExposurePrefsBytes = 32_000;

export function parseStoredExposurePrefs(raw: string | null | undefined): StoredExposurePrefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { updatedAt?: unknown };
    if (!value || typeof value !== 'object') return null;
    return { ...cleanExposurePrefs(value), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' };
  } catch {
    return null;
  }
}

/** The stored record, or null when nothing was ever saved. */
export async function readExposurePrefs(db: D1Database): Promise<StoredExposurePrefs | null> {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(exposurePrefsKey).first<{ value: string }>();
  return parseStoredExposurePrefs(row?.value);
}

/** Replaces the parts `patch` names (themes, events, cashLike) and keeps the rest. */
export async function writeExposurePrefs(db: D1Database, patch: unknown, now = new Date()): Promise<StoredExposurePrefs> {
  const current: ExposurePrefs = await readExposurePrefs(db) ?? emptyExposurePrefs;
  const value: StoredExposurePrefs = { ...mergeExposurePrefs(current, patch), updatedAt: now.toISOString() };
  await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(exposurePrefsKey, JSON.stringify(value)).run();
  return value;
}
