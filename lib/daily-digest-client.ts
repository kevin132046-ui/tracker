/** The page's side of 每日彙總 (/api/daily-digest, behind Cloudflare Access). */
import type { DigestRecord, DigestSettings } from '@/lib/daily-digest';

export type DigestState = { settings: DigestSettings; digests: DigestRecord[]; day: string; due: boolean };

const endpoint = '/api/daily-digest';
const caughtUpKey = 'optionflow-digest-caught-up';

export async function loadDigests(signal?: AbortSignal): Promise<DigestState | null> {
  const response = await fetch(endpoint, { cache: 'no-store', signal }).catch(() => null);
  if (!response?.ok) return null;
  return await response.json().catch(() => null) as DigestState | null;
}

/** Writes a digest now: the one the Cron trigger missed, or (force) today's again. */
export async function runDigest(force = false, signal?: AbortSignal) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }), signal });
  if (!response.ok) throw new Error(`彙總暫時無法產生（${response.status}）`);
  return await response.json() as { state: string; record: DigestRecord | null };
}

export async function saveDigestSettings(settings: DigestSettings) {
  const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  if (!response.ok) throw new Error(`設定沒有存好（${response.status}）`);
  return (await response.json() as { settings: DigestSettings }).settings;
}

/** One catch-up attempt per session and day, so a failing run isn't repeated on every reload. */
export function shouldCatchUp(day: string) {
  try {
    if (window.sessionStorage.getItem(caughtUpKey) === day) return false;
    window.sessionStorage.setItem(caughtUpKey, day);
  } catch { /* storage unavailable: try once */ }
  return true;
}
