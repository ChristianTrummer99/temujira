CREATE TABLE `inbox_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inbox_id` text NOT NULL,
	FOREIGN KEY (`inbox_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_events_inbox_id_unique` ON `inbox_events` (`inbox_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_workspace_position_idx` ON `tasks` (`workspace_id`,`position`);
--> statement-breakpoint
-- Preserve the previous newest-first display as the initial saved order.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at DESC, number DESC) - 1 AS position
  FROM tasks
)
UPDATE tasks SET position = (SELECT position FROM ranked WHERE ranked.id = tasks.id);
--> statement-breakpoint
INSERT INTO inbox_events (inbox_id) SELECT id FROM inbox_items ORDER BY created_at, rowid;
--> statement-breakpoint
CREATE TRIGGER inbox_events_insert AFTER INSERT ON inbox_items BEGIN
  INSERT INTO inbox_events (inbox_id) VALUES (new.id);
END;
