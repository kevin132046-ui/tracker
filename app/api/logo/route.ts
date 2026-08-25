import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get('ticker')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) return NextResponse.json({ error: 'Invalid ticker.' }, { status: 400 });

  try {
    const response = await fetch(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`, {
      headers: { Accept: 'image/png,image/*;q=0.8' },
      signal: AbortSignal.timeout(5000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.startsWith('image/')) return new Response(null, { status: 404 });
    return new Response(response.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
