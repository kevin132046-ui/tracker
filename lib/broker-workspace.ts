export type BrokerCurrency = 'USD' | 'JPY';

export type BrokerAccount = {
  id: string;
  name: string;
  currency: BrokerCurrency;
  color: string;
  priority: number;
  updatedAt: string;
};

export type BrokerPosition = {
  id: string;
  brokerId: string;
  ticker: string;
  name: string;
  currency: BrokerCurrency;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  entryFx: number | null;
  source: 'portfolio' | 'manual' | 'rebalance';
  updatedAt: string;
};

export type BrokerTarget = {
  ticker: string;
  name: string;
  currency: BrokerCurrency;
  currentPrice: number;
  weight: number;
};

export type RebalanceAction = {
  id: string;
  brokerId: string;
  ticker: string;
  side: 'BUY';
  quantity: number;
  price: number;
  currency: BrokerCurrency;
  amountUsd: number;
  completed: boolean;
  completedAt: string | null;
  appliedPositionId: string | null;
  contextKey: string;
};

export type BrokerWorkspace = {
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  displayCurrency: BrokerCurrency;
  buyOnly: boolean;
  allowFractional: boolean;
  contributionUsd: number;
  driftThreshold: number;
  accounts: BrokerAccount[];
  positions: BrokerPosition[];
  targets: BrokerTarget[];
  actionPlan: RebalanceAction[];
  updatedAt: string;
};

const colors = ['#2f73ed', '#21b6ca', '#7161e8', '#18a67f', '#f3a533', '#e45e70', '#66758d'];
const cleanId = (value: unknown, fallback: string) => String(value ?? fallback).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || fallback;
const cleanText = (value: unknown, fallback: string, max = 50) => String(value ?? fallback).trim().slice(0, max) || fallback;
const cleanNumber = (value: unknown, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const cleanCurrency = (value: unknown): BrokerCurrency => value === 'JPY' ? 'JPY' : 'USD';
const cleanDate = (value: unknown) => {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 30) : new Date().toISOString();
};

export function emptyBrokerWorkspace(enabled = false): BrokerWorkspace {
  return {
    schemaVersion: 1,
    revision: 0,
    enabled,
    displayCurrency: 'USD',
    buyOnly: true,
    allowFractional: true,
    contributionUsd: 5_000,
    driftThreshold: 0.05,
    accounts: [],
    positions: [],
    targets: [],
    actionPlan: [],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeBrokerWorkspace(value: unknown, enabled = false): BrokerWorkspace {
  const input = value && typeof value === 'object' ? value as Partial<BrokerWorkspace> : {};
  const accounts = (Array.isArray(input.accounts) ? input.accounts : []).slice(0, 12).map((item, index) => {
    const account = item && typeof item === 'object' ? item as Partial<BrokerAccount> : {};
    return {
      id: cleanId(account.id, `broker-${index + 1}`),
      name: cleanText(account.name, `券商 ${index + 1}`, 40),
      currency: cleanCurrency(account.currency),
      color: /^#[0-9a-f]{6}$/i.test(String(account.color ?? '')) ? String(account.color) : colors[index % colors.length],
      priority: Math.round(cleanNumber(account.priority, index, 0, 99)),
      updatedAt: cleanDate(account.updatedAt),
    } satisfies BrokerAccount;
  });
  const uniqueAccounts = accounts.filter((account, index) => accounts.findIndex((item) => item.id === account.id) === index);
  const accountIds = new Set(uniqueAccounts.map((account) => account.id));
  const currencyByTicker = new Map<string, BrokerCurrency>();
  const positions = (Array.isArray(input.positions) ? input.positions : []).slice(0, 250).flatMap((item, index) => {
    const position = item && typeof item === 'object' ? item as Partial<BrokerPosition> : {};
    const brokerId = cleanId(position.brokerId, '');
    const ticker = cleanText(position.ticker, '', 16).toUpperCase();
    if (!accountIds.has(brokerId) || !ticker) return [];
    const currency = cleanCurrency(position.currency);
    const knownCurrency = currencyByTicker.get(ticker);
    if (knownCurrency && knownCurrency !== currency) return [];
    currencyByTicker.set(ticker, currency);
    const entryFxValue = Number(position.entryFx);
    return [{
      id: cleanId(position.id, `position-${index + 1}`),
      brokerId,
      ticker,
      name: cleanText(position.name, ticker, 70),
      currency,
      quantity: cleanNumber(position.quantity, 0, 0, 1_000_000_000),
      avgCost: cleanNumber(position.avgCost, 0, 0, 1_000_000_000),
      currentPrice: cleanNumber(position.currentPrice, 0, 0, 1_000_000_000),
      entryFx: Number.isFinite(entryFxValue) && entryFxValue > 0 ? Math.min(1_000_000, entryFxValue) : null,
      source: position.source === 'portfolio' || position.source === 'rebalance' ? position.source : 'manual',
      updatedAt: cleanDate(position.updatedAt),
    } satisfies BrokerPosition];
  });
  const uniquePositions = positions.filter((position, index) => positions.findIndex((item) => item.id === position.id) === index);
  const targetMap = new Map<string, BrokerTarget>();
  (Array.isArray(input.targets) ? input.targets : []).slice(0, 150).forEach((item) => {
    const target = item && typeof item === 'object' ? item as Partial<BrokerTarget> : {};
    const ticker = cleanText(target.ticker, '', 16).toUpperCase();
    const reference = uniquePositions.find((position) => position.ticker === ticker);
    if (ticker) targetMap.set(ticker, {
      ticker,
      name: cleanText(target.name, reference?.name ?? ticker, 70),
      currency: cleanCurrency(target.currency ?? reference?.currency),
      currentPrice: cleanNumber(target.currentPrice, reference?.currentPrice ?? 0, 0, 1_000_000_000),
      weight: cleanNumber(target.weight, 0, 0, 1),
    });
  });
  const actions = (Array.isArray(input.actionPlan) ? input.actionPlan : []).slice(0, 250).flatMap((item, index) => {
    const action = item && typeof item === 'object' ? item as Partial<RebalanceAction> : {};
    const brokerId = cleanId(action.brokerId, '');
    const ticker = cleanText(action.ticker, '', 16).toUpperCase();
    if (!accountIds.has(brokerId) || !ticker) return [];
    return [{
      id: cleanId(action.id, `action-${index + 1}`),
      brokerId,
      ticker,
      side: 'BUY',
      quantity: cleanNumber(action.quantity, 0, 0, 1_000_000_000),
      price: cleanNumber(action.price, 0, 0, 1_000_000_000),
      currency: cleanCurrency(action.currency),
      amountUsd: cleanNumber(action.amountUsd, 0, 0, 1_000_000_000_000),
      completed: Boolean(action.completed),
      completedAt: action.completedAt ? cleanDate(action.completedAt) : null,
      appliedPositionId: action.appliedPositionId ? cleanId(action.appliedPositionId, '') : null,
      contextKey: cleanText(action.contextKey, '', 500),
    } satisfies RebalanceAction];
  });
  return {
    schemaVersion: 1,
    revision: Math.round(cleanNumber(input.revision, 0, 0, Number.MAX_SAFE_INTEGER)),
    enabled,
    displayCurrency: cleanCurrency(input.displayCurrency),
    buyOnly: true,
    allowFractional: input.allowFractional !== false,
    contributionUsd: cleanNumber(input.contributionUsd, 5_000, 0, 1_000_000_000),
    driftThreshold: cleanNumber(input.driftThreshold, 0.05, 0.01, 0.25),
    accounts: uniqueAccounts,
    positions: uniquePositions,
    targets: [...targetMap.values()],
    actionPlan: actions,
    updatedAt: cleanDate(input.updatedAt),
  };
}
