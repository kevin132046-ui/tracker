import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type TradeInput = Omit<TradeRow, 'id' | 'createdAt' | 'updatedAt' | 'sourceRow'> & { sourceRow?: number | null };

function clean(input: Partial<TradeInput>): TradeInput {
  const ticker = String(input.ticker ?? '').trim().toUpperCase().slice(0, 12) || null;
  const event = String(input.event ?? 'PUT').trim().toUpperCase().slice(0, 24);
  const type = String(input.type ?? 'Sell').trim().slice(0, 12);
  const openDate = String(input.openDate ?? '').slice(0, 10);
  const closeDate = input.closeDate ? String(input.closeDate).slice(0, 10) : null;
  const status = closeDate ? 'closed' : 'open';
  const rawCurrent = input.currentPrice as unknown;
  if (!openDate) throw new Error('Open date is required.');
  if (input.status === 'closed' && !closeDate) throw new Error('Close date is required for a closed trade.');
  if (closeDate && closeDate < openDate) throw new Error('Close date cannot be earlier than open date.');
  if (!event) throw new Error('Strategy is required.');
  return {
    type,
    openDate,
    expiryDate: input.expiryDate ? String(input.expiryDate).slice(0, 10) : null,
    closeDate,
    ticker,
    event,
    strike: input.strike ? String(input.strike).trim().slice(0, 30) : null,
    quantity: Math.max(0, Number(input.quantity ?? 0)),
    entryPrice: Math.max(0, Number(input.entryPrice ?? 0)),
    currentPrice: rawCurrent === null || rawCurrent === undefined || rawCurrent === '' ? null : Math.max(0, Number(rawCurrent)),
    fees: Math.max(0, Number(input.fees ?? 0)),
    collateral: Math.max(0, Number(input.collateral ?? 0)),
    notes: String(input.notes ?? '').trim().slice(0, 1000),
    status,
    quoteMode: input.quoteMode === 'auto' && type === 'SDI' ? 'auto' : 'manual',
    sourceRow: input.sourceRow ? Number(input.sourceRow) : null,
  };
}

async function getTrade(id: number) {
  const db = await ensureDatabase();
  return db.prepare(`${tradeSelect} WHERE id = ?`).bind(id).first<TradeRow>();
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    const result = await db.prepare(`${tradeSelect} ORDER BY status ASC, open_date DESC, id DESC`).all<TradeRow>();
    return NextResponse.json({ trades: result.results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load trades.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

export async function PUT(request: Request) {
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

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: number };
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
