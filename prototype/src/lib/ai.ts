// AI 助手：原型內用 claude.ai 頁面內建的「詢問 Claude」能力（以觀看者自己的 Claude 帳號額度）；
// 正式站可在設定改用 OpenAI 或 Anthropic API（金鑰存 Cloudflare Secret，由 /api/ai 代呼叫，不放在瀏覽器）。
import { safeGet, safeSet } from "./wa";

export type Provider = "claude" | "openai" | "anthropic";
export interface AiPrefs { provider: Provider; model: string; key: string; autoEarnings: boolean }

const read = (): AiPrefs => {
  try {
    const raw = safeGet("wa-ai");
    if (raw) return { provider: "claude", model: "", key: "", autoEarnings: true, ...JSON.parse(raw) };
  } catch { /* 忽略壞資料 */ }
  return { provider: "claude", model: "", key: "", autoEarnings: true };
};
export const aiPrefs: AiPrefs = read();
export function saveAiPrefs(p: Partial<AiPrefs>) {
  Object.assign(aiPrefs, p);
  // 原型只存在這個瀏覽器；正式站不會把金鑰存在前端
  safeSet("wa-ai", JSON.stringify(aiPrefs));
}

export interface SampleResultLike { text: string; truncated: boolean }
export interface SampleErrorLike { code: string; message: string; text?: string }
export interface SampleFn {
  (input: string | { role: "user" | "assistant"; content: string }[], opts?: Record<string, unknown>): Promise<SampleResultLike>;
  json: <T = unknown>(input: string | { role: "user" | "assistant"; content: string }[], opts?: Record<string, unknown>) => Promise<T>;
  limits: () => Promise<{ maxPromptBytes: number; images?: { maxCount: number; maxInputBytes: number; mediaTypes: string[] }; tools?: { maxCount: number } }>;
}

type ClaudeWin = Window & { claude?: { use: (name: string) => Promise<unknown> } };

let samplePromise: Promise<SampleFn | null> | null = null;
/** 取得頁面內建的 Claude（沒有或無法使用時回傳 null） */
export function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const c = (window as ClaudeWin).claude;
    samplePromise = c?.use ? c.use("sample").then((s) => (s as SampleFn) ?? null).catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}

export function errorCopy(code: string, lang: "zh" | "ja") {
  const zh: Record<string, string> = {
    not_granted: "你尚未允許這個頁面使用 Claude。", sampling_disabled: "這個帳號目前無法使用 Claude。",
    rate_limited: "使用太頻繁或額度已滿，請稍後再試。", session_expired: "請重新登入 Claude。",
    refused: "這個問題無法回答，換個問法試試。", empty_completion: "沒有得到回覆，請簡化問題。",
    invalid_json: "辨識結果格式不完整，請再試一次或換張更清楚的圖。", image_rejected: "這張圖片無法使用（格式或大小不符）。",
    images_unavailable: "目前無法傳送圖片。", prompt_too_large: "內容太長，請縮短。", upstream_error: "連線中斷，請再試一次。",
  };
  const ja: Record<string, string> = {
    not_granted: "このページでの Claude 利用が許可されていません。", sampling_disabled: "このアカウントでは Claude を利用できません。",
    rate_limited: "利用が集中しています。しばらくして再試行してください。", session_expired: "Claude に再ログインしてください。",
    refused: "この質問には回答できません。聞き方を変えてください。", empty_completion: "回答がありませんでした。質問を簡単にしてください。",
    invalid_json: "認識結果が不完全です。もう一度、または鮮明な画像でお試しください。", image_rejected: "この画像は使用できません。",
    images_unavailable: "画像を送信できません。", prompt_too_large: "内容が長すぎます。", upstream_error: "接続が途切れました。再試行してください。",
  };
  return (lang === "ja" ? ja : zh)[code] ?? (lang === "ja" ? "エラーが発生しました。" : "發生錯誤，請再試一次。");
}
