CREATE TABLE `managed_agents` (
	`user_id` text PRIMARY KEY NOT NULL,
	`admitted_by` text NOT NULL,
	`admitted_at` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`run_reference` text NOT NULL,
	`request_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`manager_user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`released_at` integer,
	`released_by` text,
	`release_reason` text,
	FOREIGN KEY (`agent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reservations_status_check" CHECK("reservations"."status" IN ('active','released'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_request_id_unique` ON `reservations` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_active_agent_unique` ON `reservations` (`agent_user_id`) WHERE "reservations"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_active_task_unique` ON `reservations` (`task_id`) WHERE "reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX `reservations_api_key_id_idx` ON `reservations` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `reservations_task_id_idx` ON `reservations` (`task_id`);--> statement-breakpoint
CREATE INDEX `reservations_agent_user_id_idx` ON `reservations` (`agent_user_id`);