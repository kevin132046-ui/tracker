/**
 * US and Japanese market holiday calendars shared by the header market calendar and the
 * trade editor's date picker. Pure and deterministic: dates are plain calendar days
 * (UTC-based Date arithmetic), keyed as YYYY-MM-DD.
 */

export type ZonedDate = { year: number; month: number; day: number };

export const dateKey = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
export const zonedDateKey = (date: ZonedDate) => dateKey(date.year, date.month, date.day);
export const zonedDate = (timestamp: number, timeZone: string): ZonedDate => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
};
export const weekday = ({ year, month, day }: ZonedDate) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
export const nthWeekday = (year: number, month: number, targetWeekday: number, occurrence: number) => {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((targetWeekday - firstWeekday + 7) % 7) + (occurrence - 1) * 7;
};
export const lastWeekday = (year: number, month: number, targetWeekday: number) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDayWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((lastDayWeekday - targetWeekday + 7) % 7);
};
export const addUtcDays = (date: ZonedDate, offset: number): ZonedDate => {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
};
const japaneseHolidayCache = new Map<number, Map<string, string>>();
const usHolidayCache = new Map<number, Map<string, string>>();

export function japaneseHolidays(year: number) {
  const cached = japaneseHolidayCache.get(year);
  if (cached) return cached;
  const base = new Map<string, string>();
  const add = (month: number, day: number, name: string) => base.set(dateKey(year, month, day), name);
  add(1, 1, '元日');
  add(1, nthWeekday(year, 1, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  add(2, 23, '天皇誕生日');
  add(3, Math.floor(20.8431 + .242194 * (year - 1980) - Math.floor((year - 1980) / 4)), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthWeekday(year, 7, 1, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthWeekday(year, 9, 1, 3), '敬老の日');
  add(9, Math.floor(23.2488 + .242194 * (year - 1980) - Math.floor((year - 1980) / 4)), '秋分の日');
  add(10, nthWeekday(year, 10, 1, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  const holidays = new Map(base);
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 2; day < days; day += 1) {
      const key = dateKey(year, month, day);
      if (holidays.has(key)) continue;
      const current = { year, month, day };
      if (base.has(zonedDateKey(addUtcDays(current, -1))) && base.has(zonedDateKey(addUtcDays(current, 1)))) holidays.set(key, '国民の休日');
    }
  }
  [...base.entries()].forEach(([key, name]) => {
    const [holidayYear, holidayMonth, holidayDay] = key.split('-').map(Number);
    if (new Date(Date.UTC(holidayYear, holidayMonth - 1, holidayDay)).getUTCDay() !== 0) return;
    let substitute = addUtcDays({ year: holidayYear, month: holidayMonth, day: holidayDay }, 1);
    while (holidays.has(zonedDateKey(substitute))) substitute = addUtcDays(substitute, 1);
    holidays.set(zonedDateKey(substitute), `振替休日（${name}）`);
  });
  japaneseHolidayCache.set(year, holidays);
  return holidays;
}

function easterSunday(year: number): ZonedDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return { year, month, day: ((h + l - 7 * m + 114) % 31) + 1 };
}

export function usMarketHolidays(year: number) {
  const cached = usHolidayCache.get(year);
  if (cached) return cached;
  const holidays = new Map<string, string>();
  const add = (date: ZonedDate, name: string) => holidays.set(dateKey(date.year, date.month, date.day), name);
  const observed = (month: number, day: number, name: string, saturdayObserved = true) => {
    const actual = { year, month, day };
    const dayOfWeek = weekday(actual);
    if (dayOfWeek === 6 && saturdayObserved) add(addUtcDays(actual, -1), name);
    else if (dayOfWeek === 0) add(addUtcDays(actual, 1), name);
    else add(actual, name);
  };
  observed(1, 1, '元旦', false);
  add({ year, month: 1, day: nthWeekday(year, 1, 1, 3) }, '馬丁路德金恩紀念日');
  add({ year, month: 2, day: nthWeekday(year, 2, 1, 3) }, '華盛頓誕辰');
  add(addUtcDays(easterSunday(year), -2), '耶穌受難日');
  add({ year, month: 5, day: lastWeekday(year, 5, 1) }, '陣亡將士紀念日');
  observed(6, 19, '六月節');
  observed(7, 4, '美國獨立日');
  add({ year, month: 9, day: nthWeekday(year, 9, 1, 1) }, '勞動節');
  add({ year, month: 11, day: nthWeekday(year, 11, 4, 4) }, '感恩節');
  observed(12, 25, '聖誕節');
  usHolidayCache.set(year, holidays);
  return holidays;
}

/* ------------------------------------------------------------------ */
/* Date-picker helpers                                                 */
/* ------------------------------------------------------------------ */

export type CalendarMarket = 'US' | 'JP';

/** YYYY-MM-DD → calendar parts; null unless it is a real date. */
export function parseDateKey(key: string | null | undefined): ZonedDate | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}

export const addDaysToKey = (key: string, days: number) => {
  const date = parseDateKey(key);
  return date ? zonedDateKey(addUtcDays(date, days)) : key;
};

export const isWeekendKey = (key: string) => {
  const date = parseDateKey(key);
  return date ? weekday(date) === 0 || weekday(date) === 6 : false;
};

/** NYSE / Nasdaq full-day closure on that day, if any. */
export const usHolidayName = (key: string) => {
  const date = parseDateKey(key);
  return date ? usMarketHolidays(date.year).get(key) ?? null : null;
};

/** Tokyo Stock Exchange closure: the year-end break (Dec 31 – Jan 3) and national holidays. */
export const japanHolidayName = (key: string) => {
  const date = parseDateKey(key);
  if (!date) return null;
  if (date.month === 1 && (date.day === 2 || date.day === 3)) return '年始休業';
  if (date.month === 12 && date.day === 31) return '年末休業';
  return japaneseHolidays(date.year).get(key) ?? null;
};

export const isTradingDay = (key: string, market: CalendarMarket) => Boolean(parseDateKey(key))
  && !isWeekendKey(key)
  && !(market === 'US' ? usHolidayName(key) : japanHolidayName(key));

/** The last trading day strictly before `key`. */
export function previousTradingDay(key: string, market: CalendarMarket) {
  let cursor = addDaysToKey(key, -1);
  for (let guard = 0; guard < 20 && !isTradingDay(cursor, market); guard += 1) cursor = addDaysToKey(cursor, -1);
  return cursor;
}

export const thirdFriday = (year: number, month: number) => dateKey(year, month, nthWeekday(year, month, 5, 3));

/** US equity options expire on Friday, or on the trading day before when that Friday is an exchange holiday. */
export function optionExpiryForFriday(fridayKey: string) {
  let cursor = fridayKey;
  for (let guard = 0; guard < 7 && !isTradingDay(cursor, 'US'); guard += 1) cursor = addDaysToKey(cursor, -1);
  return cursor;
}

/** Standard monthly expiry: the third Friday, moved earlier for a holiday. */
export const monthlyExpiry = (year: number, month: number) => optionExpiryForFriday(thirdFriday(year, month));

export const isMonthlyExpiry = (key: string) => {
  const date = parseDateKey(key);
  return Boolean(date) && monthlyExpiry(date!.year, date!.month) === key;
};

export type ExpiryChoice = { key: string; monthly: boolean; holidayAdjusted: boolean };

/**
 * The next `count` weekly expiries strictly after `afterKey` (Fridays, holiday-adjusted) and the
 * first monthly expiry after the last of them.
 */
export function upcomingExpiries(afterKey: string, count = 4): { weekly: ExpiryChoice[]; monthly: ExpiryChoice | null } {
  const start = parseDateKey(afterKey);
  if (!start) return { weekly: [], monthly: null };
  let friday = zonedDateKey(addUtcDays(start, ((5 - weekday(start) + 7) % 7) || 7));
  const weekly: ExpiryChoice[] = [];
  for (let guard = 0; weekly.length < count && guard < count + 3; guard += 1) {
    const key = optionExpiryForFriday(friday);
    if (key > afterKey) weekly.push({ key, monthly: isMonthlyExpiry(key), holidayAdjusted: key !== friday });
    friday = addDaysToKey(friday, 7);
  }
  const last = parseDateKey(weekly.at(-1)?.key ?? afterKey)!;
  let { year, month } = last;
  let key = monthlyExpiry(year, month);
  for (let guard = 0; key <= (weekly.at(-1)?.key ?? afterKey) && guard < 3; guard += 1) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    key = monthlyExpiry(year, month);
  }
  return { weekly, monthly: { key, monthly: true, holidayAdjusted: key !== thirdFriday(year, month) } };
}

/* ------------------------------------------------------------------ */
/* Upcoming closures (holiday notice)                                  */
/* ------------------------------------------------------------------ */

/** NYSE / Nasdaq 1:00 p.m. ET early close on that day, if any. */
export function usEarlyCloseName(key: string) {
  const date = parseDateKey(key);
  if (!date || isWeekendKey(key) || usHolidayName(key)) return null;
  const { year, month, day } = date;
  // July 3 closes early when Independence Day falls Tuesday–Friday (July 3 is Monday–Thursday).
  if (month === 7 && day === 3 && weekday(date) <= 4) return '美國獨立日前夕';
  if (month === 11 && day === nthWeekday(year, 11, 4, 4) + 1) return '感恩節翌日';
  if (month === 12 && day === 24) return '平安夜';
  return null;
}

export type UpcomingClosure = { market: CalendarMarket; key: string; name: string; kind: 'closed' | 'early'; daysAway: number };

/**
 * Exchange closures and US early closes in the `days` calendar days after `fromKey` (the market's
 * own local date). Weekends are skipped. Today's full-day closure is left out because the header
 * already shows it, but today's early close is included.
 */
export function upcomingClosures(market: CalendarMarket, fromKey: string, days = 7): UpcomingClosure[] {
  if (!parseDateKey(fromKey)) return [];
  const closures: UpcomingClosure[] = [];
  for (let offset = 0; offset <= days; offset += 1) {
    const key = addDaysToKey(fromKey, offset);
    if (isWeekendKey(key)) continue;
    const holiday = offset > 0 ? (market === 'US' ? usHolidayName(key) : japanHolidayName(key)) : null;
    if (holiday) closures.push({ market, key, name: holiday, kind: 'closed', daysAway: offset });
    const early = market === 'US' ? usEarlyCloseName(key) : null;
    if (early) closures.push({ market, key, name: early, kind: 'early', daysAway: offset });
  }
  return closures;
}
