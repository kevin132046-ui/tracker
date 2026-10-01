import { NextResponse } from 'next/server';
import { SecNotConfigured, quarterlyFigures } from '@/lib/server/sec';

export const dynamic = 'force-dynamic';

/** Recent quarterly revenue, diluted EPS and gross margin (SEC XBRL company facts) for 財報解讀. */
export async function GET(request: Request) {
  const cik = String(new URL(request.url).searchParams.get('cik') ?? '');
  if (!/^\d{1,10}$/.test(cik)) return NextResponse.json({ error: '請提供有效的 CIK。' }, { status: 400 });
  try {
    const figures = await quarterlyFigures(cik, 6);
    return NextResponse.json({ figures, source: 'SEC EDGAR company facts (XBRL)' }, { headers: { 'Cache-Control': 'private, max-age=21600' } });
  } catch (error) {
    if (error instanceof SecNotConfigured) return NextResponse.json({ error: 'SEC 財報功能未設定。', code: 'sec-not-configured' }, { status: 503 });
    return NextResponse.json({ error: '暫時無法取得財報數字。' }, { status: 502 });
  }
}
