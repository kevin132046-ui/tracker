import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const simpleIconSlugs: Record<string, string> = {
  KO: 'cocacola',
  NVDA: 'nvidia',
  TTWO: '2k',
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
};

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) return NextResponse.json({ error: 'Invalid ticker.' }, { status: 400 });

  const companyImage = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
  const brandImage = simpleIconSlugs[ticker] ? `https://cdn.simpleicons.org/${simpleIconSlugs[ticker]}` : null;
  const domainImage = companyDomains[ticker] ? `https://icon.horse/icon/${companyDomains[ticker]}` : null;
  const sources = [...(domainImage ? [domainImage] : []), ...(brandImage ? [brandImage] : []), companyImage];

  for (const source of sources) {
    try {
      const response = await fetch(source, {
        headers: { Accept: 'image/svg+xml,image/png,image/*;q=0.8' },
        signal: AbortSignal.timeout(5000),
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
