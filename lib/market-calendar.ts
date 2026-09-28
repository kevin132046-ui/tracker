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
