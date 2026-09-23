CREATE TABLE `identity_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`released_at` integer,
	`released_by` text,
	`release_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "identity_sessions_status_check" CHECK("identity_sessions"."status" IN ('active','released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_sessions_active_user_unique` ON `identity_sessions` (`user_id`) WHERE "identity_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX `identity_sessions_api_key_id_idx` ON `identity_sessions` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `identity_sessions_user_id_idx` ON `identity_sessions` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `exclusive_identity` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP TABLE `reservations`;--> statement-breakpoint
DROP TABLE `managed_agents`;
