CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_events_workspace_id_idx` ON `activity_events` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `activity_events_task_id_idx` ON `activity_events` (`task_id`);--> statement-breakpoint
CREATE INDEX `activity_events_actor_id_idx` ON `activity_events` (`actor_id`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_comment_id` text NOT NULL,
	`parent_comment_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inbox_items_user_id_idx` ON `inbox_items` (`user_id`);--> statement-breakpoint
CREATE INDEX `inbox_items_source_comment_id_idx` ON `inbox_items` (`source_comment_id`);--> statement-breakpoint
CREATE INDEX `inbox_items_workspace_id_idx` ON `inbox_items` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`task_id` text NOT NULL,
	`mentioned_id` text NOT NULL,
	`by_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mentioned_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mentions_mentioned_id_idx` ON `mentions` (`mentioned_id`);--> statement-breakpoint
CREATE INDEX `mentions_comment_id_idx` ON `mentions` (`comment_id`);--> statement-breakpoint
CREATE INDEX `mentions_task_id_idx` ON `mentions` (`task_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_workspace_name_unique` ON `tags` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `tags_workspace_id_idx` ON `tags` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `task_associations` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`associated_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_associations_task_id_idx` ON `task_associations` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_associations_user_id_idx` ON `task_associations` (`user_id`);--> statement-breakpoint
CREATE TABLE `task_tags` (
	`task_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_tags_task_id_idx` ON `task_tags` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_tags_tag_id_idx` ON `task_tags` (`tag_id`);--> statement-breakpoint
ALTER TABLE `comments` ADD `parent_id` text REFERENCES comments(id);--> statement-breakpoint
ALTER TABLE `comments` ADD `question_options` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `answer_option_index` integer;--> statement-breakpoint
CREATE INDEX `comments_parent_id_idx` ON `comments` (`parent_id`);