import { desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { CreateApiKeyInputSchema, ListApiKeysQuerySchema } from "@temujira/shared";
import { accessibleWorkspaceIds, hasScope, userScopes } from "../access";
import { newApiKeyToken, sha256hex } from "../auth";
import { apiKeys, users, workspaces } from "../db/schema";
import { forbidden, notFound, validationError } from "../errors";
import { apiKeyToApi } from "../serialize";
import { newId, now } from "../util";
import { body, currentUser, query, type AppContext, type Handlers } from "./types";

export function apiKeyHandlers(
  ctx: AppContext,
): Pick<Handlers, "apiKeys.list" | "apiKeys.create" | "apiKeys.revoke"> {
  return {
    "apiKeys.list": (c) => {
      const user = currentUser(c);
      const q = query<z.infer<typeof ListApiKeysQuerySchema>>(c);
      if (q.all) {
        if (!hasScope(user, "api_keys:manage"))
          throw forbidden("missing scope: api_keys:manage");
        const all = ctx.db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)).all();
        return c.json({ items: all.map(apiKeyToApi) });
      }
      let targetUserId = user.id;
      if (q.user_id && q.user_id !== user.id) {
        if (!hasScope(user, "api_keys:manage"))
          throw forbidden("missing scope: api_keys:manage");
        targetUserId = q.user_id;
      }
      const items = ctx.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, targetUserId))
        .orderBy(desc(apiKeys.createdAt))
        .all();
      return c.json({ items: items.map(apiKeyToApi) });
    },

    "apiKeys.create": (c) => {
      const user = currentUser(c);
      const input = body<z.infer<typeof CreateApiKeyInputSchema>>(c);
      let target = ctx.db.select().from(users).where(eq(users.id, user.id)).get()!;
      if (input.user_id && input.user_id !== user.id) {
        if (!hasScope(user, "api_keys:manage"))
          throw forbidden("missing scope: api_keys:manage");
        const found = ctx.db.select().from(users).where(eq(users.id, input.user_id)).get();
        if (!found) throw notFound("user");
        target = found;
      }
      const actingForOther = target.id !== user.id;
      // A non-admin key manager cannot mint a more privileged credential by targeting an admin.
      if (actingForOther && target.role === "admin" && user.role !== "admin") {
        throw forbidden("only admins can mint keys for admin accounts");
      }
      const askedScopes = input.scopes === undefined ? null : [...new Set(input.scopes)];
      const ownerScopes = new Set(userScopes(target));
      const actorScopes = new Set(userScopes(user));
      if (askedScopes !== null) {
        const missing = askedScopes.filter((scope) =>
          !ownerScopes.has(scope) || (actingForOther && user.role !== "admin" && !actorScopes.has(scope)),
        );
        if (missing.length > 0) {
          throw forbidden(`key scopes must be held by the key owner: ${missing.join(", ")}`);
        }
      }
      const askedWorkspaces = input.workspace_ids === undefined ? null : [...new Set(input.workspace_ids)];
      if (askedWorkspaces !== null) {
        if (askedWorkspaces.length > 0) {
          const known = new Set(
            ctx.db.select({ id: workspaces.id }).from(workspaces)
              .where(inArray(workspaces.id, askedWorkspaces)).all().map((w) => w.id),
          );
          const unknown = askedWorkspaces.filter((id) => !known.has(id));
          if (unknown.length > 0) throw validationError(`unknown workspace: ${unknown.join(", ")}`);
        }
        const ownerAccess = accessibleWorkspaceIds(ctx.db, target);
        if (ownerAccess !== null && askedWorkspaces.some((id) => !ownerAccess.includes(id))) {
          throw forbidden("key workspaces must be accessible to the key owner");
        }
        if (actingForOther && user.role !== "admin") {
          const actorAccess = accessibleWorkspaceIds(ctx.db, user);
          if (actorAccess !== null && askedWorkspaces.some((id) => !actorAccess.includes(id))) {
            throw forbidden("cannot grant key access to workspaces you cannot access");
          }
        }
      }
      // A non-admin delegating to another identity must not inherit more than the manager
      // holds. Store the intersection explicitly instead of letting the key inherit.
      let storedScopes = askedScopes;
      let storedWorkspaces = askedWorkspaces;
      if (actingForOther && user.role !== "admin") {
        if (storedScopes === null) {
          storedScopes = [...actorScopes].filter((scope) => ownerScopes.has(scope));
        }
        if (storedWorkspaces === null) {
          const actorAccess = accessibleWorkspaceIds(ctx.db, user);
          if (actorAccess !== null) {
            const ownerAccess = accessibleWorkspaceIds(ctx.db, target);
            storedWorkspaces = ownerAccess === null
              ? [...actorAccess]
              : ownerAccess.filter((id) => actorAccess.includes(id));
          }
        }
      }
      const token = newApiKeyToken();
      const t = now();
      const row: typeof apiKeys.$inferSelect = {
        id: newId(),
        userId: target.id,
        name: input.name,
        tokenHash: sha256hex(token),
        tokenPrefix: token.slice(0, 12),
        lastUsedAt: null,
        revokedAt: null,
        scopes: storedScopes === null ? null : JSON.stringify(storedScopes),
        workspaceIds: storedWorkspaces === null ? null : JSON.stringify(storedWorkspaces),
        createdAt: t,
      };
      ctx.db.insert(apiKeys).values(row).run();
      return c.json({ apiKey: apiKeyToApi(row), token });
    },

    "apiKeys.revoke": (c) => {
      const user = currentUser(c);
      const id = c.req.param("id") ?? "";
      const key = ctx.db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
      if (!key) throw notFound("API key");
      if (key.userId !== user.id && !hasScope(user, "api_keys:manage")) {
        throw forbidden("only the owner or a caller with api_keys:manage can revoke this key");
      }
      if (key.userId !== user.id && user.role !== "admin") {
        const owner = ctx.db.select().from(users).where(eq(users.id, key.userId)).get();
        if (owner?.role === "admin") throw forbidden("only admins can revoke admin keys");
      }
      if (key.revokedAt === null) {
        ctx.db.update(apiKeys).set({ revokedAt: now() }).where(eq(apiKeys.id, id)).run();
      }
      return c.json({ ok: true as const });
    },
  };
}
