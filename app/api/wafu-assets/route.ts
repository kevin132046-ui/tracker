import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import type { WafuAsset, WafuAssets, WafuAssetSlot } from '@/lib/wafu/asset-slots';
import { assetKind, assetUrl, assetVersionPattern, isWafuAssetSlot, maxAssetBytes, sniffAsset } from '@/lib/wafu/asset-slots';

export const dynamic = 'force-dynamic';

// Stored beside the site background in the same bucket: wafu/<slot>/<version>.
const prefix = 'wafu/';
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });
// A Cloudflare Preview only has the bindings listed in the config's previews block.
const noBucket = () => env.BACKGROUND_IMAGES ? null : fail('這個網址沒有連到 R2 儲存空間（BACKGROUND_IMAGES 未綁定），無法存取和風素材。', 503);

async function listSlot(slot?: WafuAssetSlot) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKGROUND_IMAGES.list({ prefix: slot ? `${prefix}${slot}/` : prefix, cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function describe(object: R2Object): WafuAsset | null {
  const [, slot, version] = object.key.split('/');
  if (!isWafuAssetSlot(slot) || !assetVersionPattern.test(version ?? '')) return null;
  return {
    slot,
    version,
    type: object.httpMetadata?.contentType ?? 'application/octet-stream',
    size: object.size,
    name: object.customMetadata?.name ?? '',
    updatedAt: object.customMetadata?.updatedAt ?? object.uploaded.toISOString(),
    url: assetUrl(slot, version),
  };
}

/** Without a slot: what is uploaded. With ?slot=&v=: the file itself (ranges supported, so audio can seek). */
export async function GET(request: Request) {
  const missing = noBucket();
  if (missing) return missing;
  try {
    const url = new URL(request.url);
    const slot = url.searchParams.get('slot');
    if (!slot) {
      const assets: WafuAssets = {};
      // Listings carry no metadata here, so each file (six at most) is read with head().
      const heads = await Promise.all((await listSlot()).map((object) => env.BACKGROUND_IMAGES.head(object.key)));
      for (const object of heads) {
        const asset = object && describe(object);
        // Newest version wins if an older one was not cleaned up.
        if (asset && (!assets[asset.slot] || assets[asset.slot]!.version < asset.version)) assets[asset.slot] = asset;
      }
      return NextResponse.json({ assets }, { headers: noStore });
    }

    const version = url.searchParams.get('v') ?? '';
    if (!isWafuAssetSlot(slot) || !assetVersionPattern.test(version)) return new Response(null, { status: 400, headers: noStore });
    const key = `${prefix}${slot}/${version}`;
    const head = await env.BACKGROUND_IMAGES.head(key);
    if (!head) return new Response(null, { status: 404, headers: noStore });

    const headers = new Headers({
      'Content-Type': head.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
      'ETag': head.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    });
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const size = head.size;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const object = await env.BACKGROUND_IMAGES.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!object) return new Response(null, { status: 404, headers: noStore });
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(object.body, { status: 206, headers });
    }
    const object = await env.BACKGROUND_IMAGES.get(key);
    if (!object) return new Response(null, { status: 404, headers: noStore });
    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  } catch (error) {
    return fail(error instanceof Error ? error.message : '和風素材無法讀取', 500);
  }
}

/** Replaces one slot: PUT ?slot=<slot> with the file as the body (and X-File-Name for music). */
export async function PUT(request: Request) {
  const missing = noBucket();
  if (missing) return missing;
  const slot = new URL(request.url).searchParams.get('slot');
  if (!isWafuAssetSlot(slot)) return fail('素材欄位不正確', 400);
  const kind = assetKind(slot);
  const limit = maxAssetBytes[kind];
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > limit) return fail(`檔案不可超過 ${limit / 1024 / 1024} MB`, 413);
  let key = '';
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength) return fail('檔案內容是空的', 400);
    if (bytes.byteLength > limit) return fail(`檔案不可超過 ${limit / 1024 / 1024} MB`, 413);
    const type = sniffAsset(kind, bytes);
    if (!type) return fail(kind === 'bgm' ? '不支援這種音檔（可用 MP3、M4A、OGG、WAV、FLAC、WebM）' : kind === 'bg' ? '背景必須是 JPEG' : '剪影必須是 PNG', 415);

    let name = '';
    try { name = decodeURIComponent(request.headers.get('x-file-name') ?? ''); } catch { /* keep it blank */ }
    name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\.[a-z0-9]{2,5}$/i, '').trim().slice(0, 80);
    const updatedAt = new Date().toISOString();
    const version = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    key = `${prefix}${slot}/${version}`;
    const previous = await listSlot(slot);
    await env.BACKGROUND_IMAGES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { name, updatedAt } });
    // The new file is in place; older versions go (best effort, a leftover is only ignored).
    await Promise.all(previous.map((object) => env.BACKGROUND_IMAGES.delete(object.key).catch(() => undefined)));
    const asset: WafuAsset = { slot, version, type, size: bytes.byteLength, name, updatedAt, url: assetUrl(slot, version) };
    return NextResponse.json({ saved: true, asset }, { headers: noStore });
  } catch (error) {
    if (key) await env.BACKGROUND_IMAGES.delete(key).catch(() => undefined);
    return fail(error instanceof Error ? error.message : '和風素材無法保存', 500);
  }
}

export async function DELETE(request: Request) {
  const missing = noBucket();
  if (missing) return missing;
  const slot = new URL(request.url).searchParams.get('slot');
  if (!isWafuAssetSlot(slot)) return fail('素材欄位不正確', 400);
  try {
    const objects = await listSlot(slot);
    await Promise.all(objects.map((object) => env.BACKGROUND_IMAGES.delete(object.key)));
    return NextResponse.json({ deleted: objects.length }, { headers: noStore });
  } catch (error) {
    return fail(error instanceof Error ? error.message : '和風素材無法刪除', 500);
  }
}
