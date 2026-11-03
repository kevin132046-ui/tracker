/**
 * 基本面參考: the figures read from FactSet's weekly Earnings Insight PDF. The route resolves the
 * latest report (https://www.factset.com/earningsinsight redirects to EarningsInsight_MMDDYY.pdf); the
 * browser reads the PDF's text and these patterns pick the sentences FactSet repeats every week.
 * Anything a pattern doesn't find stays null, and the card shows only what was found.
 */

export type EarningsInsight = {
  /** The report's file name and date (YYYY-MM-DD, from the MMDDYY in the name). */
  file: string;
  date: string | null;
  /** Forward 12-month P/E with its 5- and 10-year averages. */
  forwardPe: number | null; pe5y: number | null; pe10y: number | null;
  /** Earnings growth analysts expect for calendar years, e.g. [{ year: 2026, growth: 32.9 }]. */
  calendarGrowth: Array<{ year: number; growth: number }>;
  /** The quarter in season: share reported, EPS-surprise share, blended or estimated growth. */
  quarter: string | null;
  reportedPct: number | null; beatPct: number | null;
  epsGrowth: number | null; revenueGrowth: number | null; growthKind: 'blended' | 'estimated' | null;
  /** Next quarter's EPS guidance: counts of negative and positive. */
  guidanceQuarter: string | null; guidanceNegative: number | null; guidancePositive: number | null;
};

export const reportFile = /^EarningsInsight_(\d{2})(\d{2})(\d{2})\.pdf$/;

/** YYYY-MM-DD from a report file name such as EarningsInsight_103026.pdf. */
export function reportDate(file: string) {
  const match = file.match(reportFile);
  if (!match) return null;
  const [, month, day, year] = match;
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31 ? `20${year}-${month}-${day}` : null;
}

/** One line of text: whitespace collapsed and words broken across lines at a hyphen joined again. */
export function flattenText(text: string) {
  return text.replace(/\s+/g, ' ').replace(/(\w)- (?=[a-z0-9])/g, '$1-').trim();
}

const number = (value: string | undefined) => {
  if (value === undefined) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseEarningsInsight(file: string, rawText: string): EarningsInsight {
  const text = flattenText(rawText);
  const pe = text.match(/forward 12-month P\/E ratio (?:for the S&P 500 )?is (\d+(?:\.\d+)?)[.,][^.]*?5-year average (?:of )?\(?(\d+(?:\.\d+)?)\)?[^.]*?10-year average (?:of )?\(?(\d+(?:\.\d+)?)\)?/i);
  const growth = new Map<number, number>();
  for (const match of text.matchAll(/For CY (\d{4}), analysts are (?:projecting|predicting|calling for|expecting)(?: \(year-over-year\))? earnings growth (?:rate )?of (-?\d+(?:\.\d+)?)%/gi)) {
    const year = Number(match[1]);
    if (!growth.has(year)) growth.set(year, Number(match[2]));
  }
  const scorecard = text.match(/For (Q\d \d{4}) \(with (\d+)% of (?:the )?S&P 500 companies reporting actual results\), (\d+)% of S&P 500 companies have reported a positive EPS surprise/i);
  const eps = text.match(/For (Q\d \d{4}), the (blended|estimated) \(year-over-year\) earnings growth rate for the S&P 500 is (-?\d+(?:\.\d+)?)%/i);
  const revenue = text.match(/(?:blended|estimated) \(year-over-year\) revenue growth rate for (Q\d \d{4}) is (-?\d+(?:\.\d+)?)%/i);
  const guidance = text.match(/For (Q\d \d{4}), (\d+) S&P 500 companies have issued negative EPS guidance and (\d+) S&P 500 companies have issued positive EPS guidance/i);
  const quarter = eps?.[1] ?? scorecard?.[1] ?? null;
  return {
    file,
    date: reportDate(file),
    forwardPe: number(pe?.[1]), pe5y: number(pe?.[2]), pe10y: number(pe?.[3]),
    calendarGrowth: [...growth].map(([year, value]) => ({ year, growth: value })).sort((a, b) => a.year - b.year),
    quarter,
    reportedPct: scorecard && scorecard[1] === quarter ? number(scorecard[2]) : null,
    beatPct: scorecard && scorecard[1] === quarter ? number(scorecard[3]) : null,
    epsGrowth: number(eps?.[3]),
    revenueGrowth: revenue && revenue[1] === quarter ? number(revenue[2]) : null,
    growthKind: eps ? (eps[2].toLowerCase() as 'blended' | 'estimated') : null,
    guidanceQuarter: guidance?.[1] ?? null,
    guidanceNegative: number(guidance?.[2]),
    guidancePositive: number(guidance?.[3]),
  };
}

/** True when the parse found enough to be worth showing (and caching). */
export function hasInsight(insight: EarningsInsight) {
  return insight.forwardPe !== null || insight.calendarGrowth.length > 0 || insight.epsGrowth !== null;
}
