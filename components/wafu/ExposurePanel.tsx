'use client';

import type { FormEvent } from 'react';
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EarningsReminder } from '@/lib/earnings';
import type { CustomEvent, ExposureInput, GroupMode } from '@/lib/exposure';
import {
  buildPositions, cashLikeGroup, concentration, defaultGroupMode, eventWindowDays, exposureEventsKey, exposureGroups, exposureOpenKey,
  exposureThemesKey, maxEventLabelLength, maxThemeLength, optionTools, sanitizeCustomEvents, sanitizeThemes, scenarioLoss, stressScenarios, upcomingEvents,
} from '@/lib/exposure';

type Props = {
  inputs: ExposureInput[];
  earnings: EarningsReminder[];
  cashLike: string[];
  unrealized: number;
  todayKey: string;
  colors: { colors: string[]; other: string };
  loading: boolean;
};
type Profiles = Record<string, { sector: string | null }>;

const minus = '−';
const wholeFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = (value: number) => `${value < -0.5 ? minus : ''}$${wholeFormat.format(Math.abs(value))}`;
const lossText = (value: number) => `${minus}$${wholeFormat.format(Math.abs(value))}`;
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const dayLabel = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const weekdayLabel = (key: string) => `週${weekdays[new Date(`${key}T00:00:00Z`).getUTCDay()]}`;
const levelText = { high: '集中度偏高', mid: '略為集中', low: '分散良好' } as const;
const shockSteps = { min: 5, max: 50, step: 5 };

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeValue(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the panel still works for this visit.
  }
}

function ExposurePanel({ inputs, earnings, cashLike, unrealized, todayKey, colors, loading }: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [themes, setThemes] = useState<Record<string, string>>({});
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>([]);
  const [modeChoice, setModeChoice] = useState<GroupMode | null>(null);
  const [includeCash, setIncludeCash] = useState(true);
  const [customGroup, setCustomGroup] = useState<string | null>(null);
  const [customShock, setCustomShock] = useState(30);
  const [themeEditor, setThemeEditor] = useState<string | null>(null);
  const [themeDraft, setThemeDraft] = useState('');
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState({ date: '', ticker: '', label: '' });
  const [profiles, setProfiles] = useState<{ key: string; data: Profiles } | null>(null);
  const [visible, setVisible] = useState(false);

  // Stored choices load after the first paint so the server render and the first client render agree.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setOpen(window.localStorage.getItem(exposureOpenKey) === '1'); } catch { /* storage refused */ }
      setThemes(sanitizeThemes(readJson(exposureThemesKey)));
      setCustomEvents(sanitizeCustomEvents(readJson(exposureEventsKey), todayKey));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [todayKey]);

  // Sectors are fetched only once the panel is near the screen.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === 'undefined') { queueMicrotask(() => setVisible(true)); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setVisible(true); }, { rootMargin: '400px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const positions = useMemo(() => buildPositions(inputs, cashLike), [inputs, cashLike]);
  const profileKey = useMemo(() => [...new Set(positions.filter((position) => !position.cashLike).map((position) => position.symbol))]
    .filter((symbol) => /^[A-Z0-9.=^-]{1,15}$/.test(symbol)).sort().join(','), [positions]);

  useEffect(() => {
    if (!visible || !profileKey || profiles?.key === profileKey) return;
    const controller = new AbortController();
    fetch(`/api/profile?symbols=${encodeURIComponent(profileKey)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { profiles?: Profiles };
        if (!controller.signal.aborted) setProfiles({ key: profileKey, data: response.ok && payload.profiles ? payload.profiles : {} });
      })
      // Without sectors every holding shows as 未分類 until the next visit.
      .catch(() => { if (!controller.signal.aborted) setProfiles({ key: profileKey, data: {} }); });
    return () => controller.abort();
  }, [profileKey, profiles?.key, visible]);

  const sectors = useMemo(() => Object.fromEntries(Object.entries(profiles?.data ?? {}).map(([symbol, profile]) => [symbol, profile.sector])), [profiles]);
  const mode: GroupMode = modeChoice ?? defaultGroupMode(positions, themes);
  const { groups } = useMemo(() => exposureGroups(positions, { mode, sectors, themes, includeCash }), [includeCash, mode, positions, sectors, themes]);
  const allGroups = useMemo(() => exposureGroups(positions, { mode, sectors, themes, includeCash: false }).groups, [mode, positions, sectors, themes]);
  const conc = useMemo(() => concentration(positions, includeCash), [includeCash, positions]);
  const scenarios = useMemo(() => stressScenarios(allGroups, positions), [allGroups, positions]);
  const events = useMemo(() => upcomingEvents(earnings, customEvents, positions, todayKey), [customEvents, earnings, positions, todayKey]);
  const tools = useMemo(() => optionTools(positions), [positions]);
  const riskGroups = allGroups.filter((group) => group.value > 0);
  const activeCustomGroup = riskGroups.find((group) => group.name === customGroup) ?? riskGroups[0] ?? null;
  const customLoss = activeCustomGroup ? scenarioLoss(activeCustomGroup.value, customShock / 100) : 0;
  const totalValue = positions.reduce((sum, position) => sum + Math.max(0, position.value), 0);
  const unpricedOptions = positions.reduce((sum, position) => sum + position.unpricedOptions, 0);
  const heldTickers = positions.filter((position) => !position.cashLike).map((position) => position.ticker).sort();
  const existingThemes = [...new Set(Object.values(themes))].sort((a, b) => a.localeCompare(b));
  const worst = scenarios.reduce((max, scenario) => Math.max(max, scenario.loss), 0);
  const scale = Math.max(worst, customLoss, unrealized > 0 ? unrealized : 0, 1) * 1.1;

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    let index = 0;
    for (const group of groups) {
      if (group.cashLike) continue;
      map.set(group.name, colors.colors.length ? colors.colors[index % colors.colors.length] : colors.other);
      index += 1;
    }
    return map;
  }, [colors, groups]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    writeValue(exposureOpenKey, next ? '1' : '0');
  };
  const saveThemes = (next: Record<string, string>) => {
    setThemes(next);
    writeValue(exposureThemesKey, Object.keys(next).length ? JSON.stringify(next) : null);
  };
  const assignTheme = (ticker: string, theme: string | null) => {
    const next = { ...themes };
    const name = theme?.trim().slice(0, maxThemeLength) ?? '';
    if (name && name !== cashLikeGroup) next[ticker] = name;
    else delete next[ticker];
    saveThemes(next);
    setThemeEditor(null);
    setThemeDraft('');
  };
  const saveEvents = (next: CustomEvent[]) => {
    const clean = sanitizeCustomEvents(next, todayKey);
    setCustomEvents(clean);
    writeValue(exposureEventsKey, clean.length ? JSON.stringify(clean) : null);
  };
  const addEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = eventDraft.label.trim();
    if (!eventDraft.date || !eventDraft.ticker || !label) return;
    saveEvents([...customEvents, { id: `${Date.now().toString(36)}`, date: eventDraft.date, ticker: eventDraft.ticker, label }]);
    setEventDraft({ date: '', ticker: '', label: '' });
    setEventFormOpen(false);
  };
  const removeEvent = (id: string) => saveEvents(customEvents.filter((item) => item.id !== id));

  const topGroup = groups.find((group) => !group.cashLike && group.share > 0) ?? null;
  const empty = !positions.length;

  const bar = <div className="exposure-bar" role="img" aria-label={groups.map((group) => `${group.name} ${percent(group.share)}`).join('，') || '沒有持倉'}>
    {groups.filter((group) => group.share > 0).map((group) => <span key={group.name} className={group.cashLike ? 'is-cash' : ''} style={{ flexBasis: `${group.share * 100}%`, background: group.cashLike ? undefined : colorOf.get(group.name) }} />)}
  </div>;

  const stressRow = (key: string, label: string, amount: number) => <div className="exposure-stress-row" key={key}>
    <b>{label}</b>
    <strong>{lossText(amount)}</strong>
    <div className="exposure-stress-track" aria-hidden="true">
      <span style={{ width: `${Math.min(100, (amount / scale) * 100)}%` }} />
      {unrealized > 0 && <u style={{ left: `${Math.min(99.5, (unrealized / scale) * 100)}%` }} />}
    </div>
    <small>
      <span>占組合 {minus}{percent(totalValue > 0 ? amount / totalValue : 0)}</span>
      {unrealized > 0 && <span>{amount >= unrealized ? ` · 相當於未實現損益 × ${(amount / unrealized).toFixed(1)}` : ` · 未實現損益還剩 ${money(unrealized - amount)}`}</span>}
    </small>
  </div>;

  return <article ref={rootRef} className={`panel exposure-panel ${open ? 'is-open' : ''} ${loading ? 'is-loading' : ''}`} id="exposure" aria-labelledby={`${panelId}-title`}>
    <div className="panel-heading">
      <div><p className="eyebrow">Exposure</p><h2 id={`${panelId}-title`}>持倉風險</h2></div>
      <div className="exposure-actions">
        {open && !empty && <>
          <div className="exposure-switch" role="group" aria-label="分組方式">
            <button type="button" className={mode === 'sector' ? 'active' : ''} aria-pressed={mode === 'sector'} onClick={() => setModeChoice('sector')}>產業</button>
            <button type="button" className={mode === 'theme' ? 'active' : ''} aria-pressed={mode === 'theme'} onClick={() => setModeChoice('theme')}>主題</button>
          </div>
          <button type="button" className={`exposure-toggle ${includeCash ? 'is-on' : ''}`} role="switch" aria-checked={includeCash} onClick={() => setIncludeCash((value) => !value)}><i aria-hidden="true" />含類現金</button>
        </>}
        <button type="button" className="exposure-open" aria-expanded={open} aria-controls={`${panelId}-body`} onClick={toggleOpen}>{open ? '收合' : '展開'}<span aria-hidden="true">▾</span></button>
      </div>
    </div>

    {empty ? <p className="exposure-empty">{loading ? '正在讀取持倉…' : '還沒有未平倉持倉。新增交易後，這裡會顯示曝險、集中度與壓力情境。'}</p> : <>
      {!open && <div className="exposure-summary">
        {topGroup && <span>{mode === 'theme' ? '最大主題' : '最大產業'} <b>{topGroup.name} {percent(topGroup.share)}</b></span>}
        {conc && <span>集中度 <em className={`exposure-level is-${conc.level}`}>{levelText[conc.level]}</em></span>}
        {worst > 0 && <span>最差預設情境 <b className="negative">{lossText(worst)}</b></span>}
        <span>{eventWindowDays} 天內事件 <b>{events.length}</b></span>
      </div>}

      <div className="exposure-bar-block">{bar}</div>

      {open && <div className="exposure-body" id={`${panelId}-body`}>
        <div className="exposure-legend">
          {groups.map((group) => <div className="exposure-legend-item" key={group.name}>
            <i className={group.cashLike ? 'is-cash' : ''} style={{ background: group.cashLike ? undefined : colorOf.get(group.name) }} aria-hidden="true" />
            <b>{group.name}</b>
            <em>{percent(group.share)}</em>
            <div className="exposure-members">
              {group.members.map((ticker) => group.cashLike
                ? <span key={ticker}>{ticker}</span>
                : <button type="button" key={ticker} aria-label={`${ticker}：指定主題`} aria-expanded={themeEditor === ticker} onClick={() => { setThemeEditor(themeEditor === ticker ? null : ticker); setThemeDraft(''); }}>{ticker}{themes[ticker] && mode === 'sector' ? <small>{themes[ticker]}</small> : null}</button>)}
              <span className="exposure-amount">{money(group.value)}</span>
            </div>
          </div>)}
        </div>

        {themeEditor && <div className="exposure-pop" role="group" aria-label={`${themeEditor} 的主題`}>
          <p><b>{themeEditor} 的主題</b><span>只影響這個面板</span></p>
          <div className="exposure-pop-options">
            {existingThemes.map((theme) => <button type="button" key={theme} className={themes[themeEditor] === theme ? 'active' : ''} aria-pressed={themes[themeEditor] === theme} onClick={() => assignTheme(themeEditor, theme)}>{theme}</button>)}
          </div>
          <form className="exposure-pop-new" onSubmit={(event) => { event.preventDefault(); if (themeDraft.trim()) assignTheme(themeEditor, themeDraft); }}>
            <label htmlFor={`${panelId}-theme`}>新主題</label>
            <input id={`${panelId}-theme`} value={themeDraft} maxLength={maxThemeLength} placeholder="例如 AI 鏈" onChange={(event) => setThemeDraft(event.target.value)} />
            <button type="submit" className="exposure-primary" disabled={!themeDraft.trim()}>加入</button>
          </form>
          <div className="exposure-pop-actions">
            {themes[themeEditor] && <button type="button" onClick={() => assignTheme(themeEditor, null)}>清除主題</button>}
            <button type="button" onClick={() => setThemeEditor(null)}>完成</button>
          </div>
          <small>沒指定主題的代號沿用產業分類；主題會跟著完整備份一起保存。</small>
        </div>}

        <div className="exposure-cards">
          <section className="exposure-card" aria-label="集中度">
            <h3>集中度{conc && <em className={`exposure-level is-${conc.level}`}>{levelText[conc.level]}</em>}</h3>
            {conc ? <dl className="exposure-kv">
              <div><dt>最大單一</dt><dd>{percent(conc.top1.share)}<small>{conc.top1.ticker}</small></dd></div>
              <div><dt>前三大</dt><dd>{percent(conc.top3)}<small>{conc.names.join('、')}</small></dd></div>
              <div><dt>有效檔數</dt><dd>{conc.effective.toFixed(1)}<small>{conc.count} 檔部位 · 權重越平均越接近總數</small></dd></div>
            </dl> : <p className="exposure-note">不含類現金時沒有其他部位。</p>}
          </section>

          <section className="exposure-card" aria-label="壓力情境">
            <h3>壓力情境<span>等幅下跌</span></h3>
            <div className="exposure-stress">
              {scenarios.map((scenario) => stressRow(scenario.id, scenario.name ? `${scenario.name} ${minus}${scenario.shock * 100}%` : `非現金全部 ${minus}${scenario.shock * 100}%`, scenario.loss))}
              {!scenarios.length && <p className="exposure-note">只有類現金時沒有可計算的情境。</p>}
              {activeCustomGroup && <div className="exposure-custom">
                <div className="exposure-custom-row">
                  <select aria-label="自訂情境的分組" value={activeCustomGroup.name} onChange={(event) => setCustomGroup(event.target.value)}>
                    {riskGroups.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
                  </select>
                  <input type="range" aria-label="自訂跌幅" min={shockSteps.min} max={shockSteps.max} step={shockSteps.step} value={customShock} onChange={(event) => setCustomShock(Number(event.target.value))} />
                  <output>{minus}{customShock}%</output>
                </div>
                {stressRow('custom', `自訂：${activeCustomGroup.name} ${minus}${customShock}%`, customLoss)}
              </div>}
              {unpricedOptions > 0 && <p className="exposure-note">{unpricedOptions} 筆選擇權等待標的報價，尚未計入。</p>}
            </div>
          </section>

          <section className="exposure-card" aria-label={`${eventWindowDays} 天內事件`}>
            <h3>{eventWindowDays} 天內事件<span>權重</span></h3>
            {events.length ? <ul className="exposure-events">
              {events.map((item) => <li key={item.key}>
                <time dateTime={item.date}><b>{dayLabel(item.date)}</b><small>{weekdayLabel(item.date)}</small></time>
                <div>
                  <b>{item.ticker}</b> {item.label}
                  {item.estimate && <span className="exposure-tag">預估</span>}
                  {item.kind === 'custom' && <span className="exposure-tag is-custom">自訂</span>}
                  <small>{item.timing === 'pre' ? '盤前' : item.timing === 'post' ? '盤後' : item.daysAway === 0 ? '今天' : `${item.daysAway} 天後`}</small>
                </div>
                <span className="exposure-weight">{percent(item.share)}</span>
                {item.kind === 'custom' && <button type="button" className="exposure-remove" aria-label={`刪除 ${item.ticker} ${item.label}`} onClick={() => removeEvent(item.key.slice(2))}>×</button>}
              </li>)}
            </ul> : <p className="exposure-note">{eventWindowDays} 天內沒有持股的財報或自訂事件。</p>}
            {eventFormOpen ? <form className="exposure-event-form" onSubmit={addEvent}>
              <label htmlFor={`${panelId}-ev-date`}>日期<input id={`${panelId}-ev-date`} type="date" required min={todayKey} value={eventDraft.date} onChange={(event) => setEventDraft({ ...eventDraft, date: event.target.value })} /></label>
              <label htmlFor={`${panelId}-ev-ticker`}>代號<select id={`${panelId}-ev-ticker`} required value={eventDraft.ticker} onChange={(event) => setEventDraft({ ...eventDraft, ticker: event.target.value })}>
                <option value="">選擇代號</option>
                {heldTickers.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}
              </select></label>
              <label htmlFor={`${panelId}-ev-label`}>名稱<input id={`${panelId}-ev-label`} required maxLength={maxEventLabelLength} placeholder="例如 新品發表" value={eventDraft.label} onChange={(event) => setEventDraft({ ...eventDraft, label: event.target.value })} /></label>
              <div className="exposure-pop-actions"><button type="button" onClick={() => setEventFormOpen(false)}>取消</button><button type="submit" className="exposure-primary">新增</button></div>
            </form> : heldTickers.length > 0 && <button type="button" className="exposure-add" onClick={() => setEventFormOpen(true)}>＋ 自訂事件</button>}
          </section>
        </div>

        <dl className="exposure-tools">
          <div><dt>可賣 covered call</dt><dd>{tools.coveredCalls.length
            ? tools.coveredCalls.map((item) => <strong key={item.ticker}>{item.ticker} × {item.contracts}</strong>)
            : <><strong>0 檔</strong><span>每檔都不到 100 股</span></>}</dd></div>
          <div><dt>類現金可擔保 put</dt><dd><strong>{money(tools.cashLike)}</strong>{tools.putStrikeCap > 0 && <span>單口履約價上限約 ${wholeFormat.format(tools.putStrikeCap)}</span>}</dd></div>
        </dl>
        <p className="exposure-foot">依目前報價計算，不構成投資建議。公式見 設定 → 資料 → 計算與標示說明。</p>
      </div>}
    </>}
  </article>;
}

export default memo(ExposurePanel);
