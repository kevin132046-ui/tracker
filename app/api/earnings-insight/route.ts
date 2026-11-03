import { NextResponse } from 'next/server';
import { reportDate, reportFile } from '@/lib/earnings-insight';

export const dynamic = 'force-dynamic';

/*
 * FactSet Earnings Insight, the weekly S&P 500 earnings report. GET resolves the latest issue (the
 * landing page redirects to EarningsInsight_MMDDYY.pdf); GET ?file=<that name> passes the PDF through
 * on this origin so the browser can read its text (lib/earnings-insight.ts). Only FactSet's report
 * folder and that file-name pattern are ever fetched.
 */
const landing = 'https://www.factset.com/earningsinsight';
const reportHost = 'advantage.factset.com';
const reportFolder = 'https://advantage.factset.com/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/';
const requestHeaders = { 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' };
const latestFreshMs = 3 * 60 * 60_000;

type Latest = { file: string; url: string; date: string | null };
let latestCache: { value: Latest; fetchedAt: number } | null = null;
let latestRequest: Promise<Latest> | null = null;
/** The URL each resolved file name came from, so ?file= follows FactSet's link even if the folder moves. */
const knownUrls = new Map<string, string>();

function reportFromUrl(value: string | null): Latest | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value, landing); } catch { return null; }
  const file = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (url.protocol !== 'https:' || url.hostname !== reportHost || !reportFile.test(file)) return null;
  return { file, url: url.toString(), date: reportDate(file) };
}

async function resolveLatest(): Promise<Latest> {
  const response = await fetch(landing, { headers: { ...requestHeaders, Accept: 'text/html' }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  let latest = reportFromUrl(response.headers.get('location'));
  // A page instead of a redirect: the first link to a report on it.
  if (!latest && response.ok) {
    const link = (await response.text()).match(/https:\/\/advantage\.factset\.com\/[^"'\s<>]*EarningsInsight_\d{6}\.pdf/);
    latest = reportFromUrl(link?.[0] ?? null);
  } else {
    await response.body?.cancel();
  }
  if (!latest) throw new Error(`Earnings Insight link not found (${response.status}).`);
  knownUrls.set(latest.file, latest.url);
  return latest;
}

function latestReport() {
  if (latestCache && Date.now() - latestCache.fetchedAt < latestFreshMs) return Promise.resolve(latestCache.value);
  latestRequest ??= resolveLatest().then((value) => {
    latestCache = { value, fetchedAt: Date.now() };
    return value;
  }, (error: unknown) => {
    if (latestCache) return latestCache.value;
    throw error;
  }).finally(() => { latestRequest = null; });
  return latestRequest;
}

export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get('file');
  if (file === null) {
    try {
      return NextResponse.json(await latestReport(), { headers: { 'Cache-Control': 'public, max-age=1800' } });
    } catch (error) {
      console.warn(error instanceof Error ? error.message : 'Earnings Insight unavailable.');
      return NextResponse.json({ error: '暫時連不上 FactSet。' }, { status: 502 });
    }
  }
  if (!reportFile.test(file)) return NextResponse.json({ error: '不是 Earnings Insight 的檔名。' }, { status: 400 });
  try {
    const upstream = await fetch(knownUrls.get(file) ?? `${reportFolder}${file}`, { headers: { ...requestHeaders, Accept: 'application/pdf' }, signal: AbortSignal.timeout(20_000) });
    const type = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !upstream.body || !/pdf|octet-stream/i.test(type)) {
      await upstream.body?.cancel();
      return NextResponse.json({ error: `FactSet 回應 ${upstream.status}。` }, { status: 502 });
    }
    // Each issue has its own file name, so the browser may keep it for a week.
    return new Response(upstream.body, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=604800, immutable' } });
  } catch (error) {
    console.warn(error instanceof Error ? error.message : 'Earnings Insight PDF unavailable.');
    return NextResponse.json({ error: '暫時連不上 FactSet。' }, { status: 502 });
  }
}
