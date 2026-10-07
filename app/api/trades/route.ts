import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { cleanTradeInput as clean, type TradeInput } from '@/lib/server/trade-input';
import { clearAllPhrase } from '@/lib/trade-batch';
import { NextResponse } from 'next/server';
import { guarded } from '@/lib/server/data-gate';

export const dynamic = 'force-dynamic';

async function getTrade(id: number) {
  const db = await ensureDatabase();
  return db.prepare(`${tradeSelect} WHERE id = ?`).bind(id).first<TradeRow>();
}

async function handleGET() {
  try {
    const db = await ensureDatabase();
    const result = await db.prepare(`${tradeSelect} ORDER BY status ASC, open_date DESC, id DESC`).all<TradeRow>();
    return NextResponse.json({ trades: result.results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load trades.' }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  try {
    const data = clean(await request.json());
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const result = await db.prepare(`INSERT INTO trades (
      type, open_date, expiry_date, close_date, ticker, event, strike, quantity,
      entry_price, current_price, fees, collateral, notes, status, quote_mode,
      source_row, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      data.type, data.openDate, data.expiryDate, data.closeDate, data.ticker, data.event,
      data.strike, data.quantity, data.entryPrice, data.currentPrice, data.fees,
      data.collateral, data.notes, data.status, data.quoteMode, data.sourceRow, now, now,
    ).run();
    return NextResponse.json({ trade: await getTrade(Number(result.meta.last_row_id)) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to save trade.' }, { status: 400 });
  }
}

async function handlePUT(request: Request) {
  try {
    const body = await request.json() as Partial<TradeInput> & { id?: number };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new Error('A valid trade id is required.');
    const data = clean(body);
    const db = await ensureDatabase();
    const result = await db.prepare(`UPDATE trades SET
      type = ?, open_date = ?, expiry_date = ?, close_date = ?, ticker = ?, event = ?,
      strike = ?, quantity = ?, entry_price = ?, current_price = ?, fees = ?,
      collateral = ?, notes = ?, status = ?, quote_mode = ?, updated_at = ?
      WHERE id = ?`).bind(
      data.type, data.openDate, data.expiryDate, data.closeDate, data.ticker, data.event,
      data.strike, data.quantity, data.entryPrice, data.currentPrice, data.fees,
      data.collateral, data.notes, data.status, data.quoteMode, new Date().toISOString(), id,
    ).run();
    if (!result.meta.changes) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    return NextResponse.json({ trade: await getTrade(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update trade.' }, { status: 400 });
  }
}

async function handleDELETE(request: Request) {
  try {
    const body = await request.json() as { id?: number; all?: boolean; confirm?: string };
    if (body.all === true) {
      if (body.confirm !== clearAllPhrase) throw new Error('Clearing every trade needs the confirmation phrase.');
      const db = await ensureDatabase();
      const result = await db.prepare('DELETE FROM trades').run();
      return NextResponse.json({ deletedAll: true, deleted: result.meta.changes ?? 0 });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new Error('A valid trade id is required.');
    const db = await ensureDatabase();
    const result = await db.prepare('DELETE FROM trades WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    return NextResponse.json({ deletedId: id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to delete trade.' }, { status: 400 });
  }
}

// Owner data: only behind Cloudflare Access once it is configured (lib/server/data-gate).
export const GET = guarded(handleGET);
export const POST = guarded(handlePOST);
export const PUT = guarded(handlePUT);
export const DELETE = guarded(handleDELETE);
