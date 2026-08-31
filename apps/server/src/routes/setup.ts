import { count } from "drizzle-orm";
import type { z } from "zod";
import type { SetupInputSchema } from "@temujira/shared";
import { createSession, hashPassword, setSessionCookie } from "../auth";
import { users } from "../db/schema";
import { HttpError } from "../errors";
import { seedGettingStarted } from "../seed";
import { userToApi } from "../serialize";
import { newId, now } from "../util";
import { body, type AppContext, type Handlers } from "./types";

export function needsSetup(ctx: AppContext): boolean {
  const row = ctx.db.select({ c: count() }).from(users).get();
  return (row?.c ?? 0) === 0;
}

export function createFirstAdmin(
  ctx: AppContext,
  input: { email: string; name: string; passwordHash: string },
): typeof users.$inferSelect {
  const t = now();
  const row: typeof users.$inferSelect = {
    id: newId(),
    email: input.email,
    name: input.name,
    passwordHash: input.passwordHash,
    role: "admin",
    isAgent: 0,
    deactivatedAt: null,
    createdAt: t,
    updatedAt: t,
  };
  ctx.db.transaction((tx) => {
    tx.insert(users).values(row).run();
    seedGettingStarted(tx as unknown as typeof ctx.db, row.id);
  });
  return row;
}

export function setupHandlers(ctx: AppContext): Pick<Handlers, "setup.status" | "setup.run"> {
  return {
    "setup.status": (c) => c.json({ needsSetup: needsSetup(ctx) }),
    "setup.run": async (c) => {
      if (!needsSetup(ctx)) {
        throw new HttpError("forbidden", "setup already completed; log in instead");
      }
      const input = body<z.infer<typeof SetupInputSchema>>(c);
      const passwordHash = await hashPassword(input.password);
      // Re-check inside the critical section: two concurrent setups must not both win.
      if (!needsSetup(ctx)) {
        throw new HttpError("forbidden", "setup already completed; log in instead");
      }
      const user = createFirstAdmin(ctx, { email: input.email, name: input.name, passwordHash });
      const { token } = createSession(ctx.db, user.id);
      setSessionCookie(c, ctx.config, token);
      return c.json({ user: userToApi(user), token });
    },
  };
}
