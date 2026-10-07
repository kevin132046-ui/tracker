import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/server/database';
import { clearCashFlowsPhrase, maxCashFlowBatch, type CashFlow, type CashFlowInput } from '@/lib/cash-flows';
import { guarded } from '@/lib/server/data-gate';

export const dynamic = 'force-dynamic';

const select = 'SELECT id, date, kind, amount, currency, note, created_at AS createdAt, updated_at AS updatedAt FROM cash_flows';

// Its own table, created on first use, so trade requests keep their query budget.
async function ensureCashFlows() {
  const db = getDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cash_flows_date ON cash_flows(date)'),
  ]);
  return db;
}

function clean(input: Partial<CashFlowInput>): CashFlowInput {
  const date = String(input.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be a YYYY-MM-DD date.');
  if (input.kind !== 'deposit' && input.kind !== 'withdrawal') throw new Error('Kind must be deposit or withdrawal.');
  const amount = typeof input.amount === 'number' ? input.amount : Number(String(input.amount ?? '').replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new Error('Amount must be a positive number.');
  return {
    date,
    kind: input.kind,
    amount: Math.round(amount * 100) / 100,
    currency: input.currency === 'JPY' ? 'JPY' : 'USD',
    note: String(input.note ?? '').trim().slice(0, 500),
  };
}

const fail = (error: unknown, status = 400) => NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save the record.' }, { status });

async function handleGET() {
  try {
    const db = await ensureCashFlows();
    const result = await db.prepare(`${select} ORDER BY date DESC, id DESC`).all<CashFlow>();
    return NextResponse.json({ flows: result.results });
  } catch (error) {
    return fail(error, 500);
  }
}

/** One record, or { flows: [...] } (up to maxCashFlowBatch) saved together. */
async function handlePOST(request: Request) {
  try {
    const body = await request.json() as Partial<CashFlowInput> & { flows?: Array<Partial<CashFlowInput>> };
    const inputs = (Array.isArray(body.flows) ? body.flows : [body]).map(clean);
    if (!inputs.length) throw new Error('Nothing to save.');
    if (inputs.length > maxCashFlowBatch) throw new Error(`At most ${maxCashFlowBatch} records per request.`);
    const db = await ensureCashFlows();
    const now = new Date().toISOString();
    const results = await db.batch(inputs.map((flow) => db.prepare(`INSERT INTO cash_flows (date, kind, amount, currency, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, date, kind, amount, currency, note, created_at AS createdAt, updated_at AS updatedAt`)
      .bind(flow.date, flow.kind, flow.amount, flow.currency, flow.note, now, now)));
    const flows = results.map((result) => result.results?.[0] as CashFlow);
    return NextResponse.json({ flows, flow: flows[0] }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

async function handlePUT(request: Request) {
  try {
    const body = await request.json() as Partial<CashFlowInput> & { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new Error('A valid record id is required.');
    const flow = clean(body);
    const db = await ensureCashFlows();
    const result = await db.prepare('UPDATE cash_flows SET date = ?, kind = ?, amount = ?, currency = ?, note = ?, updated_at = ? WHERE id = ?')
      .bind(flow.date, flow.kind, flow.amount, flow.currency, flow.note, new Date().toISOString(), id).run();
    if (!result.meta.changes) return fail(new Error('Record not found.'), 404);
    return NextResponse.json({ flow: await db.prepare(`${select} WHERE id = ?`).bind(id).first<CashFlow>() });
  } catch (error) {
    return fail(error);
  }
}

/** { id } deletes one record; { all: true, confirm } deletes every record. */
async function handleDELETE(request: Request) {
  try {
    const body = await request.json() as { id?: number; all?: boolean; confirm?: string };
    const db = await ensureCashFlows();
    if (body.all === true) {
      if (body.confirm !== clearCashFlowsPhrase) throw new Error('Clearing every record needs the confirmation phrase.');
      const result = await db.prepare('DELETE FROM cash_flows').run();
      return NextResponse.json({ deletedAll: true, deleted: result.meta.changes ?? 0 });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new Error('A valid record id is required.');
    const result = await db.prepare('DELETE FROM cash_flows WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return fail(new Error('Record not found.'), 404);
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return fail(error);
  }
}

// Owner data: only behind Cloudflare Access once it is configured (lib/server/data-gate).
export const GET = guarded(handleGET);
export const POST = guarded(handlePOST);
export const PUT = guarded(handlePUT);
export const DELETE = guarded(handleDELETE);
