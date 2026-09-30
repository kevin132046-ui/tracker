/**
 * 暦 details for the 和風 header (from the prototype): the current 二十四節氣 and the traditional
 * two-hour 刻, both on Japan time.
 */
const sekki: ReadonlyArray<readonly [number, number, string]> = [
  [1, 5, '小寒'], [1, 20, '大寒'], [2, 4, '立春'], [2, 19, '雨水'], [3, 5, '驚蟄'], [3, 20, '春分'],
  [4, 4, '清明'], [4, 20, '穀雨'], [5, 5, '立夏'], [5, 21, '小滿'], [6, 5, '芒種'], [6, 21, '夏至'],
  [7, 7, '小暑'], [7, 22, '大暑'], [8, 7, '立秋'], [8, 23, '處暑'], [9, 7, '白露'], [9, 23, '秋分'],
  [10, 8, '寒露'], [10, 23, '霜降'], [11, 7, '立冬'], [11, 22, '小雪'], [12, 7, '大雪'], [12, 21, '冬至'],
];
const jikan = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

function tokyo(timestamp: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(timestamp));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { month: get('month'), day: get('day'), hour: get('hour') % 24 };
}

/** The solar term in effect (approximate fixed dates, good to a day). */
export function sekkiOf(timestamp: number) {
  const { month, day } = tokyo(timestamp);
  let current = sekki[sekki.length - 1];
  for (const term of sekki) if (month > term[0] || (month === term[0] && day >= term[1])) current = term;
  return current[2];
}

/** 子の刻 (23:00–01:00) … 亥の刻 (21:00–23:00). */
export function jikanOf(timestamp: number) {
  const { hour } = tokyo(timestamp);
  return `${jikan[Math.floor(((hour + 1) % 24) / 2)]}の刻`;
}
