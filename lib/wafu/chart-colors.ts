/**
 * 圖表顏色: the colour of each line in the 收益分析 charts, chosen from a set of 和色 that read on both
 * the dark themes and 和紙's paper. Unset lines follow the theme. Saved in this browser only.
 */
export type ChartSeries = 'mine' | 'spy' | 'boxx';
export type ChartColors = Partial<Record<ChartSeries, string>>;

export const chartColorKey = 'optionflow-chart-colors';

export const wairo: ReadonlyArray<readonly [name: string, hex: string]> = [
  ['藍', '#3d7cc9'], ['浅葱', '#2aa5b8'], ['錆青磁', '#5a9e98'], ['若竹', '#4ba36b'], ['山吹', '#e0a526'],
  ['朱', '#e0603a'], ['紅', '#c8384e'], ['桜', '#d9849b'], ['藤', '#8f74c6'], ['銀鼠', '#9aa0a6'],
];

const allowed = new Set(wairo.map(([, hex]) => hex));
const series: readonly ChartSeries[] = ['mine', 'spy', 'boxx'];

export function loadChartColors(): ChartColors {
  try {
    const saved = JSON.parse(window.localStorage.getItem(chartColorKey) ?? '{}') as Record<string, unknown>;
    const colors: ChartColors = {};
    for (const key of series) if (typeof saved[key] === 'string' && allowed.has(saved[key])) colors[key] = saved[key];
    return colors;
  } catch {
    return {};
  }
}

export function saveChartColors(colors: ChartColors) {
  try { window.localStorage.setItem(chartColorKey, JSON.stringify(colors)); } catch { /* storage unavailable */ }
}

export const wairoName = (hex: string | undefined) => wairo.find(([, value]) => value === hex)?.[0] ?? null;
