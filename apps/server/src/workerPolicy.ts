import type { MiddlewareHandler } from "hono";
import { ROUTES, type RouteId } from "@temujira/shared";
import { forbidden } from "./errors";
import type { AppEnv } from "./routes/types";

/**
 * Worker-credential policy. Applies only to API-key requests made *as* an admitted managed
 * agent identity (a "worker credential"): sessions and unmanaged users are unaffected.
 *
 * Default deny. Reads are allowed unless explicitly denied; ticket-bound mutations pass
 * through to the handler, which resolves the target object and calls
 * `assertWorkerTicketAccess` (so indirect ids cannot bypass ownership); the few non-ticket
 * personal mutations a worker legitimately needs are allowlisted.
 */
const WORKER_ALLOWED_MUTATIONS = new Set<RouteId>([
  // Personal queue metadata is distinct from active ownership.
  "queue.add",
  "queue.setState",
  "queue.remove",
  "queue.reorder",
  // Own inbox.
  "inbox.update",
]);

/** Mutations that must resolve their target and prove it belongs to the reserved ticket. */
const WORKER_TICKET_BOUND = new Set<RouteId>([
  "tasks.update",
  "comments.create",
  "comments.update",
  "comments.delete",
  "attachments.uploadToTask",
  "attachments.uploadToComment",
  "attachments.delete",
  "links.create",
  "links.delete",
]);

/** Reads a worker credential may not perform even though they are GETs. */
const WORKER_DENIED_READS = new Set<RouteId>([
  "apiKeys.list",
  "users.list",
  "managedAgents.list",
  "reservations.list",
  "reservations.get",
  "reservations.lookup",
]);

export function enforceWorkerPolicy(routeId: RouteId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get("apiKeyId") || !c.get("managedAgent")) return next();
    const method = ROUTES[routeId].method;
    if (method === "GET" && !WORKER_DENIED_READS.has(routeId)) return next();
    if (WORKER_ALLOWED_MUTATIONS.has(routeId)) return next();
    if (WORKER_TICKET_BOUND.has(routeId)) {
      if (!c.get("reservation")) {
        throw forbidden(
          "managed agent credentials need an active reservation for job writes",
        );
      }
      return next();
    }
    throw forbidden(`managed agent credentials cannot use ${routeId}`);
  };
}
