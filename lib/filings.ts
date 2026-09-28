/**
 * SEC earnings filings as the page sees them, the AI analyses kept in this browser, and the
 * settings that shape them. Storage helpers never throw: without localStorage they do nothing.
 */
import type { AiProvider } from '@/lib/earnings';

export type EarningsFiling = { form: string; accession: string; filed: string; reportDate: string | null; items: string[]; url: string };
export type CompanyFilings = { cik: string; name: string; earningsRelease: EarningsFiling | null; periodicReport: EarningsFiling | null };
export type QuarterFigure = { start: string; end: string; value: number; derived: boolean };
export type QuarterRow = { end: string; revenue: QuarterFigure | null; epsDiluted: QuarterFigure | null; grossMargin: number | null; derived: boolean };

export type FilingExchange = { question: string; answer: string; provider: AiProvider; model: string; at: number };
export type FilingAnalysis = {
  symbol: string;
  accession: string;
  form: string;
  filed: string;
  documentUrl: string;
  provider: AiProvider;
  model: string;
  text: string;
  figures: QuarterRow[];
  createdAt: number;
  followUps: FilingExchange[];
};

export const analysesKey = 'optionflow-filing-analyses';
export const aiKeysKey = 'optionflow-ai-keys';
export const aiDefaultProviderKey = 'optionflow-ai-default-provider';
export const analysisQuestionsKey = 'optionflow-analysis-questions';
export const usageTierKey = 'optionflow-openai-usage-tier';

/** Analyses older than this are dropped when the page loads; the count cap keeps storage small. */
export const analysisMaxAgeMs = 183 * 24 * 60 * 60_000;
export const analysisMaxCount = 60;
export const maxQuestions = 10;
export const maxQuestionLength = 200;
export const maxFollowUps = 20;
/** A "results are out" chip shows for this many days after the 8-K was filed. */
export const releaseNoticeDays = 14;

export const defaultAnalysisQuestions = [
  '營收成長主要來自哪些產品、地區或客戶？',
  '毛利率和營業利益率為什麼變化？',
  '公司對下一季或全年的財測是什麼？比上次上調還是下調？',
  '有哪些一次性項目或會計調整會影響這季的數字？',
  '對選擇權賣方來說，財報後需要注意哪些風險？',
];

export const analysisId = (accession: string) => accession;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable or full */ }
}

/** Drops analyses past the age limit, then the oldest beyond the count cap. */
export function pruneAnalyses(analyses: Record<string, FilingAnalysis>, now = Date.now()) {
  const kept = Object.values(analyses)
    .filter((analysis) => analysis && typeof analysis.createdAt === 'number' && now - analysis.createdAt < analysisMaxAgeMs)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, analysisMaxCount);
  return Object.fromEntries(kept.map((analysis) => [analysisId(analysis.accession), analysis]));
}

export function loadAnalyses() {
  const stored = read<Record<string, FilingAnalysis>>(analysesKey, {});
  const pruned = pruneAnalyses(stored && typeof stored === 'object' ? stored : {});
  if (Object.keys(pruned).length !== Object.keys(stored ?? {}).length) write(analysesKey, pruned);
  return pruned;
}
export const saveAnalyses = (analyses: Record<string, FilingAnalysis>) => write(analysesKey, pruneAnalyses(analyses));

export type AiKeys = { openai: string; anthropic: string };
export function loadAiKeys(): AiKeys {
  const stored = read<Partial<AiKeys>>(aiKeysKey, {});
  return { openai: typeof stored.openai === 'string' ? stored.openai : '', anthropic: typeof stored.anthropic === 'string' ? stored.anthropic : '' };
}
export const saveAiKeys = (keys: AiKeys) => keys.openai || keys.anthropic ? write(aiKeysKey, keys) : (() => { try { window.localStorage.removeItem(aiKeysKey); } catch { /* storage unavailable */ } })();

export const loadDefaultProvider = (): AiProvider => read<string>(aiDefaultProviderKey, 'openai') === 'anthropic' ? 'anthropic' : 'openai';
export const saveDefaultProvider = (provider: AiProvider) => write(aiDefaultProviderKey, provider);

/** Unknown tiers use the smaller (tier 1–2) allowance so the free limit is never overshot. */
export const loadUsageTier = (): 'low' | 'high' => read<string>(usageTierKey, 'low') === 'high' ? 'high' : 'low';
export const saveUsageTier = (tier: 'low' | 'high') => write(usageTierKey, tier);

export function cleanQuestions(questions: unknown): string[] {
  if (!Array.isArray(questions)) return [];
  return questions.filter((question): question is string => typeof question === 'string')
    .map((question) => question.trim().slice(0, maxQuestionLength)).filter(Boolean).slice(0, maxQuestions);
}
export function loadQuestions() {
  const stored = read<unknown>(analysisQuestionsKey, null);
  return stored === null ? defaultAnalysisQuestions : cleanQuestions(stored);
}
export const saveQuestions = (questions: string[]) => write(analysisQuestionsKey, cleanQuestions(questions));

/** Request headers carrying the keys typed into this browser, if any. */
export function aiKeyHeaders(keys: AiKeys): Record<string, string> {
  return {
    ...(keys.openai.trim() ? { 'X-OpenAI-Key': keys.openai.trim() } : {}),
    ...(keys.anthropic.trim() ? { 'X-Anthropic-Key': keys.anthropic.trim() } : {}),
  };
}
