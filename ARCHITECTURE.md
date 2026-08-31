# Temujira — Architecture (v1)

Decided via a 3-architect / 3-judge design panel. The "radical simplicity" architecture won
unanimously; the security and DX grafts the judges mandated are folded in below.

## Shape

One Node process. One SQLite file. One uploads directory. One Docker image. One port.

- **Server**: Node 22 (LTS in Docker; dev on 23 is fine) + **Hono** + zod. Serves the JSON
  API under `/api/v1` **and** the statically-exported Expo web app from the same origin
  (SPA fallback). Dev: `tsx watch`; build: `tsup`.
- **DB**: SQLite via **better-sqlite3**, WAL mode, `busy_timeout=5000`,
  `foreign_keys=ON`, `synchronous=NORMAL`. **Drizzle ORM** with committed SQL migrations,
  auto-applied at boot. Before applying pending migrations to an existing DB, the server
  snapshots it (`db.backup()` → `temujira.db.pre-<version>.bak`, keep last 3).
- **Files**: `$DATA_DIR/uploads/<attachment-ulid>` on the same volume as the DB — backup is
  one directory. `storage.ts` is a tiny put/getStream/stat/delete module (S3 is a post-v1
  swap, not a v1 tax).
- **Web app**: Expo (**SDK 56**, expo-router, `web.output: "single"`) + NativeWind 4.2 +
  Tailwind 3.4 + **react-native-reusables** (scaffolded from its official `minimal`
  template — we inherit the template's version pins verbatim). RNR has **no sidebar**, so
  we port shadcn/ui's sidebar (Provider/Trigger/Menu anatomy, offcanvas collapse) to RN.
  `<PortalHost />` at root (required by RNR overlays).
- **CLI**: `tmj` (commander), built exclusively on `@temujira/client`.
- **Monorepo**: pnpm workspaces, `node-linker=hoisted` (the known-good setting for
  Expo/Metro in pnpm monorepos). No turborepo. Layout:

```
apps/server     Hono API + static web serving + Drizzle + tests
apps/web        Expo app (web-first, native later)
apps/cli        tmj CLI
packages/shared THE CONTRACT: zod entity schemas + typed route registry
packages/client TemujiraClient: one typed method per registry route (fetch; cookie or Bearer)
scripts/        e2e.sh, seed-demo.ts
```

## The parity mechanism (UI ⇔ API ⇔ CLI)

`packages/shared` exports a **route registry**: for every endpoint an entry
`{id, method, path, query/params/body schemas, response schema, auth level}`. Honestly
enforced (no magic claims):

1. The server wires handlers via an exhaustive `Record<RouteId, Handler>` — a missing
   handler is a **compile error**. A two-way test diffs Hono's mounted route table against
   the registry (catches stray extra routes, not just gaps).
2. `packages/client` exposes one typed method per route id; web and CLI import **only** the
   client. A test greps `apps/web` and `apps/cli` sources for raw `fetch(` and fails if found.
3. `parity.test.ts`: every registry id must be claimed by ≥1 CLI command's declared route
   ids, and the client must export a method per id.
4. An **authz-matrix test** iterates every registry route asserting anonymous → 401,
   member-on-admin-route → 403, revoked key → 401. An unprotected route fails by default.
5. `/api/v1/openapi.json` is emitted from the registry at boot (zod → JSON Schema) for
   agent self-discovery. The registry, not OpenAPI, is the source of truth.

Contract amendments during the build go through the orchestrator only (single owner);
implementation agents report needed changes rather than editing `packages/shared`.

## Auth

- **Passwords**: Node built-in `crypto.scrypt`, N=2^15, r=8, p=1 (maxmem raised to 64MB),
  per-user 16-byte salt, stored as `scrypt:N:r:p:salt:hash`. No native bcrypt dep.
- **Sessions**: opaque 32-byte token, prefix `tms_`; DB stores SHA-256(token). HttpOnly
  SameSite=Lax cookie for the browser; the login response **also returns the token** so
  native apps (and anyone) can use it as a Bearer credential — no auth redesign for mobile.
  30-day sliding expiry.
- **API keys**: `tmj_` + 40 hex chars; DB stores SHA-256 + first-12-chars display prefix;
  full token shown exactly once. Create/list/revoke; admins can mint keys for agent users.
- One middleware accepts cookie, `Bearer tms_…`, or `Bearer tmj_…` and yields the same
  `ctx.user`. Deactivated user ⇒ everything refused.
- **CSRF**: cookie-authed mutations require an Origin header whose host matches
  `Host`/`X-Forwarded-Host` (proxy-aware, no BASE_URL config). Bearer-authed requests are
  exempt. One shared dev-origins constant feeds both the dev CORS middleware and the
  Origin check. Cookie `Secure` flag: on when the request is https (direct or
  `X-Forwarded-Proto`), overridable via `COOKIE_SECURE`.
- **Login rate limit**: in-memory, 10 attempts / 15 min per IP+email.
- **Roles**: global `admin` | `member` (no per-workspace membership in v1 — every member
  sees every workspace; stated in README as a design decision). Guards: cannot deactivate
  or demote the last active admin.
- **Agent accounts**: ordinary users with `is_agent=1` and `password_hash NULL` (web login
  structurally refused — API keys only). `tmj user create --agent` + admin key-minting is
  the agent onboarding path.
- **First run**: `GET /api/v1/setup` → `{needsSetup}`; `POST /api/v1/setup` creates the
  first admin then self-disables (403 forever after). Also honored at boot:
  `TEMUJIRA_ADMIN_EMAIL`/`TEMUJIRA_ADMIN_PASSWORD` env for headless provisioning. Setup
  seeds a "Getting started" workspace with a welcome task so first render is never empty.

## Data model

TEXT ULID PKs, INTEGER unix-ms timestamps, INTEGER 0/1 booleans.

- **users**: email (unique, lowercased), name, password_hash (NULL = agent, no web login),
  role CHECK in (admin, member), is_agent, deactivated_at, timestamps.
- **sessions**: user_id FK, token_hash (unique), expires_at, last_seen_at.
- **api_keys**: user_id FK, name, token_hash (unique), token_prefix, last_used_at,
  revoked_at, created_at.
- **workspaces**: name, key (unique, `[A-Z]{2,6}`), next_task_number, archived_at,
  timestamps. No hard delete — archive only. Ordered by created_at (no manual reorder in v1).
- **statuses**: workspace_id FK, name (unique per workspace), color (hex), **position
  INTEGER** — reorder is a full-array `PUT` of ordered ids (no fractional floats, no
  drift). New workspace seeds Backlog / In Progress / Done. Deleting a status with tasks
  requires `move_to` (else 409).
- **tasks**: workspace_id FK, number (unique per workspace, from `next_task_number` in the
  same transaction), title, description (markdown), status_id FK, assignee_id FK NULL,
  archived_at, created_by, timestamps. Display key `TEM-42`; task endpoints accept ULID or
  key. No manual position — list sorts by created_at/updated_at/number. Archive only.
- **comments**: task_id FK, author_id, body (markdown), timestamps. Hard-delete allowed
  (author or admin); deletes its attachments' bytes too.
- **attachments**: exactly-one-parent CHECK (task_id XOR comment_id), uploader_id,
  filename, mime_type, size, **sha256**, created_at. Bytes at `uploads/<id>`, never in DB.

Deletion is crash-consistent: DB row first (transaction), unlink after commit; a startup
sweep removes upload files with no DB row.

## API

Plain REST under `/api/v1`, ~34 endpoints (meta/setup, auth, api-keys, users, workspaces,
statuses incl. reorder, tasks, comments, attachments — the registry is the authoritative
list). `{items, total, limit, offset}` pagination (limit ≤ 200); errors
`{error: {code, message, details?}}` with a fixed code set; ULIDs; `:idOrKey` accepts
`TEM-42`. **Uploads**: streaming multipart via busboy, hard byte-cap abort mid-stream
(plus Content-Length preflight), temp-file-then-rename, `MAX_UPLOAD_MB` default 50.
**Downloads**: authenticated stream, `X-Content-Type-Options: nosniff` always,
`Content-Disposition: attachment` for everything except an inline safelist (`image/*`
minus SVG, `application/pdf`) — closes stored-XSS-via-uploaded-HTML on the cookie origin.

## CLI

`tmj` — global flags `--json` (auto-on when stdout isn't a TTY), `--quiet` (ids only),
`--url`, `--api-key`. Env `TEMUJIRA_URL` + `TEMUJIRA_API_KEY` beat
`~/.config/temujira/config.json` (written by `tmj auth login`). Exit codes: 0 ok,
1 server/network, 2 usage, 3 auth (401/403), 4 not found, 5 validation/conflict.
Command groups mirror the API 1:1 (setup, auth, me, apikey, user, workspace, status, task,
comment, attach) plus conveniences that stay pure-API: `--assignee me|email`,
`--status <name>`, `tmj user create --agent --with-key` (create agent + mint key in one
go), `tmj attach download` verifies sha256, and **`tmj api <method> <path> [--body]`** — a
gh-style raw escape hatch guaranteeing a parity floor forever.

## Deployment

- **Dev**: `pnpm dev` → server :3000 (tsx watch) + Expo dev server :8081 with
  `EXPO_PUBLIC_API_URL=http://localhost:3000`; server enables credentialed CORS for the
  dev origin only in development.
- **Prod**: multi-stage Dockerfile (pnpm install → build server+cli → `expo export
  --platform web` → node:22-slim runtime with a build-time
  `node -e "require('better-sqlite3')"` smoke check). `docker-compose.yml`: one service,
  `3000:3000`, `./data:/data`. The client defaults to **same-origin relative** `/api/v1`
  when no URL is configured, so the image works on any domain. The CLI ships inside the
  image (`docker compose exec app tmj …`). README documents the Caddy/nginx reverse-proxy
  snippet and live-backup commands (`sqlite3 .backup` / `VACUUM INTO`, not raw file copy).
  No Kubernetes.

## Verification (v1 acceptance)

1. Vitest integration suite in `apps/server` (in-process `app.request` against temp DBs):
   auth flows, RBAC, per-resource CRUD, status-delete-with-move, attachment round-trip
   with checksum, last-admin guards, rate limit.
2. Parity + authz-matrix + two-way route-diff + no-raw-fetch tests (registry-driven).
3. `scripts/e2e.sh`: build image → compose up → drive the **real CLI** through the full
   narrative (setup → key → workspace → statuses → tasks → assign → comment → upload →
   download+checksum → archive) with jq asserts.
4. Playwright web smoke: setup → login → create task → see it in the list, plus a
   screenshot pass over every screen.
5. Adversarial multi-agent code review before ship.
