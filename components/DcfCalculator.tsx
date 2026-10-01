'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './DcfCalculator.module.css';
import type { AiEntryContext } from '@/components/AiTradeEntry';
import type { AiCompanyInfo } from '@/lib/company-ai';
import { askCompanyAi, cachedCompanyAi, companyAiProviderName } from '@/lib/company-ai';
import type { AiProvider } from '@/lib/earnings';
import type { DcfAiSuggestion, DcfAssumptionKey } from '@/lib/dcf-ai';
import { askDcfAssumptions, dcfAssumptionKeys, savedDcfSuggestion } from '@/lib/dcf-ai';

type Currency = 'USD' | 'JPY';

type Assumptions = {
  ticker: string;
  currency: Currency;
  currentPrice: number;
  freeCashFlow: number;
  shares: number;
  netCash: number;
  growth: number;
  years: number;
  wacc: number;
  terminalGrowth: number;
  marginOfSafety: number;
};

type CompanyPayload = {
  symbol: string;
  name: string;
  currency: string;
  instrumentType: string;
  price: number | null;
  updatedAt: string;
  metrics: { freeCashFlow: number | null; dilutedShares: number | null; netCash: number | null };
  ai?: AiCompanyInfo;
  error?: string;
};
/** The base-period inputs a company lookup fills. */
type BaseField = 'price' | 'freeCashFlow' | 'dilutedShares' | 'netCash';
const baseFieldNames: Record<BaseField, string> = { price: '股價', freeCashFlow: 'TTM 自由現金流', dilutedShares: '稀釋後股數', netCash: '淨現金' };
const missingFields = (payload: CompanyPayload): BaseField[] => [
  typeof payload.price === 'number' ? null : 'price' as const,
  typeof payload.metrics.freeCashFlow === 'number' ? null : 'freeCashFlow' as const,
  typeof payload.metrics.dilutedShares === 'number' ? null : 'dilutedShares' as const,
  typeof payload.metrics.netCash === 'number' ? null : 'netCash' as const,
].filter((field): field is BaseField => field !== null);
type SavedScenario = { id: number; name: string; ticker: string; currency: Currency; data: Assumptions; updatedAt: string };

const defaultAssumptions: Assumptions = {
  ticker: 'MSFT',
  currency: 'USD',
  currentPrice: 496,
  freeCashFlow: 74,
  shares: 7.43,
  netCash: 31,
  growth: 9,
  years: 5,
  wacc: 9,
  terminalGrowth: 2.5,
  marginOfSafety: 20,
};

const currencyDefaults: Record<Currency, Pick<Assumptions, 'wacc' | 'terminalGrowth'>> = {
  USD: { wacc: 9, terminalGrowth: 2.5 },
  JPY: { wacc: 7, terminalGrowth: 1 },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

function normalizeAssumptions(input: Assumptions): Assumptions {
  const defaults = currencyDefaults[input.currency];
  const wacc = clamp(finiteOr(input.wacc, defaults.wacc), 4, 25);
  const terminalMaximum = Math.min(3.5, wacc - 1);
  return {
    ...input,
    currentPrice: Math.max(0, finiteOr(input.currentPrice, 0)),
    freeCashFlow: finiteOr(input.freeCashFlow, 0),
    shares: Math.max(0, finiteOr(input.shares, 0)),
    netCash: finiteOr(input.netCash, 0),
    growth: clamp(finiteOr(input.growth, 0), -50, 50),
    years: Math.round(clamp(finiteOr(input.years, 5), 3, 10)),
    wacc,
    terminalGrowth: clamp(finiteOr(input.terminalGrowth, defaults.terminalGrowth), -2, terminalMaximum),
    marginOfSafety: clamp(finiteOr(input.marginOfSafety, 20), 0, 90),
  };
}

function dcfErrors(input: Assumptions, waccOverride = input.wacc, terminalGrowthOverride = input.terminalGrowth) {
  const errors: string[] = [];
  if (!Number.isFinite(input.freeCashFlow) || input.freeCashFlow <= 0) errors.push('TTM 自由現金流必須大於 0');
  if (!Number.isFinite(input.shares) || input.shares <= 0) errors.push('稀釋後股數必須大於 0');
  if (!Number.isFinite(input.years) || input.years < 1) errors.push('預測年數必須大於 0');
  if (!Number.isFinite(input.growth) || input.growth <= -100) errors.push('FCF 成長率必須高於 -100%');
  if (!Number.isFinite(waccOverride) || waccOverride <= 0) errors.push('WACC 必須大於 0');
  if (!Number.isFinite(terminalGrowthOverride) || waccOverride <= terminalGrowthOverride) errors.push('WACC 必須高於永續成長率');
  return errors;
}

function calculateDcf(input: Assumptions, waccOverride = input.wacc, terminalGrowthOverride = input.terminalGrowth) {
  const wacc = waccOverride / 100;
  const terminalGrowth = terminalGrowthOverride / 100;
  const growth = input.growth / 100;
  if (dcfErrors(input, waccOverride, terminalGrowthOverride).length) return null;
  const projections = Array.from({ length: input.years }, (_, index) => {
    const year = index + 1;
    const fcf = input.freeCashFlow * ((1 + growth) ** year);
    const presentValue = fcf / ((1 + wacc) ** (year - .5));
    return { year, fcf, presentValue };
  });
  const finalFcf = projections.at(-1)?.fcf ?? input.freeCashFlow;
  if (!Number.isFinite(finalFcf) || finalFcf <= 0) return null;
  const terminalValue = finalFcf * (1 + terminalGrowth) / (wacc - terminalGrowth);
  const terminalPresentValue = terminalValue / ((1 + wacc) ** (input.years - .5));
  const forecastPresentValue = projections.reduce((sum, item) => sum + item.presentValue, 0);
  const enterpriseValue = forecastPresentValue + terminalPresentValue;
  const equityValue = enterpriseValue + input.netCash;
  const intrinsicValue = equityValue / input.shares;
  return {
    projections,
    forecastPresentValue,
    terminalPresentValue,
    terminalShare: enterpriseValue ? terminalPresentValue / enterpriseValue : 0,
    enterpriseValue,
    equityValue,
    intrinsicValue,
    upside: input.currentPrice > 0 ? intrinsicValue / input.currentPrice - 1 : null,
    buyBelow: intrinsicValue * (1 - input.marginOfSafety / 100),
  };
}

function money(value: number, currency: Currency) {
  return new Intl.NumberFormat(currency === 'JPY' ? 'ja-JP' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(value);
}

function NumberField({ label, value, suffix, step = '0.1', min, max, note, onChange }: {
  label: string;
  /** A line under the input (the AI's reason for a pre-filled value). */
  note?: ReactNode;
  value: number;
  suffix?: string;
  step?: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const commit = (input: HTMLInputElement) => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = String(value);
      return;
    }
    const next = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
    input.value = String(next);
    onChange(next);
  };
  return <label className={styles.field}><span>{label}</span><span className={styles.inputShell}><input
    key={String(value)}
    type="number"
    defaultValue={value}
    step={step}
    min={min}
    max={max}
    onFocus={(event) => event.currentTarget.select()}
    onBlur={(event) => commit(event.currentTarget)}
    onKeyDown={(event) => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') {
        event.currentTarget.value = String(value);
        event.currentTarget.blur();
      }
    }}
  />{suffix && <i>{suffix}</i>}</span>{note}</label>;
}

export default function DcfCalculator({ initialTicker = 'MSFT', onClose, ai = null }: {
  initialTicker?: string;
  onClose?: () => void;
  /** AI settings; when set and the market data fails or lacks a base input, ChatGPT or Claude can fill it. */
  ai?: AiEntryContext | null;
}) {
  const [assumptions, setAssumptions] = useState<Assumptions>(() => normalizeAssumptions({
    ...defaultAssumptions,
    ticker: initialTicker || defaultAssumptions.ticker,
    currency: initialTicker.endsWith('.T') ? 'JPY' : 'USD',
    terminalGrowth: initialTicker.endsWith('.T') ? 1 : 2.5,
    wacc: initialTicker.endsWith('.T') ? 7 : 9,
  }));
  const [companyName, setCompanyName] = useState('');
  const [companyUpdatedAt, setCompanyUpdatedAt] = useState('');
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyMessage, setCompanyMessage] = useState('');
  // What the last lookup could not fill ('all' when it failed), so the AI can be asked for just that.
  const [companyGap, setCompanyGap] = useState<{ symbol: string; fields: BaseField[] | 'all' } | null>(null);
  const [aiAsk, setAiAsk] = useState<{ provider: AiProvider; loading: boolean; error: string } | null>(null);
  const [aiSource, setAiSource] = useState<AiCompanyInfo | null>(null);
  // AI 預填 of the forecast inputs (asked only on the button); fields the user changed keep their value.
  const [dcfAi, setDcfAi] = useState<{ provider: AiProvider; loading: boolean; error: string } | null>(null);
  const [suggestion, setSuggestion] = useState<DcfAiSuggestion | null>(null);
  const [touched, setTouched] = useState<ReadonlySet<DcfAssumptionKey>>(new Set());
  const [scenarioName, setScenarioName] = useState(`${initialTicker || 'MSFT'} Base`);
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const result = useMemo(() => calculateDcf(assumptions), [assumptions]);
  const modelErrors = useMemo(() => dcfErrors(assumptions), [assumptions]);
  const set = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => setAssumptions((current) => {
    const next = { ...current, [key]: value };
    return typeof value === 'number' ? normalizeAssumptions(next) : next;
  });
  const setForecast = (key: DcfAssumptionKey, value: number) => {
    setTouched((current) => current.has(key) ? current : new Set(current).add(key));
    set(key, value);
  };
  const applySuggestion = (next: DcfAiSuggestion, keep: ReadonlySet<DcfAssumptionKey>) => {
    setSuggestion(next);
    setAssumptions((current) => normalizeAssumptions({ ...current, ...Object.fromEntries(dcfAssumptionKeys.filter((key) => !keep.has(key)).map((key) => [key, next.values[key]])) }));
  };
  const askForecast = async (provider: AiProvider, fresh: boolean) => {
    if (!ai || dcfAi?.loading) return;
    const symbol = assumptions.ticker.trim().toUpperCase();
    setDcfAi({ provider, loading: true, error: '' });
    try {
      applySuggestion(await askDcfAssumptions(symbol, ai, provider, fresh), touched);
      setDcfAi(null);
    } catch (reason) {
      setDcfAi({ provider, loading: false, error: reason instanceof Error ? reason.message : 'AI 判斷失敗，請稍後再試。' });
    }
  };
  const resetForecast = () => {
    const japan = assumptions.currency === 'JPY';
    setSuggestion(null);
    setTouched(new Set());
    setDcfAi(null);
    setAssumptions((current) => normalizeAssumptions({ ...current, growth: defaultAssumptions.growth, years: defaultAssumptions.years, marginOfSafety: defaultAssumptions.marginOfSafety, ...currencyDefaults[japan ? 'JPY' : 'USD'] }));
  };
  const aiNote = (key: DcfAssumptionKey, unitLabel: string) => {
    if (!suggestion || suggestion.symbol !== assumptions.ticker.trim().toUpperCase()) return undefined;
    const value = suggestion.values[key];
    const kept = touched.has(key) && assumptions[key] !== value;
    return <small className={styles.aiFieldNote}>
      <b>{kept ? `AI 建議 ${value}${unitLabel}` : 'AI 預填'}</b>{suggestion.reasons[key]}
      {kept && <button type="button" onClick={() => { setTouched((current) => { const next = new Set(current); next.delete(key); return next; }); set(key, value); }}>套用</button>}
    </small>;
  };
  const otherProvider: AiProvider = ai?.defaultProvider === 'anthropic' ? 'openai' : 'anthropic';
  const savedForecast = ai ? savedDcfSuggestion(assumptions.ticker.trim()) : null;
  const chartValues = [assumptions.freeCashFlow, ...(result?.projections.map((item) => item.fcf) ?? [])].filter((value) => Number.isFinite(value) && value > 0);
  const fcfMaximum = Math.max(1, ...chartValues);
  const barHeight = (value: number) => `${Math.min(100, Math.max(4, value / fcfMaximum * 100))}%`;
  const waccValues = [-2, -1, 0, 1, 2].map((offset) => assumptions.wacc + offset);
  const terminalValues = [-1, -.5, 0, .5, 1].map((offset) => assumptions.terminalGrowth + offset);
  const unit = assumptions.currency === 'JPY' ? '十億日圓' : '十億美元';

  const loadScenarios = useCallback(() => {
    fetch('/api/dcf-scenarios', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { scenarios?: SavedScenario[] };
        if (response.ok && payload.scenarios) setScenarios(payload.scenarios);
      }).catch(() => undefined);
  }, []);

  // Fills the base inputs from a company payload: all of them, or only the listed ones (to fill gaps).
  const applyCompany = useCallback((payload: CompanyPayload, only: BaseField[] | null) => {
    const currency: Currency = payload.currency === 'JPY' ? 'JPY' : 'USD';
    const use = (field: BaseField) => !only || only.includes(field);
    setAssumptions((current) => normalizeAssumptions({
      ...current,
      ticker: payload.symbol,
      currency: only ? current.currency : currency,
      currentPrice: use('price') && typeof payload.price === 'number' ? payload.price : current.currentPrice,
      freeCashFlow: use('freeCashFlow') && typeof payload.metrics.freeCashFlow === 'number' ? Number((payload.metrics.freeCashFlow / 1e9).toFixed(3)) : current.freeCashFlow,
      shares: use('dilutedShares') && typeof payload.metrics.dilutedShares === 'number' ? Number((payload.metrics.dilutedShares / 1e9).toFixed(4)) : current.shares,
      netCash: use('netCash') && typeof payload.metrics.netCash === 'number' ? Number((payload.metrics.netCash / 1e9).toFixed(3)) : current.netCash,
      wacc: !only && currency !== current.currency ? currencyDefaults[currency].wacc : current.wacc,
      terminalGrowth: !only && currency !== current.currency ? currencyDefaults[currency].terminalGrowth : current.terminalGrowth,
    }));
  }, []);

  const applyAiCompany = useCallback((company: CompanyPayload & { ai: AiCompanyInfo }, only: BaseField[] | null, earlier = false) => {
    applyCompany(company, only);
    setCompanyName(company.name);
    setCompanyUpdatedAt(company.updatedAt);
    setAiSource(company.ai);
    const name = companyAiProviderName(company.ai.provider);
    const stillMissing = missingFields(company).filter((field) => !only || only.includes(field));
    if (!only) setScenarioName(`${company.symbol} Base`);
    setCompanyGap(stillMissing.length ? { symbol: company.symbol, fields: stillMissing } : null);
    setCompanyMessage(`${earlier ? '已帶入稍早' : '已用'} ${name} 查詢的資料${only ? `補齊 ${only.filter((field) => !stillMissing.includes(field)).map((field) => baseFieldNames[field]).join('、') || '缺值'}` : ''}・請核對${stillMissing.length ? `；仍缺 ${stillMissing.map((field) => baseFieldNames[field]).join('、')}，請手動輸入` : ''}。`);
  }, [applyCompany]);

  const loadCompany = useCallback(async (ticker: string) => {
    const symbol = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) return setCompanyMessage('請輸入有效的股票代號。');
    setCompanyLoading(true);
    setCompanyMessage('');
    setAiAsk(null);
    setAiSource(null);
    setSuggestion((current) => current && current.symbol === symbol ? current : null);
    setDcfAi(null);
    try {
      const response = await fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
      const payload = await response.json() as CompanyPayload;
      if (!response.ok) throw new Error(payload.error ?? '公司資料暫時無法取得。');
      applyCompany(payload, null);
      setCompanyName(payload.name);
      setCompanyUpdatedAt(payload.updatedAt);
      setScenarioName(`${payload.symbol} Base`);
      const missing = missingFields(payload).filter((field) => field !== 'price' || payload.instrumentType !== 'ETF');
      setCompanyGap(missing.length && payload.instrumentType !== 'ETF' ? { symbol: payload.symbol, fields: missing } : null);
      setCompanyMessage(payload.instrumentType === 'ETF'
        ? 'ETF 不適合公司 DCF；請改用資產配置或成分股估值。'
        : missing.length ? `已帶入可取得資料；另有 ${missing.length} 個基期欄位缺值，請手動確認。` : '最新可用公司資料已自動帶入。');
    } catch (error) {
      setCompanyGap({ symbol, fields: 'all' });
      // An AI lookup made earlier in this visit (here or in the 基本面 tab) stands in for the failed source.
      const earlier = cachedCompanyAi(symbol);
      if (earlier) applyAiCompany(earlier, null, true);
      else setCompanyMessage(error instanceof Error ? error.message : '公司資料暫時無法取得。');
    } finally {
      setCompanyLoading(false);
    }
  }, [applyAiCompany, applyCompany]);

  const askAi = async (provider: AiProvider) => {
    if (!ai || !companyGap || aiAsk?.loading) return;
    const { symbol, fields } = companyGap;
    setAiAsk({ provider, loading: true, error: '' });
    try {
      const company = await askCompanyAi(symbol, ai, provider);
      applyAiCompany(company, fields === 'all' ? null : fields);
      setAiAsk(null);
    } catch (reason) {
      setAiAsk({ provider, loading: false, error: reason instanceof Error ? reason.message : '查詢失敗，請稍後再試。' });
    }
  };

  useEffect(() => { loadScenarios(); }, [loadScenarios]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadCompany(initialTicker || 'MSFT'); });
    return () => window.cancelAnimationFrame(frame);
  }, [initialTicker, loadCompany]);

  async function saveScenario() {
    const name = scenarioName.trim();
    if (!name) return setCompanyMessage('請先輸入情境名稱。');
    setScenarioSaving(true);
    try {
      const response = await fetch('/api/dcf-scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ticker: assumptions.ticker, currency: assumptions.currency, data: assumptions }) });
      const payload = await response.json() as { scenario?: SavedScenario; error?: string };
      if (!response.ok || !payload.scenario) throw new Error(payload.error ?? '估值情境無法保存。');
      setScenarios((current) => [payload.scenario!, ...current]);
      setCompanyMessage(`「${payload.scenario.name}」已保存。`);
    } catch (error) {
      setCompanyMessage(error instanceof Error ? error.message : '估值情境無法保存。');
    } finally {
      setScenarioSaving(false);
    }
  }

  function loadScenario(scenario: SavedScenario) {
    if (!scenario.data) return;
    const original = { ...defaultAssumptions, ...scenario.data };
    const normalized = normalizeAssumptions(original);
    setAssumptions(normalized);
    setScenarioName(scenario.name);
    setCompanyName('');
    setCompanyUpdatedAt(scenario.updatedAt);
    setCompanyMessage(original.terminalGrowth !== normalized.terminalGrowth || original.wacc !== normalized.wacc
      ? `已載入「${scenario.name}」，並將 WACC／永續成長率修正至有效範圍。`
      : `已載入「${scenario.name}」。`);
  }

  function switchCurrency(currency: Currency) {
    setAssumptions((current) => normalizeAssumptions({
      ...current,
      currency,
      ...currencyDefaults[currency],
    }));
  }

  async function deleteScenario(id: number) {
    try {
      const response = await fetch(`/api/dcf-scenarios?id=${id}`, { method: 'DELETE' });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? '估值情境無法刪除。');
      setScenarios((current) => current.filter((scenario) => scenario.id !== id));
      setCompanyMessage('估值情境已刪除。');
    } catch (error) {
      setCompanyMessage(error instanceof Error ? error.message : '估值情境無法刪除。');
    }
  }

  return <section className={styles.workspace} id="valuation" aria-labelledby="dcf-title">
    <header className={styles.header}>
      <div className={styles.identity}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/logo?ticker=${encodeURIComponent(assumptions.ticker || 'MSFT')}&v=6`} alt="" width="58" height="58" decoding="async" draggable={false} />
        <div><p>Valuation workspace</p><h2 id="dcf-title">DCF 內在價值試算</h2><span>以自由現金流、WACC 與永續成長率估算企業價值</span></div>
      </div>
      <div className={styles.headerActions}><div className={styles.tickerControl}><label>Ticker<input value={assumptions.ticker} onChange={(event) => set('ticker', event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') void loadCompany(assumptions.ticker); }} /></label><div role="group" aria-label="估值幣別"><button type="button" className={assumptions.currency === 'USD' ? styles.active : ''} onClick={() => switchCurrency('USD')}>USD</button><button type="button" className={assumptions.currency === 'JPY' ? styles.active : ''} onClick={() => switchCurrency('JPY')}>JPY</button></div></div><button type="button" className={styles.loadButton} disabled={companyLoading} onClick={() => void loadCompany(assumptions.ticker)}>{companyLoading ? '讀取中…' : '自動帶入資料'}</button>{onClose && <button type="button" className={styles.closeButton} onClick={onClose}>關閉估值表</button>}</div>
    </header>

    <div className={styles.scenarioBar}><div><label>情境名稱<input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} /></label><button type="button" disabled={scenarioSaving} onClick={() => void saveScenario()}>{scenarioSaving ? '保存中…' : '儲存情境'}</button></div><div className={styles.savedScenarios}>{scenarios.length ? scenarios.slice(0, 6).map((scenario) => <span key={scenario.id}><button type="button" onClick={() => loadScenario(scenario)}>{scenario.name}<small>{scenario.ticker}</small></button><button type="button" aria-label={`刪除 ${scenario.name}`} onClick={() => void deleteScenario(scenario.id)}>×</button></span>) : <em>尚未保存估值情境</em>}</div></div>
    {(companyMessage || companyName) && <p className={styles.dataStatus}><b>{companyName || assumptions.ticker}</b>{aiSource && <em className={styles.aiBadge}>AI 查詢・請核對</em>}{companyMessage}
      {aiSource && aiSource.sources.length > 0 && <span className={styles.aiSources}>{aiSource.sources.slice(0, 3).map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title || `來源 ${index + 1}`}</a>)}</span>}
      {ai && companyGap && !aiAsk?.loading && <span className={styles.aiActions}><button type="button" onClick={() => void askAi('openai')}>✦ 用 ChatGPT {companyGap.fields === 'all' ? '查詢' : '補齊缺值'}</button><button type="button" className={styles.aiAlt} onClick={() => void askAi('anthropic')}>改用 Claude</button></span>}
      {aiAsk?.loading && <span className={styles.aiWorking} role="status">正在用 {companyAiProviderName(aiAsk.provider)} 上網查詢…（約 20–60 秒）</span>}
      {aiAsk?.error && <span className={styles.aiError} role="alert">{aiAsk.error}</span>}{companyUpdatedAt && <small>資料時間 {new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(companyUpdatedAt))}</small>}</p>}

    <div className={styles.summaryGrid}>
      <article><span>每股內在價值</span><strong>{result ? money(result.intrinsicValue, assumptions.currency) : '—'}</strong><small>Base case</small></article>
      <article><span>目前價格</span><strong>{money(assumptions.currentPrice, assumptions.currency)}</strong><small>{assumptions.ticker || '尚未選擇標的'}</small></article>
      <article className={result && (result.upside ?? 0) >= 0 ? styles.positive : styles.negative}><span>潛在報酬</span><strong>{result?.upside === null || result?.upside === undefined ? '—' : `${result.upside >= 0 ? '+' : ''}${(result.upside * 100).toFixed(1)}%`}</strong><small>內在價值相對現價</small></article>
      <article><span>安全邊際買入價</span><strong>{result ? money(result.buyBelow, assumptions.currency) : '—'}</strong><small>{assumptions.marginOfSafety}% margin of safety</small></article>
    </div>

    <div className={styles.mainGrid}>
      <aside className={styles.assumptions}>
        <div className={styles.sectionHeading}><div><b>01</b><span><strong>基期資料</strong><small>所有金額使用十億元，股數使用十億股。</small></span></div></div>
        <div className={styles.fieldGrid}>
          <NumberField label="目前股價" value={assumptions.currentPrice} step="0.01" min={0} suffix={assumptions.currency} onChange={(value) => set('currentPrice', value)} />
          <NumberField label={`TTM 自由現金流（${unit}）`} value={assumptions.freeCashFlow} min={0} onChange={(value) => set('freeCashFlow', value)} />
          <NumberField label="稀釋後股數（十億股）" value={assumptions.shares} min={0} onChange={(value) => set('shares', value)} />
          <NumberField label={`淨現金／（淨負債）（${unit}）`} value={assumptions.netCash} onChange={(value) => set('netCash', value)} />
        </div>
        <div className={styles.sectionHeading}><div><b>02</b><span><strong>預測與折現</strong><small>百分比欄位輸入 9 代表 9%。</small></span></div></div>
        {ai && <div className={styles.aiForecast}>
          <div className={styles.aiActions}>
            {!dcfAi?.loading && <>
              <button type="button" onClick={() => void askForecast(ai.defaultProvider, Boolean(suggestion))}>✦ {suggestion ? '重新請 AI 判斷' : savedForecast ? 'AI 預填（7 天內已查過，不另計費）' : `AI 預填（${companyAiProviderName(ai.defaultProvider)}）`}</button>
              <button type="button" className={styles.aiAlt} onClick={() => void askForecast(otherProvider, Boolean(suggestion))}>改用 {companyAiProviderName(otherProvider)}</button>
              {(suggestion || touched.size > 0) && <button type="button" className={styles.aiAlt} onClick={resetForecast}>改回預設值</button>}
            </>}
          </div>
          {dcfAi?.loading && <p className={styles.aiWorking} role="status">正在用 {companyAiProviderName(dcfAi.provider)} 上網判斷 {assumptions.ticker} 的假設…（約 20–60 秒）</p>}
          {dcfAi?.error && <p className={styles.aiError} role="alert">{dcfAi.error}</p>}
          {suggestion && suggestion.symbol === assumptions.ticker.trim().toUpperCase() && <p className={styles.aiForecastNote}>
            {suggestion.summary && <span>{suggestion.summary}</span>}
            <small>{companyAiProviderName(suggestion.provider)}（{suggestion.model}）· {suggestion.asOf} · 僅供參考，請核對{touched.size > 0 ? ' · 你改過的欄位已保留' : ''}</small>
            {suggestion.sources.length > 0 && <span className={styles.aiSources}>{suggestion.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>{source.title}</a>)}</span>}
          </p>}
        </div>}
        <div className={styles.fieldGrid}>
          <NumberField label="FCF 年成長率" value={assumptions.growth} suffix="%" min={-50} max={50} note={aiNote('growth', '%')} onChange={(value) => setForecast('growth', value)} />
          <NumberField label="預測年數" value={assumptions.years} step="1" min={3} max={10} suffix="年" note={aiNote('years', '年')} onChange={(value) => setForecast('years', Math.max(3, Math.min(10, Math.round(value))))} />
          <NumberField label="WACC" value={assumptions.wacc} suffix="%" min={4} max={25} note={aiNote('wacc', '%')} onChange={(value) => setForecast('wacc', value)} />
          <NumberField label="永續成長率" value={assumptions.terminalGrowth} suffix="%" min={-2} max={Math.min(3.5, assumptions.wacc - 1)} note={aiNote('terminalGrowth', '%')} onChange={(value) => setForecast('terminalGrowth', value)} />
          <NumberField label="安全邊際" value={assumptions.marginOfSafety} suffix="%" min={0} max={90} note={aiNote('marginOfSafety', '%')} onChange={(value) => setForecast('marginOfSafety', value)} />
        </div>
        <p className={styles.rangeHint}>輸入框會整欄取代原值；永續成長率上限為 3.5%，並至少低於 WACC 1 個百分點。</p>
        {!result && <p className={styles.error}>{modelErrors.length ? modelErrors.join('；') : '目前假設無法完成估值。'}</p>}
        {result && result.terminalShare > .75 && <p className={styles.warning}>終值占企業價值 {(result.terminalShare * 100).toFixed(1)}%，估值對 WACC 與永續成長率較敏感。</p>}
      </aside>

      <div className={styles.results}>
        <article className={styles.resultCard}>
          <div className={styles.cardHeading}><div><p>Projected cash flow</p><h3>年度自由現金流</h3></div><span>{unit}</span></div>
          <div className={`${styles.projectionChart} ${!result ? styles.invalidChart : ''}`} aria-label="預測自由現金流長條圖">
            <div><i style={{ height: barHeight(assumptions.freeCashFlow) }} /><span>TTM</span><b>{Number.isFinite(assumptions.freeCashFlow) ? assumptions.freeCashFlow.toFixed(1) : '—'}</b></div>
            {result?.projections.map((item) => <div key={item.year}><i style={{ height: barHeight(item.fcf) }} /><span>Y{item.year}</span><b>{item.fcf.toFixed(1)}</b></div>)}
            {!result && <p>請先修正左側假設，預測圖會自動恢復。</p>}
          </div>
          <dl className={styles.bridge}><div><dt>預測期 FCF 現值</dt><dd>{result ? `${result.forecastPresentValue.toFixed(1)} ${unit}` : '—'}</dd></div><div><dt>終值現值</dt><dd>{result ? `${result.terminalPresentValue.toFixed(1)} ${unit}` : '—'}</dd></div><div><dt>企業價值</dt><dd>{result ? `${result.enterpriseValue.toFixed(1)} ${unit}` : '—'}</dd></div><div><dt>股權價值</dt><dd>{result ? `${result.equityValue.toFixed(1)} ${unit}` : '—'}</dd></div></dl>
        </article>

        <article className={styles.resultCard}>
          <div className={styles.cardHeading}><div><p>Sensitivity</p><h3>WACC／永續成長敏感度</h3></div><span>每股價值</span></div>
          <div className={styles.sensitivity}>
            <div className={styles.corner}>WACC \ g</div>{terminalValues.map((value) => <b key={`head-${value}`}>{value.toFixed(1)}%</b>)}
            {waccValues.flatMap((wacc) => {
              const row = [<b key={`wacc-${wacc}`}>{wacc.toFixed(1)}%</b>];
              terminalValues.forEach((terminalGrowth) => {
                const cell = calculateDcf(assumptions, wacc, terminalGrowth);
                const base = wacc === assumptions.wacc && terminalGrowth === assumptions.terminalGrowth;
                const below = cell && assumptions.currentPrice > 0 && cell.intrinsicValue < assumptions.currentPrice;
                // Each value with its gap to the current price, as (+18%).
                const gap = cell?.upside ?? null;
                row.push(<span key={`${wacc}-${terminalGrowth}`} className={`${base ? styles.baseCell : ''} ${below ? styles.belowCell : ''}`}>{cell ? money(cell.intrinsicValue, assumptions.currency) : '無效'}{gap !== null && <small className={styles.cellGap}>({gap >= 0 ? '+' : '−'}{Math.abs(Math.round(gap * 100))}%)</small>}</span>);
              });
              return row;
            })}
          </div>
        </article>
      </div>
    </div>
    <footer className={styles.note}>簡化 DCF 以 TTM 自由現金流作為基期，採期中折現並以淨現金銜接股權價值；ETF、銀行、保險與負自由現金流公司需使用其他估值模型。試算結果不構成投資建議。</footer>
  </section>;
}
