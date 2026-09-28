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

// Fictional sample trades for a new, empty database (tickers, prices and dates are made up for the demo).
const seedTrades: SeedTrade[] = [
  { type: 'Sell', openDate: '2026-03-30', expiryDate: '2026-05-15', closeDate: '2026-05-06', ticker: 'KHC', event: 'PUT', strike: '26', quantity: 1, entryPrice: 0.45, currentPrice: 0.06, fees: 0, collateral: 2600, notes: 'Closed early at most of the premium', status: 'closed', quoteMode: 'manual', sourceRow: 2 },
  { type: 'Sell', openDate: '2026-04-21', expiryDate: '2026-06-18', closeDate: '2026-06-18', ticker: 'KHC', event: 'PUT', strike: '26', quantity: 1, entryPrice: 0.52, currentPrice: 0, fees: 0, collateral: 2600, notes: '', status: 'closed', quoteMode: 'manual', sourceRow: 3 },
  { type: 'Sell', openDate: '2026-05-06', expiryDate: '2026-11-20', closeDate: '2026-05-14', ticker: 'F', event: 'PUT', strike: '11', quantity: 1, entryPrice: 0.62, currentPrice: 0.58, fees: 0, collateral: 1100, notes: '', status: 'closed', quoteMode: 'manual', sourceRow: 4 },
  { type: 'SDI', openDate: '2026-05-07', expiryDate: null, closeDate: null, ticker: 'JNJ', event: 'STOCK', strike: '158.2', quantity: 3, entryPrice: 158.2, currentPrice: 158.2, fees: 0, collateral: 474.6, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 5 },
  { type: 'SDI', openDate: '2026-05-05', expiryDate: null, closeDate: null, ticker: 'COST', event: 'STOCK', strike: '905.1', quantity: 1, entryPrice: 905.1, currentPrice: 905.1, fees: 0, collateral: 905.1, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 6 },
  { type: 'SDI', openDate: '2026-05-05', expiryDate: null, closeDate: null, ticker: 'DIS', event: 'STOCK', strike: '112.64', quantity: 4, entryPrice: 112.64, currentPrice: 112.64, fees: 0, collateral: 450.56, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 7 },
  { type: 'SDI', openDate: '2026-05-05', expiryDate: null, closeDate: null, ticker: 'JPM', event: 'STOCK', strike: '244.3', quantity: 2, entryPrice: 244.3, currentPrice: 244.3, fees: 0, collateral: 488.6, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 8 },
  { type: 'SDI', openDate: '2026-05-06', expiryDate: null, closeDate: null, ticker: 'AAPL', event: 'STOCK', strike: '198.35', quantity: 6, entryPrice: 198.35, currentPrice: 198.35, fees: 0, collateral: 1190.1, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 9 },
  { type: 'SDI', openDate: '2026-05-01', expiryDate: null, closeDate: null, ticker: 'GOOGL', event: 'STOCK', strike: '172.5', quantity: 4, entryPrice: 172.5, currentPrice: 172.5, fees: 0, collateral: 690, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 10 },
  { type: 'SDI', openDate: '2026-05-13', expiryDate: null, closeDate: null, ticker: 'JNJ', event: 'STOCK', strike: '161.05', quantity: 2, entryPrice: 161.05, currentPrice: 161.05, fees: 0, collateral: 322.1, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 11 },
  { type: 'SDI', openDate: '2026-05-13', expiryDate: null, closeDate: null, ticker: 'AAPL', event: 'STOCK', strike: '201.8', quantity: 3, entryPrice: 201.8, currentPrice: 201.8, fees: 0, collateral: 605.4, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 12 },
  { type: 'SDI', openDate: '2026-05-11', expiryDate: null, closeDate: null, ticker: 'GOOGL', event: 'STOCK', strike: '169.95', quantity: 2, entryPrice: 169.95, currentPrice: 169.95, fees: 0, collateral: 339.9, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 13 },
  { type: 'SDI', openDate: '2026-05-11', expiryDate: null, closeDate: null, ticker: 'DIS', event: 'STOCK', strike: '109.8', quantity: 2, entryPrice: 109.8, currentPrice: 109.8, fees: 0, collateral: 219.6, notes: '', status: 'open', quoteMode: 'auto', sourceRow: 14 },
  { type: 'Sell', openDate: '2026-04-28', expiryDate: '2026-05-01', closeDate: '2026-05-01', ticker: 'INTC', event: 'CALL', strike: '24', quantity: 1, entryPrice: 0.2, currentPrice: 0.95, fees: 0, collateral: 0, notes: 'Stock gapped up after entry.', status: 'closed', quoteMode: 'manual', sourceRow: 15 },
  { type: 'Sell', openDate: '2026-05-15', expiryDate: '2026-11-20', closeDate: '2026-07-17', ticker: 'F', event: 'PUT', strike: '12', quantity: 1, entryPrice: 0.85, currentPrice: 0, fees: 0, collateral: 1200, notes: '', status: 'closed', quoteMode: 'manual', sourceRow: 16 },
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
    db.prepare(`CREATE TABLE IF NOT EXISTS dcf_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ticker TEXT NOT NULL,
      currency TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_dcf_scenarios_updated_at ON dcf_scenarios(updated_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_dcf_scenarios_ticker ON dcf_scenarios(ticker)'),
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
