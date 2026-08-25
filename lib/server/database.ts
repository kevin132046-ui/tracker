import { env } from 'cloudflare:workers';

export type TradeRow = {
  id: number;
  type: string;
  openDate: string;
  expiryDate: string | null;
  closeDate: string | null;
  ticker: string | null;
  event: string;
  strike: string | null;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  fees: number;
  collateral: number;
  notes: string;
  status: 'open' | 'closed';
  quoteMode: 'auto' | 'manual';
  sourceRow: number | null;
  createdAt: string;
  updatedAt: string;
};

type SeedTrade = Omit<TradeRow, 'id' | 'createdAt' | 'updatedAt'>;

const seedTrades: SeedTrade[] = [
  { type: 'Sell', openDate: '2026-03-30', expiryDate: '2026-06-18', closeDate: '2026-05-06', ticker: 'KO', event: 'PUT', strike: '70', quantity: 1, entryPrice: 1.25, currentPrice: 0.19, fees: 0, collateral: 7000, notes: 'nice shot', status: 'closed', quoteMode: 'manual', sourceRow: 2 },
  { type: 'Sell', openDate: '2026-04-21', expiryDate: '2026-08-21', closeDate: '2026-08-21', ticker: 'KO', event: 'PUT', strike: '70', quantity: 1, entryPrice: 1.51, currentPrice: 0, fees: 0, collateral: 7000, notes: '', status: 'closed', quoteMode: 'manual', sourceRow: 3 },
  { type: 'Sell', openDate: '2026-05-06', expiryDate: '2026-11-20', closeDate: '2026-05-14', ticker: 'KO', event: 'PUT', strike: '72.5', quantity: 1, entryPrice: 2, currentPrice: 1.97, fees: 0, collateral: 7250, notes: '', status: 'closed', quoteMode: 'manual', sourceRow: 4 },
  { type: 'SDI', openDate: '2026-05-07', expiryDate: null, closeDate: null, ticker: 'TRV', event: 'STOCK', strike: '303.73', quantity: 3, entryPrice: 303.73, currentPrice: 303.73, fees: 0, collateral: 911.18, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 5 },
  { type: 'SDI', openDate: '2026-05-05', expiryDate: null, closeDate: null, ticker: 'SPGI', event: 'STOCK', strike: '471.24', quantity: 5, entryPrice: 471.24, currentPrice: 471.24, fees: 0, collateral: 2356.2, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 6 },
  { type: 'SDI', openDate: '2026-05-05', expiryDate: null, closeDate: null, ticker: 'TTWO', event: 'STOCK', strike: '223.02', quantity: 1, entryPrice: 223.02, currentPrice: 223.02, fees: 0, collateral: 223.02, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 7 },
  { type: 'SDI', openDate: '2026-05-05', expiryDate: null, closeDate: null, ticker: 'V', event: 'STOCK', strike: '322.47', quantity: 2, entryPrice: 322.47, currentPrice: 322.47, fees: 0, collateral: 644.94, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 8 },
  { type: 'SDI', openDate: '2026-05-06', expiryDate: null, closeDate: null, ticker: 'NVDA', event: 'STOCK', strike: '204.53', quantity: 10, entryPrice: 204.53, currentPrice: 204.53, fees: 0, collateral: 2045.3, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 9 },
  { type: 'SDI', openDate: '2026-05-01', expiryDate: null, closeDate: null, ticker: 'MSFT', event: 'STOCK', strike: '416.58', quantity: 5, entryPrice: 416.58, currentPrice: 416.58, fees: 0, collateral: 2082.9, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 10 },
  { type: 'SDI', openDate: '2026-05-13', expiryDate: null, closeDate: null, ticker: 'SPGI', event: 'STOCK', strike: '403.66', quantity: 5, entryPrice: 403.66, currentPrice: 403.66, fees: 0, collateral: 2018.3, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 11 },
  { type: 'SDI', openDate: '2026-05-13', expiryDate: null, closeDate: null, ticker: 'MSFT', event: 'STOCK', strike: '404.31', quantity: 2, entryPrice: 404.31, currentPrice: 404.31, fees: 0, collateral: 808.62, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 12 },
  { type: 'SDI', openDate: '2026-05-11', expiryDate: null, closeDate: null, ticker: 'MSFT', event: 'STOCK', strike: '410.47', quantity: 2, entryPrice: 410.47, currentPrice: 410.47, fees: 0, collateral: 820.94, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 13 },
  { type: 'SDI', openDate: '2026-05-11', expiryDate: null, closeDate: null, ticker: 'TRV', event: 'STOCK', strike: '296.76', quantity: 1, entryPrice: 296.76, currentPrice: 296.76, fees: 0, collateral: 296.76, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 14 },
  { type: 'Sell', openDate: '2026-04-28', expiryDate: '2026-05-01', closeDate: '2026-05-01', ticker: 'CNC', event: 'CALL', strike: '53', quantity: 1, entryPrice: 0.25, currentPrice: 1.3, fees: 0, collateral: 0, notes: 'Price moved sharply after entry.', status: 'closed', quoteMode: 'manual', sourceRow: 15 },
  { type: 'Sell', openDate: '2026-05-15', expiryDate: '2026-11-20', closeDate: '2026-07-17', ticker: 'KO', event: 'PUT', strike: '75', quantity: 1, entryPrice: 2.3, currentPrice: 0, fees: 0, collateral: 7500, notes: '', status: 'closed', quoteMode: 'manual', sourceRow: 17 },
];

export function getDatabase() {
  if (!env.DB) throw new Error('D1 database binding DB is unavailable.');
  return env.DB;
}

export async function ensureDatabase() {
  const db = getDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      open_date TEXT NOT NULL,
      expiry_date TEXT,
      close_date TEXT,
      ticker TEXT,
      event TEXT NOT NULL,
      strike TEXT,
      quantity REAL NOT NULL DEFAULT 1,
      entry_price REAL NOT NULL DEFAULT 0,
      current_price REAL,
      fees REAL NOT NULL DEFAULT 0,
      collateral REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      quote_mode TEXT NOT NULL DEFAULT 'manual',
      source_row INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_trades_status_open_date ON trades(status, open_date)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_trades_ticker_quote_mode ON trades(ticker, quote_mode)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
  ]);

  const seedMarker = await db.prepare("SELECT value FROM app_meta WHERE key = 'seed_trades_v1'").first<{ value: string }>();
  if (!seedMarker) {
    const count = await db.prepare('SELECT COUNT(*) AS count FROM trades').first<{ count: number }>();
    const statements = [];
    if (Number(count?.count ?? 0) === 0) {
      const now = new Date().toISOString();
      statements.push(...seedTrades.map((trade) => db.prepare(`INSERT INTO trades (
        type, open_date, expiry_date, close_date, ticker, event, strike, quantity,
        entry_price, current_price, fees, collateral, notes, status, quote_mode,
        source_row, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        trade.type, trade.openDate, trade.expiryDate, trade.closeDate, trade.ticker,
        trade.event, trade.strike, trade.quantity, trade.entryPrice, trade.currentPrice,
        trade.fees, trade.collateral, trade.notes, trade.status, trade.quoteMode,
        trade.sourceRow, now, now,
      )));
    }
    statements.push(db.prepare("INSERT INTO app_meta (key, value) VALUES ('seed_trades_v1', 'complete')"));
    await db.batch(statements);
  }

  await db.prepare('PRAGMA optimize').run();
  return db;
}

export const tradeSelect = `SELECT
  id, type, open_date AS openDate, expiry_date AS expiryDate,
  close_date AS closeDate, ticker, event, strike, quantity,
  entry_price AS entryPrice, current_price AS currentPrice, fees,
  collateral, notes, status, quote_mode AS quoteMode,
  source_row AS sourceRow, created_at AS createdAt, updated_at AS updatedAt
FROM trades`;
