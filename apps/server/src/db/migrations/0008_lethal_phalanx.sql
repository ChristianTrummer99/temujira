PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`visibility` text DEFAULT 'workspace' NOT NULL,
	`owner_id` text,
	`related_workspace_id` text,
	`task_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_activity_events`("id", "workspace_id", "visibility", "owner_id", "related_workspace_id", "task_id", "actor_id", "action", "metadata", "created_at") SELECT "id", "workspace_id", 'workspace', NULL, NULL, "task_id", "actor_id", "action", "metadata", "created_at" FROM `activity_events`;--> statement-breakpoint
DROP TABLE `activity_events`;--> statement-breakpoint
ALTER TABLE `__new_activity_events` RENAME TO `activity_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activity_events_workspace_id_idx` ON `activity_events` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `activity_events_task_id_idx` ON `activity_events` (`task_id`);--> statement-breakpoint
CREATE INDEX `activity_events_actor_id_idx` ON `activity_events` (`actor_id`);--> statement-breakpoint
CREATE INDEX `activity_events_visibility_owner_idx` ON `activity_events` (`visibility`,`owner_id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `search_text` text;
