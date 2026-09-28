'use client';

import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

const defaultTitle = '桐生桔梗';
const cacheKey = 'optionflow-hero-title-v1';

type HeroTitleState = {
  title: string;
  revision: number;
  updatedAt: string | null;
};

function splitTitle(title: string) {
  const characters = Array.from(title);
  const accentLength = Math.min(2, Math.max(1, characters.length));
  return {
    base: characters.slice(0, -accentLength).join(''),
    accent: characters.slice(-accentLength).join(''),
  };
}

function readCache(): HeroTitleState | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HeroTitleState>;
    if (typeof parsed.title !== 'string' || !parsed.title.trim() || !Number.isSafeInteger(parsed.revision)) return null;
    return { title: parsed.title, revision: Number(parsed.revision), updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null };
  } catch {
    return null;
  }
}

function writeCache(state: HeroTitleState) {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(state));
  } catch {
    // The D1-backed setting remains authoritative when browser storage is unavailable.
  }
}

/** One box per character, so a vertical 和風 title stacks evenly whatever font the device falls back to. */
const verticalChars = (text: string) => [...text].map((char, index) => <i key={index} className="wafu-title-ch">{char}</i>);

export default function EditableHeroTitle({ onNotify, vertical = false }: { onNotify: (message: string) => void; vertical?: boolean }) {
  const [title, setTitle] = useState(defaultTitle);
  const [draft, setDraft] = useState(defaultTitle);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cached = readCache();
    const cacheTimer = cached ? window.setTimeout(() => {
      setTitle(cached.title);
      setDraft(cached.title);
      setRevision(cached.revision);
    }, 0) : null;
    const controller = new AbortController();
    fetch('/api/hero-title', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as HeroTitleState & { error?: string };
        if (!response.ok || typeof payload.title !== 'string') throw new Error(payload.error ?? '網頁標題無法讀取');
        if (controller.signal.aborted) return;
        setTitle(payload.title);
        setDraft((current) => current === defaultTitle || current === cached?.title ? payload.title : current);
        setRevision(payload.revision);
        writeCache(payload);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError') && !cached) onNotify('網頁標題暫時無法同步');
      });
    return () => {
      controller.abort();
      if (cacheTimer !== null) window.clearTimeout(cacheTimer);
    };
  }, [onNotify]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const cancelEditing = () => {
    setDraft(title);
    setEditing(false);
  };

  const saveTitle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/hero-title', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft, revision }),
      });
      const payload = await response.json() as HeroTitleState & { error?: string };
      if (response.status === 409 && typeof payload.title === 'string') {
        setTitle(payload.title);
        setRevision(payload.revision);
        writeCache(payload);
        throw new Error(payload.error ?? '標題已在另一個頁面更新，請確認後再儲存');
      }
      if (!response.ok || typeof payload.title !== 'string') throw new Error(payload.error ?? '網頁標題無法保存');
      setTitle(payload.title);
      setDraft(payload.title);
      setRevision(payload.revision);
      writeCache(payload);
      setEditing(false);
      onNotify('網頁標題已永久保存');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '網頁標題無法保存');
    } finally {
      setSaving(false);
    }
  };

  const parts = splitTitle(title);
  if (editing) {
    return <form className="hero-title-editor" onSubmit={saveTitle}>
      <label className="visually-hidden" htmlFor="hero-title-input">網頁標題</label>
      <input
        ref={inputRef}
        id="hero-title-input"
        value={draft}
        maxLength={32}
        disabled={saving}
        aria-label="網頁標題"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancelEditing();
          if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
        }}
      />
      <div className="hero-title-editor-actions">
        <button type="submit" disabled={saving || !draft.trim()}>{saving ? '保存中…' : '儲存'}</button>
        <button type="button" disabled={saving} onClick={cancelEditing}>取消</button>
      </div>
    </form>;
  }

  return <h1 className="editable-hero-title">
    <button type="button" className="hero-title-display" onClick={() => setEditing(true)} title="點擊編輯網頁標題" aria-label={`編輯網頁標題：${title}`}>
      {vertical ? verticalChars(parts.base) : parts.base}<span className="hero-title-accent">{vertical ? verticalChars(parts.accent) : parts.accent}</span><span className="hero-title-edit-icon" aria-hidden="true">✎</span>
    </button>
  </h1>;
}
