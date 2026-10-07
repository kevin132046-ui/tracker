'use client';

import { startTransition, useState } from 'react';

/**
 * The holdings search box. The text updates at once; the page's filtering follows as a low-priority
 * update, so typing stays smooth while the holdings grid re-renders.
 */
export default function SearchInput({ value, onChange, placeholder, label }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // The page can set the query too (drilling into a ticker, clearing a filter).
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  return <input value={text} placeholder={placeholder} aria-label={label} onChange={(event) => {
    const next = event.target.value;
    setText(next);
    setSeen(next);
    startTransition(() => onChange(next));
  }} />;
}
