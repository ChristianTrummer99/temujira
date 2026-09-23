PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`workspace_access_all` integer DEFAULT 1 NOT NULL,
	`is_agent` integer DEFAULT 0 NOT NULL,
	`deactivated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_role_check" CHECK("__new_users"."role" IN ('admin','member'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "name", "password_hash", "role", "scopes", "workspace_access_all", "is_agent", "deactivated_at", "created_at", "updated_at") SELECT "id", "email", "name", "password_hash", "role", "scopes", "workspace_access_all", "is_agent", "deactivated_at", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
