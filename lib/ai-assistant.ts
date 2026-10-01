/**
 * AI assistant (側欄「AI」): questions about your own portfolio, answered by Claude or ChatGPT
 * from a summary of the positions the page already shows. Shared by the panel and /api/ai.
 * The summary has tickers, sizes, prices and totals only: no names, accounts or trade notes.
 */
export type AssistantPersona = 'kikyo' | 'shigure' | 'neutral';
export type AssistantLanguage = 'zh' | 'ja' | 'en';
export type AssistantTurn = { role: 'user' | 'assistant'; text: string };

export type SnapshotPosition = {
  ticker: string;
  kind: 'stock' | 'put' | 'call' | 'cash' | 'other';
  side: 'long' | 'short';
  quantity: number;
  strike: string | null;
  expiry: string | null;
  daysToExpiry: number | null;
  entryPrice: number;
  currentPrice: number | null;
  underlyingPrice: number | null;
  marketValueUsd: number;
  pnlUsd: number;
  currency: 'USD' | 'JPY';
};

export type PortfolioSnapshot = {
  asOf: string;
  usdJpy: number | null;
  totals: { marketValueUsd: number; openPnlUsd: number; capitalUsd: number };
  positions: SnapshotPosition[];
  closed: { count: number; realizedUsd: number; yearRealizedUsd: number; year: number };
  dividends: { usdNet: number; jpyNet: number; usdPending: number; jpyPending: number } | null;
};

export const maxAssistantQuestion = 800;
export const maxAssistantTurns = 8;
export const maxAssistantTurnLength = 3000;
export const maxSnapshotPositions = 120;
export const assistantMaxOutput = 2000;

/** Suggested questions, one tap each. */
export const assistantPresets: Record<AssistantLanguage, string[]> = {
  zh: ['這週有哪些選擇權快到期？各自該怎麼處理？', '目前哪個部位的風險最大？', '幫我整理持倉損益與資金使用概況', '今年已實現的權利金與股息收入有多少？'],
  ja: ['今週満期のオプションは？それぞれどう対処すべき？', 'いま一番リスクが大きいポジションは？', '保有ポジションの損益と資金の使い方をまとめて', '今年確定したプレミアムと配当収入はいくら？'],
  en: ['Which options expire this week, and how should I handle each?', 'Which position carries the most risk right now?', 'Summarise my open P&L and how my capital is used', 'How much premium and dividend income have I realised this year?'],
};

/** The panel's greeting, in the character's voice or a neutral one. */
export const assistantGreeting: Record<AssistantPersona, Record<AssistantLanguage, string>> = {
  kikyo: {
    zh: 'Sensai，戰況資料已整理好。想先看哪一處布陣？',
    ja: 'Sensai、戦況の資料は揃っています。どの布陣から確認しますか？',
    en: 'Sensai, the situation report is ready. Which part of the line shall we look at first?',
  },
  shigure: {
    zh: 'Sensai，先喝口熱茶吧。持倉的事，我們慢慢看就好。',
    ja: 'Sensai、まずは温かいお茶でもどうぞ。持高のことは、ゆっくり見ていきましょう。',
    en: 'Sensai, have some warm tea first. We can look over the positions slowly.',
  },
  neutral: {
    zh: '可以問我關於你持倉的問題，例如到期、風險或損益。',
    ja: '保有ポジションについて質問できます。満期、リスク、損益など。',
    en: 'Ask about your positions: expiries, risk or P&L.',
  },
};

/** Browser-side settings: whether the assistant is on, and whether it speaks as the theme's character. */
export type AssistantPrefs = { enabled: boolean; voice: 'character' | 'neutral' };
const prefsKey = 'optionflow-assistant';
export const defaultAssistantPrefs: AssistantPrefs = { enabled: true, voice: 'character' };
export function loadAssistantPrefs(): AssistantPrefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(prefsKey) ?? '{}') as Partial<AssistantPrefs>;
    return { enabled: saved.enabled !== false, voice: saved.voice === 'neutral' ? 'neutral' : 'character' };
  } catch {
    return defaultAssistantPrefs;
  }
}
export function saveAssistantPrefs(prefs: AssistantPrefs) {
  try { window.localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

/**
 * The conversation, kept in this browser only: the messages of the last three visits (a visit is one
 * browser session of the site), at most 40. Messages saved before visits were recorded count as one.
 */
export type AssistantMessage = AssistantTurn & { provider?: 'openai' | 'anthropic'; model?: string; at: number; error?: boolean; session?: string };
const chatKey = 'optionflow-assistant-chat';
const sessionKey = 'optionflow-assistant-session';
export const keptVisits = 3;

/** This visit's id (new for each browser session). */
export function currentAssistantSession() {
  try {
    let id = window.sessionStorage.getItem(sessionKey);
    if (!id) { id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; window.sessionStorage.setItem(sessionKey, id); }
    return id;
  } catch {
    return 'this-visit';
  }
}

/** Only the messages of the last `keptVisits` visits, then the last 40. */
export function keepRecentVisits(messages: AssistantMessage[]) {
  const visits: string[] = [];
  for (const message of messages) {
    const visit = message.session ?? 'earlier';
    if (!visits.includes(visit)) visits.push(visit);
  }
  const kept = new Set(visits.slice(-keptVisits));
  return messages.filter((message) => kept.has(message.session ?? 'earlier')).slice(-40);
}

export function loadAssistantChat(): AssistantMessage[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(chatKey) ?? '[]') as unknown;
    return Array.isArray(saved) ? keepRecentVisits(saved.filter((item): item is AssistantMessage => Boolean(item) && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string')) : [];
  } catch {
    return [];
  }
}
export function saveAssistantChat(messages: AssistantMessage[]) {
  try {
    const kept = keepRecentVisits(messages);
    if (kept.length) window.localStorage.setItem(chatKey, JSON.stringify(kept));
    else window.localStorage.removeItem(chatKey);
  } catch { /* storage unavailable */ }
}
