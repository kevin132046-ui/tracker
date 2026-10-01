/**
 * OpenAI's complimentary daily tokens for organisations that share data with OpenAI. Models sit
 * in groups whose daily allowance is shared by every model in the group, and it resets at
 * 00:00 UTC. The list changes over time, so the server reads it from OpenAI's help article and
 * falls back to the copy below.
 */
export const freeTierArticleUrl = 'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai';

export type UsageTier = 'low' | 'high';
export type FreeTierGroup = { id: string; label: string; highLimit: number; lowLimit: number; models: string[] };
export type FreeTierList = { groups: FreeTierGroup[]; source: 'article' | 'builtin'; checkedAt: number; asOf: string };

export type ModelQuota = {
  model: string;
  group: { id: string; label: string; limit: number; models: string[] } | null;
  used: number;
  remaining: number;
  resetsAt: string;
};
export type QuotaReport = { list: FreeTierList; tier: UsageTier; usageAvailable: boolean; usageError: string | null; usedByModel: Record<string, number>; groups: Array<{ id: string; label: string; limit: number; used: number; remaining: number; models: string[] }>; selected: ModelQuota | null;
  /** false: no admin key in bring-your-own-key mode, so ChatGPT is not held to the free tier (billed to that key). */
  enforced?: boolean };

/** From the article as captured on 2026-09-28; used only when the live article cannot be read. */
export const builtinFreeTier: FreeTierList = {
  source: 'builtin',
  checkedAt: 0,
  asOf: '2026-09-28',
  groups: [
    { id: '1M', label: '1M token 組', highLimit: 1_000_000, lowLimit: 250_000, models: [
      'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.5-2026-04-23', 'gpt-5.4-2026-03-05', 'gpt-5.2-2025-12-11',
      'gpt-5.1-2025-11-13', 'gpt-5.1-codex', 'gpt-5-codex', 'gpt-5-2025-08-07', 'gpt-5-chat-latest', 'gpt-4.1-2025-04-14',
      'gpt-4o-2024-05-13', 'gpt-4o-2024-08-06', 'gpt-4o-2024-11-20', 'o3-2025-04-16', 'o1-preview-2024-09-12', 'o1-2024-12-17',
    ] },
    { id: '10M', label: '10M token 組', highLimit: 10_000_000, lowLimit: 2_500_000, models: [
      'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4-mini-2026-03-17', 'gpt-5.4-nano-2026-03-17', 'gpt-5.1-codex-mini', 'gpt-5-mini-2025-08-07',
      'gpt-5-nano-2025-08-07', 'gpt-4.1-mini-2025-04-14', 'gpt-4.1-nano-2025-04-14', 'gpt-4o-mini-2024-07-18', 'o4-mini-2025-04-16',
      'o1-mini-2024-09-12', 'codex-mini-latest',
    ] },
  ],
};

const amount = (value: string, unit: string) => Number(value) * (unit.toUpperCase() === 'M' ? 1_000_000 : 1_000);
const modelLine = /^[a-z0-9][a-z0-9.:-]{1,63}$/i;

/**
 * Groups from the article text: a heading such as "1M token group (250K for usage tiers 1-2):"
 * followed by one model per line. Deprecated or shut-down models are left out.
 */
export function parseFreeTierText(text: string): FreeTierGroup[] {
  const groups: FreeTierGroup[] = [];
  let current: FreeTierGroup | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[•\-*\s]+/, '').trim();
    const heading = line.match(/^(\d+(?:\.\d+)?)\s*([KM])\s+tokens?\s+group\s*\(\s*(\d+(?:\.\d+)?)\s*([KM])\s+for\s+usage\s+tiers?\s+1\s*[-–]\s*2\s*\)/i);
    if (heading) {
      current = { id: `${heading[1]}${heading[2].toUpperCase()}`, label: `${heading[1]}${heading[2].toUpperCase()} token 組`, highLimit: amount(heading[1], heading[2]), lowLimit: amount(heading[3], heading[4]), models: [] };
      groups.push(current);
      continue;
    }
    if (!current || !line) continue;
    if (/deprecated|shut\s*down|retired/i.test(line)) continue;
    const model = line.split(/\s+/)[0];
    if (modelLine.test(model) && /\d|latest|mini|nano|codex/i.test(model)) current.models.push(model);
    else if (current.models.length) current = null;
  }
  return groups.filter((group) => group.models.length);
}

/**
 * The group a model belongs to. An alias ("gpt-5.5") matches a dated snapshot in the list
 * ("gpt-5.5-2026-04-23") only when exactly one snapshot has that prefix.
 */
export function groupOfModel(groups: FreeTierGroup[], model: string) {
  const name = model.trim().toLowerCase();
  if (!name) return null;
  const exact = groups.find((group) => group.models.some((entry) => entry.toLowerCase() === name));
  if (exact) return exact;
  const snapshots = groups.flatMap((group) => group.models.filter((entry) => {
    const lower = entry.toLowerCase();
    return lower.startsWith(`${name}-`) && /^\d{4}-\d{2}-\d{2}$/.test(lower.slice(name.length + 1));
  }).map(() => group));
  return snapshots.length === 1 ? snapshots[0] : null;
}

/** Usage API model names are snapshots; count each against the group it belongs to. */
export const limitFor = (group: FreeTierGroup, tier: UsageTier) => tier === 'high' ? group.highLimit : group.lowLimit;

/** Conservative token estimate: CJK characters count as one token each, other text as one per 3 characters. */
export function estimateTokens(text: string) {
  let wide = 0;
  for (const char of text) if (char.charCodeAt(0) > 0x2e7f) wide += 1;
  return Math.ceil(wide + (text.length - wide) / 3);
}

export const nextUtcMidnight = (now = Date.now()) => {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
};
