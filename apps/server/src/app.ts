import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { ROUTES, ROUTE_IDS, type RouteDef } from "@temujira/shared";
import { LoginRateLimiter, hashPassword, requireAuth } from "./auth";
import type { ServerConfig } from "./config";
import { createDb } from "./db";
import { attachments } from "./db/schema";
import { HttpError } from "./errors";
import { createFirstAdmin, needsSetup, setupHandlers } from "./routes/setup";
import { activityHandlers } from "./routes/activityRoutes";
import { apiKeyHandlers } from "./routes/apiKeysRoutes";
import { attachmentsHandlers } from "./routes/attachmentsRoutes";
import { authHandlers } from "./routes/authRoutes";
import { commentsHandlers } from "./routes/commentsRoutes";
import { inboxHandlers } from "./routes/inboxRoutes";
import { linksHandlers } from "./routes/linksRoutes";
import { metaHandlers } from "./routes/meta";
import { statusesHandlers } from "./routes/statusesRoutes";
import { tagsHandlers } from "./routes/tagsRoutes";
import { tasksHandlers } from "./routes/tasksRoutes";
import { usersHandlers } from "./routes/usersRoutes";
import { workspacesHandlers } from "./routes/workspacesRoutes";
import type { AppContext, AppEnv, Handlers } from "./routes/types";
import { LocalStorage } from "./storage";
import { staticMiddleware } from "./static";

const JSON_BODY_LIMIT = 2 * 1024 * 1024;

function validateRequest(def: RouteDef): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (def.query) {
      const parsed = def.query.safeParse(c.req.query());
      if (!parsed.success) {
        throw new HttpError("validation_error", "invalid query parameters", parsed.error.issues);
      }
      c.set("query", parsed.data);
    }
    if (def.body && def.bodyType !== "multipart") {
      const len = Number(c.req.header("content-length") ?? 0);
      if (len > JSON_BODY_LIMIT) throw new HttpError("payload_too_large", "request body too large");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw new HttpError("validation_error", "request body must be valid JSON");
      }
      const parsed = def.body.safeParse(raw);
      if (!parsed.success) {
        throw new HttpError("validation_error", "invalid request body", parsed.error.issues);
      }
      c.set("body", parsed.data);
    }
    await next();
  };
}

async function seedAdminFromEnv(ctx: AppContext): Promise<void> {
  const { adminEmail, adminPassword, adminName } = ctx.config;
  if (!adminEmail || !adminPassword || !needsSetup(ctx)) return;
  const passwordHash = await hashPassword(adminPassword);
  createFirstAdmin(ctx, { email: adminEmail.toLowerCase(), name: adminName ?? "Admin", passwordHash });
  console.log(`[temujira] created initial admin ${adminEmail} from environment`);
}

export interface BuiltApp {
  app: Hono<AppEnv>;
  ctx: AppContext;
}

export async function buildApp(config: ServerConfig): Promise<BuiltApp> {
  const { db, sqlite } = createDb(config.dataDir);
  const storage = new LocalStorage(join(config.dataDir, "uploads"), config.maxUploadMb * 1024 * 1024);
  const ctx: AppContext = { db, sqlite, config, storage, limiter: new LoginRateLimiter() };

  // Startup maintenance: crash-consistency sweep for upload bytes without DB rows.
  const validIds = new Set(db.select({ id: attachments.id }).from(attachments).all().map((r) => r.id));
  const swept = storage.sweepOrphans(validIds);
  if (swept > 0) console.log(`[temujira] removed ${swept} orphaned upload file(s)`);

  await seedAdminFromEnv(ctx);

  const handlers: Handlers = {
    ...metaHandlers(ctx),
    ...setupHandlers(ctx),
    ...authHandlers(ctx),
    ...apiKeyHandlers(ctx),
    ...usersHandlers(ctx),
    ...workspacesHandlers(ctx),
    ...statusesHandlers(ctx),
    ...tagsHandlers(ctx),
    ...tasksHandlers(ctx),
    ...linksHandlers(ctx),
    ...commentsHandlers(ctx),
    ...attachmentsHandlers(ctx),
    ...activityHandlers(ctx),
    ...inboxHandlers(ctx),
  };

  const app = new Hono<AppEnv>();

  const serveWeb = staticMiddleware(config.webDist);

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
        err.status as 400,
      );
    }
    console.error("[temujira] unhandled error:", err);
    return c.json({ error: { code: "server_error", message: "internal server error" } }, 500);
  });

  app.notFound((c) => serveWeb(c));

  if (config.devOrigins.length > 0) {
    app.use("/api/*", cors({ origin: config.devOrigins, credentials: true }));
  }

  // Hono resolves overlapping matches in registration order, so mount fully literal paths
  // before parameterized ones: /users/search must win over /users/:id, /tasks/mine over
  // /tasks/:idOrKey. Sorting by path-param count is stable, so registry order is otherwise
  // preserved (and route parity is a set diff, unaffected by order).
  const paramCount = (path: string) => (path.match(/:[A-Za-z]+/g) ?? []).length;
  const mountOrder = [...ROUTE_IDS].sort((a, b) => paramCount(ROUTES[a].path) - paramCount(ROUTES[b].path));

  for (const id of mountOrder) {
    const def: RouteDef = ROUTES[id];
    const middlewares: MiddlewareHandler<AppEnv>[] = [];
    if (def.auth !== "public") middlewares.push(requireAuth(def.auth, db, config));
    middlewares.push(validateRequest(def));
    app.on([def.method], [`/api/v1${def.path}`], ...middlewares, handlers[id]);
  }

  return { app, ctx };
}
