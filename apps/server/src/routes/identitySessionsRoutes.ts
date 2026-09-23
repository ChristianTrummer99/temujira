import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { ReleaseIdentitySessionInputSchema } from "@temujira/shared";
import { requireScope } from "../access";
import { activeIdentitySession, newApiKeyToken, sha256hex } from "../auth";
import type { Db } from "../db";
import { apiKeys, identitySessions, users } from "../db/schema";
import { HttpError, conflict, notFound, validationError } from "../errors";
import { identitySessionToApi, userToApi, type UserRow } from "../serialize";
import { newId, now } from "../util";
import { body, currentUser, type AppContext, type Handlers } from "./types";

function requireIdentity(db: Db, userId: string): UserRow {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw notFound("identity");
  return user;
}

function activeSessionConflict(sessionId: string): HttpError {
  return new HttpError("conflict", "identity already has an active session", {
    session_id: sessionId,
  });
}

/** SQLite reports the partial unique index by name; translate it into a machine-readable 409. */
function mapSessionConstraint(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes("identity_sessions_active_user_unique") ||
    message.includes("identity_sessions.user_id")
  ) {
    throw conflict("identity already has an active session");
  }
  throw err;
}

export function identitySessionHandlers(
  ctx: AppContext
): Pick<
  Handlers,
  | "identitySessions.acquire"
  | "identitySessions.release"
  | "identitySessions.get"
  | "identitySessions.list"
  | "identitySessions.current"
> {
  return {
    "identitySessions.acquire": (c) => {
      const actor = currentUser(c);
      const target = requireIdentity(ctx.db, c.req.param("userId") ?? "");
      if (!target.isAgent) {
        throw validationError("exclusive identity sessions apply to agent accounts");
      }
      if (!target.exclusiveIdentity) {
        throw conflict("identity is not in exclusive mode");
      }
      const existing = activeIdentitySession(ctx.db, target.id);
      if (existing) throw activeSessionConflict(existing.id);

      const sessionId = newId();
      const keyId = newId();
      const token = newApiKeyToken();
      const t = now();
      try {
        ctx.db.transaction((tx) => {
          // Re-check inside the transaction; the partial unique index is the final
          // authority, this gives a precise conflict message.
          const recheck = tx
            .select()
            .from(identitySessions)
            .where(
              and(eq(identitySessions.userId, target.id), eq(identitySessions.status, "active"))
            )
            .get();
          if (recheck) throw activeSessionConflict(recheck.id);
          tx.insert(apiKeys)
            .values({
              id: keyId,
              userId: target.id,
              name: `identity session ${sessionId}`,
              tokenHash: sha256hex(token),
              tokenPrefix: token.slice(0, 12),
              lastUsedAt: null,
              revokedAt: null,
              createdAt: t,
            })
            .run();
          tx.insert(identitySessions)
            .values({
              id: sessionId,
              userId: target.id,
              apiKeyId: keyId,
              createdBy: actor.id,
              createdAt: t,
              status: "active",
              releasedAt: null,
              releasedBy: null,
              releaseReason: null,
            })
            .run();
        });
      } catch (err) {
        mapSessionConstraint(err);
      }
      const session = ctx.db
        .select()
        .from(identitySessions)
        .where(eq(identitySessions.id, sessionId))
        .get()!;
      return c.json({ session: identitySessionToApi(session), token });
    },

    "identitySessions.release": (c) => {
      const actor = currentUser(c);
      const input = body<z.infer<typeof ReleaseIdentitySessionInputSchema>>(c);
      const target = requireIdentity(ctx.db, c.req.param("userId") ?? "");
      const session = activeIdentitySession(ctx.db, target.id);
      if (!session) throw conflict("identity has no active session");

      // The worker releases itself with its own session key (no management scope);
      // otherwise this is an authorized management recovery.
      const isOwnSession = c.get("identitySession")?.id === session.id;
      if (!isOwnSession) requireScope(actor, "api_keys:manage");

      const t = now();
      ctx.db.transaction((tx) => {
        tx.update(identitySessions)
          .set({
            status: "released",
            releasedAt: t,
            releasedBy: actor.id,
            releaseReason: input.reason ?? null,
          })
          .where(eq(identitySessions.id, session.id))
          .run();
        tx.update(apiKeys)
          .set({ revokedAt: t })
          .where(and(eq(apiKeys.id, session.apiKeyId), isNull(apiKeys.revokedAt)))
          .run();
      });
      const updated = ctx.db
        .select()
        .from(identitySessions)
        .where(eq(identitySessions.id, session.id))
        .get()!;
      return c.json({ session: identitySessionToApi(updated) });
    },

    "identitySessions.get": (c) => {
      const target = requireIdentity(ctx.db, c.req.param("userId") ?? "");
      const session = activeIdentitySession(ctx.db, target.id) ?? null;
      return c.json({ session: session ? identitySessionToApi(session) : null });
    },

    "identitySessions.list": (c) => {
      const rows = ctx.db
        .select()
        .from(identitySessions)
        .where(eq(identitySessions.status, "active"))
        .orderBy(asc(identitySessions.createdAt))
        .all();
      return c.json({ items: rows.map(identitySessionToApi) });
    },

    "identitySessions.current": (c) => {
      const user = currentUser(c);
      const session = c.get("identitySession") ?? null;
      return c.json({
        user: userToApi(user),
        session: session ? identitySessionToApi(session) : null,
      });
    },
  };
}
