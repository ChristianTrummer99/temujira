CREATE TABLE `task_links` (
	`id` text PRIMARY KEY NOT NULL,
	`src_task_id` text NOT NULL,
	`type` text NOT NULL,
	`dst_task_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`src_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dst_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_links_type_check" CHECK("task_links"."type" IN ('relates','blocks','absorbs')),
	CONSTRAINT "task_links_no_self_check" CHECK("task_links"."src_task_id" != "task_links"."dst_task_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_links_edge_unique` ON `task_links` (`src_task_id`,`type`,`dst_task_id`);--> statement-breakpoint
CREATE INDEX `task_links_src_idx` ON `task_links` (`src_task_id`);--> statement-breakpoint
CREATE INDEX `task_links_dst_idx` ON `task_links` (`dst_task_id`);