CREATE TABLE `instance_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK("instance_settings"."id" = 1)
);
