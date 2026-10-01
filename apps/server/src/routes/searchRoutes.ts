import type { z } from "zod";
import type { SearchQuerySchema, SearchResult } from "@temujira/shared";
import { accessibleWorkspaceIds } from "../access";
import { searchExpression } from "../search";
import { requireWorkspace } from "./resolve";
import { currentUser, query, type AppContext, type Handlers } from "./types";

export function searchHandlers(ctx: AppContext): Pick<Handlers, "search.query"> {
  return {
    "search.query": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof SearchQuerySchema>>(c);
      const workspace = q.workspace ? requireWorkspace(ctx.db, q.workspace, user) : null;
      const expression = searchExpression(q.q);
      const scope = accessibleWorkspaceIds(ctx.db, user);
      if (!expression || scope?.length === 0) return c.json({ items: [], total: 0, limit: q.limit, offset: q.offset });
      const conditions = ["search_fts MATCH ?"];
      const params: (string | number)[] = [expression];
      if (scope !== null) {
        conditions.push(`t.workspace_id IN (${scope.map(() => "?").join(",")})`);
        params.push(...scope);
      }
      if (workspace) { conditions.push("t.workspace_id = ?"); params.push(workspace.id); }
      if (q.type !== "all") { conditions.push("s.kind = ?"); params.push(q.type); }
      if (!q.include_archived) conditions.push("t.archived_at IS NULL AND w.archived_at IS NULL");
      const from = `FROM search_fts s JOIN tasks t ON t.id = s.task_id
        JOIN workspaces w ON w.id = t.workspace_id
        LEFT JOIN attachments a ON s.kind = 'attachment' AND a.id = s.entity_id
        WHERE ${conditions.join(" AND ")}`;
      // The same permission predicate applies BEFORE count, ranking, snippets and pagination.
      const total = (ctx.sqlite.prepare(`SELECT count(*) n ${from}`).get(...params) as { n: number }).n;
      const items = ctx.sqlite.prepare(`SELECT s.entity_id AS id, s.kind AS type,
        w.id AS workspace_id, w.key AS workspace_key, w.name AS workspace_name,
        t.id AS task_id, w.key || '-' || t.number AS task_key, t.title AS task_title,
        CASE WHEN s.kind = 'attachment' THEN a.filename ELSE t.title END AS title,
        snippet(search_fts, -1, '', '', ' … ', 40) AS snippet,
        CASE WHEN s.kind = 'comment' THEN s.entity_id ELSE a.comment_id END AS comment_id,
        CASE WHEN s.kind = 'attachment' THEN s.entity_id ELSE NULL END AS attachment_id
        ${from} ORDER BY bm25(search_fts, 0, 0, 0, 5, 1), s.rowid DESC LIMIT ? OFFSET ?`
      ).all(...params, q.limit, q.offset) as SearchResult[];
      return c.json({ items, total, limit: q.limit, offset: q.offset });
    },
  };
}
