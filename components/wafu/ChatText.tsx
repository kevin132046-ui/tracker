import type { ReactNode } from 'react';
import { tidyReply } from '@/lib/chat-text';

/**
 * An assistant reply as formatted text: paragraphs, "- " lists, **bold**, [links](https://…) and bare
 * links, and the 來源 list at the end as small links. The inline citations ChatGPT adds after each
 * sentence — "([bea.gov](https://…?utm_source=openai))" — are dropped (the sources are listed once
 * at the end). Built as React elements only (no HTML is injected), and only http(s) links are made.
 */
const token = /\*\*([^*\n]+)\*\*|\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(token)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const id = `${key}-${index++}`;
    if (match[1]) out.push(<strong key={id}>{match[1]}</strong>);
    else if (match[3]) out.push(<a key={id} href={match[3]} target="_blank" rel="noopener noreferrer">{match[2]}</a>);
    else if (match[4]) out.push(<a key={id} href={match[4]} target="_blank" rel="noopener noreferrer">{new URL(match[4]).hostname.replace(/^www\./, '')}</a>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  // A stray ** left over from a broken pair is noise.
  return out.map((part) => typeof part === 'string' ? part.replace(/\*\*/g, '') : part);
}

export default function ChatText({ text }: { text: string }) {
  const tidy = tidyReply(text);
  const [body, sources] = tidy.split(/\n+來源：\n/);
  const blocks = body.split(/\n{2,}/);
  return <div className="wafu-chat-text">
    {blocks.map((block, b) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*([-*•]|\d+[.)])\s+/.test(line))) {
        return <ul key={b}>{lines.map((line, l) => <li key={l}>{inline(line.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${b}-${l}`)}</li>)}</ul>;
      }
      return <p key={b}>{lines.flatMap((line, l) => {
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        const content = heading ? [<strong key={`h${l}`}>{inline(heading[1], `${b}-${l}`)}</strong>] : inline(line, `${b}-${l}`);
        return l ? [<br key={`br${l}`} />, ...content] : content;
      })}</p>;
    })}
    {sources && <div className="wafu-chat-sources"><span>來源</span><ol>{sources.split('\n').map((line) => line.replace(/^\s*-\s*/, '')).filter(Boolean).map((line, i) => {
      const url = line.match(/https?:\/\/\S+/)?.[0];
      const title = url ? line.replace(url, '').trim() : line;
      return <li key={i}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{title || new URL(url).hostname}</a> : title}</li>;
    })}</ol></div>}
  </div>;
}
