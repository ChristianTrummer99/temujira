import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { LoginInputSchema, UpdateMeInputSchema } from "@temujira/shared";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "../auth";
import { users } from "../db/schema";
import { forbidden, unauthorized, validationError } from "../errors";
import { userToApi } from "../serialize";
import { now } from "../util";
import {
  body,
  currentUser,
  type AppContext,
  type Ctx,
  type Handlers,
} from "./types";

function clientIp(c: Ctx): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "direct";
}

export function authHandlers(
  ctx: AppContext,
): Pick<Handlers, "auth.login" | "auth.logout" | "auth.me" | "auth.updateMe"> {
  return {
    "auth.login": async (c) => {
      const input = body<z.infer<typeof LoginInputSchema>>(c);
      const limiterKey = `${clientIp(c)}:${input.email}`;
      ctx.limiter.assertAllowed(limiterKey);
      const user = ctx.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .get();
      // Agent accounts (passwordHash null) and unknown emails fail identically.
      const ok =
        user?.passwordHash != null && user.deactivatedAt === null
          ? await verifyPassword(input.password, user.passwordHash)
          : false;
      if (!ok) {
        ctx.limiter.recordFailure(limiterKey);
        throw unauthorized("invalid email or password");
      }
      ctx.limiter.reset(limiterKey);
      const { token } = createSession(ctx.db, user!.id);
      setSessionCookie(c, ctx.config, token);
      return c.json({ user: userToApi(user!), token });
    },

    "auth.logout": (c) => {
      const sessionId = c.get("sessionId");
      if (sessionId) destroySession(ctx.db, sessionId);
      clearSessionCookie(c, ctx.config);
      return c.json({ ok: true as const });
    },

    "auth.me": (c) => c.json({ user: userToApi(currentUser(c)) }),

    "auth.updateMe": async (c) => {
      const input = body<z.infer<typeof UpdateMeInputSchema>>(c);
      const user = currentUser(c);
      const updates: Partial<typeof users.$inferInsert> = { updatedAt: now() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.new_password !== undefined) {
        if (user.passwordHash === null) {
          throw forbidden("agent accounts have no password");
        }
        if (
          !input.current_password ||
          !(await verifyPassword(input.current_password, user.passwordHash))
        ) {
          throw unauthorized("current password is incorrect");
        }
        updates.passwordHash = await hashPassword(input.new_password);
      }
      if (input.name === undefined && input.new_password === undefined) {
        throw validationError("nothing to update");
      }
      const updated = ctx.db
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id))
        .returning()
        .get();
      if (input.new_password !== undefined)
        destroyUserSessions(ctx.db, user.id, c.get("sessionId"));
      return c.json({ user: userToApi(updated!) });
    },
  };
}
