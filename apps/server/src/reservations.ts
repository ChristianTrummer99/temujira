import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Ctx } from "./routes/types";
import type { Db } from "./db";
import { managedAgents, reservations, tasks, users } from "./db/schema";
import { conflict, forbidden, notFound } from "./errors";
import type { ReservationRow, UserRow } from "./serialize";

/**
 * Reservation helpers shared by the reservation routes and the mutation paths that must
 * enforce worker ownership. The invariants live here so every caller agrees on them:
 *
 *  - availability is derived from reservation state, never a mutable flag;
 *  - a managed identity's API key may only perform job writes on its reserved ticket;
 *  - ordinary assignment paths may not create jobs for managed identities.
 */

export function isManagedAgent(db: Db, userId: string): boolean {
  return !!db.select().from(managedAgents).where(eq(managedAgents.userId, userId)).get();
}

export function activeReservationForAgent(db: Db, agentUserId: string): ReservationRow | undefined {
  return db
    .select()
    .from(reservations)
    .where(and(eq(reservations.agentUserId, agentUserId), eq(reservations.status, "active")))
    .get();
}

export function activeReservationForTask(db: Db, taskId: string): ReservationRow | undefined {
  return db
    .select()
    .from(reservations)
    .where(and(eq(reservations.taskId, taskId), eq(reservations.status, "active")))
    .get();
}

/** The active reservation bound to an API key id (worker credential lookup). */
export function activeReservationForKey(db: Db, apiKeyId: string): ReservationRow | undefined {
  return db
    .select()
    .from(reservations)
    .where(and(eq(reservations.apiKeyId, apiKeyId), eq(reservations.status, "active")))
    .get();
}

export function requireReservation(db: Db, id: string): ReservationRow {
  const row = db.select().from(reservations).where(eq(reservations.id, id)).get();
  if (!row) throw notFound("reservation");
  return row;
}

export function requireAgentUser(db: Db, userId: string): UserRow {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw notFound("agent");
  if (!user.isAgent) throw conflict("reservations bind agent accounts only");
  return user;
}

/**
 * The reservation governing this request, or null when the caller is not a worker
 * credential. Only API-key requests for an admitted managed identity qualify; a session or
 * an unmanaged user's key is never a worker credential.
 */
export function workerReservation(c: Ctx): ReservationRow | null {
  if (!c.get("apiKeyId") || !c.get("managedAgent")) return null;
  return c.get("reservation") ?? null;
}

/**
 * Object-level worker ownership check, called at each ticket-bound mutation. Re-reads the
 * reservation so a release committed after authentication cannot still commit a write.
 */
export function assertWorkerTicketAccess(db: Db, c: Ctx, taskId: string): void {
  const reservation = workerReservation(c);
  if (!reservation) return; // not a worker credential: ordinary authorization applies
  const current = db.select().from(reservations).where(eq(reservations.id, reservation.id)).get();
  if (!current || current.status !== "active") {
    throw forbidden("reservation is no longer active");
  }
  if (current.taskId !== taskId) {
    throw forbidden("this credential is reserved for a different ticket");
  }
}

/** True when the credential is a worker credential (managed identity + API key). */
export function isWorkerCredential(c: Ctx): boolean {
  return !!c.get("apiKeyId") && !!c.get("managedAgent");
}

/** Legacy work check: tickets assigned to this agent with no active reservation. */
export function legacyAssignments(db: Db, agentUserIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (agentUserIds.length === 0) return map;
  const activeTaskIds = new Set(
    db
      .select({ taskId: reservations.taskId })
      .from(reservations)
      .where(and(eq(reservations.status, "active"), inArray(reservations.agentUserId, agentUserIds)))
      .all()
      .map((r) => r.taskId),
  );
  const rows = db
    .select({ assigneeId: tasks.assigneeId, id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.assigneeId, agentUserIds))
    .all();
  for (const row of rows) {
    if (!row.assigneeId || activeTaskIds.has(row.id)) continue;
    const list = map.get(row.assigneeId) ?? [];
    list.push(row.id);
    map.set(row.assigneeId, list);
  }
  return map;
}

/**
 * Management guard for ordinary assignee changes. A ticket with an active reservation may
 * only change hands through `reservations.release` (which revokes the worker key and clears
 * the matching assignment); otherwise two owners could exist at once.
 */
export function assertAssigneeChangeAllowed(
  db: Db,
  c: Ctx,
  taskId: string,
  currentAssigneeId: string | null,
  nextAssigneeId: string | null
): void {
  const worker = workerReservation(c);
  const active = activeReservationForTask(db, taskId);

  if (worker) {
    // A worker may only keep itself assigned to its own reserved ticket.
    if (!active || active.id !== worker.id || active.taskId !== taskId) {
      throw forbidden("this credential is reserved for a different ticket");
    }
    if (nextAssigneeId !== worker.agentUserId) {
      throw forbidden("a reserved worker cannot reassign its ticket; release the reservation");
    }
    return;
  }

  if (active && nextAssigneeId !== currentAssigneeId) {
    throw conflict(
      `ticket has an active reservation (${active.id}); release it before changing the assignee`,
    );
  }
}

/**
 * Management guard for assignment into a managed identity: it must go through the claim
 * path. The one exception is a worker idempotently re-asserting its own assignment.
 */
export function assertManagedAssigneeAllowed(
  db: Db,
  c: Ctx,
  nextAssigneeId: string | null,
  taskId: string
): void {
  if (nextAssigneeId === null) return;
  if (!isManagedAgent(db, nextAssigneeId)) return;
  const worker = workerReservation(c);
  if (worker && worker.agentUserId === nextAssigneeId && worker.taskId === taskId) return;
  throw conflict(
    "managed agents are assigned through the reservation claim path (reservations.claim)",
  );
}

/** Un-admission is only safe once the identity holds no active reservation. */
export function assertNoActiveReservation(db: Db, agentUserId: string): void {
  const active = activeReservationForAgent(db, agentUserId);
  if (active) {
    throw conflict(`agent has an active reservation (${active.id}); release it first`);
  }
}

/** Active managed identities, for availability listings. */
export function activeManagedAgentIds(db: Db): string[] {
  return db
    .select({ userId: managedAgents.userId })
    .from(managedAgents)
    .innerJoin(users, eq(users.id, managedAgents.userId))
    .where(isNull(users.deactivatedAt))
    .all()
    .map((r) => r.userId);
}
