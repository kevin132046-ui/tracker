/**
 * Option analytics shared by the dashboard: Black–Scholes prices and greeks, implied
 * volatility, strike parsing, days to expiry and position-level risk.
 *
 * Pure and unit-free: prices in any one currency, rates and volatilities as decimals
 * (0.043 = 4.3%), time in years. No React or server imports, so it runs in the browser,
 * during SSR or in a quick script.
 */

export const DEFAULT_RISK_FREE_RATE = 0.043;
export const MIN_IMPLIED_VOL = 0.01;
export const MAX_IMPLIED_VOL = 5;
export const OPTION_CONTRACT_SIZE = 100;

export type OptionRight = 'call' | 'put';

export type BlackScholesInput = {
  right: OptionRight;
  /** Underlying price S. */
  spot: number;
  /** Strike K. */
  strike: number;
  /** Time to expiry T in years. */
  years: number;
  /** Volatility σ as a decimal (0.2 = 20%). */
  volatility: number;
  /** Continuously compounded risk-free rate r; defaults to 4.3%. */
  rate?: number;
  /** Continuous dividend yield q; defaults to 0. */
  dividendYield?: number;
};

/** Per-share Black–Scholes value and sensitivities. */
export type OptionGreeks = {
  price: number;
  /** ∂V/∂S. */
  delta: number;
  /** ∂²V/∂S². */
  gamma: number;
  /** ∂V/∂t per calendar day (negative when a long option loses value to time). */
  thetaPerDay: number;
  /** ∂V/∂σ per one volatility point (σ + 0.01). */
  vegaPerPoint: number;
  /** Risk-neutral probability of finishing in the money: N(d2) for calls, N(−d2) for puts. */
  probabilityItm: number;
  d1: number;
  d2: number;
};

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
const dayMs = 86_400_000;
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const normalPdf = (x: number) => Math.exp(-x * x / 2) / SQRT_TWO_PI;

/** Standard normal CDF (Hart 1968 as given by West 2005), accurate to double precision. */
export function normalCdf(x: number) {
  if (Number.isNaN(x)) return Number.NaN;
  const z = Math.abs(x);
  let tail = 0;
  if (z <= 37) {
    const exponential = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      let numerator = 3.52624965998911e-2 * z + 0.700383064443688;
      numerator = numerator * z + 6.37396220353165;
      numerator = numerator * z + 33.912866078383;
      numerator = numerator * z + 112.079291497871;
      numerator = numerator * z + 221.213596169931;
      numerator = numerator * z + 220.206867912376;
      let denominator = 8.83883476483184e-2 * z + 1.75566716318264;
      denominator = denominator * z + 16.064177579207;
      denominator = denominator * z + 86.7807322029461;
      denominator = denominator * z + 296.564248779674;
      denominator = denominator * z + 637.333633378831;
      denominator = denominator * z + 793.826512519948;
      denominator = denominator * z + 440.413735824752;
      tail = exponential * numerator / denominator;
    } else {
      let fraction = z + 0.65;
      fraction = z + 4 / fraction;
      fraction = z + 3 / fraction;
      fraction = z + 2 / fraction;
      fraction = z + 1 / fraction;
      tail = exponential / fraction / 2.506628274631;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

const finite = (...values: number[]) => values.every((value) => Number.isFinite(value));

/** Black–Scholes(–Merton) price and greeks; null when an input is missing or not positive. */
export function blackScholes(input: BlackScholesInput): OptionGreeks | null {
  const { right, spot, strike, years, volatility } = input;
  const rate = input.rate ?? DEFAULT_RISK_FREE_RATE;
  const dividendYield = input.dividendYield ?? 0;
  if (!finite(spot, strike, years, volatility, rate, dividendYield)) return null;
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(volatility > 0)) return null;
  const sqrtYears = Math.sqrt(years);
  const volSqrtYears = volatility * sqrtYears;
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + volatility * volatility / 2) * years) / volSqrtYears;
  const d2 = d1 - volSqrtYears;
  const discount = Math.exp(-rate * years);
  const carry = Math.exp(-dividendYield * years);
  const density = normalPdf(d1);
  const decay = -spot * carry * density * volatility / (2 * sqrtYears);
  let price: number;
  let delta: number;
  let thetaPerYear: number;
  let probabilityItm: number;
  if (right === 'call') {
    const nd1 = normalCdf(d1);
    const nd2 = normalCdf(d2);
    price = spot * carry * nd1 - strike * discount * nd2;
    delta = carry * nd1;
    thetaPerYear = decay - rate * strike * discount * nd2 + dividendYield * spot * carry * nd1;
    probabilityItm = nd2;
  } else {
    const nMinusD1 = normalCdf(-d1);
    const nMinusD2 = normalCdf(-d2);
    price = strike * discount * nMinusD2 - spot * carry * nMinusD1;
    delta = -carry * nMinusD1;
    thetaPerYear = decay + rate * strike * discount * nMinusD2 - dividendYield * spot * carry * nMinusD1;
    probabilityItm = nMinusD2;
  }
  return {
    price: Math.max(0, price),
    delta,
    gamma: carry * density / (spot * volSqrtYears),
    thetaPerDay: thetaPerYear / 365,
    vegaPerPoint: spot * carry * density * sqrtYears / 100,
    probabilityItm,
    d1,
    d2,
  };
}

/** No-arbitrage price bounds of a European option: (intrinsic of the forward, discounted cap). */
export function optionPriceBounds(input: Omit<BlackScholesInput, 'volatility'>) {
  const rate = input.rate ?? DEFAULT_RISK_FREE_RATE;
  const dividendYield = input.dividendYield ?? 0;
  const discountedStrike = input.strike * Math.exp(-rate * input.years);
  const discountedSpot = input.spot * Math.exp(-dividendYield * input.years);
  return input.right === 'call'
    ? { lower: Math.max(0, discountedSpot - discountedStrike), upper: discountedSpot }
    : { lower: Math.max(0, discountedStrike - discountedSpot), upper: discountedStrike };
}

/**
 * Volatility that reproduces `price`, solved by safeguarded Newton (bisection fallback) on
 * [1%, 500%]. Null when inputs are missing, the price is outside the no-arbitrage bounds, or
 * the solution lies outside that range.
 */
export function impliedVolatility(input: Omit<BlackScholesInput, 'volatility'> & { price: number }): number | null {
  const { price, spot, strike, years } = input;
  if (!finite(price, spot, strike, years) || !(price > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  const { lower, upper } = optionPriceBounds(input);
  if (price <= lower || price >= upper) return null;
  const valueAt = (volatility: number) => blackScholes({ ...input, volatility });
  let low = MIN_IMPLIED_VOL;
  let high = MAX_IMPLIED_VOL;
  const lowPrice = valueAt(low)?.price;
  const highPrice = valueAt(high)?.price;
  if (lowPrice === undefined || highPrice === undefined || price < lowPrice || price > highPrice) return null;
  const tolerance = 1e-9 * Math.max(1, price);
  // Brenner–Subrahmanyam starting point, which is close for near-the-money options.
  let volatility = Math.min(high, Math.max(low, Math.sqrt(2 * Math.PI / years) * price / spot));
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const greeks = valueAt(volatility);
    if (!greeks) return null;
    const difference = greeks.price - price;
    if (Math.abs(difference) <= tolerance) return volatility;
    if (difference > 0) high = volatility;
    else low = volatility;
    const vega = greeks.vegaPerPoint * 100;
    let next = vega > 1e-12 ? volatility - difference / vega : Number.NaN;
    if (!(next > low && next < high)) next = (low + high) / 2;
    if (Math.abs(next - volatility) < 1e-12 || high - low < 1e-12) return next;
    volatility = next;
  }
  return volatility;
}

/**
 * Numeric strike from the free-text strike field: "70", "72.5", "$1,050" → number; spreads
 * such as "185/180", blanks and anything else → null.
 */
export function parseStrike(text: string | null | undefined): number | null {
  let cleaned = String(text ?? '').trim().replace(/^[$¥]\s*/, '');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) cleaned = cleaned.replace(/,/g, '');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** PUT / CALL from the trade's event text; null for stock, cash, spreads or anything else. */
export function optionRightFromEvent(event: string | null | undefined): OptionRight | null {
  const text = String(event ?? '').trim().toUpperCase();
  if (text === 'P') return 'put';
  if (text === 'C') return 'call';
  const put = /\bPUTS?\b/.test(text);
  const call = /\bCALLS?\b/.test(text);
  return put === call ? null : put ? 'put' : 'call';
}

const toDayNumber = (key: string) => dateKeyPattern.test(key) ? Math.floor(Date.parse(`${key}T00:00:00Z`) / dayMs) : Number.NaN;

/** Calendar days from `fromKey` to `toKey` (YYYY-MM-DD); null when either date is invalid. */
export function calendarDaysBetween(fromKey: string | null | undefined, toKey: string | null | undefined): number | null {
  const from = toDayNumber(String(fromKey ?? ''));
  const to = toDayNumber(String(toKey ?? ''));
  return Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
}

/** Calendar days until expiry, never below 0; null without a valid expiry date. */
export function daysToExpiry(expiryDate: string | null | undefined, todayKey: string): number | null {
  const days = calendarDaysBetween(todayKey, expiryDate);
  return days === null ? null : Math.max(0, days);
}

/** Black–Scholes time: max(days, ½) ÷ 365, so an option expiring today keeps half a day. */
export const yearsFromDays = (days: number) => Math.max(days, 0.5) / 365;

/** Moneyness signed so a positive value means out of the money: (S−K)/S for puts, (K−S)/S for calls. */
export function outOfTheMoneyPercent(right: OptionRight, spot: number, strike: number): number | null {
  if (!(spot > 0) || !(strike > 0)) return null;
  return right === 'put' ? (spot - strike) / spot : (strike - spot) / spot;
}

export type OptionPositionInput = {
  right: OptionRight;
  /** −1 for a short (sold) option, +1 for a long one. */
  direction: 1 | -1;
  /** Contracts, as a positive number. */
  quantity: number;
  strike: number;
  daysToExpiry: number;
  /** Option premium per share used to back out the implied volatility. */
  optionPrice: number | null;
  underlyingPrice: number | null;
  rate?: number;
};

export type OptionPositionAnalytics = {
  impliedVol: number | null;
  otmPercent: number | null;
  /** Per-share greeks at the implied volatility. */
  greeks: OptionGreeks | null;
  /** Share-equivalent delta: delta × direction × 100 × quantity. */
  positionDelta: number | null;
  /** Dollar delta: position delta × underlying price. */
  deltaDollars: number | null;
  /** Position theta per calendar day in currency (positive = time decay earns). */
  positionTheta: number | null;
  /** Position vega per volatility point in currency. */
  positionVega: number | null;
  positionGamma: number | null;
};

/** Implied volatility, moneyness and position-sized greeks for one option position. */
export function analyzeOptionPosition(input: OptionPositionInput): OptionPositionAnalytics {
  const spot = input.underlyingPrice;
  const years = yearsFromDays(input.daysToExpiry);
  const empty: OptionPositionAnalytics = { impliedVol: null, otmPercent: null, greeks: null, positionDelta: null, deltaDollars: null, positionTheta: null, positionVega: null, positionGamma: null };
  if (spot === null || !(spot > 0) || !(input.strike > 0)) return empty;
  const otmPercent = outOfTheMoneyPercent(input.right, spot, input.strike);
  const impliedVol = input.optionPrice === null ? null : impliedVolatility({ right: input.right, spot, strike: input.strike, years, rate: input.rate, price: input.optionPrice });
  const greeks = impliedVol === null ? null : blackScholes({ right: input.right, spot, strike: input.strike, years, volatility: impliedVol, rate: input.rate });
  if (!greeks) return { ...empty, otmPercent, impliedVol };
  const size = input.direction * OPTION_CONTRACT_SIZE * Math.abs(input.quantity);
  const positionDelta = greeks.delta * size;
  return {
    impliedVol,
    otmPercent,
    greeks,
    positionDelta,
    deltaDollars: positionDelta * spot,
    positionTheta: greeks.thetaPerDay * size,
    positionVega: greeks.vegaPerPoint * size,
    positionGamma: greeks.gamma * size,
  };
}

export type OptionRiskItem = {
  id: number;
  ticker: string;
  right: OptionRight;
  direction: 1 | -1;
  strike: number | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  /** Capital base in USD (collateral, strike notional or premium). */
  capital: number;
  analytics: OptionPositionAnalytics | null;
};

export type OptionRiskSummary = {
  positions: number;
  /** Positions with greeks (underlying price and implied volatility known). */
  analyzed: number;
  netDelta: number;
  netDeltaDollars: number;
  theta: number;
  vega: number;
  nearestExpiry: { id: number; ticker: string; days: number; expiryDate: string } | null;
  maxAssignment: { id: number; ticker: string; probability: number; strike: number | null; right: OptionRight } | null;
  /** Capital tied up by short options and its share of all open capital. */
  shortCapital: number;
  shortCapitalShare: number | null;
};

/** Portfolio totals for the option-seller risk strip. */
export function summarizeOptionRisk(items: ReadonlyArray<OptionRiskItem>, totalOpenCapital: number): OptionRiskSummary {
  let analyzed = 0;
  let netDelta = 0;
  let netDeltaDollars = 0;
  let theta = 0;
  let vega = 0;
  let shortCapital = 0;
  let nearestExpiry: OptionRiskSummary['nearestExpiry'] = null;
  let maxAssignment: OptionRiskSummary['maxAssignment'] = null;
  for (const item of items) {
    const analytics = item.analytics;
    if (analytics?.greeks && analytics.positionDelta !== null && analytics.positionTheta !== null && analytics.positionVega !== null) {
      analyzed += 1;
      netDelta += analytics.positionDelta;
      netDeltaDollars += analytics.deltaDollars ?? 0;
      theta += analytics.positionTheta;
      vega += analytics.positionVega;
      if (item.direction < 0 && (!maxAssignment || analytics.greeks.probabilityItm > maxAssignment.probability)) {
        maxAssignment = { id: item.id, ticker: item.ticker, probability: analytics.greeks.probabilityItm, strike: item.strike, right: item.right };
      }
    }
    if (item.daysToExpiry !== null && item.expiryDate && (!nearestExpiry || item.daysToExpiry < nearestExpiry.days)) {
      nearestExpiry = { id: item.id, ticker: item.ticker, days: item.daysToExpiry, expiryDate: item.expiryDate };
    }
    if (item.direction < 0 && Number.isFinite(item.capital)) shortCapital += Math.max(0, item.capital);
  }
  return {
    positions: items.length,
    analyzed,
    netDelta,
    netDeltaDollars,
    theta,
    vega,
    nearestExpiry,
    maxAssignment,
    shortCapital,
    shortCapitalShare: totalOpenCapital > 0 ? shortCapital / totalOpenCapital : null,
  };
}
