import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { CreateApiKeyInputSchema, ListApiKeysQuerySchema } from "@temujira/shared";
import { hasScope } from "../access";
import { newApiKeyToken, sha256hex } from "../auth";
import { apiKeys, users } from "../db/schema";
import { forbidden, notFound } from "../errors";
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
      let targetUserId = user.id;
      if (input.user_id && input.user_id !== user.id) {
        if (!hasScope(user, "api_keys:manage"))
          throw forbidden("missing scope: api_keys:manage");
        const target = ctx.db.select().from(users).where(eq(users.id, input.user_id)).get();
        if (!target) throw notFound("user");
        targetUserId = target.id;
      }
      const token = newApiKeyToken();
      const t = now();
      const row: typeof apiKeys.$inferSelect = {
        id: newId(),
        userId: targetUserId,
        name: input.name,
        tokenHash: sha256hex(token),
        tokenPrefix: token.slice(0, 12),
        lastUsedAt: null,
        revokedAt: null,
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
      if (key.revokedAt === null) {
        ctx.db.update(apiKeys).set({ revokedAt: now() }).where(eq(apiKeys.id, id)).run();
      }
      return c.json({ ok: true as const });
    },
  };
}
