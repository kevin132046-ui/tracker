import { NextResponse } from 'next/server';
import { searchJpStocks } from '@/lib/jp-stocks';

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
type MarketFilter = 'US' | 'JP' | null;

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
  { symbol: '7203.T', name: 'Toyota Motor Corporation', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '6758.T', name: 'Sony Group Corporation', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '9984.T', name: 'SoftBank Group Corp.', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '6861.T', name: 'Keyence Corporation', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '8306.T', name: 'Mitsubishi UFJ Financial Group, Inc.', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '8035.T', name: 'Tokyo Electron Limited', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '9983.T', name: 'Fast Retailing Co., Ltd.', exchange: 'Tokyo', type: 'Equity' },
  { symbol: '7974.T', name: 'Nintendo Co., Ltd.', exchange: 'Tokyo', type: 'Equity' },
];

function matchesMarket(symbol: string, market: MarketFilter) {
  if (market === 'JP') return symbol.endsWith('.T');
  if (market === 'US') return !symbol.endsWith('.T');
  return true;
}

function normalizedQuery(query: string, market: MarketFilter) {
  const term = query.trim().toUpperCase();
  return market === 'JP' && /^\d{4}$/.test(term) ? `${term}.T` : term;
}

const hasCjk = (value: string) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(value);

function localMatches(query: string, market: MarketFilter) {
  const term = normalizedQuery(query, market);
  // Japanese stocks by Japanese, English or Chinese name (Yahoo's search does not read Japanese names).
  const japanese = market === 'US' ? [] : searchJpStocks(query).map<SymbolResult>((item) => ({ symbol: item.symbol, name: item.name, exchange: 'Tokyo', type: 'Equity' }));
  const known = new Set(japanese.map((item) => item.symbol));
  return [...japanese, ...fallbackCatalog
    .filter((item) => matchesMarket(item.symbol, market) && (item.symbol.includes(term) || item.name.toUpperCase().includes(query.toUpperCase())))
    .filter((item) => !known.has(item.symbol))
    .sort((a, b) => relevanceScore(a, term) - relevanceScore(b, term) || a.symbol.length - b.symbol.length)].slice(0, 8);
}

function relevanceScore(item: SymbolResult, term: string) {
  if (item.symbol === term) return 0;
  if (item.symbol.startsWith(term)) return 1;
  if (item.symbol.includes(term)) return 2;
  if (item.name.toUpperCase().startsWith(term)) return 3;
  return 4;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim().slice(0, 40) ?? '';
  const marketParam = params.get('market')?.trim().toUpperCase();
  const market: MarketFilter = marketParam === 'JP' || marketParam === 'US' ? marketParam : null;
  if (!query) return NextResponse.json({ suggestions: [] });

  const searchQuery = normalizedQuery(query, market);
  const fallback = localMatches(query, market);
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      // Japanese searches ask Yahoo's Japan region, with more results so Tokyo listings are not crowded out by ADRs.
      const japan = market === 'JP' || hasCjk(query);
      const response = await fetch(`https://${host}/v1/finance/search?q=${encodeURIComponent(searchQuery)}&quotesCount=${japan ? 25 : 10}&newsCount=0&listsCount=0&enableFuzzyQuery=true${japan ? '&lang=ja-JP&region=JP' : ''}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Symbol search unavailable.');
      const payload = await response.json() as YahooSearch;
      const allowedTypes = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);
      const remote = (payload.quotes ?? []).flatMap<SymbolResult>((quote) => {
        const symbol = quote.symbol?.trim().toUpperCase();
        if (!symbol || !allowedTypes.has(quote.quoteType ?? '') || !matchesMarket(symbol, market)) return [];
        return [{
          symbol,
          name: quote.longname ?? quote.shortname ?? symbol,
          exchange: quote.exchDisp ?? quote.exchange ?? '',
          type: quote.typeDisp ?? quote.quoteType ?? '',
        }];
      });
      const unique = new Map<string, SymbolResult>();
      const named = market !== 'US' ? fallback.filter((item) => item.symbol.endsWith('.T')) : [];
      [...named, ...remote, ...fallback].forEach((item) => { if (!unique.has(item.symbol)) unique.set(item.symbol, item); });
      // Name-index hits keep their order; Yahoo's results follow by relevance.
      const rest = [...unique.values()].slice(named.length).sort((a, b) => relevanceScore(a, searchQuery) - relevanceScore(b, searchQuery) || a.symbol.length - b.symbol.length);
      const suggestions = [...named, ...rest].slice(0, 8);
      return NextResponse.json({ suggestions, source: 'Yahoo Finance search' }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } });
    } catch {
      // Try Yahoo's second public chart/search host before using the local catalog.
    }
  }
  return NextResponse.json({ suggestions: fallback, source: 'OptionFlow fallback catalog' }, { headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' } });
}
