import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AuthLevel } from "@temujira/shared";
import type { ServerConfig } from "./config";
import type { Db } from "./db";
import { apiKeys, sessions, users } from "./db/schema";
import { forbidden, unauthorized, HttpError } from "./errors";
import type { UserRow } from "./serialize";
import { newId, now } from "./util";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// ---------- password hashing (Node built-in scrypt; zero native deps) ----------

const SCRYPT_N = 32768; // 2^15
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex!, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex!, "hex"), expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: SCRYPT_MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- tokens ----------

export const SESSION_COOKIE = "tmj_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const SESSION_RENEW_AFTER_MS = 60 * 60 * 1000; // refresh sliding expiry at most hourly

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export const newSessionToken = () => `tms_${randomBytes(32).toString("hex")}`;
export const newApiKeyToken = () => `tmj_${randomBytes(20).toString("hex")}`;

// ---------- login rate limiting (in-memory) ----------

const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export class LoginRateLimiter {
  private failures = new Map<string, { count: number; resetAt: number }>();

  assertAllowed(key: string): void {
    const entry = this.failures.get(key);
    if (entry && entry.resetAt > now() && entry.count >= LOGIN_MAX_FAILURES) {
      throw new HttpError("rate_limited", "too many failed login attempts; try again later");
    }
  }

  recordFailure(key: string): void {
    const t = now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= t) {
      this.failures.set(key, { count: 1, resetAt: t + LOGIN_WINDOW_MS });
    } else {
      entry.count++;
    }
    // Opportunistic prune so the map cannot grow unboundedly.
    if (this.failures.size > 10_000) {
      for (const [k, v] of this.failures) if (v.resetAt <= t) this.failures.delete(k);
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

// ---------- sessions ----------

export function createSession(db: Db, userId: string): { token: string; sessionId: string } {
  const token = newSessionToken();
  const t = now();
  const sessionId = newId();
  db.insert(sessions)
    .values({
      id: sessionId,
      userId,
      tokenHash: sha256hex(token),
      expiresAt: t + SESSION_TTL_MS,
      createdAt: t,
      lastSeenAt: t,
    })
    .run();
  return { token, sessionId };
}

export function destroySession(db: Db, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

function isSecureRequest(c: Context, config: ServerConfig): boolean {
  if (config.cookieSecure !== undefined) return config.cookieSecure;
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  return proto === "https";
}

export function setSessionCookie(c: Context, config: ServerConfig, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure: isSecureRequest(c, config),
  });
}

export function clearSessionCookie(c: Context, config: ServerConfig): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecureRequest(c, config) });
}

// ---------- authentication ----------

export type AuthKind = "cookie" | "bearer";

export interface AuthResult {
  user: UserRow;
  kind: AuthKind;
  sessionId?: string;
}

function verifySessionToken(db: Db, token: string): { user: UserRow; sessionId: string } | null {
  const t = now();
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, sha256hex(token)))
    .get();
  if (!row) return null;
  if (row.session.expiresAt <= t) {
    db.delete(sessions).where(eq(sessions.id, row.session.id)).run();
    return null;
  }
  if (t - row.session.lastSeenAt > SESSION_RENEW_AFTER_MS) {
    db.update(sessions)
      .set({ lastSeenAt: t, expiresAt: t + SESSION_TTL_MS })
      .where(eq(sessions.id, row.session.id))
      .run();
  }
  return { user: row.user, sessionId: row.session.id };
}

function verifyApiKey(db: Db, token: string): UserRow | null {
  const t = now();
  const row = db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.tokenHash, sha256hex(token)))
    .get();
  if (!row || row.key.revokedAt !== null) return null;
  if (row.key.lastUsedAt === null || t - row.key.lastUsedAt > 60_000) {
    db.update(apiKeys).set({ lastUsedAt: t }).where(eq(apiKeys.id, row.key.id)).run();
  }
  return row.user;
}

export function authenticate(c: Context, db: Db): AuthResult | null {
  const authz = c.req.header("authorization");
  if (authz) {
    const m = /^Bearer\s+(.+)$/i.exec(authz.trim());
    if (!m) return null;
    const token = m[1]!;
    if (token.startsWith("tmj_")) {
      const user = verifyApiKey(db, token);
      return user ? { user, kind: "bearer" } : null;
    }
    if (token.startsWith("tms_")) {
      const res = verifySessionToken(db, token);
      return res ? { user: res.user, kind: "bearer", sessionId: res.sessionId } : null;
    }
    return null;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) {
    const res = verifySessionToken(db, cookie);
    return res ? { user: res.user, kind: "cookie", sessionId: res.sessionId } : null;
  }
  return null;
}

// ---------- CSRF (cookie-authed mutations only) ----------

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function assertOriginAllowed(c: Context, config: ServerConfig): void {
  const origin = c.req.header("origin");
  if (!origin) {
    throw forbidden("cross-site request blocked: missing Origin header (use a Bearer token for scripts)");
  }
  if (config.devOrigins.includes(origin)) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("cross-site request blocked: invalid Origin");
  }
  const requestHost = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (!requestHost || originHost.toLowerCase() !== requestHost.toLowerCase()) {
    throw forbidden("cross-site request blocked: Origin does not match this host");
  }
}

// ---------- middleware ----------

export function requireAuth(level: Exclude<AuthLevel, "public">, db: Db, config: ServerConfig): MiddlewareHandler {
  return async (c, next) => {
    const result = authenticate(c, db);
    if (!result) throw unauthorized();
    if (result.user.deactivatedAt !== null) throw unauthorized("account is deactivated");
    if (level === "admin" && result.user.role !== "admin") throw forbidden("admin role required");
    if (result.kind === "cookie" && MUTATING.has(c.req.method)) assertOriginAllowed(c, config);
    c.set("user", result.user);
    c.set("authKind", result.kind);
    c.set("sessionId", result.sessionId);
    await next();
  };
}
