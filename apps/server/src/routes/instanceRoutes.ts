import type { InstanceSettings } from "@temujira/shared";
import { forbidden } from "../errors";
import { getInstanceSettings, saveInstanceSettings } from "../instance";
import { body, currentUser, type AppContext, type Handlers } from "./types";

export function instanceHandlers(ctx: AppContext): Pick<Handlers, "instance.get" | "instance.update"> {
  return {
    "instance.get": (c) => {
      c.header("Cache-Control", "no-store");
      return c.json({ instance: getInstanceSettings(ctx.db) });
    },
    "instance.update": (c) => {
      const user = currentUser(c);
      // Instance-wide changes are outside any scope or workspace-limited key grant.
      if (user.keyScopes !== undefined || user.keyWorkspaceIds !== undefined) {
        throw forbidden("unrestricted admin credentials required");
      }
      c.header("Cache-Control", "no-store");
      return c.json({ instance: saveInstanceSettings(ctx.db, body<InstanceSettings>(c)) });
    },
  };
}
