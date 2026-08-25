CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`open_date` text NOT NULL,
	`expiry_date` text,
	`close_date` text,
	`ticker` text,
	`event` text NOT NULL,
	`strike` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`entry_price` real DEFAULT 0 NOT NULL,
	`current_price` real,
	`fees` real DEFAULT 0 NOT NULL,
	`collateral` real DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`quote_mode` text DEFAULT 'manual' NOT NULL,
	`source_row` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trades_status_open_date` ON `trades` (`status`,`open_date`);--> statement-breakpoint
CREATE INDEX `idx_trades_ticker_quote_mode` ON `trades` (`ticker`,`quote_mode`);