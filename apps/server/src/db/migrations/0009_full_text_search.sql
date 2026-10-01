-- The index contains only task-owned content. Every read joins current task/workspace
-- permissions before counting, ranking or returning snippets.
CREATE VIRTUAL TABLE search_fts USING fts5(
  kind UNINDEXED, entity_id UNINDEXED, task_id UNINDEXED, title, body,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
);
--> statement-breakpoint
INSERT INTO search_fts(kind, entity_id, task_id, title, body)
SELECT 'task', t.id, t.id, w.key || '-' || t.number || ' ' || t.title, t.description
FROM tasks t JOIN workspaces w ON w.id = t.workspace_id;
--> statement-breakpoint
INSERT INTO search_fts(kind, entity_id, task_id, title, body)
SELECT 'comment', id, task_id, '', body || ' ' || COALESCE(question_options, '') FROM comments;
--> statement-breakpoint
INSERT INTO search_fts(kind, entity_id, task_id, title, body)
SELECT 'attachment', a.id, COALESCE(a.task_id, c.task_id), a.filename, COALESCE(a.search_text, '')
FROM attachments a LEFT JOIN comments c ON c.id = a.comment_id;
--> statement-breakpoint
CREATE TRIGGER search_tasks_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO search_fts(kind, entity_id, task_id, title, body)
  VALUES ('task', new.id, new.id, (SELECT key FROM workspaces WHERE id = new.workspace_id) || '-' || new.number || ' ' || new.title, new.description);
END;
--> statement-breakpoint
CREATE TRIGGER search_tasks_update AFTER UPDATE OF title, description ON tasks BEGIN
  UPDATE search_fts SET title = (SELECT key FROM workspaces WHERE id = new.workspace_id) || '-' || new.number || ' ' || new.title,
    body = new.description WHERE kind = 'task' AND entity_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_tasks_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM search_fts WHERE task_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_comments_insert AFTER INSERT ON comments BEGIN
  INSERT INTO search_fts(kind, entity_id, task_id, title, body)
  VALUES ('comment', new.id, new.task_id, '', new.body || ' ' || COALESCE(new.question_options, ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_comments_update AFTER UPDATE OF body, question_options ON comments BEGIN
  UPDATE search_fts SET body = new.body || ' ' || COALESCE(new.question_options, '')
  WHERE kind = 'comment' AND entity_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_comments_delete AFTER DELETE ON comments BEGIN
  DELETE FROM search_fts WHERE kind = 'comment' AND entity_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_attachments_insert AFTER INSERT ON attachments BEGIN
  INSERT INTO search_fts(kind, entity_id, task_id, title, body)
  VALUES ('attachment', new.id, COALESCE(new.task_id, (SELECT task_id FROM comments WHERE id = new.comment_id)), new.filename, COALESCE(new.search_text, ''));
END;
--> statement-breakpoint
CREATE TRIGGER search_attachments_update AFTER UPDATE OF filename, search_text ON attachments BEGIN
  UPDATE search_fts SET title = new.filename, body = COALESCE(new.search_text, '')
  WHERE kind = 'attachment' AND entity_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER search_attachments_delete AFTER DELETE ON attachments BEGIN
  DELETE FROM search_fts WHERE kind = 'attachment' AND entity_id = old.id;
END;
