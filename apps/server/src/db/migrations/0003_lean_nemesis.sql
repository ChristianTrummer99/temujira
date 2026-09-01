CREATE TABLE `field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`options` text NOT NULL,
	`position` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "field_defs_type_check" CHECK("field_defs"."type" IN ('select','text','number'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_defs_workspace_name_unique` ON `field_defs` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `field_defs_workspace_id_idx` ON `field_defs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`field_id` text NOT NULL,
	`value` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `field_defs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_values_task_field_unique` ON `field_values` (`task_id`,`field_id`);--> statement-breakpoint
CREATE INDEX `field_values_field_id_idx` ON `field_values` (`field_id`);--> statement-breakpoint
CREATE TABLE `queue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`position` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`added_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_entries_state_check" CHECK("queue_entries"."state" IN ('queued','ready','running'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_entries_user_task_unique` ON `queue_entries` (`user_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `queue_entries_user_id_idx` ON `queue_entries` (`user_id`);