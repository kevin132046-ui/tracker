import { emptyBrokerWorkspace, normalizeBrokerWorkspace } from '@/lib/broker-workspace';
import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { NextResponse } from 'next/server';
import { guarded } from '@/lib/server/data-gate';

export const dynamic = 'force-dynamic';

const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const stateTable = `CREATE TABLE IF NOT EXISTS broker_hub_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

type StateRow = { enabled: number; revision: number; data: string; updatedAt: string };

async function getState() {
  const db = await ensureDatabase();
  await db.prepare(stateTable).run();
  const empty = emptyBrokerWorkspace(false);
  await db.prepare(`INSERT OR IGNORE INTO broker_hub_state (id, enabled, revision, data, updated_at)
    VALUES (1, 0, 0, ?, ?)`).bind(JSON.stringify(empty), empty.updatedAt).run();
  const row = await db.prepare(`SELECT enabled, revision, data, updated_at AS updatedAt
    FROM broker_hub_state WHERE id = 1`).first<StateRow>();
  if (!row) throw new Error('跨券商設定尚未建立');
  return { db, row };
}

function parseWorkspace(row: StateRow) {
  try {
    return normalizeBrokerWorkspace({ ...JSON.parse(row.data), revision: row.revision }, Boolean(row.enabled));
  } catch {
    return { ...emptyBrokerWorkspace(Boolean(row.enabled)), revision: row.revision, updatedAt: row.updatedAt };
  }
}

async function readWorkspace() {
  const { row } = await getState();
  return parseWorkspace(row);
}

const companyNames: Record<string, string> = {
  AAPL: 'Apple', AMZN: 'Amazon', BOXX: 'Alpha Architect', GOOGL: 'Alphabet', KO: 'Coca-Cola',
  CNC: 'Centene', META: 'Meta Platforms', MSFT: 'Microsoft', NVDA: 'NVIDIA', SPGI: 'S&P Global', SPY: 'SPDR S&P 500',
  TRV: 'The Travelers Companies', TSLA: 'Tesla', TTWO: 'Take-Two Interactive', V: 'Visa',
  '7203.T': 'Toyota Motor', '6758.T': 'Sony Group', '9984.T': 'SoftBank Group', '6861.T': 'Keyence',
  '8306.T': 'Mitsubishi UFJ Financial Group', '8035.T': 'Tokyo Electron', '9983.T': 'Fast Retailing', '7974.T': 'Nintendo',
};

async function buildPortfolioSeed() {
  const db = await ensureDatabase();
  const result = await db.prepare(`${tradeSelect}
    WHERE status = 'open' AND (type = 'SDI' OR event = 'STOCK')
    ORDER BY open_date, id`).all<TradeRow>();
  const now = new Date().toISOString();
  const groups = new Map<string, { ticker: string; currency: 'USD' | 'JPY'; quantity: number; cost: number; current: number }>();
  for (const trade of result.results) {
    const ticker = String(trade.ticker ?? '').toUpperCase();
    const quantity = Math.max(0, Number(trade.quantity));
    if (!ticker || quantity <= 0) continue;
    const currency = ticker.endsWith('.T') ? 'JPY' : 'USD';
    const group = groups.get(ticker) ?? { ticker, currency, quantity: 0, cost: 0, current: 0 };
    group.quantity += quantity;
    group.cost += Math.max(0, Number(trade.entryPrice)) * quantity;
    group.current += Math.max(0, Number(trade.currentPrice ?? trade.entryPrice)) * quantity;
    groups.set(ticker, group);
  }
  const workspace = emptyBrokerWorkspace(true);
  workspace.revision = Date.now();
  workspace.accounts = [{ id: 'primary', name: '主要券商', currency: 'USD', color: '#2f73ed', priority: 0, updatedAt: now }];
  workspace.positions = [...groups.values()].map((group) => ({
    id: `portfolio-${group.ticker.replace(/[^A-Z0-9]/g, '-').toLowerCase()}`,
    brokerId: 'primary',
    ticker: group.ticker,
    name: companyNames[group.ticker] ?? group.ticker,
    currency: group.currency,
    quantity: group.quantity,
    avgCost: group.quantity > 0 ? group.cost / group.quantity : 0,
    currentPrice: group.quantity > 0 ? group.current / group.quantity : 0,
    entryFx: null,
    source: 'portfolio' as const,
    updatedAt: now,
  }));
  const values = workspace.positions.map((position) => position.currentPrice * position.quantity / (position.currency === 'JPY' ? 150 : 1));
  const total = values.reduce((sum, value) => sum + value, 0);
  workspace.targets = workspace.positions.map((position, index) => ({
    ticker: position.ticker,
    name: position.name,
    currency: position.currency,
    currentPrice: position.currentPrice,
    weight: total > 0 ? values[index] / total : workspace.positions.length ? 1 / workspace.positions.length : 0,
  }));
  workspace.updatedAt = now;
  return workspace;
}

async function handleGET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('summary') === '1') {
      const { row } = await getState();
      return NextResponse.json({ enabled: Boolean(row.enabled), revision: row.revision, updatedAt: row.updatedAt }, { headers: responseHeaders });
    }
    return NextResponse.json({ workspace: await readWorkspace() }, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '跨券商設定無法讀取' }, { status: 500, headers: responseHeaders });
  }
}

async function handlePATCH(request: Request) {
  try {
    const body = await request.json() as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: '功能狀態不正確' }, { status: 400, headers: responseHeaders });
    }
    const { db, row } = await getState();
    let workspace = parseWorkspace(row);
    if (body.enabled && workspace.accounts.length === 0 && workspace.positions.length === 0 && workspace.targets.length === 0) {
      workspace = await buildPortfolioSeed();
      workspace.revision = Math.max(workspace.revision, row.revision + 1);
      await db.prepare(`UPDATE broker_hub_state SET enabled = 1, revision = ?, data = ?, updated_at = ? WHERE id = 1`)
        .bind(workspace.revision, JSON.stringify(workspace), workspace.updatedAt).run();
    } else {
      const updatedAt = new Date().toISOString();
      await db.prepare(`UPDATE broker_hub_state SET enabled = ?, updated_at = ? WHERE id = 1`)
        .bind(body.enabled ? 1 : 0, updatedAt).run();
      workspace = { ...workspace, enabled: body.enabled, updatedAt };
    }
    return NextResponse.json({ workspace }, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '功能狀態無法保存' }, { status: 500, headers: responseHeaders });
  }
}

async function handlePUT(request: Request) {
  try {
    const body = await request.json();
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const { db, row } = await getState();
    const inputRevision = Math.round(Number(input.revision) || 0);
    const requestedRevision = inputRevision > 0 ? inputRevision : Date.now();
    const updatedAt = new Date().toISOString();
    const workspace = normalizeBrokerWorkspace({ ...input, revision: requestedRevision, updatedAt }, Boolean(row.enabled));
    const result = await db.prepare(`UPDATE broker_hub_state SET revision = ?, data = ?, updated_at = ?
      WHERE id = 1 AND revision < ?`).bind(requestedRevision, JSON.stringify(workspace), updatedAt, requestedRevision).run();
    const changes = Number((result.meta as { changes?: number } | undefined)?.changes ?? 0);
    if (changes !== 1) {
      const current = await readWorkspace();
      return NextResponse.json({ workspace: current, error: '偵測到較新的跨券商資料，請重試保存' }, { status: 409, headers: responseHeaders });
    }
    return NextResponse.json({ workspace }, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '跨券商資料無法保存' }, { status: 400, headers: responseHeaders });
  }
}

// Owner data: only behind Cloudflare Access once it is configured (lib/server/data-gate).
export const GET = guarded(handleGET);
export const PATCH = guarded(handlePATCH);
export const PUT = guarded(handlePUT);
