import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type TechnicalRange = '3mo' | '6mo' | '1y';
type YahooChart = {
  chart?: { result?: Array<{
    timestamp?: number[];
    indicators?: {
      adjclose?: Array<{ adjclose?: Array<number | null> }>;
      quote?: Array<{ close?: Array<number | null> }>;
    };
  }> };
};

function exponentialMovingAverage(values: number[], period: number) {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  const alpha = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
    result[index] = previous;
  }
  return result;
}

function relativeStrengthIndex(values: number[], period = 14) {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gainTotal = 0;
  let lossTotal = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gainTotal += Math.max(0, change);
    lossTotal += Math.max(0, -change);
  }
  let averageGain = gainTotal / period;
  let averageLoss = lossTotal / period;
  const calculate = () => averageGain === 0 && averageLoss === 0 ? 50 : averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  result[period] = calculate();
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    result[index] = calculate();
  }
  return result;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get('symbol')?.trim().toUpperCase() ?? '';
  const rangeParam = params.get('range');
  const range: TechnicalRange = rangeParam === '3mo' || rangeParam === '1y' ? rangeParam : '6mo';
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) return NextResponse.json({ error: 'Invalid symbol.' }, { status: 400 });

  try {
    const visibleDays = range === '3mo' ? 92 : range === '1y' ? 366 : 184;
    const now = Date.now();
    const visibleStart = now - visibleDays * 86_400_000;
    const period1 = Math.floor((visibleStart - 160 * 86_400_000) / 1000);
    const period2 = Math.floor((now + 86_400_000) / 1000);
    let payload: YahooChart | null = null;
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`${symbol} historical prices are unavailable.`);
        payload = await response.json() as YahooChart;
        if (payload.chart?.result?.[0]) break;
      } catch {
        payload = null;
      }
    }
    if (!payload) throw new Error(`${symbol} historical prices are unavailable.`);
    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
    const raw = timestamps.flatMap((timestamp, index) => {
      const close = closes[index];
      return typeof close === 'number' && Number.isFinite(close)
        ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close }]
        : [];
    });
    if (raw.length < 2) throw new Error(`${symbol} historical prices are unavailable.`);

    const values = raw.map((point) => point.close);
    const rsi = relativeStrengthIndex(values);
    const ema12 = exponentialMovingAverage(values, 12);
    const ema26 = exponentialMovingAverage(values, 26);
    const macdValues = values.map((_, index) => ema12[index] !== null && ema26[index] !== null ? ema12[index]! - ema26[index]! : null);
    const compactMacd = macdValues.filter((value): value is number => value !== null);
    const compactSignal = exponentialMovingAverage(compactMacd, 9);
    let signalIndex = 0;
    const signalValues = macdValues.map((value) => value === null ? null : compactSignal[signalIndex++]);
    const points = raw.map((point, index) => ({
      ...point,
      rsi: rsi[index],
      macd: macdValues[index],
      signal: signalValues[index],
      histogram: macdValues[index] !== null && signalValues[index] !== null ? macdValues[index]! - signalValues[index]! : null,
    })).filter((point) => new Date(`${point.date}T00:00:00Z`).getTime() >= visibleStart);
    if (points.length < 2) throw new Error(`${symbol} historical prices are unavailable.`);
    const latest = points.at(-1)!;
    const previous = points.at(-2)!;
    return NextResponse.json({
      symbol,
      range,
      points,
      latestPrice: latest.close,
      change: latest.close - previous.close,
      changePercent: previous.close ? latest.close / previous.close - 1 : 0,
      updatedAt: new Date().toISOString(),
      source: 'Yahoo Finance — daily adjusted close',
    }, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load technical indicators.' }, { status: 502 });
  }
}
