import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const simpleIconSlugs: Record<string, string> = {
  AAPL: 'apple',
  AMZN: 'amazon',
  AXP: 'americanexpress',
  GOOGL: 'google',
  KO: 'cocacola',
  META: 'meta',
  NVDA: 'nvidia',
  TSLA: 'tesla',
  TTWO: 'taketwointeractivesoftware',
  V: 'visa',
};
const companyDomains: Record<string, string> = {
  AAPL: 'apple.com',
  AMZN: 'amazon.com',
  AXP: 'americanexpress.com',
  BOXX: 'alphaarchitect.com',
  CNC: 'centene.com',
  COST: 'costco.com',
  DIS: 'thewaltdisneycompany.com',
  F: 'ford.com',
  INTC: 'intel.com',
  JNJ: 'jnj.com',
  JPM: 'jpmorganchase.com',
  KHC: 'kraftheinzcompany.com',
  GOOGL: 'google.com',
  KO: 'coca-colacompany.com',
  META: 'meta.com',
  MSFT: 'microsoft.com',
  NVDA: 'nvidia.com',
  SPGI: 'spglobal.com',
  SPY: 'ssga.com',
  TSLA: 'tesla.com',
  TRV: 'travelers.com',
  TTWO: 'take2games.com',
  V: 'visa.com',
  VST: 'vistracorp.com',
  '7203.T': 'global.toyota',
  '6758.T': 'sony.com',
  '9984.T': 'group.softbank',
  '6861.T': 'keyence.com',
  '8306.T': 'mufg.jp',
  '8035.T': 'tel.com',
  '9983.T': 'fastretailing.com',
  '7974.T': 'nintendo.co.jp',
};
const officialLogoSources: Record<string, string> = {
  AXP: 'https://upload.wikimedia.org/wikipedia/commons/3/30/American_Express_logo.svg',
  MSFT: 'https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg',
  SPGI: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/S%26P_Global_logo.svg',
  TRV: 'https://www.travelers.com/ClientResources/tds-icons/assets/icons/logos/svg/trv-logo-2color-small.svg',
};

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) return NextResponse.json({ error: 'Invalid ticker.' }, { status: 400 });

  const companyImage = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
  const brandImage = simpleIconSlugs[ticker] ? `https://cdn.simpleicons.org/${simpleIconSlugs[ticker]}` : null;
  const officialImage = officialLogoSources[ticker] ?? null;
  const domain = companyDomains[ticker] ?? null;
  const googleImage = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256` : null;
  const domainImage = domain ? `https://icon.horse/icon/${domain}?size=256` : null;
  const sources = [...(officialImage ? [officialImage] : []), ...(brandImage ? [brandImage] : []), ...(googleImage ? [googleImage] : []), ...(domainImage ? [domainImage] : []), companyImage];

  for (const source of sources) {
    try {
      const response = await fetch(source, {
        headers: {
          Accept: 'image/svg+xml,image/png,image/jpeg,image/*;q=0.8',
          Referer: `${new URL(source).origin}/`,
          'User-Agent': 'Mozilla/5.0 (compatible; OptionFlow/1.0; +https://openai.com/)',
        },
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.startsWith('image/')) continue;
      return new Response(response.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      continue;
    }
  }
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=3600' } });
}
