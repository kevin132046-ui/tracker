/**
 * 色調: an optional warm palette over the 和風 themes (app/wafu-tone.css), set as <html data-tone>.
 * - off: the themes as they are (default).
 * - auto: 燈籠 (warm dark) in the evening and night, 和紙 (warm paper, light) in the daytime.
 * - lantern / washi / showa: always that tone (昭和 is a sample style).
 * 桔梗 and 時雨 keep their own accents inside each tone.
 */
export type ToneSetting = 'off' | 'auto' | 'lantern' | 'washi' | 'showa';
export type Tone = 'lantern' | 'washi' | 'showa';

export const toneKey = 'optionflow-wafu-tone';
/** Daytime (和紙) runs from 06:00 to 17:59 local time under 'auto'. */
export const dayStartHour = 6;
export const dayEndHour = 18;

export const toneChoices: ReadonlyArray<readonly [ToneSetting, string]> = [
  ['off', '現行'],
  ['auto', '暖色自動（夜燈籠・日和紙）'],
  ['lantern', '燈籠'],
  ['washi', '和紙'],
  ['showa', '昭和（試作）'],
];

const isToneSetting = (value: unknown): value is ToneSetting => value === 'off' || value === 'auto' || value === 'lantern' || value === 'washi' || value === 'showa';

export function loadToneSetting(): ToneSetting {
  try {
    const saved = window.localStorage.getItem(toneKey);
    return isToneSetting(saved) ? saved : 'off';
  } catch {
    return 'off';
  }
}

export function saveToneSetting(setting: ToneSetting) {
  try { window.localStorage.setItem(toneKey, setting); } catch { /* storage unavailable */ }
}

export function resolveTone(setting: ToneSetting, now = new Date()): Tone | null {
  if (setting === 'off') return null;
  if (setting !== 'auto') return setting;
  const hour = now.getHours();
  return hour >= dayStartHour && hour < dayEndHour ? 'washi' : 'lantern';
}

const showaFontHref = 'https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap';

export function applyTone(tone: Tone | null) {
  const root = document.documentElement;
  if (tone) root.dataset.tone = tone;
  else delete root.dataset.tone;
  // 昭和's rounded gothic is fetched only when that tone is used.
  if (tone === 'showa' && !document.getElementById('wafu-tone-font')) {
    const link = document.createElement('link');
    link.id = 'wafu-tone-font';
    link.rel = 'stylesheet';
    link.href = showaFontHref;
    document.head.appendChild(link);
  }
}

/** Part of the boot script: sets data-tone before the first paint so the page never flashes the other palette. */
export const toneBootSnippet = `var tn=localStorage.getItem('${toneKey}');if(tn==='auto'){var hh=new Date().getHours();tn=hh>=${dayStartHour}&&hh<${dayEndHour}?'washi':'lantern';}if(tn==='lantern'||tn==='washi'||tn==='showa')r.dataset.tone=tn;`;
