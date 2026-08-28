import { ensureDatabase } from '@/lib/server/database';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type ScenarioRow = { id: number; name: string; ticker: string; currency: string; data: string; createdAt: string; updatedAt: string };

function parseRow(row: ScenarioRow) {
  try { return { ...row, data: JSON.parse(row.data) as unknown }; }
  catch { return { ...row, data: null }; }
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    const rows = await db.prepare(`SELECT id, name, ticker, currency, data,
      created_at AS createdAt, updated_at AS updatedAt
      FROM dcf_scenarios ORDER BY updated_at DESC LIMIT 50`).all<ScenarioRow>();
    return NextResponse.json({ scenarios: rows.results.map(parseRow) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '估值情境無法讀取。' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; ticker?: string; currency?: string; data?: unknown };
    const name = String(body.name ?? '').trim().slice(0, 80);
    const ticker = String(body.ticker ?? '').trim().toUpperCase();
    const currency = body.currency === 'JPY' ? 'JPY' : 'USD';
    if (!name || !/^[A-Z0-9.-]{1,12}$/.test(ticker) || !body.data || typeof body.data !== 'object') return NextResponse.json({ error: '請提供有效的情境名稱與估值資料。' }, { status: 400 });
    const serialized = JSON.stringify(body.data);
    if (serialized.length > 20_000) return NextResponse.json({ error: '估值情境資料過大。' }, { status: 413 });
    const db = await ensureDatabase();
    const now = new Date().toISOString();
    const inserted = await db.prepare(`INSERT INTO dcf_scenarios (name, ticker, currency, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING id, name, ticker, currency, data, created_at AS createdAt, updated_at AS updatedAt`)
      .bind(name, ticker, currency, serialized, now, now).first<ScenarioRow>();
    if (!inserted) throw new Error('估值情境無法保存。');
    return NextResponse.json({ scenario: parseRow(inserted) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '估值情境無法保存。' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '無效的估值情境。' }, { status: 400 });
    const db = await ensureDatabase();
    const result = await db.prepare('DELETE FROM dcf_scenarios WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return NextResponse.json({ error: '找不到這個估值情境。' }, { status: 404 });
    return NextResponse.json({ deletedId: id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '估值情境無法刪除。' }, { status: 500 });
  }
}
