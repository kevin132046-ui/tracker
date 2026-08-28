import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const trades = sqliteTable(
  'trades',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    openDate: text('open_date').notNull(),
    expiryDate: text('expiry_date'),
    closeDate: text('close_date'),
    ticker: text('ticker'),
    event: text('event').notNull(),
    strike: text('strike'),
    quantity: real('quantity').notNull().default(1),
    entryPrice: real('entry_price').notNull().default(0),
    currentPrice: real('current_price'),
    fees: real('fees').notNull().default(0),
    collateral: real('collateral').notNull().default(0),
    notes: text('notes').notNull().default(''),
    status: text('status').notNull().default('open'),
    quoteMode: text('quote_mode').notNull().default('manual'),
    sourceRow: integer('source_row'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_trades_status_open_date').on(table.status, table.openDate),
    index('idx_trades_ticker_quote_mode').on(table.ticker, table.quoteMode),
  ],
);

export const brokerHubState = sqliteTable('broker_hub_state', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled').notNull().default(0),
  revision: integer('revision').notNull().default(0),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const dcfScenarios = sqliteTable(
  'dcf_scenarios',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    ticker: text('ticker').notNull(),
    currency: text('currency').notNull(),
    data: text('data').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_dcf_scenarios_updated_at').on(table.updatedAt),
    index('idx_dcf_scenarios_ticker').on(table.ticker),
  ],
);
