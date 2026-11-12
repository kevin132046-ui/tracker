'use client';

import { useEffect, useState } from 'react';
import type { DigestRecord } from '@/lib/daily-digest';
import { regimeNames } from '@/components/wafu/MarketRegimeTile';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const signedUsd = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${usd.format(Math.abs(value))}`;
const percent = (value: number, places = 1) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value * 100).toFixed(places)}%`;
const md = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const time = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; };
const tone = (value: number | null | undefined) => !value ? '' : value > 0 ? ' is-up' : ' is-down';

/**
 * 每日彙總: one US session per page, newest first. Only describes what happened; it is not advice.
 */
export default function DailyDigestPanel({ digests, startDay, onClose, onRegenerate }: {
  digests: readonly DigestRecord[];
  startDay: string | null;
  onClose: () => void;
  /** Rewrites the newest day's digest (uses web searches again). */
  onRegenerate: () => Promise<void>;
}) {
  const [index, setIndex] = useState(() => Math.max(0, digests.findIndex((digest) => digest.day === startDay)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const record = digests[Math.min(index, digests.length - 1)] ?? null;
  const body = record?.body ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const regenerate = async () => {
    setBusy(true);
    setError('');
    try { await onRegenerate(); setIndex(0); } catch (reason) { setError(reason instanceof Error ? reason.message : '彙總暫時無法產生'); } finally { setBusy(false); }
  };

  return <div className="confirm-backdrop digest-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="digest-modal" role="dialog" aria-modal="true" aria-labelledby="digest-title">
      <header>
        <div><p className="eyebrow">Daily digest</p><h2 id="digest-title">{record ? `每日彙總 · ${md(record.day)} 收盤` : '每日彙總'}</h2></div>
        <button type="button" className="close-button" onClick={onClose} aria-label="關閉每日彙總">×</button>
      </header>
      <div className="digest-body">
        <div className="digest-nav">
          <button type="button" disabled={index >= digests.length - 1} onClick={() => setIndex((current) => current + 1)} aria-label="前一天">‹</button>
          <span>{record ? `${record.status === 'ok' ? `${time(record.createdAt)} 產生${body?.model ? ` · ${body.model}` : ''}` : record.status === 'running' ? '產生中…' : '這天沒有產生'}` : '還沒有彙總'}</span>
          <button type="button" disabled={index <= 0} onClick={() => setIndex((current) => current - 1)} aria-label="後一天">›</button>
        </div>

        {!record && <p className="digest-empty">每天美股收盤後（台灣清晨）會自動產生一份；也可以按下方「重新產生」。</p>}
        {record?.status === 'error' && <p className="digest-alert">{record.error ?? '彙總產生失敗'}</p>}

        {body && <>
          <section><h3>昨日變化</h3>
            {body.value ? <p>追蹤市值 <b>{usd.format(body.value.total)}</b>
              {body.value.change !== null && <span className={`digest-change${tone(body.value.change)}`}>（{signedUsd(body.value.change)}{body.value.changePercent !== null ? `，${percent(body.value.changePercent, 2)}` : ''}）</span>}
              {body.value.previous === null && <small>（第一份彙總，下次起和前一天比較）</small>}
            </p> : <p>沒有未平倉持倉。</p>}
            {body.movers.length > 0 && <p>變動最大：{body.movers.map((mover, position) => <span key={mover.ticker}>{position > 0 && '、'}<b>{mover.ticker}</b> <span className={`digest-change${tone(mover.changePercent)}`}>{percent(mover.changePercent)}</span></span>)}</p>}
          </section>

          <section><h3>快到期（7 天內）</h3>
            {body.expiring.length ? <ul>{body.expiring.map((item) => <li key={`${item.ticker}-${item.expiry}-${item.strike}-${item.right}`}><b>{item.ticker}</b> {md(item.expiry)} {item.strike} {item.right === 'PUT' ? 'P' : 'C'} · 剩 {item.days} 天{item.moneyness ? ` · ${item.moneyness === 'ITM' ? '價內' : item.moneyness === 'OTM' ? '價外' : '價平附近'}` : ''}</li>)}</ul> : <p>7 天內沒有到期的選擇權。</p>}
          </section>

          <section><h3>30 天內財報與事件</h3>
            {body.events.length ? <p>{body.events.map((event, position) => <span key={`${event.ticker}-${event.date}-${event.kind ?? 'earnings'}-${event.label ?? ''}`}>{position > 0 && '、'}<b>{event.ticker}</b> {md(event.date)}{event.kind === 'custom' ? ` ${event.label ?? ''}` : <>{event.timing ? (event.timing === 'pre' ? ' 盤前' : ' 盤後') : ''}{event.estimate ? '（預估）' : ''}</>}</span>)}</p> : <p>30 天內沒有已知的財報日或自訂事件。</p>}
          </section>

          <section><h3>持倉相關新聞</h3>
            {body.news.length ? <ul>{body.news.map((item) => <li key={item.ticker}><b>{item.ticker}</b>：{item.text} <a href={item.url} target="_blank" rel="noreferrer noopener">來源 ↗</a></li>)}</ul> : <p>{body.newsNote ?? '沒有新聞。'}</p>}
          </section>

          <section><h3>市場定調</h3>
            {body.regime ? <p>目前 <b>{regimeNames[body.regime.id]}</b>{body.regime.previousId !== null && body.regime.previousId !== body.regime.id ? `（前一個交易日是「${regimeNames[body.regime.previousId]}」）` : '，和前一個交易日相同'}；VIX {body.regime.vix.toFixed(2)}、比率 {body.regime.ratio.toFixed(3)}。</p> : <p>這次讀不到市場定調。</p>}
          </section>

          <section><h3>集中度</h3>
            {body.concentration ? <p>最大分組 <b>{body.concentration.group}</b> {(body.concentration.share * 100).toFixed(1)}%{body.concentration.mode === 'theme' ? '（依主題）' : body.concentration.mode === 'sector' ? '（依產業）' : ''}{body.concentration.previousShare !== null ? `，前一份是 ${(body.concentration.previousShare * 100).toFixed(1)}%` : ''}。</p> : <p>沒有可計算的持倉。</p>}
          </section>

          <section><h3>OpenAI</h3>
            {body.openai?.ok === true && <p className="digest-ok">{md(body.openai.day)}（UTC）免費額度正常：清單上的模型沒有被收費{body.openai.searchCost ? ` · 搜尋費 $${body.openai.searchCost.toFixed(2)}` : ''}。</p>}
            {body.openai?.ok === false && <p className="digest-alert">{md(body.openai.day)}（UTC）免費額度內卻被收費：{body.openai.billed.map((item) => `${item.model} $${item.cost.toFixed(3)}`).join('、')}。請到 OpenAI 的 Sharing 頁確認是否仍是 enrolled，或資格清單是否改了。</p>}
            {(!body.openai || body.openai.ok === null) && <p>{body.openai?.note ?? '這次沒有核對費用。'}</p>}
          </section>

          {body.missing.length > 0 && <p className="digest-note">這次讀不到：{body.missing.join('、')}。</p>}
        </>}
        <p className="digest-note">只描述發生了什麼，不是買賣建議。每天美股收盤後產生；桌面版和沒跑到的日子會在打開網站時補上。</p>
        {error && <p className="digest-alert" role="alert">{error}</p>}
      </div>
      <footer className="digest-footer">
        <button type="button" className="cancel-button" disabled={busy} onClick={() => void regenerate()}>{busy ? '產生中…' : '重新產生最新一份'}</button>
        <button type="button" className="primary-button" onClick={onClose}>關閉</button>
      </footer>
    </section>
  </div>;
}
