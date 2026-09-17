CREATE TABLE `user_workspaces` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_workspaces_workspace_id_idx` ON `user_workspaces` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `scopes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `workspace_access_all` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Grandfather existing members: grant the capabilities that were previously open to every
-- authenticated user (workspace create/config and task writes). New users start with only
-- the `tasks:write` default and must be granted more.
UPDATE `users` SET `scopes` = '["workspaces:create","workspaces:manage","tasks:write"]' WHERE `role` != 'admin';