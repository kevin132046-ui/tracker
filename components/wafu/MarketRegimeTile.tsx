'use client';

import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MarketRegimePayload, RegimeId } from '@/lib/market-regime';
import { classifyRegime, eventRatio } from '@/lib/market-regime';

/*
 * 市場定調: the shared /api/market-regime data (one request for the tile and the panel, refreshed when
 * older than ten minutes) and the entry tile at the top of 績效與風險指標.
 */
type RegimeState = { data: MarketRegimePayload | null; loading: boolean; failed: boolean; fetchedAt: number };
let regimeState: RegimeState = { data: null, loading: false, failed: false, fetchedAt: 0 };
const listeners = new Set<() => void>();
const staleMs = 10 * 60_000;

function setRegimeState(next: Partial<RegimeState>) {
  regimeState = { ...regimeState, ...next };
  listeners.forEach((listener) => listener());
}

export function loadMarketRegime(force = false) {
  if (regimeState.loading || (!force && regimeState.data && Date.now() - regimeState.fetchedAt < staleMs)) return;
  setRegimeState({ loading: true });
  fetch(`/api/market-regime${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
    .then((response) => response.ok ? response.json() as Promise<MarketRegimePayload> : Promise.reject(new Error(String(response.status))))
    .then((data) => setRegimeState({ data, loading: false, failed: !data.ratioHistory.length, fetchedAt: Date.now() }))
    .catch(() => setRegimeState({ loading: false, failed: true, fetchedAt: Date.now() }));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => regimeState;

/** The shared market data, loaded once `active` turns true (and again when it has gone stale). */
export function useMarketRegime(active: boolean) {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!active) return;
    loadMarketRegime();
    const onVisible = () => { if (document.visibilityState === 'visible') loadMarketRegime(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active]);
  return state;
}

/** True once the element has come near the viewport. */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

export const regimeNames: Record<RegimeId, string> = { 0: '倒掛觀察', 1: '平靜', 2: '正常偏緊張', 3: '近端恐慌開始', 4: '持續倒掛', 5: '恐慌消退' };
export const regimeShort: Record<RegimeId, string> = {
  0: '比率過 1.0，留意倒掛是否持續',
  1: '維持正常倉位，保護便宜',
  2: '倉位不動也可以，少重倉追高',
  3: '降低高 Beta、垃圾債、小型股',
  4: '以標普 5–10% 修正預期管理倉位',
  5: '恐慌消退，適合分批加倉',
};
/** Tone of each reading for the colour bar and badge: calm, tense or stressed. */
export const regimeTone: Record<RegimeId, 'calm' | 'tense' | 'stress'> = { 0: 'tense', 1: 'calm', 2: 'tense', 3: 'stress', 4: 'stress', 5: 'calm' };

export const fmtLevel = (value: number) => value.toFixed(2);
export const fmtRatio = (value: number) => value.toFixed(3);
/** "11/2" from 2026-11-02. */
export const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function goToPanel(event: ReactMouseEvent<HTMLAnchorElement>) {
  const panel = document.getElementById('market-regime');
  if (!panel) return;
  event.preventDefault();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The entry tile: today's reading in one line, linking to the 市場定調 panel below. */
export function MarketRegimeTile() {
  const [ref, seen] = useSeen<HTMLAnchorElement>();
  const { data, loading, failed } = useMarketRegime(seen);
  const reading = useMemo(() => data ? classifyRegime(data.ratioHistory) : null, [data]);
  const nine = data ? eventRatio(data.quotes) : null;
  const tone = reading ? regimeTone[reading.id] : 'none';
  return <a ref={ref} href="#market-regime" className={`wafu-regime-tile tone-${tone}`} onClick={goToPanel} aria-busy={loading && !reading}>
    <span className="wafu-regime-badge" aria-hidden="true">{reading ? reading.id || '!' : '·'}</span>
    <span className="wafu-regime-tile-text">
      <span>市場定調 · VIX 期限結構{data?.asOf ? ` · ${shortDate(data.asOf)} ${data.intraday ? '盤中' : '收盤'}` : ''}</span>
      {reading ? <strong>{regimeNames[reading.id]}：{regimeShort[reading.id]}</strong>
        : <strong className="is-muted">{failed ? '暫時讀不到 Cboe 資料' : '正在讀取 VIX…'}</strong>}
      {reading && <small>VIX {fmtLevel(reading.vix)} · VIX÷VIX3M {fmtRatio(reading.ratio)}{nine !== null && <> · VIX9D÷VIX {nine.toFixed(2)}</>}</small>}
    </span>
    <span className="wafu-regime-go">查看期限結構 →</span>
  </a>;
}
