import { ensureDatabase } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const settingsKey = 'hero_title_v1';
const defaultTitle = '桐生桔梗';
const maxTitleLength = 32;
const responseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

type HeroTitleState = {
  title: string;
  revision: number;
  updatedAt: string | null;
};

function fallbackState(): HeroTitleState {
  return { title: defaultTitle, revision: 0, updatedAt: null };
}

function parseStoredTitle(raw: string | null): HeroTitleState {
  if (!raw) return fallbackState();
  try {
    const parsed = JSON.parse(raw) as Partial<HeroTitleState>;
    if (typeof parsed.title !== 'string' || !parsed.title.trim()) return fallbackState();
    return {
      title: parsed.title,
      revision: Number.isSafeInteger(parsed.revision) && Number(parsed.revision) >= 0 ? Number(parsed.revision) : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return fallbackState();
  }
}

function normalizeTitle(value: unknown) {
  if (typeof value !== 'string') throw new Error('請輸入網頁標題');
  if (/[\r\n\u0000-\u001f\u007f]/u.test(value)) throw new Error('標題不可包含換行或控制字元');
  const title = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!title) throw new Error('網頁標題不可留白');
  if (Array.from(title).length > maxTitleLength) throw new Error(`網頁標題不可超過 ${maxTitleLength} 個字`);
  return title;
}

async function readCurrent() {
  const db = await ensureDatabase();
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(settingsKey).first<{ value: string }>();
  const raw = row?.value ?? null;
  return { db, raw, state: parseStoredTitle(raw) };
}

export async function GET() {
  try {
    const { state } = await readCurrent();
    return NextResponse.json(state, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '網頁標題無法讀取' }, { status: 500, headers: responseHeaders });
  }
}

export async function PUT(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return NextResponse.json({ error: '標題資料過大' }, { status: 413, headers: responseHeaders });
  }

  let body: { title?: unknown; revision?: unknown };
  try {
    body = await request.json() as { title?: unknown; revision?: unknown };
  } catch {
    return NextResponse.json({ error: '標題資料格式不正確' }, { status: 400, headers: responseHeaders });
  }

  let title: string;
  try {
    title = normalizeTitle(body.title);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '網頁標題不正確' }, { status: 400, headers: responseHeaders });
  }

  try {
    const { db, raw, state } = await readCurrent();
    const revision = Number(body.revision);
    if (!Number.isSafeInteger(revision) || revision !== state.revision) {
      return NextResponse.json({ ...state, error: '標題已在另一個頁面更新，請確認後再儲存' }, { status: 409, headers: responseHeaders });
    }
    if (title === state.title) return NextResponse.json(state, { headers: responseHeaders });

    const nextState: HeroTitleState = {
      title,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const nextRaw = JSON.stringify(nextState);
    const result = raw === null
      ? await db.prepare('INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)').bind(settingsKey, nextRaw).run()
      : await db.prepare('UPDATE app_meta SET value = ? WHERE key = ? AND value = ?').bind(nextRaw, settingsKey, raw).run();
    const changes = Number((result.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (changes !== 1) {
      const latest = await readCurrent();
      return NextResponse.json({ ...latest.state, error: '標題已在另一個頁面更新，請確認後再儲存' }, { status: 409, headers: responseHeaders });
    }
    return NextResponse.json(nextState, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '網頁標題無法保存' }, { status: 500, headers: responseHeaders });
  }
}
