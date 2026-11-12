import type { ModelRoles } from '@/lib/ai-model-roles';
import { cleanModelRoles, emptyModelRoles } from '@/lib/ai-model-roles';

/**
 * The model chosen for each role, as this browser knows it. The site's database (/api/ai-model-roles)
 * holds the copy every device shares; this browser keeps one to start from and for when the database
 * can't be reached (no Access sign-in). The single model chosen before roles existed becomes the chat
 * role's model.
 */
export const modelRolesKey = 'optionflow-openai-model-roles';
const legacyModelKey = 'optionflow-openai-model';
const endpoint = '/api/ai-model-roles';

let cache: { raw: string | null; legacy: string | null; value: ModelRoles } | null = null;
const listeners = new Set<() => void>();

/** The roles, the same object until they change (for useSyncExternalStore). */
export function loadModelRoles(): ModelRoles {
  let raw: string | null = null;
  let legacy: string | null = null;
  try {
    raw = window.localStorage.getItem(modelRolesKey);
    legacy = raw ? null : window.localStorage.getItem(legacyModelKey);
  } catch { /* storage unavailable */ }
  if (cache?.raw === raw && cache.legacy === legacy) return cache.value;
  let value = emptyModelRoles;
  if (raw) {
    try { value = cleanModelRoles(JSON.parse(raw)); } catch { /* keep empty */ }
  } else if (legacy) {
    value = cleanModelRoles({ chat: legacy });
  }
  cache = { raw, legacy, value };
  return value;
}
export const serverModelRoles = () => emptyModelRoles;

function keep(roles: ModelRoles) {
  try { window.localStorage.setItem(modelRolesKey, JSON.stringify(roles)); } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}

export function watchModelRoles(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === modelRolesKey || event.key === legacyModelKey) listener(); };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

/**
 * Takes the database's copy. When the database has none yet, this browser's choice (including the old
 * single model) is saved there, so the first device to open the settings seeds it.
 */
export async function syncModelRoles(signal?: AbortSignal) {
  const response = await fetch(endpoint, { cache: 'no-store', signal }).catch(() => null);
  if (!response?.ok) return;
  const { roles } = await response.json().catch(() => ({ roles: undefined })) as { roles?: unknown };
  if (roles === undefined) return;
  if (roles) {
    const next = cleanModelRoles(roles);
    const current = loadModelRoles();
    if (next.chat !== current.chat || next.lookup !== current.lookup) keep(next);
    return;
  }
  const local = loadModelRoles();
  if (local.chat || local.lookup) await saveModelRoles(local);
}

/** Saves the roles to the database (and this browser); without database access, to this browser only. */
export async function saveModelRoles(roles: ModelRoles): Promise<string | null> {
  const clean = cleanModelRoles(roles);
  keep(clean);
  const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean) }).catch(() => null);
  if (!response) return '連不上網站伺服器，這次只存在這個瀏覽器。';
  if (response.ok || [401, 403, 503].includes(response.status)) return null;
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return payload.error ?? '模型設定沒有存到網站資料庫，請稍後再試。';
}
