import { NextResponse } from 'next/server';
import type { CompanyFilings } from '@/lib/filings';
import { SecNotConfigured, latestEarningsFilings, lookupCik } from '@/lib/server/sec';

export const dynamic = 'force-dynamic';

const symbolPattern = /^[A-Z0-9.-]{1,15}$/;
const maxSymbols = 40;

/** Latest earnings press release (8-K Item 2.02) and 10-Q / 10-K of each US symbol. */
export async function GET(request: Request) {
  const symbols = [...new Set(String(new URL(request.url).searchParams.get('symbols') ?? '').split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length || symbols.length > maxSymbols || symbols.some((symbol) => !symbolPattern.test(symbol))) {
    return NextResponse.json({ error: `請提供 1 到 ${maxSymbols} 個有效代號。` }, { status: 400 });
  }
  const filings: Record<string, CompanyFilings> = {};
  const unsupported: string[] = [];
  const failed: string[] = [];
  try {
    // SEC requests are spaced by the client, so symbols are simply taken in turn.
    for (const symbol of symbols) {
      if (symbol.endsWith('.T')) {
        unsupported.push(symbol);
        continue;
      }
      try {
        const company = await lookupCik(symbol);
        if (!company) unsupported.push(symbol);
        else filings[symbol] = await latestEarningsFilings(company.cik, company.name);
      } catch (error) {
        if (error instanceof SecNotConfigured) throw error;
        failed.push(symbol);
      }
    }
  } catch (error) {
    if (error instanceof SecNotConfigured) return NextResponse.json({ error: '伺服器尚未設定 SEC_CONTACT（SEC 要求的聯絡 Email），SEC 財報功能已停用。', code: 'sec-not-configured' }, { status: 503 });
    throw error;
  }
  if (failed.length) console.warn(`SEC filings unavailable: ${failed.join(', ')}`);
  return NextResponse.json({ filings, unsupported, failed, source: 'SEC EDGAR submissions' }, { headers: { 'Cache-Control': 'private, max-age=900' } });
}
