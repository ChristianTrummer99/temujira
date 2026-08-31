import { buildOpenApiDoc } from "../openapi";
import type { AppContext, Handlers } from "./types";

export function metaHandlers(ctx: AppContext): Pick<Handlers, "meta.health" | "meta.openapi"> {
  let openapiDoc: Record<string, unknown> | null = null;
  return {
    "meta.health": (c) => c.json({ ok: true as const, version: ctx.config.version }),
    "meta.openapi": (c) => {
      openapiDoc ??= buildOpenApiDoc(ctx.config.version);
      return c.json(openapiDoc);
    },
  };
}
