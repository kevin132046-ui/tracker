import { NextResponse } from 'next/server';
import { ensureDatabase, tradeSelect, type TradeRow } from '@/lib/server/database';
import { cleanTradeInput, type TradeInput } from '@/lib/server/trade-input';
import { maxBatchOperations } from '@/lib/trade-batch';
import { guarded } from '@/lib/server/data-gate';

export const dynamic = 'force-dynamic';

type BatchBody = { updates?: Array<Partial<TradeInput> & { id?: number }>; creates?: Array<Partial<TradeInput>>; deletes?: unknown[] };

const validId = (value: unknown) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error('A valid trade id is required.');
  return id;
};

/**
 * Several trade writes at once (整理選擇權紀錄 and re-imports): updates, inserts and deletes run in one
 * D1 batch, which is a single transaction, so a request either applies completely or not at all.
 */
async function handlePOST(request: Request) {
  try {
    const body = await request.json() as BatchBody;
    const updates = (body.updates ?? []).map((item) => ({ id: validId(item.id), data: cleanTradeInput(item) }));
    const creates = (body.creates ?? []).map((item) => cleanTradeInput(item));
    const deletes = [...new Set((body.deletes ?? []).map(validId))];
    const total = updates.length + creates.length + deletes.length;
    if (!total) throw new Error('Nothing to change.');
    if (total > maxBatchOperations) throw new Error(`At most ${maxBatchOperations} changes per request.`);
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const statements = [
      ...updates.map(({ id, data }) => db.prepare(`UPDATE trades SET
        type = ?, open_date = ?, expiry_date = ?, close_date = ?, ticker = ?, event = ?,
        strike = ?, quantity = ?, entry_price = ?, current_price = ?, fees = ?,
        collateral = ?, notes = ?, status = ?, quote_mode = ?, updated_at = ?
        WHERE id = ?`).bind(
        data.type, data.openDate, data.expiryDate, data.closeDate, data.ticker, data.event,
        data.strike, data.quantity, data.entryPrice, data.currentPrice, data.fees,
        data.collateral, data.notes, data.status, data.quoteMode, now, id,
      )),
      ...creates.map((data) => db.prepare(`INSERT INTO trades (
        type, open_date, expiry_date, close_date, ticker, event, strike, quantity,
        entry_price, current_price, fees, collateral, notes, status, quote_mode,
        source_row, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(
        data.type, data.openDate, data.expiryDate, data.closeDate, data.ticker, data.event,
        data.strike, data.quantity, data.entryPrice, data.currentPrice, data.fees,
        data.collateral, data.notes, data.status, data.quoteMode, data.sourceRow, now, now,
      )),
      ...deletes.map((id) => db.prepare('DELETE FROM trades WHERE id = ?').bind(id)),
    ];
    const results = await db.batch(statements);
    const missing = updates.filter((_, index) => !results[index].meta.changes).map(({ id }) => id);
    const createdIds = results.slice(updates.length, updates.length + creates.length).map((result) => Number((result.results?.[0] as { id?: number } | undefined)?.id ?? 0));
    const changedIds = [...updates.map(({ id }) => id).filter((id) => !missing.includes(id)), ...createdIds.filter(Boolean)];
    const trades = changedIds.length
      ? (await db.prepare(`${tradeSelect} WHERE id IN (${changedIds.map(() => '?').join(',')})`).bind(...changedIds).all<TradeRow>()).results
      : [];
    return NextResponse.json({ updated: updates.length - missing.length, created: createdIds.filter(Boolean).length, deleted: deletes.length, missing, trades });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to apply the changes.' }, { status: 400 });
  }
}

// Owner data: only behind Cloudflare Access once it is configured (lib/server/data-gate).
export const POST = guarded(handlePOST);
