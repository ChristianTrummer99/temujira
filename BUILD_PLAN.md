# Temujira — Build Plan (v1)

Execution plan for the AI-agent build session. Serialization point: `packages/shared` (the
contract). Single contract owner: the orchestrator. Implementation agents never edit
`packages/shared` — they report needed amendments.

## Phase 0 — Foundation + contract (orchestrator, sequential)

1. Monorepo scaffold: root package.json, pnpm-workspace.yaml, `.npmrc`
   (`node-linker=hoisted`), tsconfig.base.json, all four package manifests with complete
   dependency lists (so later phases need no conflicting installs). One `pnpm install`.
2. `packages/shared` complete: entity schemas, error codes, full route registry (~34
   routes) — checked against SPEC.md FR-01…FR-23 before fan-out.
3. `packages/client`: generic typed caller + per-route methods, cookie/Bearer modes,
   same-origin default base URL.
4. `apps/server` core: Drizzle schema + initial migration, boot (pragmas, backup-then-
   migrate, env-admin seed, orphan sweep), auth.ts (scrypt, sessions, API keys, unified
   middleware, Origin check, rate limiter), error envelope, health/setup/auth/openapi
   routes, exhaustive-Record mounting. Vitest proves setup → login → me → API key round-trip.

Parallel with 0.2–0.4: **web-scaffold agent** (independent of contract): RNR `minimal`
template scaffolded standalone in scratch → `expo export --platform web` verified →
moved into `apps/web` → metro monorepo config → export verified again → `add` the needed
RNR components → port the shadcn sidebar to RN → app shell with placeholder screens.
Toolchain risk is burned down before any feature UI exists.

## Phase 1 — Parallel build (3 agents, frozen contract)

- **Server agent** (`apps/server` only): remaining route files — users, api-keys,
  workspaces (status seeding), statuses (reorder endpoint, delete-with-move), tasks
  (KEY-42 resolution, counter txn, filters), comments, attachments (busboy streaming,
  storage.ts, hardened download) — with per-resource vitest integration tests + the
  authz-matrix + route-diff tests.
- **CLI agent** (`apps/cli` only): full command tree over `@temujira/client`, config/env
  resolution, --json/--quiet, exit codes, `tmj api` escape hatch, parity.test.ts.
- **Web agent** (`apps/web` only): setup/login screens, sidebar wiring (workspaces,
  archived section, user menu), task list (stacked rows, filters, inline status/assignee),
  task detail (markdown via platform-split renderer — react-markdown on web; comments;
  attachments upload/download), settings (profile, API keys, users admin, status editor
  with create/rename/recolor/reorder/delete-with-move, workspace archive).

## Phase 2 — Integration + ship (sequential)

1. Dockerfile (multi-stage, better-sqlite3 smoke check), docker-compose.yml, static
   serving + SPA fallback, CLI in image.
2. `scripts/e2e.sh` full CLI narrative against the built image; Playwright web smoke +
   screenshot pass per screen.
3. README: compose quickstart, reverse-proxy snippet, backup commands, agent onboarding,
   CLI reference, design decisions (SQLite-on-purpose, global roles).

## Phase 3 — Adversarial verification

Multi-agent review workflow (correctness, security, parity, spec-fidelity lenses) →
verified findings fixed → e2e + Playwright re-run green. Acceptance = SPEC.md v1 list
checked off, `scripts/e2e.sh` exit 0, web smoke green.
