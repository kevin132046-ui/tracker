import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type YahooSearch = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
    exchDisp?: string;
    typeDisp?: string;
  }>;
};

type SymbolResult = { symbol: string; name: string; exchange: string; type: string };

const fallbackCatalog: SymbolResult[] = [
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'MSI', name: 'Motorola Solutions, Inc.', exchange: 'NYSE', type: 'Equity' },
  { symbol: 'MSCI', name: 'MSCI Inc.', exchange: 'NYSE', type: 'Equity' },
  { symbol: 'MS', name: 'Morgan Stanley', exchange: 'NYSE', type: 'Equity' },
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', type: 'Equity' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE Arca', type: 'ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', type: 'ETF' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', exchange: 'NYSE Arca', type: 'ETF' },
  { symbol: 'BOXX', name: 'Alpha Architect 1-3 Month Box ETF', exchange: 'Cboe', type: 'ETF' },
  { symbol: 'KO', name: 'The Coca-Cola Company', exchange: 'NYSE', type: 'Equity' },
  { symbol: 'V', name: 'Visa Inc.', exchange: 'NYSE', type: 'Equity' },
];

function localMatches(query: string) {
  const term = query.toUpperCase();
  return fallbackCatalog
    .filter((item) => item.symbol.includes(term) || item.name.toUpperCase().includes(term))
    .sort((a, b) => relevanceScore(a, term) - relevanceScore(b, term) || a.symbol.length - b.symbol.length)
    .slice(0, 8);
}

function relevanceScore(item: SymbolResult, term: string) {
  if (item.symbol === term) return 0;
  if (item.symbol.startsWith(term)) return 1;
  if (item.symbol.includes(term)) return 2;
  if (item.name.toUpperCase().startsWith(term)) return 3;
  return 4;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, 40) ?? '';
  if (!query) return NextResponse.json({ suggestions: [] });

  const fallback = localMatches(query);
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=true`, {
      headers: { Accept: 'application/json', 'User-Agent': 'OptionFlow/1.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error('Symbol search unavailable.');
    const payload = await response.json() as YahooSearch;
    const allowedTypes = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);
    const remote = (payload.quotes ?? []).flatMap<SymbolResult>((quote) => {
      const symbol = quote.symbol?.trim().toUpperCase();
      if (!symbol || !allowedTypes.has(quote.quoteType ?? '')) return [];
      return [{
        symbol,
        name: quote.longname ?? quote.shortname ?? symbol,
        exchange: quote.exchDisp ?? quote.exchange ?? '',
        type: quote.typeDisp ?? quote.quoteType ?? '',
      }];
    });
    const unique = new Map<string, SymbolResult>();
    [...remote, ...fallback].forEach((item) => { if (!unique.has(item.symbol)) unique.set(item.symbol, item); });
    const suggestions = [...unique.values()].sort((a, b) => relevanceScore(a, query.toUpperCase()) - relevanceScore(b, query.toUpperCase()) || a.symbol.length - b.symbol.length).slice(0, 8);
    return NextResponse.json({ suggestions, source: 'Yahoo Finance search' }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } });
  } catch {
    return NextResponse.json({ suggestions: fallback, source: 'OptionFlow fallback catalog' }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } });
  }
}
