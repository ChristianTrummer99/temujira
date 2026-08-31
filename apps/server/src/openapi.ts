import { z } from "zod";
import { ROUTES, type RouteDef } from "@temujira/shared";

function toSchema(schema: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-7" }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Minimal OpenAPI 3.1 document generated from the route registry. */
export function buildOpenApiDoc(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [id, def] of Object.entries(ROUTES) as [string, RouteDef][]) {
    const oaPath = "/api/v1" + def.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const parameters: unknown[] = [];
    for (const m of def.path.matchAll(/:([A-Za-z]+)/g)) {
      parameters.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
    }
    if (def.query) {
      const qs = toSchema(def.query, "input");
      const props = (qs.properties ?? {}) as Record<string, unknown>;
      const required = new Set((qs.required as string[]) ?? []);
      for (const [name, schema] of Object.entries(props)) {
        parameters.push({ name, in: "query", required: required.has(name), schema });
      }
    }
    const op: Record<string, unknown> = {
      operationId: id,
      summary: def.summary,
      ...(def.auth !== "public" ? { security: [{ bearerAuth: [] }] } : {}),
      ...(parameters.length ? { parameters } : {}),
      responses: {
        "200":
          def.response === "binary"
            ? { description: "file stream", content: { "application/octet-stream": {} } }
            : {
                description: "success",
                content: { "application/json": { schema: toSchema(def.response, "output") } },
              },
      },
    };
    if (def.bodyType === "multipart") {
      op.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] },
          },
        },
      };
    } else if (def.body) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: toSchema(def.body, "input") } },
      };
    }
    paths[oaPath] = { ...(paths[oaPath] ?? {}), [def.method.toLowerCase()]: op };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Temujira API",
      version,
      description:
        "Self-hosted project management for humans and agents. Authenticate with an API key (Authorization: Bearer tmj_...) or a session token (Bearer tms_...).",
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    paths,
  };
}
