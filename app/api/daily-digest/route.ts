import { NextResponse } from 'next/server';
import { guarded } from '@/lib/server/data-gate';
import { cleanDigestSettings, digestDayFor } from '@/lib/daily-digest';
import { digestDatabase, readDigests, readDigestSettings, runDailyDigest, writeDigestSettings } from '@/lib/server/daily-digest';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

/** 每日彙總: the latest digests, the settings, and whether the session just closed still needs one. */
async function handleGET() {
  const db = await digestDatabase();
  const [settings, digests] = await Promise.all([readDigestSettings(db), readDigests(db)]);
  const day = digestDayFor(Date.now());
  const due = settings.enabled && !digests.some((digest) => digest.day === day);
  return NextResponse.json({ settings, digests, day, due }, { headers: noStore });
}

/** Writes the digest the Cron trigger missed (the desktop app has none); a second caller gets the first one's. */
async function handlePOST(request: Request) {
  const body = await request.json().catch(() => ({})) as { force?: unknown };
  const run = await runDailyDigest(Date.now(), body.force === true);
  return NextResponse.json(run, { headers: noStore });
}

async function handlePUT(request: Request) {
  const body = await request.json().catch(() => null);
  const settings = await writeDigestSettings(await digestDatabase(), cleanDigestSettings(body));
  return NextResponse.json({ settings }, { headers: noStore });
}

// The owner's positions and AI use: only behind Cloudflare Access (lib/server/data-gate).
export const GET = guarded(handleGET);
export const POST = guarded(handlePOST);
export const PUT = guarded(handlePUT);
