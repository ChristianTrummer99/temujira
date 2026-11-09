import { buildOpenApiDoc } from "../openapi";
import { getInstanceSettings } from "../instance";
import type { AppContext, Handlers } from "./types";

export function metaHandlers(ctx: AppContext): Pick<Handlers, "meta.health" | "meta.openapi"> {
  let openapiDoc: Record<string, unknown> | null = null;
  return {
    "meta.health": (c) => c.json({ ok: true as const, version: ctx.config.version }),
    "meta.openapi": (c) => {
      openapiDoc ??= buildOpenApiDoc(ctx.config.version);
      c.header("Cache-Control", "no-store");
      return c.json({ ...openapiDoc, info: { ...openapiDoc.info as Record<string, unknown>, title: `${getInstanceSettings(ctx.db).display_name} API` } });
    },
  };
}
