import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import type {
  AdmitManagedAgentInputSchema,
  CreateReservationInputSchema,
  ListManagedAgentsQuerySchema,
  ListReservationsQuerySchema,
  LookupReservationQuerySchema,
  ManagedAgent,
  ReleaseReservationInputSchema,
} from "@temujira/shared";
import { accessibleWorkspaceIds, workspaceScopeWhere } from "../access";
import { newApiKeyToken, sha256hex } from "../auth";
import type { Db } from "../db";
import {
  apiKeys,
  managedAgents,
  reservations,
  statuses,
  tasks,
  users,
  workspaces,
} from "../db/schema";
import { conflict } from "../errors";
import {
  activeReservationForAgent,
  assertNoActiveReservation,
  legacyAssignments,
  requireAgentUser,
  requireReservation,
} from "../reservations";
import {
  reservationToApi,
  taskToApi,
  userToApi,
  type ManagedAgentRow,
  type ReservationRow,
  type UserRow,
} from "../serialize";
import { newId, now } from "../util";
import { recordActivity } from "./engagement";
import { assertTaskIdAccess, requireTask } from "./resolve";
import { body, currentUser, query, type AppContext, type Handlers } from "./types";

/** "KEY-42" for a task id (falls back to the id when the task is missing). */
function taskKeyOf(db: Db, taskId: string): string {
  const row = db
    .select({ key: workspaces.key, number: tasks.number })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .where(eq(tasks.id, taskId))
    .get();
  return row ? `${row.key}-${row.number}` : taskId;
}

function taskKeysOf(db: Db, taskIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({ id: tasks.id, key: workspaces.key, number: tasks.number })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .where(inArray(tasks.id, taskIds))
    .all();
  for (const row of rows) map.set(row.id, `${row.key}-${row.number}`);
  return map;
}

function managedAgentToApi(
  row: ManagedAgentRow,
  user: UserRow,
  active: ReservationRow | null,
  taskKey: string,
  legacyTaskKeys: string[]
): ManagedAgent {
  const conflicts: string[] = [];
  if (user.deactivatedAt !== null) conflicts.push("identity is deactivated");
  if (legacyTaskKeys.length > 0) {
    conflicts.push(`assigned without a reservation: ${legacyTaskKeys.join(", ")}`);
  }
  return {
    user_id: row.userId,
    name: user.name,
    deactivated: user.deactivatedAt !== null,
    admitted_by: row.admittedBy,
    admitted_at: row.admittedAt,
    note: row.note,
    available: user.deactivatedAt === null && active === null,
    reservation: active ? reservationToApi(active, taskKey) : null,
    conflicts,
  };
}

/**
 * SQLite reports partial-unique-index violations with the index name (and sometimes the
 * column); translate both into machine-readable conflicts rather than a 500.
 */
function mapConstraintError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("reservations_active_agent_unique") || message.includes("reservations.agent_user_id")) {
    throw conflict("agent already has an active reservation");
  }
  if (message.includes("reservations_active_task_unique") || message.includes("reservations.task_id")) {
    throw conflict("ticket already has an active reservation");
  }
  if (message.includes("reservations_request_id_unique") || message.includes("reservations.request_id")) {
    throw conflict("request_id was already used for a different claim");
  }
  throw err;
}

export function reservationHandlers(
  ctx: AppContext
): Pick<
  Handlers,
  | "managedAgents.list"
  | "managedAgents.admit"
  | "managedAgents.remove"
  | "reservations.list"
  | "reservations.lookup"
  | "reservations.current"
  | "reservations.get"
  | "reservations.claim"
  | "reservations.release"
> {
  return {
    "managedAgents.list": (c) => {
      const q = query<z.infer<typeof ListManagedAgentsQuerySchema>>(c);
      const rows = ctx.db
        .select({ ma: managedAgents, user: users })
        .from(managedAgents)
        .innerJoin(users, eq(users.id, managedAgents.userId))
        .where(q.include_deactivated ? undefined : isNull(users.deactivatedAt))
        .orderBy(asc(users.name), asc(users.id))
        .all();
      const ids = rows.map((r) => r.user.id);
      const activeRows = ids.length
        ? ctx.db
            .select()
            .from(reservations)
            .where(and(eq(reservations.status, "active"), inArray(reservations.agentUserId, ids)))
            .all()
        : [];
      const activeByAgent = new Map(activeRows.map((r) => [r.agentUserId, r]));
      const legacy = legacyAssignments(ctx.db, ids);
      const keyByTask = taskKeysOf(ctx.db, activeRows.map((r) => r.taskId));
      return c.json({
        items: rows.map(({ ma, user }) =>
          managedAgentToApi(
            ma,
            user,
            activeByAgent.get(user.id) ?? null,
            keyByTask.get(activeByAgent.get(user.id)?.taskId ?? "") ?? "",
            (legacy.get(user.id) ?? []).map((id) => keyByTask.get(id) ?? id)
          )
        ),
      });
    },

    "managedAgents.admit": (c) => {
      const actor = currentUser(c);
      const input = body<z.infer<typeof AdmitManagedAgentInputSchema>>(c);
      const agent = requireAgentUser(ctx.db, input.user_id);
      // Idempotent and concurrency-safe: re-admitting is a no-op.
      ctx.db
        .insert(managedAgents)
        .values({
          userId: agent.id,
          admittedBy: actor.id,
          admittedAt: now(),
          note: input.note ?? null,
        })
        .onConflictDoNothing()
        .run();
      const row = ctx.db
        .select()
        .from(managedAgents)
        .where(eq(managedAgents.userId, agent.id))
        .get()!;
      const active = activeReservationForAgent(ctx.db, agent.id) ?? null;
      const legacy = legacyAssignments(ctx.db, [agent.id]).get(agent.id) ?? [];
      const keyByTask = taskKeysOf(
        ctx.db,
        [...legacy, ...(active ? [active.taskId] : [])]
      );
      return c.json({
        agent: managedAgentToApi(
          row,
          agent,
          active,
          active ? (keyByTask.get(active.taskId) ?? "") : "",
          legacy.map((id) => keyByTask.get(id) ?? id)
        ),
      });
    },

    "managedAgents.remove": (c) => {
      const userId = c.req.param("userId") ?? "";
      const row = ctx.db
        .select()
        .from(managedAgents)
        .where(eq(managedAgents.userId, userId))
        .get();
      if (!row) return c.json({ ok: true as const }); // idempotent
      assertNoActiveReservation(ctx.db, userId);
      ctx.db.delete(managedAgents).where(eq(managedAgents.userId, userId)).run();
      return c.json({ ok: true as const });
    },

    "reservations.list": (c) => {
      const actor = currentUser(c);
      const q = query<z.infer<typeof ListReservationsQuerySchema>>(c);
      const conditions = [];
      if (q.agent_user_id) conditions.push(eq(reservations.agentUserId, q.agent_user_id));
      if (q.status) conditions.push(eq(reservations.status, q.status));
      if (q.request_id) conditions.push(eq(reservations.requestId, q.request_id));
      if (q.task) {
        const { task } = requireTask(ctx.db, q.task, actor);
        conditions.push(eq(reservations.taskId, task.id));
      }
      const accessible = accessibleWorkspaceIds(ctx.db, actor);
      const rows = ctx.db
        .select({ r: reservations, task: tasks, workspaceKey: workspaces.key })
        .from(reservations)
        .innerJoin(tasks, eq(tasks.id, reservations.taskId))
        .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
        .where(and(...conditions, workspaceScopeWhere(tasks.workspaceId, accessible)))
        .orderBy(desc(reservations.createdAt))
        .limit(q.limit)
        .offset(q.offset)
        .all();
      return c.json({
        items: rows.map((row) =>
          reservationToApi(row.r, `${row.workspaceKey}-${row.task.number}`)
        ),
      });
    },

    "reservations.lookup": (c) => {
      const actor = currentUser(c);
      const q = query<z.infer<typeof LookupReservationQuerySchema>>(c);
      const row = ctx.db
        .select()
        .from(reservations)
        .where(eq(reservations.requestId, q.request_id))
        .get();
      if (!row) return c.json({ reservation: null });
      assertTaskIdAccess(ctx.db, actor, row.taskId);
      return c.json({ reservation: reservationToApi(row, taskKeyOf(ctx.db, row.taskId)) });
    },

    "reservations.current": (c) => {
      const user = currentUser(c);
      const reservation = c.get("reservation") ?? null;
      if (!reservation) {
        return c.json({ user: userToApi(user), reservation: null, task: null });
      }
      const row = ctx.db
        .select({ task: tasks, status: statuses, assignee: users })
        .from(tasks)
        .innerJoin(statuses, eq(statuses.id, tasks.statusId))
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(eq(tasks.id, reservation.taskId))
        .get();
      if (!row) {
        return c.json({
          user: userToApi(user),
          reservation: reservationToApi(reservation, reservation.taskId),
          task: null,
        });
      }
      const workspace = ctx.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, row.task.workspaceId))
        .get()!;
      return c.json({
        user: userToApi(user),
        reservation: reservationToApi(reservation, `${workspace.key}-${row.task.number}`),
        task: taskToApi(row.task, workspace.key, row.status, row.assignee ?? null),
      });
    },

    "reservations.get": (c) => {
      const actor = currentUser(c);
      const row = requireReservation(ctx.db, c.req.param("id") ?? "");
      assertTaskIdAccess(ctx.db, actor, row.taskId);
      return c.json({ reservation: reservationToApi(row, taskKeyOf(ctx.db, row.taskId)) });
    },

    "reservations.claim": (c) => {
      const actor = currentUser(c);
      const input = body<z.infer<typeof CreateReservationInputSchema>>(c);
      const { task } = requireTask(ctx.db, input.task, actor);
      const agent = requireAgentUser(ctx.db, input.agent_user_id);
      if (agent.deactivatedAt !== null) {
        throw conflict("agent identity is deactivated; reactivate it before claiming");
      }
      const admitted = ctx.db
        .select()
        .from(managedAgents)
        .where(eq(managedAgents.userId, agent.id))
        .get();
      if (!admitted) {
        throw conflict("agent identity is not admitted to the reservation workflow");
      }

      // Idempotency: a repeated claim with the same inputs returns the committed
      // reservation and never re-reveals or re-mints the token.
      const existing = ctx.db
        .select()
        .from(reservations)
        .where(eq(reservations.requestId, input.request_id))
        .get();
      if (existing) {
        const same =
          existing.agentUserId === agent.id &&
          existing.taskId === task.id &&
          existing.runReference === input.run_reference;
        if (!same) throw conflict("request_id was already used for a different claim");
        return c.json({
          reservation: reservationToApi(existing, taskKeyOf(ctx.db, existing.taskId)),
          token: null,
          replayed: true,
        });
      }

      const reservationId = newId();
      const keyId = newId();
      const token = newApiKeyToken();
      const t = now();
      try {
        ctx.db.transaction((tx) => {
          // Re-check inside the transaction: the partial unique indexes are the final
          // authority, but these give precise conflict messages.
          const agentBusy = tx
            .select()
            .from(reservations)
            .where(
              and(eq(reservations.agentUserId, agent.id), eq(reservations.status, "active"))
            )
            .get();
          if (agentBusy) {
            throw conflict(`agent ${agent.name} already has an active reservation`);
          }
          const taskBusy = tx
            .select()
            .from(reservations)
            .where(and(eq(reservations.taskId, task.id), eq(reservations.status, "active")))
            .get();
          if (taskBusy) throw conflict("ticket already has an active reservation");

          const current = tx.select().from(tasks).where(eq(tasks.id, task.id)).get()!;
          if (current.assigneeId !== null && current.assigneeId !== agent.id) {
            throw conflict("ticket is assigned to another user; the claim cannot steal it");
          }
          if (current.assigneeId === agent.id && !input.adopt_existing_assignment) {
            throw conflict(
              "ticket is already assigned to this agent without a reservation; pass adopt_existing_assignment to reconcile",
            );
          }

          tx.insert(apiKeys)
            .values({
              id: keyId,
              userId: agent.id,
              name: `reservation ${reservationId}`,
              tokenHash: sha256hex(token),
              tokenPrefix: token.slice(0, 12),
              lastUsedAt: null,
              revokedAt: null,
              createdAt: t,
            })
            .run();
          tx.insert(reservations)
            .values({
              id: reservationId,
              agentUserId: agent.id,
              taskId: task.id,
              runReference: input.run_reference,
              requestId: input.request_id,
              apiKeyId: keyId,
              managerUserId: actor.id,
              status: "active",
              createdAt: t,
              releasedAt: null,
              releasedBy: null,
              releaseReason: null,
            })
            .run();
          tx.update(tasks)
            .set({ assigneeId: agent.id, updatedAt: t })
            .where(eq(tasks.id, task.id))
            .run();
        });
      } catch (err) {
        mapConstraintError(err);
      }

      const created = ctx.db
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId))
        .get()!;
      recordActivity(ctx.db, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: actor.id,
        action: "reservation.claimed",
        metadata: {
          reservation_id: reservationId,
          agent_user_id: agent.id,
          run_reference: input.run_reference,
          request_id: input.request_id,
          api_key_id: keyId,
        },
      });
      return c.json({
        reservation: reservationToApi(created, taskKeyOf(ctx.db, task.id)),
        token,
        replayed: false,
      });
    },

    "reservations.release": (c) => {
      const actor = currentUser(c);
      const input = body<z.infer<typeof ReleaseReservationInputSchema>>(c);
      const row = requireReservation(ctx.db, c.req.param("id") ?? "");
      assertTaskIdAccess(ctx.db, actor, row.taskId);
      if (row.status === "released") {
        // Idempotent: a repeated (or stale) release is a no-op on this reservation and
        // can never touch a newer reservation for the same identity or ticket.
        return c.json({ reservation: reservationToApi(row, taskKeyOf(ctx.db, row.taskId)) });
      }
      const t = now();
      let cleared = false;
      ctx.db.transaction((tx) => {
        tx.update(reservations)
          .set({
            status: "released",
            releasedAt: t,
            releasedBy: actor.id,
            releaseReason: input.reason ?? null,
          })
          .where(eq(reservations.id, row.id))
          .run();
        tx.update(apiKeys)
          .set({ revokedAt: t })
          .where(and(eq(apiKeys.id, row.apiKeyId), isNull(apiKeys.revokedAt)))
          .run();
        // Clear the assignment only when the ticket is still assigned to this worker;
        // never overwrite a different current assignee.
        const task = tx.select().from(tasks).where(eq(tasks.id, row.taskId)).get();
        if (task && task.assigneeId === row.agentUserId) {
          tx.update(tasks)
            .set({ assigneeId: null, updatedAt: t })
            .where(eq(tasks.id, row.taskId))
            .run();
          cleared = true;
        }
      });
      const updated = ctx.db
        .select()
        .from(reservations)
        .where(eq(reservations.id, row.id))
        .get()!;
      const taskRow = ctx.db.select().from(tasks).where(eq(tasks.id, row.taskId)).get();
      if (taskRow) {
        recordActivity(ctx.db, {
          workspaceId: taskRow.workspaceId,
          taskId: row.taskId,
          actorId: actor.id,
          action: "reservation.released",
          metadata: {
            reservation_id: row.id,
            agent_user_id: row.agentUserId,
            api_key_id: row.apiKeyId,
            assignment_cleared: cleared,
            ...(input.reason ? { reason: input.reason } : {}),
          },
        });
      }
      return c.json({
        reservation: reservationToApi(updated, taskKeyOf(ctx.db, row.taskId)),
      });
    },
  };
}
