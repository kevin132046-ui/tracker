import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const simpleIconSlugs: Record<string, string> = {
  KO: 'cocacola',
  NVDA: 'nvidia',
  TTWO: 'taketwointeractivesoftware',
  V: 'visa',
};
const companyDomains: Record<string, string> = {
  CNC: 'centene.com',
  KO: 'coca-colacompany.com',
  MSFT: 'microsoft.com',
  NVDA: 'nvidia.com',
  SPGI: 'spglobal.com',
  TRV: 'travelers.com',
  TTWO: 'take2games.com',
  V: 'visa.com',
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
  CNC: 'https://www.centene.com/content/dam/centenedotcom/logos/centene_logo_2023.jpg',
  SPGI: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/S%26P_Global_logo.svg',
  TRV: 'https://www.travelers.com/ClientResources/tds-icons/assets/icons/logos/svg/trv-logo-2color-small.svg',
};

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) return NextResponse.json({ error: 'Invalid ticker.' }, { status: 400 });

  const companyImage = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
  const brandImage = simpleIconSlugs[ticker] ? `https://cdn.simpleicons.org/${simpleIconSlugs[ticker]}` : null;
  const officialImage = officialLogoSources[ticker] ?? null;
  const domainImage = companyDomains[ticker] ? `https://icon.horse/icon/${companyDomains[ticker]}?size=128` : null;
  const sources = [...(brandImage ? [brandImage] : []), ...(officialImage ? [officialImage] : []), ...(domainImage ? [domainImage] : []), companyImage];

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
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    } catch {
      continue;
    }
  }
  return new Response(null, { status: 404 });
}
