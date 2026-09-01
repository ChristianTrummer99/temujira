import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { ListActivityQuerySchema } from "@temujira/shared";
import { activityEvents, taskAssociations, tasks, users } from "../db/schema";
import { activityEventToApi } from "../serialize";
import { requireWorkspace } from "./resolve";
import { currentUser, query, type AppContext, type Handlers } from "./types";

export function activityHandlers(ctx: AppContext): Pick<Handlers, "activity.list"> {
  return {
    /**
     * Workspace action feed, newest first. `?mine=1` narrows it to events on tasks the
     * current user is associated with (created / assigned / commented / mentioned).
     */
    "activity.list": (c) => {
      const user = currentUser(c);
      const ws = requireWorkspace(ctx.db, c.req.param("idOrKey") ?? "");
      const q = query<z.infer<typeof ListActivityQuerySchema>>(c);
      const conds: (SQL | undefined)[] = [eq(activityEvents.workspaceId, ws.id)];
      if (q.mine) {
        conds.push(
          sql`EXISTS (SELECT 1 FROM ${taskAssociations} WHERE ${taskAssociations.taskId} = ${activityEvents.taskId} AND ${taskAssociations.userId} = ${user.id})`,
        );
      }
      const rows = ctx.db
        .select({ event: activityEvents, actor: users, task: tasks })
        .from(activityEvents)
        .innerJoin(users, eq(activityEvents.actorId, users.id))
        // Workspace-scoped events may have no task (task_id is nullable).
        .leftJoin(tasks, eq(activityEvents.taskId, tasks.id))
        .where(and(...conds))
        .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
        .limit(q.limit)
        .offset(q.offset)
        .all();
      return c.json({
        items: rows.map((r) =>
          activityEventToApi(
            r.event,
            r.actor,
            // Task keys are workspace key + task number; the feed is already workspace-scoped.
            r.task ? { key: `${ws.key}-${r.task.number}`, title: r.task.title } : null,
          ),
        ),
      });
    },
  };
}
