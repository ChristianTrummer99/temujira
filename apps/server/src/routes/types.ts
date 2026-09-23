import type Database from "better-sqlite3";
import type { Context } from "hono";
import type { RouteId } from "@temujira/shared";
import type { LoginRateLimiter } from "../auth";
import type { ServerConfig } from "../config";
import type { Db } from "../db";
import type { UserRow } from "../serialize";
import type { LocalStorage } from "../storage";

export type AppEnv = {
  Variables: {
    user?: UserRow;
    authKind?: "cookie" | "bearer";
    sessionId?: string;
    body?: unknown;
    query?: unknown;
  };
};

export type AppContext = {
  db: Db;
  sqlite: Database.Database;
  config: ServerConfig;
  storage: LocalStorage;
  limiter: LoginRateLimiter;
};

export type Ctx = Context<AppEnv>;
export type RouteHandler = (c: Ctx) => Promise<Response> | Response;
export type Handlers = Record<RouteId, RouteHandler>;

/** Validated request body (set by the registry validation middleware). */
export const body = <T>(c: Ctx): T => c.get("body") as T;
/** Validated query params (set by the registry validation middleware). */
export const query = <T>(c: Ctx): T => c.get("query") as T;
/** The authenticated user; only call on auth != public routes. */
export const currentUser = (c: Ctx): UserRow => {
  const u = c.get("user");
  if (!u) throw new Error("currentUser() called on an unauthenticated route");
  return u;
};
