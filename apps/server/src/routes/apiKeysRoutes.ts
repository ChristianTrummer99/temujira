import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { CreateApiKeyInputSchema, ListApiKeysQuerySchema } from "@temujira/shared";
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
      let targetUserId = user.id;
      if (q.user_id && q.user_id !== user.id) {
        if (user.role !== "admin") throw forbidden("only admins can list another user's API keys");
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
        if (user.role !== "admin") throw forbidden("only admins can create API keys for other users");
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
      if (key.userId !== user.id && user.role !== "admin") {
        throw forbidden("only the owner or an admin can revoke this key");
      }
      if (key.revokedAt === null) {
        ctx.db.update(apiKeys).set({ revokedAt: now() }).where(eq(apiKeys.id, id)).run();
      }
      return c.json({ ok: true as const });
    },
  };
}
