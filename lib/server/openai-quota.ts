import { env } from 'cloudflare:workers';
import type { FreeTierList, ModelQuota, QuotaReport, UsageTier } from '@/lib/openai-free-tier';
import { builtinFreeTier, freeTierArticleUrl, groupOfModel, limitFor, nextUtcMidnight, parseFreeTierText } from '@/lib/openai-free-tier';
import { htmlToText } from '@/lib/server/html';

/**
 * Keeps every ChatGPT request inside OpenAI's complimentary daily tokens: the allowance comes from
 * OpenAI's help article, today's usage from the organisation Usage API (admin key), plus this
 * site's own recent calls, which the Usage API reports with a delay.
 */
const listFreshMs = 10 * 60_000;
const usageFreshMs = 60_000;
const usageLagMs = 15 * 60_000;
const timeoutMs = 8_000;
// Leave a margin so estimates that come out slightly low still stay inside the allowance.
const safetyMargin = 0.95;

let listCache: FreeTierList | null = null;
let usageCache: { day: string; usedByModel: Record<string, number>; fetchedAt: number } | null = null;
const recentCalls: Array<{ model: string; tokens: number; at: number }> = [];

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** The current group list from the article, or the built-in copy when it cannot be read. */
export async function freeTierList(now = Date.now()): Promise<FreeTierList> {
  if (listCache && now - listCache.checkedAt < listFreshMs) return listCache;
  try {
    const response = await fetchWithTimeout(freeTierArticleUrl, { headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } });
    if (!response.ok) throw new Error(`Article returned ${response.status}.`);
    const groups = parseFreeTierText(htmlToText(await response.text()));
    if (groups.length < 1 || groups.reduce((sum, group) => sum + group.models.length, 0) < 5) throw new Error('Article format not recognised.');
    listCache = { groups, source: 'article', checkedAt: now, asOf: utcDay(now) };
  } catch (error) {
    console.warn('OpenAI free-tier article unavailable:', error instanceof Error ? error.message : error);
    listCache = { ...builtinFreeTier, checkedAt: now };
  }
  return listCache;
}

type UsagePage = { data?: Array<{ results?: Array<{ model?: string | null; input_tokens?: number; output_tokens?: number }> }>; has_more?: boolean; next_page?: string | null };

/** Tokens per model since 00:00 UTC today. */
async function todayUsage(now = Date.now()) {
  const day = utcDay(now);
  if (usageCache?.day === day && now - usageCache.fetchedAt < usageFreshMs) return usageCache.usedByModel;
  const adminKey = env.OPENAI_ADMIN_KEY;
  if (!adminKey) throw new Error('OPENAI_ADMIN_KEY is not set.');
  const start = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  const usedByModel: Record<string, number> = {};
  let page: string | null = null;
  for (let guard = 0; guard < 5; guard += 1) {
    const url = new URL('https://api.openai.com/v1/organization/usage/completions');
    url.searchParams.set('start_time', String(start));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.append('group_by', 'model');
    url.searchParams.set('limit', '1');
    if (page) url.searchParams.set('page', page);
    const response = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`Usage API returned ${response.status}.`);
    const payload = await response.json() as UsagePage;
    (payload.data ?? []).forEach((bucket) => (bucket.results ?? []).forEach((result) => {
      const model = String(result.model ?? 'unknown').toLowerCase();
      usedByModel[model] = (usedByModel[model] ?? 0) + (result.input_tokens ?? 0) + (result.output_tokens ?? 0);
    }));
    if (!payload.has_more || !payload.next_page) break;
    page = payload.next_page;
  }
  usageCache = { day, usedByModel, fetchedAt: now };
  return usedByModel;
}

/** Records a call made from this site so it counts before the Usage API reports it. */
export function recordOpenAiUsage(model: string, tokens: number, now = Date.now()) {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  recentCalls.push({ model: model.toLowerCase(), tokens, at: now });
  while (recentCalls.length && now - recentCalls[0].at > usageLagMs) recentCalls.shift();
}

export async function quotaReport(model: string, tier: UsageTier, now = Date.now()): Promise<QuotaReport> {
  const list = await freeTierList(now);
  let usedByModel: Record<string, number> = {};
  let usageError: string | null = null;
  try {
    usedByModel = { ...(await todayUsage(now)) };
  } catch (error) {
    usageError = error instanceof Error && error.message.includes('OPENAI_ADMIN_KEY') ? '伺服器尚未設定 OPENAI_ADMIN_KEY，無法確認今日用量。' : '暫時無法讀取 OpenAI 今日用量。';
  }
  const today = utcDay(now);
  recentCalls.filter((call) => utcDay(call.at) === today && now - call.at <= usageLagMs)
    .forEach((call) => { usedByModel[call.model] = (usedByModel[call.model] ?? 0) + call.tokens; });

  const groups = list.groups.map((group) => {
    const limit = Math.floor(limitFor(group, tier) * safetyMargin);
    const used = Object.entries(usedByModel).reduce((sum, [name, tokens]) => groupOfModel([group], name) ? sum + tokens : sum, 0);
    return { id: group.id, label: group.label, limit, used, remaining: Math.max(0, limit - used), models: group.models };
  });
  let selected: ModelQuota | null = null;
  if (model) {
    const group = groupOfModel(list.groups, model);
    const row = group ? groups.find((candidate) => candidate.id === group.id)! : null;
    selected = { model, group: row ? { id: row.id, label: row.label, limit: row.limit, models: row.models } : null, used: row?.used ?? 0, remaining: row?.remaining ?? 0, resetsAt: nextUtcMidnight(now) };
  }
  return { list, tier, usageAvailable: usageError === null, usageError, usedByModel, groups, selected };
}

/** Whether a call estimated at `estimate` tokens stays inside the model's free allowance. */
export async function checkOpenAiQuota(model: string, tier: UsageTier, estimate: number) {
  const report = await quotaReport(model, tier);
  const selected = report.selected!;
  if (!report.usageAvailable) return { ok: false as const, report, message: `${report.usageError}為避免超出免費額度，已停止這次 ChatGPT 請求。` };
  if (!selected.group) return { ok: false as const, report, message: `${model} 不在 OpenAI 免費額度清單中，使用會直接計費，已擋下。請在「AI 設定」改選清單內的模型。` };
  if (estimate > selected.remaining) {
    return { ok: false as const, report, message: `預估這次約 ${estimate.toLocaleString('en-US')} tokens，超過 ${selected.group.label}今日免費剩餘 ${selected.remaining.toLocaleString('en-US')} tokens，已擋下。額度於 UTC 00:00（台灣時間早上 8 點）重置。` };
  }
  return { ok: true as const, report };
}
