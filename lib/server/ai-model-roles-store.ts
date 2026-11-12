import type { ModelRoles } from '@/lib/ai-model-roles';
import { cleanModelRoles } from '@/lib/ai-model-roles';

/**
 * The ChatGPT model chosen for each role (lib/ai-model-roles), in app_meta so every device and the
 * server's own jobs share one choice. Read and written only past the data gate.
 */
export const modelRolesKey = 'ai_model_roles_v1';

export type StoredModelRoles = ModelRoles & { updatedAt: string };

export function parseStoredModelRoles(raw: string | null | undefined): StoredModelRoles | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { updatedAt?: unknown };
    return { ...cleanModelRoles(value), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' };
  } catch {
    return null;
  }
}

// A short per-isolate cache, as for the free-tier offer: a write here replaces it at once.
const freshMs = 60_000;
let cache: { value: StoredModelRoles | null; at: number } | null = null;

export async function readModelRoles(db: D1Database, now = Date.now()): Promise<StoredModelRoles | null> {
  if (cache && now - cache.at < freshMs) return cache.value;
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(modelRolesKey).first<{ value: string }>();
  cache = { value: parseStoredModelRoles(row?.value), at: now };
  return cache.value;
}

export async function writeModelRoles(db: D1Database, roles: ModelRoles, now = new Date()): Promise<StoredModelRoles> {
  const value: StoredModelRoles = { ...cleanModelRoles(roles), updatedAt: now.toISOString() };
  await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(modelRolesKey, JSON.stringify(value)).run();
  cache = { value, at: now.getTime() };
  return value;
}

/** Drops the cache (tests; a restore replaces app_meta wholesale). */
export const forgetModelRolesCache = () => { cache = null; };
