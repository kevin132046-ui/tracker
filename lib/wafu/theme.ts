import { defaultWafuIntro, wafuIntroKey, wafuIntroSeenKey } from '@/lib/wafu/intro';

/**
 * 和風介面: which look the page uses. 'classic' is the original light page; 桔梗 and 時雨 are the
 * dark 和風 themes, and 'random' picks one of them once per browser session. The choice lives in
 * this browser; <html data-wafu> carries the resolved theme so every style can key off it.
 */
export type WafuPreference = 'classic' | 'kikyo' | 'shigure' | 'random';
export type WafuTheme = 'kikyo' | 'shigure';

export const wafuPreferenceKey = 'optionflow-wafu-theme';
const sessionPickKey = 'optionflow-wafu-random';
/** While Phase ④ is built the classic page stays the default. */
export const defaultWafuPreference: WafuPreference = 'classic';
export const wafuFontsHref = 'https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500;700;800&family=Kaisei+Decol:wght@400;700&family=Yuji+Syuku&family=Noto+Sans+TC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap';

export const isWafuPreference = (value: unknown): value is WafuPreference => value === 'classic' || value === 'kikyo' || value === 'shigure' || value === 'random';

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
export function resolveWafu(preference: WafuPreference): WafuTheme | null {
  if (preference === 'classic') return null;
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

/** Marks <html> with the theme and loads the 和風 fonts the first time a theme is shown. */
export function applyWafu(theme: WafuTheme | null) {
  const root = document.documentElement;
  if (!theme) { delete root.dataset.wafu; return; }
  root.dataset.wafu = theme;
  if (!document.getElementById('wafu-fonts')) {
    const link = document.createElement('link');
    link.id = 'wafu-fonts';
    link.rel = 'stylesheet';
    link.href = wafuFontsHref;
    document.head.appendChild(link);
  }
}

/**
 * Runs before the page paints (inlined in the layout) so a 和風 theme never flashes the classic page.
 * Kept in step with resolveWafu and applyWafu above. When the opening will play it also veils the
 * page (data-wafu-intro); the veil lifts by itself after 8 s in case the page never starts.
 */
export const wafuBootScript = `(function(){try{var p=localStorage.getItem('${wafuPreferenceKey}')||'${defaultWafuPreference}';var t=p;if(p==='random'){t=sessionStorage.getItem('${sessionPickKey}');if(t!=='kikyo'&&t!=='shigure'){t=Math.random()<0.5?'kikyo':'shigure';sessionStorage.setItem('${sessionPickKey}',t);}}if(t!=='kikyo'&&t!=='shigure')return;var r=document.documentElement;r.dataset.wafu=t;var l=document.createElement('link');l.id='wafu-fonts';l.rel='stylesheet';l.href='${wafuFontsHref}';document.head.appendChild(l);var i=localStorage.getItem('${wafuIntroKey}')||'${defaultWafuIntro}';if(i==='off'||(i==='session'&&sessionStorage.getItem('${wafuIntroSeenKey}')))return;r.dataset.wafuIntro='1';setTimeout(function(){delete r.dataset.wafuIntro;},8000);}catch(e){}})();`;
