CREATE TABLE IF NOT EXISTS `broker_hub_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dcf_scenarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`ticker` text NOT NULL,
	`currency` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dcf_scenarios_updated_at` ON `dcf_scenarios` (`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dcf_scenarios_ticker` ON `dcf_scenarios` (`ticker`);
