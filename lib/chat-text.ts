/**
 * Cleans an AI reply for display and history: drops the inline citations ChatGPT adds after each
 * sentence, "([bea.gov](https://…?utm_source=openai))" (the sources are listed once at the end),
 * removes utm_ tracking from links and squeezes blank runs.
 */
const inlineCitation = /\s*\(\[[^\]]{1,80}\]\(https?:\/\/[^)\s]+\)\)/g;
const tracking = /([?&])utm_[a-z]+=[^&\s)]*(&)?/g;
export const cleanUrl = (url: string) => url.replace(tracking, (_, lead: string, tail?: string) => tail ? lead : '').replace(/[?&]$/, '');

export function tidyReply(text: string) {
  return text.replace(inlineCitation, '').replace(/https?:\/\/[^\s)]+/g, cleanUrl).replace(/\n{3,}/g, '\n\n').trim();
}

