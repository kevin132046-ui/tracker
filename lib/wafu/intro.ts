/**
 * The 和風 opening (shoji doors or noren, ink in water, the character's halo). It only plays in a
 * 和風 theme, on a full page load, and the boot script in theme.ts decides whether it does, so the
 * page is veiled before its first paint instead of flashing the dashboard.
 */
export type WafuIntroPreference = 'always' | 'session' | 'off';

export const wafuIntroKey = 'optionflow-wafu-intro';
/** sessionStorage: the opening already played in this tab (for 'session'). */
export const wafuIntroSeenKey = 'optionflow-wafu-intro-seen';
/** When on (default), a slow first second switches the opening to the lite version without the ink. */
export const wafuIntroLiteAutoKey = 'optionflow-wafu-intro-lite-auto';
/** Set once a slow device was detected; later openings start lite. */
export const wafuIntroLiteKey = 'optionflow-wafu-intro-lite';
export const defaultWafuIntro: WafuIntroPreference = 'always';

const isIntroPreference = (value: unknown): value is WafuIntroPreference => value === 'always' || value === 'session' || value === 'off';

const read = (key: string) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
};

export function loadWafuIntro(): WafuIntroPreference {
  const saved = read(wafuIntroKey);
  return isIntroPreference(saved) ? saved : defaultWafuIntro;
}
export const saveWafuIntro = (preference: WafuIntroPreference) => write(wafuIntroKey, preference);

export const loadIntroLiteAuto = () => read(wafuIntroLiteAutoKey) !== '0';
export const saveIntroLiteAuto = (on: boolean) => write(wafuIntroLiteAutoKey, on ? '1' : '0');
export const introLiteDetected = () => read(wafuIntroLiteKey) === '1';
export const setIntroLiteDetected = (detected: boolean) => write(wafuIntroLiteKey, detected ? '1' : null);

/** The boot script left the page veiled for the opening. */
export const introPending = () => document.documentElement.dataset.wafuIntro === '1';
/** Lifts the veil (the opening covers the page itself from here on). */
export const liftIntroVeil = () => { delete document.documentElement.dataset.wafuIntro; };

export function markIntroSeen() {
  try { window.sessionStorage.setItem(wafuIntroSeenKey, '1'); } catch { /* storage unavailable */ }
}

/** Interface language saved by the language menu, for the opening's own captions. */
export type IntroLanguage = 'zh' | 'ja' | 'en';
export function introLanguage(): IntroLanguage {
  const saved = read('optionflow-interface-language');
  return saved === 'ja-JP' ? 'ja' : saved === 'en' ? 'en' : 'zh';
}
