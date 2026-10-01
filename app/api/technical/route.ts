import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type TechnicalRange = '1d' | '1w' | '1mo' | '3mo' | '6mo' | '1y' | 'custom';
type YahooChart = {
  chart?: { result?: Array<{
    timestamp?: number[];
    meta?: {
      regularMarketPrice?: number;
      regularMarketOpen?: number;
      regularMarketDayHigh?: number;
      regularMarketDayLow?: number;
      regularMarketVolume?: number;
      previousClose?: number;
      chartPreviousClose?: number;
      regularMarketTime?: number;
      currency?: string;
    };
    indicators?: {
      quote?: Array<{
        open?: Array<number | null>;
        high?: Array<number | null>;
        low?: Array<number | null>;
        close?: Array<number | null>;
        volume?: Array<number | null>;
      }>;
    };
  }> };
};

const DAY = 86_400_000;
const presetRanges: TechnicalRange[] = ['1d', '1w', '1mo', '3mo', '6mo', '1y', 'custom'];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

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

function simpleMovingAverage(values: number[], period: number) {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  let rolling = 0;
  for (let index = 0; index < values.length; index += 1) {
    rolling += values[index];
    if (index >= period) rolling -= values[index - period];
    if (index >= period - 1) result[index] = rolling / period;
  }
  return result;
}

function bollingerBands(values: number[], period = 20, multiplier = 2) {
  const middle = simpleMovingAverage(values, period);
  const upper: Array<number | null> = Array(values.length).fill(null);
  const lower: Array<number | null> = Array(values.length).fill(null);
  for (let index = period - 1; index < values.length; index += 1) {
    const mean = middle[index];
    if (mean === null) continue;
    let squaredDifference = 0;
    for (let offset = index - period + 1; offset <= index; offset += 1) {
      squaredDifference += (values[offset] - mean) ** 2;
    }
    const deviation = Math.sqrt(squaredDifference / period) * multiplier;
    upper[index] = mean + deviation;
    lower[index] = mean - deviation;
  }
  return { middle, upper, lower };
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

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get('symbol')?.trim().toUpperCase() ?? '';
  const rangeParam = params.get('range') as TechnicalRange | null;
  const range: TechnicalRange = rangeParam && presetRanges.includes(rangeParam) ? rangeParam : '6mo';
  if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) return NextResponse.json({ error: 'Invalid symbol.' }, { status: 400 });

  const now = Date.now();
  let visibleEnd = now + DAY;
  let visibleStart = now - (range === '1d' ? 1 : range === '1w' ? 7 : range === '1mo' ? 31 : range === '3mo' ? 92 : range === '1y' ? 366 : 184) * DAY;
  if (range === 'custom') {
    const customStart = parseDate(params.get('from'));
    const customEnd = parseDate(params.get('to'), true);
    if (customStart === null || customEnd === null || customEnd <= customStart) {
      return NextResponse.json({ error: '請選擇有效的開始與結束日期。' }, { status: 400 });
    }
    if (customEnd - customStart > 5 * 366 * DAY) {
      return NextResponse.json({ error: '自訂期間最長為 5 年。' }, { status: 400 });
    }
    visibleStart = customStart;
    visibleEnd = Math.min(customEnd, now + DAY);
  }

  const spanDays = Math.max(1, Math.ceil((visibleEnd - visibleStart) / DAY));
  const endAgeDays = Math.max(0, Math.floor((now - visibleEnd) / DAY));
  const interval = range === '1d' || (range === 'custom' && spanDays <= 2 && endAgeDays <= 2)
    ? '5m'
    : range === '1w' || (range === 'custom' && spanDays <= 14 && endAgeDays <= 7)
      ? '30m'
      : '1d';
  const warmupDays = interval === '5m' ? 10 : interval === '30m' ? 45 : 330;
  const period1 = Math.floor((visibleStart - warmupDays * DAY) / 1000);
  const period2 = Math.floor((visibleEnd + DAY) / 1000);

  try {
    let payload: YahooChart | null = null;
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}&events=div%2Csplits&includePrePost=false`, {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OptionFlow/1.0' },
          cache: 'no-store',
          signal: AbortSignal.timeout(5_000),
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
    const meta = result?.meta;
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    const raw = timestamps.flatMap((timestamp, index) => {
      const close = quote?.close?.[index];
      if (!finite(close)) return [];
      const open = finite(quote?.open?.[index]) ? quote!.open![index]! : close;
      const highValue = finite(quote?.high?.[index]) ? quote!.high![index]! : Math.max(open, close);
      const lowValue = finite(quote?.low?.[index]) ? quote!.low![index]! : Math.min(open, close);
      return [{ timestamp, date: new Date(timestamp * 1000).toISOString().slice(0, 10), open, high: Math.max(highValue, open, close), low: Math.min(lowValue, open, close), close, volume: finite(quote?.volume?.[index]) ? quote!.volume![index]! : null }];
    });
    if (interval === '1d' && finite(meta?.regularMarketPrice) && finite(meta?.regularMarketTime)) {
      const marketDate = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);
      const last = raw.at(-1);
      const open = finite(meta.regularMarketOpen) ? meta.regularMarketOpen : meta.regularMarketPrice;
      const high = finite(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : Math.max(open, meta.regularMarketPrice);
      const low = finite(meta.regularMarketDayLow) ? meta.regularMarketDayLow : Math.min(open, meta.regularMarketPrice);
      const marketPoint = { timestamp: meta.regularMarketTime, date: marketDate, open, high: Math.max(high, open, meta.regularMarketPrice), low: Math.min(low, open, meta.regularMarketPrice), close: meta.regularMarketPrice , volume: finite(meta.regularMarketVolume) ? meta.regularMarketVolume : last?.volume ?? null };
      if (!last || marketDate > last.date) raw.push(marketPoint);
      else if (marketDate === last.date) raw[raw.length - 1] = marketPoint;
    }
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
    const ma20 = simpleMovingAverage(values, 20);
    const ma50 = simpleMovingAverage(values, 50);
    const ma200 = simpleMovingAverage(values, 200);
    const bollinger = bollingerBands(values);
    const enriched = raw.map((point, index) => ({
      ...point,
      rsi: rsi[index],
      macd: macdValues[index],
      signal: signalValues[index],
      histogram: macdValues[index] !== null && signalValues[index] !== null ? macdValues[index]! - signalValues[index]! : null,
      ma20: ma20[index],
      ma50: ma50[index],
      ma200: ma200[index],
      bollMiddle: bollinger.middle[index],
      bollUpper: bollinger.upper[index],
      bollLower: bollinger.lower[index],
    }));
    let points = range === '1d'
      ? enriched.filter((point) => point.timestamp * 1000 <= visibleEnd)
      : enriched.filter((point) => point.timestamp * 1000 >= visibleStart && point.timestamp * 1000 <= visibleEnd);
    if (range === '1d' && points.length) {
      const latestTradingDate = points.at(-1)!.date;
      points = points.filter((point) => point.date === latestTradingDate);
    }
    if (!points.length) throw new Error(`${symbol} 在所選期間沒有價格資料。`);

    const latest = points.at(-1)!;
    const previous = points.at(-2) ?? enriched.findLast((point) => point.timestamp < latest.timestamp) ?? latest;
    const useDailyReference = interval !== '1d' && (range !== 'custom' || visibleEnd >= now - 2 * DAY);
    const latestPrice = latest.close;
    const previousClose = useDailyReference && finite(meta?.previousClose)
      ? meta.previousClose
      : useDailyReference && finite(meta?.chartPreviousClose)
        ? meta.chartPreviousClose
        : previous.close;
    return NextResponse.json({
      symbol,
      range,
      from: points[0].date,
      to: latest.date,
      interval,
      intervalLabel: interval === '5m' ? '5 分鐘線' : interval === '30m' ? '30 分鐘線' : '日線',
      points,
      latestPrice,
      previousClose,
      change: latestPrice - previousClose,
      changePercent: previousClose ? latestPrice / previousClose - 1 : 0,
      currency: meta?.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD'),
      marketTime: finite(meta?.regularMarketTime) ? meta.regularMarketTime : latest.timestamp,
      updatedAt: new Date().toISOString(),
      source: 'Yahoo Finance — OHLC and latest market price',
    }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load technical indicators.' }, { status: 502 });
  }
}
