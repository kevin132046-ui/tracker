import { toneBootSnippet } from '@/lib/wafu/tone';
import { defaultWafuIntro, wafuIntroKey, wafuIntroLiteKey, wafuIntroSeenKey } from '@/lib/wafu/intro';

/**
 * 和風介面: 桔梗 or 時雨, or 'random' to pick one of them once per browser session. The choice lives
 * in this browser; <html data-wafu> carries the resolved theme so every style can key off it.
 */
export type WafuPreference = 'kikyo' | 'shigure' | 'random';
export type WafuTheme = 'kikyo' | 'shigure';

export const wafuPreferenceKey = 'optionflow-wafu-theme';
const sessionPickKey = 'optionflow-wafu-random';
export const defaultWafuPreference: WafuPreference = 'kikyo';
export const wafuFontsHref = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Shippori+Mincho+B1:wght@500;700;800&family=Kaisei+Decol:wght@400;700&family=Yuji+Syuku&family=Noto+Sans+TC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';

// A saved 'classic' (the old light page, now removed) falls back to the default.
export const isWafuPreference = (value: unknown): value is WafuPreference => value === 'kikyo' || value === 'shigure' || value === 'random';

export function loadWafuPreference(): WafuPreference {
  try {
    const saved = window.localStorage.getItem(wafuPreferenceKey);
    return isWafuPreference(saved) ? saved : defaultWafuPreference;
  } catch {
    return defaultWafuPreference;
  }
}

export function saveWafuPreference(preference: WafuPreference) {
  try { window.localStorage.setItem(wafuPreferenceKey, preference); } catch { /* storage unavailable */ }
}

/** The theme a preference shows now; 'random' keeps its pick for the rest of the session. */
export function resolveWafu(preference: WafuPreference): WafuTheme {
  if (preference !== 'random') return preference;
  try {
    const picked = window.sessionStorage.getItem(sessionPickKey);
    if (picked === 'kikyo' || picked === 'shigure') return picked;
    const next: WafuTheme = Math.random() < 0.5 ? 'kikyo' : 'shigure';
    window.sessionStorage.setItem(sessionPickKey, next);
    return next;
  } catch {
    return 'kikyo';
  }
}

/** Status bar / browser chrome colour on phones (Android theme-color, iOS PWA). */
export const wafuThemeColor: Record<WafuTheme, string> = { kikyo: '#0c0d11', shigure: '#07141a' };

/** Marks <html> with the theme and tints the phone's status bar to match. */
export function applyWafu(theme: WafuTheme) {
  document.documentElement.dataset.wafu = theme;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => { meta.content = wafuThemeColor[theme]; });
}

/**
 * Runs before the page paints (inlined in the layout) so the chosen theme shows from the first frame
 * (the server renders 桔梗). Kept in step with resolveWafu and applyWafu above. When the opening will play it also veils the
 * page (data-wafu-intro); the veil lifts by itself after 8 s in case the page never starts.
 */
export const wafuBootScript = `(function(){try{var p=localStorage.getItem('${wafuPreferenceKey}');var t=p;if(p==='random'){t=sessionStorage.getItem('${sessionPickKey}');if(t!=='kikyo'&&t!=='shigure'){t=Math.random()<0.5?'kikyo':'shigure';sessionStorage.setItem('${sessionPickKey}',t);}}if(t!=='kikyo'&&t!=='shigure')t='${defaultWafuPreference}';var r=document.documentElement;r.dataset.wafu=t;${toneBootSnippet}var pm=localStorage.getItem('optionflow-perf-mode');if(pm==='on'||(pm!=='off'&&localStorage.getItem('${wafuIntroLiteKey}')==='1'))r.dataset.perf='lite';var i=localStorage.getItem('${wafuIntroKey}')||'${defaultWafuIntro}';if(i==='off'||(i==='session'&&sessionStorage.getItem('${wafuIntroSeenKey}')))return;r.dataset.wafuIntro='1';window.__wafuIntroT=setTimeout(function(){delete r.dataset.wafuIntro;},12000);}catch(e){}})();`;
