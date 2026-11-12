import type { CostBucket, SavedBalance } from '@/lib/openai-spend';
import { costBuckets, costsStart } from '@/lib/openai-spend';
import type { UsageScope } from '@/lib/server/openai-quota';

/**
 * The prepaid balance entered in the settings (app_meta) and the organisation's daily costs from
 * OpenAI's Costs API (admin key). Costs change slowly and the API reports them with a delay, so one
 * read per admin key is kept for a few minutes.
 */
export const balanceKey = 'openai_balance_v1';

export function parseSavedBalance(raw: string | null | undefined): SavedBalance | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { amount?: unknown; at?: unknown };
    const amount = Number(value.amount);
    return Number.isFinite(amount) && amount >= 0 && typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at)) ? { amount, at: value.at } : null;
  } catch {
    return null;
  }
}

export async function readBalance(db: D1Database): Promise<SavedBalance | null> {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(balanceKey).first<{ value: string }>();
  return parseSavedBalance(row?.value);
}

export async function writeBalance(db: D1Database, value: SavedBalance | null) {
  if (value) {
    await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(balanceKey, JSON.stringify(value)).run();
  } else {
    await db.prepare('DELETE FROM app_meta WHERE key = ?').bind(balanceKey).run();
  }
}

const freshMs = 5 * 60_000;
const timeoutMs = 8_000;
const costsCache = new Map<string, { start: number; days: CostBucket[]; at: number }>();

/** Daily costs since `costsStart(now, balanceAt)`, per line item kind. Throws a short message on failure. */
export async function readCosts(scope: UsageScope, now: number, balanceAt: string | null): Promise<CostBucket[]> {
  if (!scope) throw new Error('未設定 OpenAI 管理金鑰，讀不到費用。');
  const start = costsStart(now, balanceAt);
  const cached = costsCache.get(scope.id);
  if (cached && cached.start <= start && now - cached.at < freshMs) return cached.days.filter((row) => Date.parse(`${row.day}T00:00:00Z`) / 1000 >= start);
  const pages = [];
  let page: string | null = null;
  for (let guard = 0; guard < 6; guard += 1) {
    const url = new URL('https://api.openai.com/v1/organization/costs');
    url.searchParams.set('start_time', String(start));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.append('group_by', 'line_item');
    url.searchParams.set('limit', '31');
    if (page) url.searchParams.set('page', page);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${scope.adminKey}` }, cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'OpenAI 管理金鑰無效或權限不足，讀不到費用。' : `OpenAI 費用資料暫時讀不到（${response.status}）。`);
    const payload = await response.json() as { data?: unknown[]; has_more?: boolean; next_page?: string | null };
    pages.push(payload as Parameters<typeof costBuckets>[0][number]);
    if (!payload.has_more || !payload.next_page) break;
    page = payload.next_page;
  }
  const days = costBuckets(pages);
  if (costsCache.size > 20) costsCache.clear();
  costsCache.set(scope.id, { start, days, at: now });
  return days;
}
