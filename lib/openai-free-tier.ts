/**
 * OpenAI's complimentary daily tokens for organisations that share data with OpenAI. Models sit
 * in groups whose daily allowance is shared by every model in the group, and it resets at
 * 00:00 UTC. The list changes over time, so the server reads it from OpenAI's help article and
 * falls back to the copy below. The help article and the offer shown on an organisation's own
 * data-sharing page are not always in step (the page has listed fewer models), so the text from
 * that page can be pasted into the settings; when it is, it is the list used.
 */
export const freeTierArticleUrl = 'https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai';

export type UsageTier = 'low' | 'high';
export type FreeTierGroup = { id: string; label: string; highLimit: number; lowLimit: number; models: string[] };
export type FreeTierList = { groups: FreeTierGroup[]; source: 'article' | 'builtin' | 'account'; checkedAt: number; asOf: string };

/** OpenAI's names for the usage tiers: Build (formerly tiers 1–2) and Launch / Grow (tiers 3–5). */
export const usageTierLabel: Record<UsageTier, string> = { low: 'Build', high: 'Launch／Grow' };
/** Where an organisation's own offer is shown (organisation owners only). */
export const sharingSettingsUrl = 'https://platform.openai.com/settings/organization/data-controls/sharing';

export type ModelQuota = {
  model: string;
  group: { id: string; label: string; limit: number; models: string[] } | null;
  used: number;
  remaining: number;
  resetsAt: string;
};
export type QuotaReport = { list: FreeTierList; tier: UsageTier; usageAvailable: boolean; usageError: string | null; usedByModel: Record<string, number>; groups: Array<{ id: string; label: string; limit: number; used: number; remaining: number; models: string[] }>; selected: ModelQuota | null;
  /** false: no admin key in bring-your-own-key mode, so ChatGPT is not held to the free tier (billed to that key). */
  enforced?: boolean;
  /** A pasted list reached the server but was out of bounds, so the article's list applied. */
  accountRejected?: boolean;
  /** The "lookup" role's model (lib/ai-model-roles), when the status was asked for it too. */
  lookup?: ModelQuota | null };

/** From the article as captured on 2026-11-12; used only when the live article cannot be read. */
export const builtinFreeTier: FreeTierList = {
  source: 'builtin',
  checkedAt: 0,
  asOf: '2026-11-12',
  groups: [
    { id: '1M', label: '1M token 組', highLimit: 1_000_000, lowLimit: 250_000, models: [
      'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.5-2026-04-23', 'gpt-5.4-2026-03-05', 'gpt-5.2-2025-12-11',
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
 * Groups from the article text: a heading such as "1M token group for Launch and Grow (250K for
 * Build):" (earlier "1M token group (250K for usage tiers 1-2):") followed by one model per line.
 * Deprecated or shut-down models are left out.
 */
export function parseFreeTierText(text: string): FreeTierGroup[] {
  const groups: FreeTierGroup[] = [];
  let current: FreeTierGroup | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[•\-*\s]+/, '').trim();
    const heading = line.match(/^(\d+(?:\.\d+)?)\s*([KM])\s+tokens?\s+group\b[^(]{0,40}\(\s*(\d+(?:\.\d+)?)\s*([KM])\s+for\s+(?:usage\s+tiers?\s+1\s*[-–]\s*2|build)\s*\)/i);
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

const datedSuffix = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The group a model belongs to. Besides an exact match:
 * - a dated snapshot ("gpt-5.4-2026-03-05") belongs to the group listing its family ("gpt-5.4"),
 *   but "gpt-5.4-mini-2026-03-17" does not ("mini-…" is not a date);
 * - an alias ("gpt-5.5") matches a dated snapshot in the list ("gpt-5.5-2026-04-23") only when
 *   exactly one snapshot has that prefix.
 * Anything else ("gpt-5-chat-latest" against a list naming only "gpt-5") is not in a group, so it
 * counts as billed.
 */
export function groupOfModel<T extends Pick<FreeTierGroup, 'models'>>(groups: T[], model: string): T | null {
  const name = model.trim().toLowerCase();
  if (!name) return null;
  const exact = groups.find((group) => group.models.some((entry) => entry.toLowerCase() === name));
  if (exact) return exact;
  const family = groups.find((group) => group.models.some((entry) => {
    const lower = entry.toLowerCase();
    return name.startsWith(`${lower}-`) && datedSuffix.test(name.slice(lower.length + 1));
  }));
  if (family) return family;
  const snapshots = groups.flatMap((group) => group.models.filter((entry) => {
    const lower = entry.toLowerCase();
    return lower.startsWith(`${name}-`) && datedSuffix.test(lower.slice(name.length + 1));
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

/** "25 萬組", "250 萬組", "1,000 萬組": a group named by its daily limit, as the settings show it. */
export function limitLabel(limit: number) {
  const wan = limit / 10_000;
  return `${Number.isInteger(wan) ? wan.toLocaleString('en-US') : String(Number(wan.toFixed(1)))} 萬組`;
}

/** One group from the organisation's own data-sharing page: its daily limit and the models named there. */
export type AccountFreeTierGroup = { limit: number; models: string[] };
export type AccountFreeTier = { status: 'eligible' | 'enrolled' | 'unknown'; groups: AccountFreeTierGroup[] };

// Bounds for a pasted list (and for the header that carries it to the server).
export const maxAccountGroups = 4;
export const maxAccountModels = 40;
export const maxAccountLimit = 10_000_000;
const unitOf: Record<string, number> = { thousand: 1_000, k: 1_000, million: 1_000_000, m: 1_000_000 };

/**
 * The offer as the data-sharing page words it:
 *   "Up to 250 thousand tokens per day across gpt-5.4, gpt-5.2, …, o1, and o3"
 *   "Up to 2.5 million tokens per day across gpt-5.4-mini, …, and o4-mini."
 * Bullets and line breaks may be missing (pasted from elsewhere), so each "Up to …" starts a group,
 * and the model list ends at a sentence-ending full stop (a dot not followed by a digit).
 * Returns an error message when no group with models can be read.
 */
export function parseAccountFreeTier(text: string): AccountFreeTier | string {
  const plain = text.replace(/[‘’]/g, "'").replace(/[•·▪●◦]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return '沒有內容。';
  const status = /\benrolled\b/i.test(plain) ? 'enrolled' : /\beligible\b/i.test(plain) ? 'eligible' : 'unknown';
  const groups: AccountFreeTierGroup[] = [];
  for (const part of plain.split(/(?=\bup to\s+[\d.,]+\s*(?:thousand|million|k|m)\b)/i)) {
    const match = /^up to\s+([\d.,]+)\s*(thousand|million|k|m)\b[^]*?\bacross\s+(.+)$/i.exec(part.trim());
    if (!match) continue;
    const limit = Math.round(Number(match[1].replace(/,/g, '')) * unitOf[match[2].toLowerCase()]);
    const list = match[3].split(/\.(?=\s|$)|\busage beyond\b/i)[0];
    // Model names have no spaces: split on commas and spaces, and drop the "and" before the last one.
    const models = [...new Set(list.split(/[\s,]+/).map((model) => model.toLowerCase()).filter((model) => model !== 'and' && modelLine.test(model)))];
    if (!Number.isFinite(limit) || limit < 1 || limit > maxAccountLimit) return `看不懂這個上限：${match[1]} ${match[2]}。`;
    if (models.length) groups.push({ limit, models: models.slice(0, maxAccountModels) });
  }
  if (!groups.length) return '沒讀到「Up to … tokens per day across …」這樣的模型清單，請把 Sharing 頁上那段完整複製過來。';
  if (groups.length > maxAccountGroups) return `讀到 ${groups.length} 組，超過 ${maxAccountGroups} 組，格式可能不對。`;
  return { status, groups };
}

/** The pasted groups as one header value: "250000:gpt-5.4,gpt-5.2|2500000:gpt-5.4-mini,…". */
export const accountFreeTierHeader = (groups: readonly AccountFreeTierGroup[]) => groups.map((group) => `${group.limit}:${group.models.join(',')}`).join('|');

/** The header back into groups, checked (the server's side); null when it is missing or out of bounds. */
export function parseAccountFreeTierHeader(value: string | null | undefined): AccountFreeTierGroup[] | null {
  const text = String(value ?? '').trim();
  if (!text || text.length > 2_000) return null;
  const parts = text.split('|');
  if (parts.length > maxAccountGroups) return null;
  const groups: AccountFreeTierGroup[] = [];
  for (const part of parts) {
    const match = /^(\d{1,8}):([^:|]+)$/.exec(part);
    if (!match) return null;
    const limit = Number(match[1]);
    const models = match[2].split(',').map((model) => model.trim().toLowerCase());
    if (limit < 1 || limit > maxAccountLimit || !models.length || models.length > maxAccountModels || !models.every((model) => modelLine.test(model))) return null;
    groups.push({ limit, models });
  }
  return groups;
}

/** A pasted list in the shape the quota check uses (the same limit whatever the usage tier setting says). */
export function accountFreeTierList(groups: readonly AccountFreeTierGroup[], now = Date.now()): FreeTierList {
  return {
    source: 'account',
    checkedAt: now,
    asOf: new Date(now).toISOString().slice(0, 10),
    groups: [...groups].sort((a, b) => a.limit - b.limit).map((group) => ({ id: `account-${group.limit}`, label: limitLabel(group.limit), highLimit: group.limit, lowLimit: group.limit, models: group.models })),
  };
}

/** The usage tier a pasted offer implies: the 250K / 2.5M limits are Build's. */
export const tierOfAccount = (groups: readonly AccountFreeTierGroup[]): UsageTier => Math.max(0, ...groups.map((group) => group.limit)) > 2_500_000 ? 'high' : 'low';
