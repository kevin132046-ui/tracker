import { ensureDatabase } from '@/lib/server/database';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const imageSettingsKey = 'background_image_v3';
const modeSettingsKey = 'background_mode_v3';
const objectPrefix = 'portfolio/backgrounds/';
const maxBackgroundBytes = 4 * 1024 * 1024;
const versionPattern = /^\d{10,16}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BackgroundMode = 'default' | 'image';
type BackgroundImageSettings = {
  activeKey: string;
  updatedAt: string;
  version: string;
};
type BackgroundSettings = BackgroundImageSettings & { mode: BackgroundMode };

const noStoreHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function validImageSettings(value: unknown): value is BackgroundImageSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackgroundImageSettings>;
  return typeof candidate.activeKey === 'string'
    && candidate.activeKey.startsWith(objectPrefix)
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.version === 'string'
    && versionPattern.test(candidate.version)
    && candidate.activeKey === `${objectPrefix}${candidate.version}.jpg`;
}

async function readSettings(): Promise<BackgroundSettings | null> {
  const db = await ensureDatabase();
  const result = await db.prepare('SELECT key, value FROM app_meta WHERE key IN (?, ?)')
    .bind(imageSettingsKey, modeSettingsKey)
    .all<{ key: string; value: string }>();
  const imageValue = result.results.find((row) => row.key === imageSettingsKey)?.value;
  if (!imageValue) return null;

  let imageSettings: unknown;
  try {
    imageSettings = JSON.parse(imageValue);
  } catch {
    return null;
  }
  if (!validImageSettings(imageSettings)) return null;

  const storedMode = result.results.find((row) => row.key === modeSettingsKey)?.value;
  const mode: BackgroundMode = storedMode === 'default' ? 'default' : 'image';
  return { ...imageSettings, mode };
}

async function writeImageSettings(settings: BackgroundImageSettings, mode: BackgroundMode) {
  const db = await ensureDatabase();
  const upsert = `INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
  await db.batch([
    db.prepare(upsert).bind(imageSettingsKey, JSON.stringify(settings)),
    db.prepare(upsert).bind(modeSettingsKey, mode),
  ]);
}

async function writeMode(mode: BackgroundMode) {
  const db = await ensureDatabase();
  await db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(modeSettingsKey, mode)
    .run();
}

function imageUrlFor(version: string) {
  return `/api/background?image=1&version=${encodeURIComponent(version)}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('image') === '1') {
      const version = url.searchParams.get('version') ?? '';
      if (!versionPattern.test(version)) {
        return new Response(null, { status: 400, headers: noStoreHeaders });
      }

      const object = await env.BACKGROUND_IMAGES.get(`${objectPrefix}${version}.jpg`);
      if (!object) return new Response(null, { status: 404, headers: noStoreHeaders });

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Content-Type', 'image/jpeg');
      headers.set('ETag', object.httpEtag);
      headers.set('Cache-Control', 'private, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(object.body, { headers });
    }

    const settings = await readSettings();
    if (!settings || !(await env.BACKGROUND_IMAGES.head(settings.activeKey))) {
      return NextResponse.json({ exists: false, mode: 'default', imageUrl: null, updatedAt: null }, { headers: noStoreHeaders });
    }

    return NextResponse.json({
      exists: true,
      mode: settings.mode,
      imageUrl: imageUrlFor(settings.version),
      updatedAt: settings.updatedAt,
      version: settings.version,
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '背景設定無法讀取' }, { status: 500, headers: noStoreHeaders });
  }
}

export async function PUT(request: Request) {
  let uploadedKey = '';
  let settingsCommitted = false;
  try {
    const requestedMode = new URL(request.url).searchParams.get('mode') ?? 'image';
    if (requestedMode !== 'default' && requestedMode !== 'image') {
      return NextResponse.json({ error: '背景模式不正確' }, { status: 400, headers: noStoreHeaders });
    }
    const mode: BackgroundMode = requestedMode;

    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'image/jpeg') {
      return NextResponse.json({ error: '背景圖片必須是 JPEG 格式' }, { status: 415, headers: noStoreHeaders });
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBackgroundBytes) {
      return NextResponse.json({ error: '背景圖片不可超過 4 MB' }, { status: 413, headers: noStoreHeaders });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBackgroundBytes) {
      return NextResponse.json({ error: bytes.byteLength === 0 ? '背景圖片內容是空的' : '背景圖片不可超過 4 MB' }, { status: bytes.byteLength === 0 ? 400 : 413, headers: noStoreHeaders });
    }
    const last = bytes.byteLength - 1;
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[last - 1] !== 0xff || bytes[last] !== 0xd9) {
      return NextResponse.json({ error: '背景圖片內容不是完整的 JPEG' }, { status: 400, headers: noStoreHeaders });
    }

    const previousSettings = await readSettings();
    const updatedAt = new Date().toISOString();
    const version = `${Date.now()}-${crypto.randomUUID()}`;
    uploadedKey = `${objectPrefix}${version}.jpg`;
    const imageSettings: BackgroundImageSettings = { activeKey: uploadedKey, updatedAt, version };

    await env.BACKGROUND_IMAGES.put(uploadedKey, bytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { updatedAt, version },
    });
    await writeImageSettings(imageSettings, mode);
    settingsCommitted = true;

    if (previousSettings && previousSettings.activeKey !== uploadedKey) {
      try {
        const currentSettings = await readSettings();
        if (currentSettings?.activeKey === uploadedKey && previousSettings.activeKey !== currentSettings.activeKey) {
          await env.BACKGROUND_IMAGES.delete(previousSettings.activeKey);
        }
      } catch {
        // Cleanup is best effort and must never invalidate the committed image.
      }
    }

    return NextResponse.json({
      saved: true,
      mode,
      imageUrl: imageUrlFor(version),
      updatedAt,
      version,
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (uploadedKey && !settingsCommitted) {
      try {
        await env.BACKGROUND_IMAGES.delete(uploadedKey);
      } catch {
        // A harmless orphan is preferable to replacing a previously working background.
      }
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : '背景圖片無法保存' }, { status: 500, headers: noStoreHeaders });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { mode?: BackgroundMode };
    if (body.mode !== 'default' && body.mode !== 'image') {
      return NextResponse.json({ error: '背景模式不正確' }, { status: 400, headers: noStoreHeaders });
    }

    const settings = await readSettings();
    if (!settings || !(await env.BACKGROUND_IMAGES.head(settings.activeKey))) {
      return NextResponse.json({ error: '尚未保存背景圖片' }, { status: 409, headers: noStoreHeaders });
    }

    await writeMode(body.mode);
    return NextResponse.json({ saved: true, mode: body.mode }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '背景模式無法保存' }, { status: 500, headers: noStoreHeaders });
  }
}
