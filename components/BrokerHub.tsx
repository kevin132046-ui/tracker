'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BrokerAccount, BrokerCurrency, BrokerPosition, BrokerWorkspace, RebalanceAction } from '@/lib/broker-workspace';
import styles from './BrokerHub.module.css';

type Props = {
  initialWorkspace: BrokerWorkspace | null;
  usdJpyRate: number;
  usdJpyEstimated: boolean;
  usdJpyUpdatedAt: string | null;
  onNotify: (message: string) => void;
};

type AssetBreakdown = {
  brokerId: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  valueUsd: number;
  neutralPnlBase: number;
  fxImpactBase: number;
  fxComplete: boolean;
  currency: BrokerCurrency;
};

type AggregatedAsset = {
  ticker: string;
  name: string;
  currency: BrokerCurrency;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  valueUsd: number;
  neutralPnlBase: number;
  fxImpactBase: number;
  fxComplete: boolean;
  weight: number;
  target: number;
  deviation: number;
  breakdowns: AssetBreakdown[];
};

const usdMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const jpyMoney = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('zh-TW', { style: 'percent', maximumFractionDigits: 1 });
const brokerColors = ['#2f73ed', '#21b6ca', '#7161e8', '#18a67f', '#f3a533', '#e45e70'];
const freshId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const contextHash = (value: string) => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `ctx-${(hash >>> 0).toString(36)}`;
};
const positionValueUsd = (position: BrokerPosition, fx: number) => position.currentPrice * position.quantity / (position.currency === 'JPY' ? fx : 1);
const positionPnlInBase = (position: BrokerPosition, displayCurrency: BrokerCurrency, fx: number) => {
  const nativeDelta = (position.currentPrice - position.avgCost) * position.quantity;
  if (displayCurrency === 'USD') {
    if (position.currency === 'USD') return { neutral: nativeDelta, fxImpact: 0, complete: true };
    if (!position.entryFx) return { neutral: 0, fxImpact: 0, complete: false };
    const neutral = nativeDelta / position.entryFx;
    const actual = position.currentPrice * position.quantity / fx - position.avgCost * position.quantity / position.entryFx;
    return { neutral, fxImpact: actual - neutral, complete: true };
  }
  if (position.currency === 'JPY') return { neutral: nativeDelta, fxImpact: 0, complete: true };
  if (!position.entryFx) return { neutral: 0, fxImpact: 0, complete: false };
  const neutral = nativeDelta * position.entryFx;
  const actual = position.currentPrice * position.quantity * fx - position.avgCost * position.quantity * position.entryFx;
  return { neutral, fxImpact: actual - neutral, complete: true };
};

function BrokerAssetLogo({ ticker }: { ticker: string }) {
  const [failed, setFailed] = useState(false);
  return <i className={styles.assetLogo}><span>{ticker.slice(0, 2)}</span>{!failed && <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/api/logo?ticker=${encodeURIComponent(ticker)}&v=6`} alt="" width="42" height="42" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />
  </>}</i>;
}

export default function BrokerHub({ initialWorkspace, usdJpyRate, usdJpyEstimated, usdJpyUpdatedAt, onNotify }: Props) {
  const [workspace, setWorkspace] = useState<BrokerWorkspace | null>(initialWorkspace);
  const [loading, setLoading] = useState(!initialWorkspace);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedBrokers, setSelectedBrokers] = useState<string[]>(initialWorkspace?.accounts.map((account) => account.id) ?? []);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<RebalanceAction | null>(null);
  const [actualPrice, setActualPrice] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountCurrency, setAccountCurrency] = useState<BrokerCurrency>('USD');
  const [positionDraft, setPositionDraft] = useState({ brokerId: initialWorkspace?.accounts[0]?.id ?? '', ticker: '', name: '', currency: 'USD' as BrokerCurrency, quantity: 0, avgCost: 0, currentPrice: 0, entryFx: null as number | null });
  const [targetDraft, setTargetDraft] = useState({ ticker: '', name: '', currency: 'USD' as BrokerCurrency, currentPrice: 0, weightPercent: 0 });
  const [statusNow] = useState(() => Date.now());
  const skipFirstSaveRef = useRef(true);
  const saveRevisionRef = useRef(0);
  const workspaceRef = useRef<BrokerWorkspace | null>(initialWorkspace);
  const serverRevisionRef = useRef(initialWorkspace?.revision ?? 0);
  const clientRevisionRef = useRef(initialWorkspace?.revision ?? 0);
  const currencyDragStartRef = useRef<number | null>(null);
  const fx = Number.isFinite(usdJpyRate) && usdJpyRate > 50 ? usdJpyRate : 150;

  useEffect(() => {
    if (initialWorkspace) return;
    const controller = new AbortController();
    fetch('/api/broker-hub', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { workspace?: BrokerWorkspace; error?: string };
        if (!response.ok || !payload.workspace) throw new Error(payload.error ?? '跨券商資料無法讀取');
        serverRevisionRef.current = payload.workspace.revision;
        clientRevisionRef.current = Math.max(clientRevisionRef.current, payload.workspace.revision);
        setWorkspace(payload.workspace);
        setSelectedBrokers(payload.workspace.accounts.map((account) => account.id));
        setPositionDraft((draft) => ({ ...draft, brokerId: draft.brokerId || payload.workspace?.accounts[0]?.id || '' }));
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) onNotify(error instanceof Error ? error.message : '跨券商資料無法讀取');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialWorkspace, onNotify]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => () => {
    const latest = workspaceRef.current;
    if (!latest) return;
    const revision = Math.max(Date.now(), serverRevisionRef.current + 1, clientRevisionRef.current + 1);
    clientRevisionRef.current = revision;
    void fetch('/api/broker-hub', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...latest, revision }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!workspace || loading) return;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    const controller = new AbortController();
    const revision = ++saveRevisionRef.current;
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const requestedRevision = Math.max(Date.now(), serverRevisionRef.current + 1, clientRevisionRef.current + 1);
        clientRevisionRef.current = requestedRevision;
        const response = await fetch('/api/broker-hub', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...workspace, revision: requestedRevision }),
          signal: controller.signal,
        });
        const payload = await response.json() as { workspace?: BrokerWorkspace; error?: string };
        if (!response.ok || !payload.workspace) throw new Error(payload.error ?? '跨券商資料無法保存');
        serverRevisionRef.current = Math.max(serverRevisionRef.current, payload.workspace.revision);
        clientRevisionRef.current = Math.max(clientRevisionRef.current, payload.workspace.revision);
        if (revision === saveRevisionRef.current) {
          setSaveState('saved');
          if (workspaceRef.current === workspace) {
            skipFirstSaveRef.current = true;
            setWorkspace(payload.workspace);
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError') && revision === saveRevisionRef.current) {
          setSaveState('error');
          onNotify(error instanceof Error ? error.message : '跨券商資料無法保存');
        }
      }
    }, 650);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loading, onNotify, workspace]);

  const calculations = useMemo(() => {
    if (!workspace) return null;
    const selected = new Set(selectedBrokers);
    const targetMap = new Map(workspace.targets.map((target) => [target.ticker, target]));
    const map = new Map<string, Omit<AggregatedAsset, 'weight' | 'target' | 'deviation'>>();
    for (const target of workspace.targets) {
      map.set(target.ticker, {
        ticker: target.ticker, name: target.name, currency: target.currency, quantity: 0, avgCost: 0,
        currentPrice: target.currentPrice, valueUsd: 0, neutralPnlBase: 0, fxImpactBase: 0, fxComplete: true, breakdowns: [],
      });
    }
    for (const position of workspace.positions.filter((item) => selected.has(item.brokerId))) {
      const valueUsd = positionValueUsd(position, fx);
      const basePnl = positionPnlInBase(position, workspace.displayCurrency, fx);
      const item = map.get(position.ticker) ?? {
        ticker: position.ticker, name: position.name, currency: position.currency, quantity: 0, avgCost: 0,
        currentPrice: position.currentPrice, valueUsd: 0, neutralPnlBase: 0, fxImpactBase: 0, fxComplete: true, breakdowns: [],
      };
      const nextQuantity = item.quantity + position.quantity;
      item.avgCost = nextQuantity > 0 ? (item.avgCost * item.quantity + position.avgCost * position.quantity) / nextQuantity : 0;
      item.currentPrice = nextQuantity > 0 ? (item.currentPrice * item.quantity + position.currentPrice * position.quantity) / nextQuantity : item.currentPrice;
      item.quantity = nextQuantity;
      item.valueUsd += valueUsd;
      item.neutralPnlBase += basePnl.neutral;
      item.fxImpactBase += basePnl.fxImpact;
      item.fxComplete = item.fxComplete && basePnl.complete;
      item.breakdowns.push({ brokerId: position.brokerId, quantity: position.quantity, avgCost: position.avgCost, currentPrice: position.currentPrice, valueUsd, neutralPnlBase: basePnl.neutral, fxImpactBase: basePnl.fxImpact, fxComplete: basePnl.complete, currency: position.currency });
      map.set(position.ticker, item);
    }
    const total = [...map.values()].reduce((sum, item) => sum + item.valueUsd, 0);
    const assets: AggregatedAsset[] = [...map.values()].map((item) => {
      const weight = total > 0 ? item.valueUsd / total : 0;
      const target = targetMap.get(item.ticker)?.weight ?? 0;
      return { ...item, weight, target, deviation: weight - target };
    }).sort((a, b) => b.valueUsd - a.valueUsd);
    const targetSum = assets.reduce((sum, item) => sum + item.target, 0);
    const targetsValid = assets.length > 0 && Math.abs(targetSum - 1) <= 0.001;
    const hasJpyExposure = workspace.positions.some((position) => position.currency === 'JPY') || workspace.targets.some((target) => target.currency === 'JPY');
    const fxReady = !hasJpyExposure || !usdJpyEstimated;
    const drift = targetsValid ? 0.5 * assets.reduce((sum, item) => sum + Math.abs(item.deviation), 0) : 1;
    const health = targetsValid && fxReady && total > 0 ? Math.max(0, Math.round(100 * (1 - Math.min(1, drift)))) : null;
    const accountValues = workspace.accounts.map((account) => {
      const accountPositions = workspace.positions.filter((position) => position.brokerId === account.id);
      const lastUpdatedAt = accountPositions.reduce((latest, position) => Math.max(latest, Date.parse(position.updatedAt) || 0), Date.parse(account.updatedAt) || 0);
      const isStale = lastUpdatedAt > 0 && statusNow - lastUpdatedAt > 7 * 24 * 60 * 60 * 1_000;
      const status = !accountPositions.length || accountPositions.some((position) => position.quantity <= 0 || position.currentPrice <= 0 || position.entryFx === null)
        ? '需補資料'
        : isStale ? '資料待更新' : '資料完整';
      const sources = new Set(accountPositions.map((position) => position.source));
      const dataSource = sources.has('portfolio') && sources.size === 1 ? '本站持倉匯入' : sources.has('portfolio') ? '匯入＋手動資料' : '手動資料';
      return {
        ...account,
        status,
        dataSource,
        lastUpdatedAt,
        valueUsd: accountPositions.reduce((sum, position) => sum + positionValueUsd(position, fx), 0),
      };
    });
    const allAccountValue = accountValues.reduce((sum, account) => sum + account.valueUsd, 0);
    return { assets, total, targetSum, targetsValid, fxReady, health, accountValues, allAccountValue };
  }, [fx, selectedBrokers, statusNow, usdJpyEstimated, workspace]);

  const planContext = useMemo(() => workspace ? contextHash(JSON.stringify({
    brokers: [...selectedBrokers].sort(),
    contribution: workspace.contributionUsd,
    fractional: workspace.allowFractional,
    fx: Number(fx.toFixed(6)),
    targets: workspace.targets.map((target) => [target.ticker, target.currency, target.currentPrice, target.weight]),
    positions: workspace.positions.map((position) => [position.id, position.brokerId, position.quantity, position.currentPrice]),
  })) : '', [fx, selectedBrokers, workspace]);

  const simulatedActions = useMemo(() => {
    if (!workspace || !calculations?.targetsValid || !calculations.fxReady || workspace.contributionUsd <= 0) return [] as RebalanceAction[];
    const afterTotal = calculations.total + workspace.contributionUsd;
    const gaps = calculations.assets.map((asset) => ({ asset, gap: Math.max(0, asset.target * afterTotal - asset.valueUsd) }));
    const totalGap = gaps.reduce((sum, item) => sum + item.gap, 0);
    if (totalGap <= 0) return [];
    const selectedAccounts = workspace.accounts.filter((account) => selectedBrokers.includes(account.id)).sort((a, b) => a.priority - b.priority);
    return gaps.flatMap(({ asset, gap }, index) => {
      if (gap <= 0 || asset.currentPrice <= 0 || !selectedAccounts.length) return [];
      const plannedUsd = workspace.contributionUsd * gap / totalGap;
      const rawQuantity = plannedUsd * (asset.currency === 'JPY' ? fx : 1) / asset.currentPrice;
      const precision = workspace.allowFractional && asset.currency === 'USD' ? 1_000 : 1;
      const quantity = Math.floor(rawQuantity * precision) / precision;
      if (quantity <= 0) return [];
      const existing = asset.breakdowns
        .filter((item) => selectedBrokers.includes(item.brokerId))
        .sort((a, b) => a.valueUsd - b.valueUsd)[0]?.brokerId;
      const currencyAccount = selectedAccounts.find((account) => account.currency === asset.currency);
      const brokerId = existing ?? currencyAccount?.id ?? selectedAccounts[0].id;
      const amountUsd = quantity * asset.currentPrice / (asset.currency === 'JPY' ? fx : 1);
      return [{
        id: `preview-${index}-${asset.ticker}`,
        brokerId,
        ticker: asset.ticker,
        side: 'BUY' as const,
        quantity,
        price: asset.currentPrice,
        currency: asset.currency,
        amountUsd,
        completed: false,
        completedAt: null,
        appliedPositionId: null,
        contextKey: planContext,
      }];
    });
  }, [calculations, fx, planContext, selectedBrokers, workspace]);

  const projectedWeights = useMemo(() => {
    if (!workspace || !calculations) return new Map<string, number>();
    const total = calculations.total + simulatedActions.reduce((sum, action) => sum + action.amountUsd, 0);
    return new Map(calculations.assets.map((asset) => [
      asset.ticker,
      total > 0 ? (asset.valueUsd + simulatedActions.filter((action) => action.ticker === asset.ticker).reduce((sum, action) => sum + action.amountUsd, 0)) / total : 0,
    ]));
  }, [calculations, simulatedActions, workspace]);

  const planIsCurrent = !workspace?.actionPlan.length || workspace.actionPlan.every((action) => action.contextKey === planContext);

  if (loading || !workspace || !calculations) {
    return <section className={styles.hub} id="broker-hub" aria-busy="true"><div className={styles.loading}>正在整理跨券商資產全景…</div></section>;
  }

  const baseMoney = (usd: number) => workspace.displayCurrency === 'JPY' ? jpyMoney.format(usd * fx) : usdMoney.format(usd);
  const displayMoney = (amount: number) => workspace.displayCurrency === 'JPY' ? jpyMoney.format(amount) : usdMoney.format(amount);
  const nativeMoney = (value: number, currency: BrokerCurrency) => currency === 'JPY' ? jpyMoney.format(value) : usdMoney.format(value);
  const selectedTotal = calculations.total;
  const investedUsd = simulatedActions.reduce((sum, action) => sum + action.amountUsd, 0);
  const residualUsd = Math.max(0, workspace.contributionUsd - investedUsd);
  const displayFactor = workspace.displayCurrency === 'JPY' ? fx : 1;
  const contributionDisplay = workspace.contributionUsd * displayFactor;
  const sliderMaximumUsd = Math.max(10_000, Math.ceil(selectedTotal * .5), Math.ceil(workspace.contributionUsd * 1.25));
  const sliderMaximumDisplay = sliderMaximumUsd * displayFactor;

  const updateTarget = (ticker: string, percentValue: number) => {
    setWorkspace((current) => current && ({
      ...current,
      targets: current.targets.some((target) => target.ticker === ticker)
        ? current.targets.map((target) => target.ticker === ticker ? { ...target, weight: Math.max(0, Math.min(1, finite(percentValue) / 100)) } : target)
        : [...current.targets, {
          ticker,
          name: calculations.assets.find((asset) => asset.ticker === ticker)?.name ?? ticker,
          currency: calculations.assets.find((asset) => asset.ticker === ticker)?.currency ?? 'USD',
          currentPrice: calculations.assets.find((asset) => asset.ticker === ticker)?.currentPrice ?? 0,
          weight: Math.max(0, Math.min(1, finite(percentValue) / 100)),
        }],
      actionPlan: [],
    }));
  };

  const setDisplayCurrency = (currency: BrokerCurrency) => {
    setWorkspace((current) => current && ({ ...current, displayCurrency: currency }));
  };

  const toggleBroker = (id: string) => {
    setSelectedBrokers((current) => {
      if (current.includes(id)) return current.length === 1 ? current : current.filter((item) => item !== id);
      return [...current, id];
    });
  };

  const addAccount = () => {
    const name = accountName.trim();
    if (!name) return onNotify('請輸入券商名稱');
    if (workspace.accounts.length >= 12) return onNotify('最多可建立 12 個券商帳戶');
    const account: BrokerAccount = {
      id: freshId('broker'), name: name.slice(0, 40), currency: accountCurrency,
      color: brokerColors[workspace.accounts.length % brokerColors.length], priority: workspace.accounts.length,
      updatedAt: new Date().toISOString(),
    };
    setWorkspace((current) => current && ({ ...current, accounts: [...current.accounts, account] }));
    setSelectedBrokers((current) => [...current, account.id]);
    setPositionDraft((draft) => ({ ...draft, brokerId: draft.brokerId || account.id }));
    setAccountName('');
  };

  const removeAccount = (id: string) => {
    if (workspace.positions.some((position) => position.brokerId === id)) return onNotify('請先移除或轉移這家券商的部位');
    const remainingAccounts = workspace.accounts.filter((account) => account.id !== id);
    setWorkspace((current) => current && ({ ...current, accounts: current.accounts.filter((account) => account.id !== id), actionPlan: [] }));
    setSelectedBrokers((current) => {
      const remainingSelection = current.filter((item) => item !== id);
      return remainingSelection.length ? remainingSelection : remainingAccounts[0] ? [remainingAccounts[0].id] : [];
    });
    setPositionDraft((draft) => draft.brokerId === id ? { ...draft, brokerId: remainingAccounts[0]?.id ?? '' } : draft);
  };

  const addPosition = () => {
    const ticker = positionDraft.ticker.trim().toUpperCase();
    if (!positionDraft.brokerId || !ticker || positionDraft.quantity <= 0 || positionDraft.currentPrice <= 0) return onNotify('請完整填寫券商、代號、數量與現價');
    if (workspace.positions.length >= 250) return onNotify('跨券商部位已達 250 筆上限');
    const existingCurrency = workspace.positions.find((position) => position.ticker === ticker)?.currency ?? workspace.targets.find((target) => target.ticker === ticker)?.currency;
    if (existingCurrency && existingCurrency !== positionDraft.currency) return onNotify(`${ticker} 已使用 ${existingCurrency}，同一標的不可以混用 USD 與 JPY`);
    const position: BrokerPosition = {
      id: freshId('position'), brokerId: positionDraft.brokerId, ticker, name: positionDraft.name.trim() || ticker,
      currency: positionDraft.currency, quantity: finite(positionDraft.quantity), avgCost: finite(positionDraft.avgCost),
      currentPrice: finite(positionDraft.currentPrice), entryFx: positionDraft.entryFx && positionDraft.entryFx > 0 ? positionDraft.entryFx : null,
      source: 'manual', updatedAt: new Date().toISOString(),
    };
    setWorkspace((current) => current && ({
      ...current,
      positions: [...current.positions, position],
      targets: current.targets.some((target) => target.ticker === ticker) ? current.targets : [...current.targets, { ticker, name: position.name, currency: position.currency, currentPrice: position.currentPrice, weight: 0 }],
      actionPlan: [],
    }));
    setPositionDraft((draft) => ({ ...draft, ticker: '', name: '', quantity: 0, avgCost: 0, currentPrice: 0, entryFx: null }));
  };

  const addTarget = () => {
    const ticker = targetDraft.ticker.trim().toUpperCase();
    if (!ticker || targetDraft.currentPrice <= 0) return onNotify('請填寫目標標的代號與試算價格');
    if (workspace.targets.some((target) => target.ticker === ticker)) return onNotify(`${ticker} 已在目標配置中`);
    if (workspace.targets.length >= 150) return onNotify('目標標的已達 150 筆上限');
    const existingCurrency = workspace.positions.find((position) => position.ticker === ticker)?.currency;
    if (existingCurrency && existingCurrency !== targetDraft.currency) return onNotify(`${ticker} 的既有部位使用 ${existingCurrency}`);
    setWorkspace((current) => current && ({
      ...current,
      targets: [...current.targets, {
        ticker,
        name: targetDraft.name.trim() || ticker,
        currency: targetDraft.currency,
        currentPrice: finite(targetDraft.currentPrice),
        weight: Math.max(0, Math.min(1, finite(targetDraft.weightPercent) / 100)),
      }],
      actionPlan: [],
    }));
    setTargetDraft({ ticker: '', name: '', currency: 'USD', currentPrice: 0, weightPercent: 0 });
  };

  const generatePlan = () => {
    if (!calculations.targetsValid) return onNotify('目標比例合計必須為 100% 才能產生清單');
    if (!calculations.fxReady) return onNotify('日圓匯率目前為估算值，取得有效匯率後才能產生清單');
    if (!simulatedActions.length) return onNotify('目前沒有可執行的買入建議，請提高投入金額或調整目標比例');
    const timestamp = Date.now();
    setWorkspace((current) => current && ({
      ...current,
      actionPlan: simulatedActions.map((action, index) => ({ ...action, id: `plan-${timestamp}-${index}-${action.ticker}` })),
    }));
    onNotify('跨券商買入清單已產生；清單只更新追蹤，不會向券商送單');
  };

  const confirmAction = () => {
    if (!pendingAction) return;
    if (!planIsCurrent || pendingAction.contextKey !== planContext) {
      setPendingAction(null);
      return onNotify('配置條件已變更，請重新生成跨券商清單');
    }
    const price = Number(actualPrice);
    if (!Number.isFinite(price) || price <= 0) return onNotify('請輸入有效成交價');
    const appliedPositionId = `rebalance-${pendingAction.id}`;
    const reference = workspace.positions.find((position) => position.ticker === pendingAction.ticker);
    const position: BrokerPosition = {
      id: appliedPositionId,
      brokerId: pendingAction.brokerId,
      ticker: pendingAction.ticker,
      name: reference?.name ?? pendingAction.ticker,
      currency: pendingAction.currency,
      quantity: pendingAction.quantity,
      avgCost: price,
      currentPrice: price,
      entryFx: fx,
      source: 'rebalance',
      updatedAt: new Date().toISOString(),
    };
    setWorkspace((current) => current && ({
      ...current,
      positions: current.positions.some((item) => item.id === appliedPositionId) ? current.positions : [...current.positions, position],
      actionPlan: current.actionPlan.map((action) => action.id === pendingAction.id ? { ...action, price, amountUsd: pendingAction.quantity * price / (pendingAction.currency === 'JPY' ? fx : 1), completed: true, completedAt: new Date().toISOString(), appliedPositionId } : action),
    }));
    setPendingAction(null);
    onNotify(`${pendingAction.ticker} 已加入手動追蹤；沒有向券商送出訂單`);
  };

  const undoAction = (action: RebalanceAction) => {
    setWorkspace((current) => current && ({
      ...current,
      positions: action.appliedPositionId ? current.positions.filter((position) => position.id !== action.appliedPositionId) : current.positions,
      actionPlan: current.actionPlan.map((item) => item.id === action.id ? { ...item, completed: false, completedAt: null, appliedPositionId: null } : item),
    }));
    onNotify(`${action.ticker} 的追蹤更新已復原`);
  };

  return <section className={styles.hub} id="broker-hub" aria-labelledby="broker-hub-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Cross-broker command center</p><h2 id="broker-hub-title">跨券商資產追蹤與再平衡</h2><p>集中手動資料、排除匯率干擾，先試算再產生只買不賣清單。</p></div>
      <div className={styles.headerActions}>
        <span className={`${styles.saveState} ${saveState === 'error' ? styles.saveError : ''}`}>{saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失敗' : '已保存'}</span>
        <div className={styles.currencySwitch} role="group" aria-label="統一顯示幣別，可左右滑動切換" onPointerDown={(event) => { currencyDragStartRef.current = event.clientX; }} onPointerUp={(event) => { const start = currencyDragStartRef.current; currencyDragStartRef.current = null; if (start === null || Math.abs(event.clientX - start) < 18) return; setDisplayCurrency(event.clientX > start ? 'JPY' : 'USD'); }}>
          <span className={workspace.displayCurrency === 'JPY' ? styles.switchRight : ''} />
          <button type="button" aria-pressed={workspace.displayCurrency === 'USD'} onClick={() => setDisplayCurrency('USD')}>USD</button>
          <button type="button" aria-pressed={workspace.displayCurrency === 'JPY'} onClick={() => setDisplayCurrency('JPY')}>JPY</button>
        </div>
        <button type="button" className={styles.manageButton} onClick={() => setManagerOpen(true)}>管理資料</button>
      </div>
    </header>

    <div className={`${styles.fxNote} ${usdJpyEstimated ? styles.fxEstimated : ''}`}><span>{usdJpyEstimated ? '估算匯率' : '匯率中性'}</span> USD/JPY {fx.toFixed(2)}{usdJpyUpdatedAt ? ` · ${new Date(usdJpyUpdatedAt).toLocaleString('zh-TW')}` : ''} · 缺少買入日匯率的跨幣別損益會標記待補</div>

    <div className={styles.capsuleBar} aria-label="券商帳戶篩選">
      <button type="button" className={selectedBrokers.length === workspace.accounts.length ? styles.allSelected : ''} onClick={() => setSelectedBrokers(workspace.accounts.map((account) => account.id))}>全部帳戶</button>
      {calculations.accountValues.map((account) => {
        const selected = selectedBrokers.includes(account.id);
        return <div className={`${styles.brokerCapsule} ${selected ? styles.selected : ''}`} key={account.id} style={{ '--broker-color': account.color } as CSSProperties}>
          <button type="button" className={styles.capsuleToggle} onClick={() => toggleBroker(account.id)} aria-pressed={selected} aria-label={`${selected ? '從合併檢視移除' : '加入合併檢視'} ${account.name}`}><i>{selected ? '✓' : ''}</i></button>
          <button type="button" className={styles.capsuleMain} onClick={() => setSelectedBrokers([account.id])} aria-label={`只查看 ${account.name}`} title={`${account.status} · ${account.dataSource} · 更新 ${account.lastUpdatedAt ? new Date(account.lastUpdatedAt).toLocaleString('zh-TW') : '—'}`}><span><strong>{account.name}</strong><small>{account.status} · {calculations.allAccountValue > 0 ? pct.format(account.valueUsd / calculations.allAccountValue) : '0%'}</small><em>{account.dataSource}</em></span><b>{baseMoney(account.valueUsd)}</b></button>
        </div>;
      })}
      {!workspace.accounts.length && <button type="button" className={styles.emptyCapsule} onClick={() => setManagerOpen(true)}>＋新增第一家券商</button>}
    </div>
    {!!workspace.accounts.length && <p className={styles.capsuleHint}>點券商名稱可單獨檢視；點左側勾選可合併多個帳戶。</p>}

    <div className={styles.bento}>
      <article className={`${styles.card} ${styles.healthCard} ${calculations.targetsValid && calculations.fxReady && !calculations.assets.some((asset) => Math.abs(asset.deviation) >= workspace.driftThreshold) ? styles.healthCalm : styles.healthAlert}`}>
        <div className={styles.cardHeading}><div><p>STEP 1 · 偏離診斷</p><h3>選取帳戶健康度</h3></div><span>{calculations.targetsValid ? `${selectedBrokers.length} 個帳戶` : '目標需修正'}</span></div>
        <div className={styles.healthBody}>
          <div className={styles.healthRing} style={{ '--health': `${calculations.health ?? 0}%` } as CSSProperties}><span><strong>{calculations.health ?? '—'}</strong><small>/ 100</small></span></div>
          <div className={styles.warningList}>
            {!calculations.targetsValid && <b className={styles.warning}>目標比例目前為 {pct.format(calculations.targetSum)}，請調整為 100%</b>}
            {!calculations.fxReady && <b className={styles.warning}>USD/JPY 暫為估算，健康度與試算已暫停</b>}
            {calculations.targetsValid && calculations.fxReady && !calculations.assets.some((asset) => Math.abs(asset.deviation) >= workspace.driftThreshold) && <b className={styles.healthy}>配置在容許範圍內</b>}
            {calculations.targetsValid && calculations.fxReady && calculations.assets.filter((asset) => Math.abs(asset.deviation) >= workspace.driftThreshold).slice(0, 4).map((asset) => <b className={asset.deviation > 0 ? styles.overweight : styles.warning} key={asset.ticker}>{asset.ticker} · {asset.deviation > 0 ? '高配' : '低配'} {pct.format(Math.abs(asset.deviation))}</b>)}
            <small>警戒值 {pct.format(workspace.driftThreshold)} · 只根據目前選取帳戶</small>
          </div>
        </div>
      </article>

      <article className={`${styles.card} ${styles.cashCard}`}>
        <div className={styles.cardHeading}><div><p>STEP 2 · 資金流向</p><h3>買入式再平衡試算</h3></div><span className={styles.buyOnly}>✓ 只買不賣</span></div>
        <label className={styles.cashInput}><span>本月注入新資金</span><strong>{workspace.displayCurrency === 'JPY' ? '¥' : '$'}<input type="number" min="0" step={workspace.displayCurrency === 'JPY' ? 1000 : 100} value={Math.round(contributionDisplay)} onChange={(event) => setWorkspace((current) => current && ({ ...current, contributionUsd: Math.max(0, Number(event.target.value) || 0) / (current.displayCurrency === 'JPY' ? fx : 1), actionPlan: [] }))} /></strong></label>
        <input className={styles.cashSlider} type="range" min="0" max={sliderMaximumDisplay} step={workspace.displayCurrency === 'JPY' ? 1000 : 100} value={Math.min(contributionDisplay, sliderMaximumDisplay)} onChange={(event) => setWorkspace((current) => current && ({ ...current, contributionUsd: Number(event.target.value) / (current.displayCurrency === 'JPY' ? fx : 1), actionPlan: [] }))} aria-label={`注入新資金滑桿（${workspace.displayCurrency}）`} />
        <div className={styles.cashStats}><span><small>預計投入</small><b>{baseMoney(investedUsd)}</b></span><span><small>保留現金</small><b>{baseMoney(residualUsd)}</b></span><span><small>預估總值</small><b>{baseMoney(selectedTotal + investedUsd)}</b></span></div>
        <button type="button" className={styles.planButton} onClick={generatePlan}>{workspace.actionPlan.length ? planIsCurrent ? '更新跨券商清單' : '條件已變更 · 重新生成' : '生成跨券商清單'}</button>
      </article>

      <article className={`${styles.card} ${styles.allocationCard}`}>
        <div className={styles.cardHeading}><div><p>預期權重環</p><h3>投入前後配置</h3></div><span>{baseMoney(selectedTotal)}</span></div>
        <div className={styles.allocationRows}>
          {calculations.assets.map((asset, index) => <div className={styles.allocationRow} key={asset.ticker}>
            <span><i style={{ background: brokerColors[index % brokerColors.length] }} />{asset.ticker}</span>
            <div><b style={{ width: `${Math.min(100, asset.weight * 100)}%` }} /><i style={{ left: `${Math.min(100, (projectedWeights.get(asset.ticker) ?? asset.weight) * 100)}%` }} /></div>
            <strong>{pct.format(asset.weight)} → {pct.format(projectedWeights.get(asset.ticker) ?? asset.weight)}</strong>
          </div>)}
          {!calculations.assets.length && <p className={styles.empty}>新增券商與部位後即可預覽配置。</p>}
        </div>
      </article>

      <article className={`${styles.card} ${styles.checklistCard}`}>
        <div className={styles.cardHeading}><div><p>STEP 3 · Action checklist</p><h3>跨券商清單派發</h3></div><span>{workspace.actionPlan.filter((action) => action.completed).length}/{workspace.actionPlan.length}</span></div>
        <div className={styles.checklist}>
          {!planIsCurrent && !!workspace.actionPlan.length && <p className={styles.stalePlan}>選取帳戶、價格或配置條件已變更；舊清單不可完成，請重新生成。</p>}
          {workspace.actionPlan.map((action) => {
            const broker = workspace.accounts.find((account) => account.id === action.brokerId);
            return <button type="button" disabled={!planIsCurrent && !action.completed} className={action.completed ? styles.completedAction : ''} key={action.id} onClick={() => action.completed ? undoAction(action) : (setPendingAction(action), setActualPrice(String(action.price)))}>
              <i>{action.completed ? '✓' : ''}</i><span><strong>{broker?.name ?? '未指定券商'} · 買入 {action.ticker}</strong><small>{action.quantity.toLocaleString()} 股 · {action.completed ? '實際' : '估算'} {nativeMoney(action.price, action.currency)}</small></span><b>{baseMoney(action.amountUsd)}</b>
            </button>;
          })}
          {!workspace.actionPlan.length && <p className={styles.empty}>調整資金後生成清單；勾選只會更新本站追蹤，不會送出真實訂單。</p>}
        </div>
      </article>
    </div>

    <article className={`${styles.card} ${styles.assetCard}`}>
      <div className={styles.cardHeading}><div><p>Cross-account asset window</p><h3>跨帳戶標的視窗</h3></div><span>{calculations.assets.length} 個標的 · {selectedBrokers.length} 個帳戶</span></div>
      <div className={styles.assetHeader}><span>標的</span><span>市值／中性損益</span><span>目前 → 目標</span><span>目標比例</span></div>
      <div className={styles.assetRows}>
        {calculations.assets.map((asset) => <div key={asset.ticker}>
          <div className={`${styles.assetRow} ${expandedTicker === asset.ticker ? styles.assetExpanded : ''}`}>
            <button type="button" className={styles.assetIdentity} onClick={() => setExpandedTicker((current) => current === asset.ticker ? null : asset.ticker)} aria-expanded={expandedTicker === asset.ticker}><BrokerAssetLogo ticker={asset.ticker} /><span><strong>{asset.ticker}</strong><small>{asset.name}</small></span></button>
            <span className={styles.assetValue}><strong>{baseMoney(asset.valueUsd)}</strong>{asset.fxComplete ? <small className={asset.neutralPnlBase >= 0 ? styles.positive : styles.negative}>{asset.neutralPnlBase >= 0 ? '+' : ''}{displayMoney(asset.neutralPnlBase)} · FX {asset.fxImpactBase >= 0 ? '+' : ''}{displayMoney(asset.fxImpactBase)}</small> : <small className={styles.fxMissing}>需補買入日 USD/JPY</small>}</span>
            <span className={styles.assetDrift}><strong>{pct.format(asset.weight)} → {pct.format(asset.target)}</strong><small className={Math.abs(asset.deviation) >= workspace.driftThreshold ? styles.driftAlert : ''}>{asset.deviation > 0 ? '高配' : '低配'} {pct.format(Math.abs(asset.deviation))}</small></span>
            <span className={styles.targetField}><input type="number" min="0" max="100" step="0.1" value={Number((asset.target * 100).toFixed(1))} onChange={(event) => updateTarget(asset.ticker, Number(event.target.value))} aria-label={`${asset.ticker} 目標比例`} /><b>%</b></span>
          </div>
          {expandedTicker === asset.ticker && <div className={styles.assetDetail}>
            <div className={styles.assetDetailSummary}><span><small>跨帳戶數量</small><strong>{asset.quantity.toLocaleString()}</strong></span><span><small>加權平均成本</small><strong>{nativeMoney(asset.avgCost, asset.currency)}</strong></span><span><small>目前價格</small><strong>{nativeMoney(asset.currentPrice, asset.currency)}</strong></span></div>
            <div className={styles.brokerStacks}>{asset.breakdowns.map((breakdown, breakdownIndex) => {
              const broker = workspace.accounts.find((account) => account.id === breakdown.brokerId);
              return <section key={`${asset.ticker}-${breakdown.brokerId}-${breakdownIndex}`} style={{ '--broker-color': broker?.color ?? '#2f73ed' } as CSSProperties}><span>{broker?.name ?? '未知券商'}</span><strong>{breakdown.quantity.toLocaleString()} 股</strong><small>成本 {nativeMoney(breakdown.avgCost, breakdown.currency)} · 市值 {baseMoney(breakdown.valueUsd)}</small>{breakdown.fxComplete ? <b className={breakdown.neutralPnlBase >= 0 ? styles.positive : styles.negative}>{breakdown.neutralPnlBase >= 0 ? '+' : ''}{displayMoney(breakdown.neutralPnlBase)}</b> : <b className={styles.fxMissing}>待補匯率</b>}</section>;
            })}</div>
          </div>}
        </div>)}
        {!calculations.assets.length && <p className={styles.empty}>尚無跨券商部位。點擊「管理資料」加入第一筆。</p>}
      </div>
    </article>

    <footer className={styles.disclaimer}>資料來源包含本站持倉匯入與手動追蹤；Checklist 不會登入券商、不會送單，也不構成投資建議。</footer>

    {managerOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManagerOpen(false); }}>
      <section className={styles.manager} role="dialog" aria-modal="true" aria-labelledby="broker-manager-title">
        <header><div><p className={styles.eyebrow}>Manual data workspace</p><h2 id="broker-manager-title">管理券商與部位</h2><span>不連接帳密；資料安全保存於本站。</span></div><button type="button" onClick={() => setManagerOpen(false)} aria-label="關閉">×</button></header>
        <div className={styles.managerGrid}>
          <section><h3>券商帳戶</h3><div className={styles.accountEditor}>{workspace.accounts.map((account) => <div key={account.id}><i style={{ background: account.color }} /><input value={account.name} onChange={(event) => setWorkspace((current) => current && ({ ...current, accounts: current.accounts.map((item) => item.id === account.id ? { ...item, name: event.target.value.slice(0, 40), updatedAt: new Date().toISOString() } : item) }))} /><select value={account.currency} onChange={(event) => setWorkspace((current) => current && ({ ...current, accounts: current.accounts.map((item) => item.id === account.id ? { ...item, currency: event.target.value as BrokerCurrency, updatedAt: new Date().toISOString() } : item) }))}><option value="USD">USD</option><option value="JPY">JPY</option></select><button type="button" onClick={() => removeAccount(account.id)}>刪除</button></div>)}</div>
            <div className={styles.addRow}><input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="例如 IBKR、樂天證券" /><select value={accountCurrency} onChange={(event) => setAccountCurrency(event.target.value as BrokerCurrency)}><option value="USD">USD</option><option value="JPY">JPY</option></select><button type="button" onClick={addAccount}>＋新增券商</button></div>
          </section>
          <section><h3>部位資料</h3><div className={styles.positionEditor}>{workspace.positions.map((position) => <div key={position.id}><select value={position.brokerId} onChange={(event) => setWorkspace((current) => current && ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, brokerId: event.target.value, updatedAt: new Date().toISOString() } : item) }))}>{workspace.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select><strong>{position.ticker}</strong><label>數量<input type="number" min="0" step="0.001" value={position.quantity} onChange={(event) => setWorkspace((current) => current && ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, quantity: Number(event.target.value) || 0, updatedAt: new Date().toISOString() } : item), actionPlan: [] }))} /></label><label>均價<input type="number" min="0" step="0.01" value={position.avgCost} onChange={(event) => setWorkspace((current) => current && ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, avgCost: Number(event.target.value) || 0, updatedAt: new Date().toISOString() } : item), actionPlan: [] }))} /></label><label>現價<input type="number" min="0" step="0.01" value={position.currentPrice} onChange={(event) => setWorkspace((current) => current && ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, currentPrice: Number(event.target.value) || 0, updatedAt: new Date().toISOString() } : item), actionPlan: [] }))} /></label><label>買入日 USD/JPY<input type="number" min="1" step="0.01" value={position.entryFx ?? ''} placeholder="待補" onChange={(event) => setWorkspace((current) => current && ({ ...current, positions: current.positions.map((item) => item.id === position.id ? { ...item, entryFx: event.target.value === '' ? null : Number(event.target.value) || null, updatedAt: new Date().toISOString() } : item), actionPlan: [] }))} /></label><button type="button" onClick={() => setWorkspace((current) => current && ({ ...current, positions: current.positions.filter((item) => item.id !== position.id), actionPlan: [] }))}>刪除</button></div>)}</div>
            <div className={styles.positionDraft}>
              <select value={positionDraft.brokerId} onChange={(event) => setPositionDraft((draft) => ({ ...draft, brokerId: event.target.value }))}><option value="">選擇券商</option>{workspace.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select>
              <input value={positionDraft.ticker} onChange={(event) => setPositionDraft((draft) => ({ ...draft, ticker: event.target.value.toUpperCase() }))} placeholder="Ticker" />
              <input value={positionDraft.name} onChange={(event) => setPositionDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="標的名稱" />
              <select value={positionDraft.currency} onChange={(event) => setPositionDraft((draft) => ({ ...draft, currency: event.target.value as BrokerCurrency }))}><option value="USD">USD</option><option value="JPY">JPY</option></select>
              <input type="number" min="0" step="0.001" value={positionDraft.quantity || ''} onChange={(event) => setPositionDraft((draft) => ({ ...draft, quantity: Number(event.target.value) || 0 }))} placeholder="數量" />
              <input type="number" min="0" step="0.01" value={positionDraft.avgCost || ''} onChange={(event) => setPositionDraft((draft) => ({ ...draft, avgCost: Number(event.target.value) || 0 }))} placeholder="買入均價" />
              <input type="number" min="0" step="0.01" value={positionDraft.currentPrice || ''} onChange={(event) => setPositionDraft((draft) => ({ ...draft, currentPrice: Number(event.target.value) || 0 }))} placeholder="目前價格" />
              <input type="number" min="1" step="0.01" value={positionDraft.entryFx ?? ''} onChange={(event) => setPositionDraft((draft) => ({ ...draft, entryFx: event.target.value === '' ? null : Number(event.target.value) || null }))} placeholder="買入日 USD/JPY（選填）" />
              <button type="button" onClick={addPosition}>＋加入部位</button>
            </div>
            <div className={styles.targetWorkspace}>
              <h3>目標標的</h3>
              <p>可先建立尚未持有的標的，再以新資金完成首次配置。</p>
              <div className={styles.targetEditor}>{workspace.targets.map((target) => {
                const hasPosition = workspace.positions.some((position) => position.ticker === target.ticker);
                return <div key={target.ticker}><strong>{target.ticker}</strong><input value={target.name} onChange={(event) => setWorkspace((current) => current && ({ ...current, targets: current.targets.map((item) => item.ticker === target.ticker ? { ...item, name: event.target.value.slice(0, 70) } : item) }))} /><select disabled={hasPosition} value={target.currency} onChange={(event) => setWorkspace((current) => current && ({ ...current, targets: current.targets.map((item) => item.ticker === target.ticker ? { ...item, currency: event.target.value as BrokerCurrency } : item), actionPlan: [] }))}><option value="USD">USD</option><option value="JPY">JPY</option></select><label>試算價格<input type="number" min="0" step="0.01" value={target.currentPrice} onChange={(event) => setWorkspace((current) => current && ({ ...current, targets: current.targets.map((item) => item.ticker === target.ticker ? { ...item, currentPrice: Number(event.target.value) || 0 } : item), actionPlan: [] }))} /></label><label>目標 %<input type="number" min="0" max="100" step="0.1" value={Number((target.weight * 100).toFixed(1))} onChange={(event) => updateTarget(target.ticker, Number(event.target.value))} /></label><button type="button" onClick={() => setWorkspace((current) => current && ({ ...current, targets: current.targets.filter((item) => item.ticker !== target.ticker), actionPlan: [] }))}>刪除</button></div>;
              })}</div>
              <div className={styles.targetDraft}><input value={targetDraft.ticker} onChange={(event) => setTargetDraft((draft) => ({ ...draft, ticker: event.target.value.toUpperCase() }))} placeholder="Ticker" /><input value={targetDraft.name} onChange={(event) => setTargetDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="標的名稱" /><select value={targetDraft.currency} onChange={(event) => setTargetDraft((draft) => ({ ...draft, currency: event.target.value as BrokerCurrency }))}><option value="USD">USD</option><option value="JPY">JPY</option></select><input type="number" min="0" step="0.01" value={targetDraft.currentPrice || ''} onChange={(event) => setTargetDraft((draft) => ({ ...draft, currentPrice: Number(event.target.value) || 0 }))} placeholder="試算價格" /><input type="number" min="0" max="100" step="0.1" value={targetDraft.weightPercent || ''} onChange={(event) => setTargetDraft((draft) => ({ ...draft, weightPercent: Number(event.target.value) || 0 }))} placeholder="目標 %" /><button type="button" onClick={addTarget}>＋新增目標</button></div>
            </div>
          </section>
        </div>
        <footer><span>目標比例可在跨帳戶標的視窗直接修改。</span><button type="button" onClick={() => setManagerOpen(false)}>完成</button></footer>
      </section>
    </div>}

    {pendingAction && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingAction(null); }}>
      <section className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="rebalance-confirm-title"><span>✓</span><p className={styles.eyebrow}>Tracking only</p><h2 id="rebalance-confirm-title">確認更新 {pendingAction.ticker} 追蹤？</h2><p>這只會把完成的買入加入本站部位，不會連接或送單至任何券商。</p><label>實際成交價<input type="number" min="0.000001" step="0.01" value={actualPrice} onChange={(event) => setActualPrice(event.target.value)} /></label><div><button type="button" onClick={() => setPendingAction(null)}>取消</button><button type="button" onClick={confirmAction}>確認並更新追蹤</button></div></section>
    </div>}
  </section>;
}
