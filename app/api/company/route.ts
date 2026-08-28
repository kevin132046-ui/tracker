import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const metricTypes = [
  'trailingMarketCap', 'trailingPeRatio', 'trailingForwardPeRatio', 'trailingPsRatio',
  'trailingPbRatio', 'trailingEnterprisesValueEBITDARatio', 'trailingFreeCashFlow',
  'trailingStockBasedCompensation', 'trailingNetIncome', 'trailingTotalRevenue',
  'trailingOperatingIncome', 'quarterlyTotalDebt',
  'quarterlyCashCashEquivalentsAndShortTermInvestments', 'quarterlyCashAndCashEquivalents',
  'quarterlyNetIncome', 'quarterlyTotalRevenue', 'trailingCashDividendsPaid',
  'annualCashDividendsPaid', 'quarterlyDilutedAverageShares', 'trailingDilutedAverageShares',
] as const;

type TimeSeriesPoint = { asOfDate?: string; reportedValue?: { raw?: number } };
type TimeSeriesResult = { meta?: { type?: string | string[] }; [key: string]: unknown };
type TimeSeriesPayload = { timeseries?: { result?: TimeSeriesResult[]; error?: { description?: string } } };
type ChartPayload = { chart?: { result?: Array<{
  meta?: { symbol?: string; shortName?: string; longName?: string; currency?: string; exchangeName?: string; fullExchangeName?: string; regularMarketPrice?: number; instrumentType?: string };
  events?: { dividends?: Record<string, { date?: number; amount?: number }> };
}> } };

const metricType = (result: TimeSeriesResult | undefined) => {
  const type = result?.meta?.type;
  return Array.isArray(type) ? type[0] : type;
};

const raw = (result: TimeSeriesResult | undefined) => {
  const type = metricType(result);
  if (!type) return null;
  const series = result?.[type] as TimeSeriesPoint[] | undefined;
  const value = series?.findLast((point) => Number.isFinite(point.reportedValue?.raw))?.reportedValue?.raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const points = (result: TimeSeriesResult | undefined) => {
  const type = metricType(result);
  if (!type) return [];
  return ((result?.[type] as TimeSeriesPoint[] | undefined) ?? [])
    .flatMap((point) => Number.isFinite(point.reportedValue?.raw) ? [{ date: point.asOfDate ?? '', value: Number(point.reportedValue?.raw) }] : [])
    .sort((a, b) => a.date.localeCompare(b.date));
};

const ratio = (numerator: number | null, denominator: number | null) => numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
const yearOverYear = (series: Array<{ date: string; value: number }>) => {
  if (series.length < 2) return null;
  const latest = series.at(-1)!;
  const targetYear = String(Number(latest.date.slice(0, 4)) - 1);
  const prior = series.findLast((point) => point.date.startsWith(targetYear)) ?? series.at(-5);
  return prior && prior.value !== 0 ? (latest.value - prior.value) / Math.abs(prior.value) : null;
};

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Market data request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return NextResponse.json({ error: '請輸入有效的股票代號。' }, { status: 400 });

  try {
    const now = Math.floor(Date.now() / 1000);
    const period1 = now - 3 * 366 * 86_400;
    let timeSeries: TimeSeriesPayload | null = null;
    let chart: ChartPayload | null = null;
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const encoded = encodeURIComponent(symbol);
        const [seriesPayload, chartPayload] = await Promise.all([
          fetchJson<TimeSeriesPayload>(`https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encoded}?symbol=${encoded}&type=${metricTypes.join(',')}&period1=${period1}&period2=${now}`),
          fetchJson<ChartPayload>(`https://${host}/v8/finance/chart/${encoded}?range=2y&interval=1d&events=div%2Csplits`),
        ]);
        if (!seriesPayload.timeseries?.result?.length || !chartPayload.chart?.result?.[0]) throw new Error('Company data unavailable.');
        timeSeries = seriesPayload;
        chart = chartPayload;
        break;
      } catch {
        timeSeries = null;
        chart = null;
      }
    }
    if (!timeSeries || !chart) throw new Error(`${symbol} 的公司資料暫時無法取得。`);

    const resultList = timeSeries.timeseries?.result ?? [];
    const byType = new Map(resultList.map((result) => [metricType(result) ?? '', result]));
    const get = (type: string) => raw(byType.get(type));
    const marketCap = get('trailingMarketCap');
    const freeCashFlow = get('trailingFreeCashFlow');
    const stockBasedCompensation = get('trailingStockBasedCompensation');
    const netIncome = get('trailingNetIncome');
    const revenue = get('trailingTotalRevenue');
    const operatingIncome = get('trailingOperatingIncome');
    const cash = get('quarterlyCashCashEquivalentsAndShortTermInvestments') ?? get('quarterlyCashAndCashEquivalents');
    const debt = get('quarterlyTotalDebt');
    const dividendsPaid = Math.abs(get('trailingCashDividendsPaid') ?? get('annualCashDividendsPaid') ?? 0) || null;
    const adjustedFreeCashFlow = freeCashFlow === null ? null : freeCashFlow - (stockBasedCompensation ?? 0);
    const meta = chart.chart?.result?.[0]?.meta ?? {};
    const dividendEvents = Object.values(chart.chart?.result?.[0]?.events?.dividends ?? {}).sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
    const latestDividend = dividendEvents.at(-1);
    const dilutedShares = get('trailingDilutedAverageShares') ?? get('quarterlyDilutedAverageShares');

    return NextResponse.json({
      symbol,
      name: meta.longName ?? meta.shortName ?? symbol,
      currency: meta.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD'),
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
      instrumentType: meta.instrumentType ?? '',
      price: Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : null,
      updatedAt: new Date().toISOString(),
      metrics: {
        marketCap,
        trailingPe: get('trailingPeRatio'),
        forwardPe: get('trailingForwardPeRatio'),
        priceToSales: get('trailingPsRatio'),
        evToEbitda: get('trailingEnterprisesValueEBITDARatio'),
        priceToBook: get('trailingPbRatio'),
        freeCashFlow,
        freeCashFlowYield: ratio(freeCashFlow, marketCap),
        adjustedFreeCashFlow,
        adjustedFreeCashFlowYield: ratio(adjustedFreeCashFlow, marketCap),
        stockBasedCompensation,
        stockBasedCompensationImpact: freeCashFlow === null || freeCashFlow === 0 || stockBasedCompensation === null ? null : -stockBasedCompensation / Math.abs(freeCashFlow),
        profitMargin: ratio(netIncome, revenue),
        operatingMargin: ratio(operatingIncome, revenue),
        quarterlyEarningsGrowth: yearOverYear(points(byType.get('quarterlyNetIncome'))),
        quarterlyRevenueGrowth: yearOverYear(points(byType.get('quarterlyTotalRevenue'))),
        cash,
        debt,
        netCash: cash === null || debt === null ? null : cash - debt,
        dividendYield: ratio(dividendsPaid, marketCap),
        payoutRatio: netIncome === null || netIncome <= 0 ? null : ratio(dividendsPaid, netIncome),
        latestDividendDate: latestDividend?.date ? new Date(latestDividend.date * 1000).toISOString().slice(0, 10) : null,
        latestDividendAmount: latestDividend?.amount ?? null,
        dilutedShares,
      },
      source: 'Yahoo Finance — fundamentals time series and exchange chart data',
    }, { headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=1800' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '公司資料暫時無法取得。' }, { status: 502 });
  }
}
