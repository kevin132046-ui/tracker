import { env } from 'cloudflare:workers';
import { GET as earningsGet } from '@/app/api/earnings/route';
import { GET as marketRegimeGet } from '@/app/api/market-regime/route';
import { GET as profileGet, type SymbolProfile } from '@/app/api/profile/route';
import type { DigestBody, DigestOpenAi, DigestQuote, DigestRecord, DigestSettings, DigestStatus, DigestTrade } from '@/lib/daily-digest';
import { cleanDigestSettings, cleanNews, concentration, digestDayFor, expiringSoon, freeTierCheck, keptDigests, marketValueUsd, maxDigestSearches, quoteSymbolOf, topMovers, trackedValue, upcomingEvents } from '@/lib/daily-digest';
import type { EarningsEvent } from '@/lib/earnings';
import { extractJson } from '@/lib/ai-trade-entry';
import { classifyRegime, type MarketRegimePayload } from '@/lib/market-regime';
import { accountFreeTierList, estimateTokens } from '@/lib/openai-free-tier';
import { estimateBalance, summarizeSpend } from '@/lib/openai-spend';
import { dailyDigestTable, ensureDatabase } from '@/lib/server/database';
import { readModelRoles } from '@/lib/server/ai-model-roles-store';
import { readFreeTier } from '@/lib/server/openai-free-tier-store';
import { checkOpenAiQuota, freeTierList, recordOpenAiUsage, usageScope } from '@/lib/server/openai-quota';
import { readBalance, readCosts } from '@/lib/server/openai-spend-store';
import { fetchLatestPrice } from '@/lib/server/yahoo-quote';

/**
 * 每日彙總 on the server: gathers the open positions (D1), fresh prices, earnings dates, 市場定調
 * and industry groups (the same public routes the page uses), news for the largest holdings with
 * the 自動找資料 model and at most three web searches, and yesterday's OpenAI charges, then stores
 * one row per US session in `daily_digest`. Runs from the Cron trigger (worker/index.ts) or, when
 * that didn't happen, from the page (POST /api/daily-digest).
 */
const settingsKey = 'daily_digest_settings_v1';
const staleRunMs = 10 * 60_000;
const newsTimeoutMs = 90_000;
const newsMaxOutput = 1_500;
const maxQuoted = 40;
const maxProfiled = 15;
const maxNewsTickers = 5;
// Searches are billed: skip them once today's searches cost this much, or the prepaid balance runs low.
const searchCapUsd = 0.1;
const local = 'https://digest.local';

type WorkerEnv = { OPENAI_API_KEY?: string; OPENAI_ADMIN_KEY?: string; OPENAI_MODEL?: string };
const secrets = () => env as unknown as WorkerEnv;

let tableReady = false;
/** The database with the digest table set up (created on first use, like cash_flows). */
export async function digestDatabase() {
  const db = await ensureDatabase();
  if (!tableReady) { await db.prepare(dailyDigestTable).run(); tableReady = true; }
  return db;
}

export async function readDigestSettings(db: D1Database): Promise<DigestSettings> {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(settingsKey).first<{ value: string }>();
  try { return cleanDigestSettings(row ? JSON.parse(row.value) : null); } catch { return cleanDigestSettings(null); }
}
export async function writeDigestSettings(db: D1Database, settings: DigestSettings) {
  await db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(settingsKey, JSON.stringify(settings)).run();
  return settings;
}

type Row = { day: string; status: string; created_at: string; data: string };
function recordOf(row: Row): DigestRecord {
  let parsed: { body?: DigestBody; error?: string } = {};
  try { parsed = JSON.parse(row.data) ?? {}; } catch { /* a broken row reads as an error */ }
  const status: DigestStatus = row.status === 'ok' || row.status === 'running' ? row.status : 'error';
  return { day: row.day, status, createdAt: row.created_at, body: parsed.body ?? null, error: parsed.error ?? (status === 'error' ? '彙總資料無法讀取' : null) };
}

export async function readDigests(db: D1Database, limit = 7): Promise<DigestRecord[]> {
  const rows = await db.prepare('SELECT day, status, created_at, data FROM daily_digest ORDER BY day DESC LIMIT ?').bind(limit).all<Row>();
  return rows.results.map(recordOf);
}

/** Public routes called in-process, the way the page calls them. */
async function readJson<T>(handler: (request: Request) => Promise<Response>, path: string): Promise<T> {
  const response = await handler(new Request(`${local}${path}`));
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return await response.json() as T;
}

type TradeRow = { id: number; type: string; ticker: string | null; event: string; strike: string | null; expiry_date: string | null; quantity: number; current_price: number | null; collateral: number };
async function openTrades(db: D1Database): Promise<DigestTrade[]> {
  const rows = await db.prepare("SELECT id, type, ticker, event, strike, expiry_date, quantity, current_price, collateral FROM trades WHERE status = 'open'").all<TradeRow>();
  return rows.results.map((row) => ({ id: row.id, type: row.type, ticker: row.ticker, event: row.event, strike: row.strike, expiryDate: row.expiry_date, quantity: Number(row.quantity) || 0, currentPrice: row.current_price === null ? null : Number(row.current_price), collateral: Number(row.collateral) || 0 }));
}

async function quotesFor(symbols: readonly string[]) {
  const quotes: Record<string, DigestQuote> = {};
  const settled = await Promise.allSettled(symbols.map(async (symbol) => [symbol, await fetchLatestPrice(symbol)] as const));
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const [symbol, quote] = result.value;
    quotes[symbol] = { price: quote.regularPrice ?? quote.price, changePercent: quote.regularChangePercent };
  }
  return { quotes, failed: settled.filter((result) => result.status === 'rejected').length };
}

/** One UTC day of an organisation endpoint (costs by line item, or usage by model). */
async function organisationDay(path: 'costs' | 'usage/completions', adminKey: string, day: string) {
  const url = new URL(`https://api.openai.com/v1/organization/${path}`);
  const start = Date.parse(`${day}T00:00:00Z`) / 1000;
  url.searchParams.set('start_time', String(start));
  url.searchParams.set('end_time', String(start + 86_400));
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.append('group_by', path === 'costs' ? 'line_item' : 'model');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${adminKey}` }, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`OpenAI ${path} ${response.status}`);
    const payload = await response.json() as { data?: Array<{ results?: Array<Record<string, unknown>> }> };
    return (payload.data ?? []).flatMap((bucket) => bucket.results ?? []);
  } finally {
    clearTimeout(timer);
  }
}

async function checkYesterday(adminKey: string | undefined, groups: Awaited<ReturnType<typeof freeGroups>>, now: number): Promise<DigestOpenAi> {
  const day = new Date(now - 86_400_000).toISOString().slice(0, 10);
  if (!adminKey) return { day, ok: null, billed: [], searchCost: null, note: '沒有 OpenAI 管理金鑰，無法核對費用' };
  const [costs, usage] = await Promise.all([organisationDay('costs', adminKey, day), organisationDay('usage/completions', adminKey, day)]);
  const lines = costs.flatMap((item) => {
    const amount = item.amount as { value?: unknown; currency?: unknown } | undefined;
    const cost = Number(amount?.value);
    return typeof item.line_item === 'string' && Number.isFinite(cost) && String(amount?.currency ?? 'usd').toLowerCase() === 'usd' ? [{ lineItem: item.line_item, cost }] : [];
  });
  const tokens: Record<string, number> = {};
  for (const item of usage) {
    if (typeof item.model !== 'string') continue;
    tokens[item.model] = (tokens[item.model] ?? 0) + (Number(item.input_tokens) || 0) + (Number(item.output_tokens) || 0);
  }
  return freeTierCheck(lines, tokens, groups.list, groups.tier, day);
}

async function freeGroups(db: D1Database, now: number) {
  const stored = await readFreeTier(db, now).catch(() => null);
  const account = stored?.parsed.groups ?? null;
  return { list: account ? accountFreeTierList(account, now).groups : (await freeTierList(now)).groups, account, tier: 'low' as const };
}

type ResponsesReply = { model?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; usage?: { total_tokens?: number } | null; error?: { message?: string } | null };

/** Recent news for the largest holdings: the 自動找資料 model with at most three web searches. */
async function findNews(tickers: readonly string[], day: string, model: string, apiKey: string) {
  const prompt = [
    `Today is ${day} (US Eastern). For each ticker below, search the web for at most one important company-specific news item from the last two days, using at most ${maxDigestSearches} searches in total.`,
    'Describe facts only, in Traditional Chinese, one sentence of at most 60 characters, with the article URL. No opinions, no price targets, no buy or sell advice. Skip a ticker when nothing notable happened.',
    'Reply with JSON only: {"news":[{"ticker":"KO","text":"…","url":"https://…"}]}',
    `Tickers: ${tickers.join(', ')}`,
  ].join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), newsTimeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: prompt, tools: [{ type: 'web_search', search_context_size: 'low' }], max_tool_calls: maxDigestSearches, max_output_tokens: newsMaxOutput }),
      signal: controller.signal,
    });
    const payload = await response.json() as ResponsesReply;
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${payload.error?.message ?? 'request failed'}`.slice(0, 200));
    const text = (payload.output ?? []).flatMap((item) => item.type === 'message' ? item.content ?? [] : []).filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('\n');
    return { news: cleanNews(extractJson(text), tickers), model: payload.model ?? model, tokens: payload.usage?.total_tokens ?? 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Claims the day's row so the Cron run and a page that opens at the same time don't both write it. */
async function claim(db: D1Database, day: string, now: number, force: boolean): Promise<'claimed' | DigestRecord> {
  const at = new Date(now).toISOString();
  const inserted = await db.prepare("INSERT INTO daily_digest (day, status, created_at, data) VALUES (?, 'running', ?, '{}') ON CONFLICT(day) DO NOTHING").bind(day, at).run();
  if (inserted.meta.changes) return 'claimed';
  const row = await db.prepare('SELECT day, status, created_at, data FROM daily_digest WHERE day = ?').bind(day).first<Row>();
  if (!row) return 'claimed';
  const existing = recordOf(row);
  const stale = existing.status === 'running' && now - Date.parse(existing.createdAt) > staleRunMs;
  if (!stale && !(force && existing.status !== 'running')) return existing;
  await db.prepare("UPDATE daily_digest SET status = 'running', created_at = ?, data = '{}' WHERE day = ?").bind(at, day).run();
  return 'claimed';
}

export type DigestRun = { state: 'off' | 'done' | 'busy' | 'written'; record: DigestRecord | null };

/** Writes the digest for the session just closed, once. `force` rewrites a finished day. */
export async function runDailyDigest(now = Date.now(), force = false): Promise<DigestRun> {
  const db = await digestDatabase();
  const settings = await readDigestSettings(db);
  if (!settings.enabled) return { state: 'off', record: null };
  const day = digestDayFor(now);
  const claimed = await claim(db, day, now, force);
  if (claimed !== 'claimed') return { state: claimed.status === 'running' ? 'busy' : 'done', record: claimed };

  let record: DigestRecord;
  try {
    record = { day, status: 'ok', createdAt: new Date(now).toISOString(), body: await gather(db, day, settings, now), error: null };
  } catch (error) {
    console.warn('Daily digest failed:', error instanceof Error ? error.message : error);
    record = { day, status: 'error', createdAt: new Date(now).toISOString(), body: null, error: error instanceof Error ? error.message.slice(0, 200) : '彙總產生失敗' };
  }
  await db.batch([
    db.prepare('UPDATE daily_digest SET status = ?, created_at = ?, data = ? WHERE day = ?').bind(record.status, record.createdAt, JSON.stringify({ body: record.body, error: record.error }), day),
    db.prepare('DELETE FROM daily_digest WHERE day NOT IN (SELECT day FROM daily_digest ORDER BY day DESC LIMIT ?)').bind(keptDigests),
  ]);
  return { state: 'written', record };
}

async function gather(db: D1Database, day: string, settings: DigestSettings, now: number): Promise<DigestBody> {
  const missing: string[] = [];
  const [trades, previous, regimePayload, groups] = await Promise.all([
    openTrades(db),
    db.prepare("SELECT day, status, created_at, data FROM daily_digest WHERE status = 'ok' AND day < ? ORDER BY day DESC LIMIT 1").bind(day).first<Row>().then((row) => row ? recordOf(row).body : null),
    readJson<MarketRegimePayload>(marketRegimeGet, '/api/market-regime').catch(() => null),
    freeGroups(db, now),
  ]);

  // Prices: every symbol held (shares and option underlyings), plus USD/JPY for yen positions.
  const symbols = [...new Set(trades.map(quoteSymbolOf).filter(Boolean))].slice(0, maxQuoted);
  const [{ quotes, failed }, fx] = await Promise.all([quotesFor(symbols), fetchLatestPrice('JPY=X').catch(() => null)]);
  if (failed) missing.push(`${failed} 檔報價`);
  const usdJpyRate = fx?.regularPrice ?? fx?.price ?? 0;

  const total = trackedValue(trades, quotes, usdJpyRate);
  const before = previous?.value?.total ?? null;
  const value = { total, previous: before, change: before === null ? null : Number((total - before).toFixed(2)), changePercent: before ? Number(((total - before) / before).toFixed(4)) : null };

  // Earnings for every symbol held; industries for the largest ones.
  const stockSymbols = symbols.filter((symbol) => !symbol.endsWith('.T'));
  const earnings = stockSymbols.length
    ? await readJson<{ earnings?: Record<string, EarningsEvent> }>(earningsGet, `/api/earnings?symbols=${encodeURIComponent(stockSymbols.join(','))}`).then((payload) => payload.earnings ?? {}).catch(() => { missing.push('財報日'); return {}; })
    : {};
  const valued = trades.map((trade) => ({ trade, symbol: quoteSymbolOf(trade), value: marketValueUsd(trade, quotes, usdJpyRate) }));
  const bySymbol = new Map<string, number>();
  for (const item of valued) if (item.symbol) bySymbol.set(item.symbol, (bySymbol.get(item.symbol) ?? 0) + item.value);
  const largest = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]).map(([symbol]) => symbol);
  const profiled = largest.filter((symbol) => !symbol.endsWith('.T')).slice(0, maxProfiled);
  const profiles: Record<string, SymbolProfile> = profiled.length
    ? await readJson<{ profiles?: Record<string, SymbolProfile> }>(profileGet, `/api/profile?symbols=${encodeURIComponent(profiled.join(','))}`).then((payload) => payload.profiles ?? {}).catch(() => { missing.push('產業分類'); return {}; })
    : {};
  const groupOf = (symbol: string, cash: boolean) => cash ? '現金' : profiles[symbol]?.industry ?? profiles[symbol]?.sector ?? symbol;
  const top = concentration(valued.map((item) => ({ group: groupOf(item.symbol, !item.symbol), value: item.value })));

  let regime: DigestBody['regime'] = null;
  if (regimePayload) {
    const reading = classifyRegime(regimePayload.ratioHistory);
    const previousReading = classifyRegime(regimePayload.ratioHistory.slice(0, -1));
    if (reading) regime = { id: reading.id, vix: reading.vix, ratio: Number(reading.ratio.toFixed(3)), previousId: previousReading?.id ?? null };
  } else missing.push('市場定調');

  // News: 自動找資料 model, inside the free tokens, searches capped by count, by today's search cost and by the balance.
  const keys = secrets();
  const scope = await usageScope(keys.OPENAI_ADMIN_KEY);
  const roles = await readModelRoles(db, now).catch(() => null);
  const model = roles?.lookup || keys.OPENAI_MODEL || '';
  const newsTickers = largest.slice(0, maxNewsTickers);
  let news: DigestBody['news'] = [];
  let newsNote: string | null = null;
  let usedModel: string | null = null;
  if (!settings.search) newsNote = '上網搜尋已關閉';
  else if (!keys.OPENAI_API_KEY || !model) newsNote = '伺服器沒有設定 OpenAI 金鑰或模型';
  else if (!newsTickers.length) newsNote = '沒有持股';
  else {
    const saved = await readBalance(db).catch(() => null);
    const costs = scope ? await readCosts(scope, now, saved?.at ?? null).catch(() => null) : null;
    const spentToday = costs?.find((row) => row.day === new Date(now).toISOString().slice(0, 10))?.search ?? 0;
    const balance = saved && costs ? estimateBalance(saved, summarizeSpend(costs, now, saved.at).sinceBalance) : null;
    const estimate = estimateTokens(newsTickers.join(' ')) + 15_000;
    const quota = await checkOpenAiQuota(model, 'low', estimate, scope, groups.account);
    if (spentToday >= searchCapUsd) newsNote = '今天的搜尋費已達上限，這次不搜尋';
    else if (balance?.low) newsNote = '預付餘額偏低，這次不搜尋';
    else if (!quota.ok) newsNote = quota.message;
    else {
      try {
        const found = await findNews(newsTickers, day, model, keys.OPENAI_API_KEY);
        news = found.news;
        usedModel = found.model;
        recordOpenAiUsage(scope, found.model, found.tokens || estimate, now);
        if (!news.length) newsNote = '沒有找到值得一提的新聞';
      } catch (error) {
        newsNote = '新聞暫時查不到';
        console.warn('Daily digest news failed:', error instanceof Error ? error.message : error);
      }
    }
  }

  const openai = await checkYesterday(keys.OPENAI_ADMIN_KEY, groups, now).catch((error) => ({ day: new Date(now - 86_400_000).toISOString().slice(0, 10), ok: null, billed: [], searchCost: null, note: error instanceof Error ? `費用暫時讀不到（${error.message.slice(0, 60)}）` : '費用暫時讀不到' }));

  return {
    day,
    generatedAt: new Date(now).toISOString(),
    model: usedModel,
    value: trades.length ? value : null,
    movers: topMovers(trades, quotes),
    expiring: expiringSoon(trades, day, quotes),
    events: upcomingEvents(earnings, day),
    regime,
    concentration: top ? { ...top, previousShare: previous?.concentration?.group === top.group ? previous.concentration.share : null } : null,
    news,
    newsNote,
    openai,
    missing,
  };
}
