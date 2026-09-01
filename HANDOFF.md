# Temujira — Feature Handoff Document

**For the next AI agent.** Read this fully before touching anything. verify every claim against the working tree — code drifts. Where this doc and the code disagree, **the code wins**; reconcile and update this doc.

---

## ⚠️ STATUS UPDATE (2026-09-01) — read this before §3

A later fleet verified this document against the tree and corrected it. Where this section
and the rest of the doc disagree, **this section wins**.

**Corrections to §0/§3 ("client/CLI/web NOT done at all"):**

- **`packages/client` is DONE and green.** All 9 new routes have typed methods and
  `ROUTE_METHOD_MAP` entries (tags×4, `tasks.mine`, `users.search`, `activity.list`,
  `inbox.list`, `inbox.update`), plus `tag_ids` on task create/update and the threaded
  comment inputs. Do not re-add them.
- **The CLI is DONE and green — 47/47 tests including parity.** Every route id maps to a
  command: `tmj tag list|create|update|delete`, `tmj user search`, `tmj task mine`,
  `tmj activity list`, `tmj inbox list|read`, plus `--tag`/`--group-by` on task commands and
  `--reply-to`/`--question`/`--answer`/`--mention` on `tmj comment add`.
- **The web app was already wired to the real API** by the prior fleet (login, setup,
  sidebar, workspace picker, task list, task detail, all four settings screens). It is NOT
  running on placeholder data; `lib/placeholder-data.ts` is orphaned. Auth is **Bearer
  token** (`lib/auth.tsx`, `localStorage` key `temujira.session_token`), not cookies.
  See `WEB_PLAN.md` for the remaining feature-UI spec.

**Bugs this doc missed (all fixed):**

1. **`/users/search` was unreachable.** It was declared *after* `/users/:id` in the
   registry; routes mount in `ROUTE_IDS` order and Hono dispatches by registration order, so
   the param route captured it and search 404'd. `users.search` now precedes `users.get`.
   (`tasks.mine` was already correctly ahead of `tasks.get`.)
2. **`engagement.ts` did not compile** — `inboxItems.userId.eq(...)` is not a Drizzle API;
   replaced with `and(eq(...), eq(...), eq(...))` + `.get()`.
3. **Self-referential `comments` table** (§7.5's cousin) — the `parentId → comments.id` FK
   needs `references((): AnySQLiteColumn => comments.id)`. **Type-only fix: do NOT
   regenerate migrations**; the journal must stay `[0000_flashy_the_fallen, 0001_lying_sentry]`.
4. **`comments.delete` must clean up FK dependents.** `foreign_keys=ON` is live and there is
   no `ON DELETE CASCADE`: deleting a comment requires removing `mentions`, `inbox_items`
   (by `sourceCommentId`), NULLing `inbox_items.parentCommentId`, and attachments, then
   deleting replies **before** the root (SQLite checks immediate FKs per row).
5. **Web attachment downloads were unauthenticated** — a bare `<a href>` to the API sends no
   Bearer header. Downloads must go through `client.downloadAttachment()` → blob → object URL.

**Corrections to §7.2/§7.3:** `commentToApi`'s 5th param `replyTo` is dead (accepted but
never emitted — the shared `Comment` type has no `reply_to` field); never pass it. And no
existing server test needed rewriting for threading: none of them create a reply, so roots
still appear flat at top level and the added fields don't break assertions.

---

## 0. One-minute context

Temujira is a self-hosted JIRA-like project tracker for **humans and agents**, with three first-class UIs that must stay feature-parity-equal:

- **Web app** — Expo/React-Native-for-web, route files under `apps/web/app/(app)/`.
- **REST API** — Hono, all routes declared in ONE registry (`packages/shared/src/routes.ts`) and auto-mounted in `apps/server/src/app.ts`. The registry is the contract.
- **CLI** — `apps/cli/src/commands/`, one command per route id.

The current feature build adds: **(1)** per-workspace admin-managed tags + group-by, **(2)** per-user activity feed with catch-all task associations, **(3)** a unified cross-workspace **Inbox** for `@`-mentions and comment replies, **(4)** `@`-mention autocomplete rendered as **clickable links**, **(5)** multiple-choice questions on comments answered via **child replies**, and **(6)** a `tasks.mine` endpoint.

The **data layer is DONE** (schema + single migration + shared entities + full route registry). The **application layer is HALF DONE**. The **client/CLI/web layers are NOT done at all.**

**Shared compiles NOW (`pnpm --filter @temujira/shared typecheck` is green).** The self-referential `CommentSchema` was fixed by giving it an explicit `z.ZodType<Comment>` annotation with a separately-declared `Comment` type (see `entities.ts`). Before doing anything else, run `pnpm -r typecheck` — `packages/shared` should pass; the **server will still be red** (broken `taskToApi`/`commentToApi` call sites, unmounted handlers), which is the TODO list in §3.

---

## 1. How the contract (parity) is enforced — DO NOT BREAK THIS

- `packages/shared/src/routes.ts` exports `ROUTES` (THE single source of truth) plus `RouteId`, `ROUTE_IDS`, `buildPath`.
- `apps/server/src/app.ts` iterates `ROUTE_IDS` and auto-mounts each with auth middleware + request validation. Handlers live in `apps/server/src/routes/*.ts`, each file exporting `xxxHandlers(ctx): Pick<Handlers, "a.b"|"c.d">`, spread into the `handlers: Handlers` record at `app.ts:79-90`. **Every `RouteId` MUST have a handler or the `Handlers` record is incomplete and TS errors.**
- `packages/client/src/index.ts` has `ROUTE_METHOD_MAP` (routeId → HTTP method) plus typed client methods. Route-parity test `apps/server/test/route-parity.test.ts` diffs shared registry ⇔ mounted routes. Add a route without a client method/map entry → mismatch.
- CLI: `apps/cli/src/commands/` — mechanism is **explicit, not automatic**; an exhaustive route-id→command map must be extended by hand.

**Adding a feature = touching 5 places: shared registry → server handler → server serialize → client (map+method) → CLI command.**

---

## 2. The clarifying decisions the USER locked in (honor these exactly)

1. **Inbox = Unified, CROSS-WORKSPACE.** One top-level nav item ("Inbox") aggregating mention + reply events from *all* workspaces. NOT per-workspace.
2. **Question model:** the `question` lives on a comment; a user **answers by posting a child reply**. This **requires reply-style comments with exactly ONE level of depth** (Slack-style thread: a reply to a reply is coerced to reply to the ROOT).
3. **Mention syntax = autosuggest:** user types `@`, a picker filters users, resolved to user **id** on post. Store resolved ids (client sends `mention_ids`); also keep display text for rendering.
4. **Tag permissions = GLOBAL ADMIN only** (create/rename/delete/color). NOT member-creatable (different from statuses, which any member can create).
5. **"All ticket mentions should be rendered as clickable links"** — mention chips/links in comment bodies AND task descriptions must be clickable (navigate to that task / open that user).

---

## 3. Current state — DONE vs TODO (accurate as of writing; re-verify)

### ✅ DONE — data layer
- **`apps/server/src/db/schema.ts`**: all tables added — `mentions`, `inboxItems`, `tags`, `taskTags` (many-to-many, no id column, composite), `taskAssociations` (composite PK `(taskId,userId)` + `associatedAt`), `activityEvents` (append-only), and `comments` extended with `parentId`, `questionOptions` (JSON string array), `answerOptionIndex`. **Exact column names (camelCase) are listed in §5 — copy them exactly.**
- **Migration**: single clean `apps/server/src/db/migrations/0001_lying_sentry.sql`; journal has only `0000_…` + `0001_lying_sentry`. Migrations auto-apply at startup via `src/db/index.ts`. (To regenerate fresh, see §9 last bullet.)
- **`packages/shared/src/entities.ts`**: `TagSchema`+`Tag`, `ActivityEventSchema`+`ActivityEvent`, `InboxItemSchema`+`InboxItem`; `tag_ids` on Create/UpdateTaskInput; `tags: z.array(TagSchema)` on TaskSchema; `parent_id`/`question`/`replies`/`CommentSchema` (self-ref via `z.lazy`); comment input schemas with `parent_id`, `question_options`, `answer_option_index`, `mention_ids`; query schemas `ListTagsQuerySchema`, `ListActivityQuerySchema` (with `mine`), `ListMyTasksQuerySchema`, `MentionSearchQuerySchema`, `ListInboxQuerySchema`, `UpdateInboxQuerySchema`; `TASK_GROUP_FIELDS = ["none","status","tag","assignee"]`; `ListTasksQuerySchema` gained `tag_id` + `group_by`.
- **`packages/shared/src/routes.ts`**: ALL new routes registered — `tags.list/create/update/delete`, `tasks.mine`, `users.search`, `activity.list`, `inbox.list`, `inbox.update`. (Verified present in §4.)

### ✅ DONE — server partial
- **`apps/server/src/serialize.ts`**: imports updated (+`ActivityEvent`, `InboxItem`, `Tag`, new tables); `TagRow`/`ActivityEventRow`/`InboxItemRow` type aliases; `tagToApi()`; `taskToApi()` **now takes `tagRows?: TagRow[]`** (new 5th positional arg, `attachmentRows` moved to 6th) and always emits `tags`; `commentToApi()` rewritten with `parent_id`, `question`, `replies`, and optional `replyTo`; added `activityEventToApi()` and `inboxItemToApi()`.
- **`apps/server/src/routes/engagement.ts`**: NEW file. Central side-effect helper:
  - `findMentionTokens(body)` — regex extractor for `@Name` tokens.
  - `resolveMentions(db, tokens)` — resolve tokens to active `UserRow`s (case-insensitive exact name).
  - `associate(db, taskId, userIds, t?)` — idempotent insert into `taskAssociations`.
  - `recordActivity(db, {workspaceId, taskId?, actorId, action, metadata?})`.
  - `pushInbox(db, {userIds, workspaceId, taskId, actorId, kind:"mention"|"reply", sourceCommentId, parentCommentId})` — dedupes per (user,kind,sourceComment), skips self-notify. **NOTE: `resolveMentions` does a full table scan; acceptable for now.**
- **`apps/server/src/routes/tagsRoutes.ts`**: NEW file, complete. `tagsHandlers(ctx)` covering all 4 tag routes, mirroring `statusesRoutes.ts` style. Requires mounting.
- **`apps/server/src/routes/engagement.ts` was simplified**: `taskContextByIds` and the `tasks`/`inArray` imports were removed. Re-verify it compiles cleanly (I removed the helper to avoid a half-baked join).

### ❌ TODO — server (the bulk of remaining work)
1. **Mount** `tagsHandlers` **and** the new `activityHandlers`, `inboxHandlers`, plus new `users.search` + `tasks.mine` in `app.ts` (`...tagsHandlers(ctx), ...` etc).
2. **`apps/server/src/routes/usersRoutes.ts`**: add `users.search` handler (active users only, match name OR email substring, ordered, `limit`).
3. **`apps/server/src/routes/tasksRoutes.ts`**:
   - `tasks.create` / `tasks.update`: handle `tag_ids` (validate each tag belongs to workspace; **replace** the full tag set in `task_tags`). `tasks.create` must also `associate(task, [creator]); recordActivity("task.created")`. `tasks.update` → `recordActivity("task.updated")` on meaningful change.
   - `tasks.update` `tag_ids` → recordActivity maybe `task.tags_updated`.
   - Add **`tasks.mine`** handler: tasks the current user is associated with (JOIN `taskAssociations`), sorted by association recency, `limit`/`offset`, returns `{items,total,limit,offset}`.
   - Update `taskToApi` call sites to pass tag rows (`tagRows`) so `tags` is populated. Look at all `taskToApi(...)` call sites in tasksRoutes.ts (there are several) and pass `tags` for that task. Consider a small helper `loadTagsForTasks(db, taskIds): Map<taskId, TagRow[]>`.
   - `tasks.list`: honor `tag_id` filter (subquery/join `task_tags`) and `group_by` param (it's a **client hint** — server still returns flat list, so `group_by` can be ignored server-side, but `tag_id` MUST filter).
4. **`apps/server/src/routes/commentsRoutes.ts`** — the most complex piece:
   - `comments.create`: support `parent_id` (one-level depth: **if the parent is itself a reply (parentId != null), coerce parent to the parent's `parentId`** — i.e. reply-to-root); support `question_options` (root comment becomes a question — only allowed on a root comment, i.e. parent must be null); support `answer_option_index` (a reply may cast a vote into its parent question — only valid if the parent is a question comment; store `answerOptionIndex` on the reply and set the parent's `answerOptionIndex` too if answering); support `mention_ids` → insert `mentions` rows, `associate` each mentioned user, `pushInbox(mention)` for each mentioned user, `recordActivity("comment.mentioned")`; on any reply → `associate` the parent's author (if different), `pushInbox(reply)` if the parent author != current user, `recordActivity("comment.replied")`; always `associate` current user + `recordActivity("comment.created")` for a root comment.
   - `comments.list`: **implement threading** — return root comments only at the top level, with each root's replies nested in `replies` (oldest first). Replies (parentId != null) must NOT appear at top level. Populate `replies` via `commentToApi` recursion. Also embed each comment's `question`/`answer_option_index`.
   - `comments.update`: honor `question_options` (nullable optional).
   - Watch the `commentToApi` signature change (now takes `replies` + `replyTo`). **The existing `comments.list`/`comments.update`/`comments.delete` handlers MUST be rewritten to compile against the new signature and new CommentRow fields (`parentId`, `questionOptions`, `answerOptionIndex`).**
5. **`apps/server/src/serialize.ts`** — verify `inboxItemToApi` compiles: it references `workspaceToApi`, and takes `(item, actor, workspace, task, workspaceKey, sourceComment, parentComment)`. `activityEventToApi(e, actor, task?)` where task is `{key?,title?}`. The `Hello` helpers (`parseJsonRecord`, `asStringArray`) are defined. Then build the **route handlers that JOIN the needed rows** for activity + inbox serialization (resolve actor, workspace, task+key, comment+author+attachments). Reuse a shared helper to serialize a comment WITH its author + attachments + replies.
6. **`apps/server/src/routes/activityRoutes.ts`** (NEW): `activity.list` — workspace feed, newest first; `?mine=1` filters to current user's associated tasks. JOIN actor + task (key/title). `limit`/`offset`. (Note: `task_key` needs the workspace key, which you can get via the workspace row or by grouping. Task keys live in `workspaces.key` + `tasks.number`; simplest is to JOIN workspaces once.)
7. **`apps/server/src/routes/inboxRoutes.ts`** (NEW): `inbox.list` — current user's rows, newest first, optional `include_read`, `limit`/`offset`, returns `{items, unread, total, limit, offset}` where `unread` counts rows with `readAt == null`. **Join `workspaces`, `tasks`, actor user, and serialize `source_comment` + `parent_comment` (with authors+attachments).** `inbox.update` — `?mark_read=1` sets `readAt` on current user's unread rows, returns `{ok:true, updated}`.
8. Run `pnpm -r typecheck` and fix the `packages/shared` error first, then server errors. Everyone compiles before moving on.

### ❌ TODO — client, CLI, web (all not started)
- **`packages/client/src/index.ts`**: add `ROUTE_METHOD_MAP` entries for the new routes + typed methods (tags.*, activity.list, inbox.list, inbox.update, tasks.mine, users.search).
- **`apps/cli/src/commands/`**: add commands mapping each new route id (parity). Follow existing command style.
- **Web** (`apps/web/app/(app)/`): See §6.

---

## 4. Exactly what's registered (verify, then contract to these)

From `packages/shared/src/routes.ts` (currently present):

| route id | method | path | auth | extra |
|---|---|---|---|---|
| users.search | GET | `/users/search` | user | query MentionSearchQuerySchema → listOf(UserSchema) |
| tags.list | GET | `/workspaces/:idOrKey/tags` | user | query ListTagsQuerySchema → listOf(TagSchema) |
| tags.create | POST | `/workspaces/:idOrKey/tags` | **admin** | body CreateTagInputSchema → {tag} |
| tags.update | PATCH | `/tags/:id` | **admin** | body UpdateTagInputSchema → {tag} |
| tags.delete | DELETE | `/tags/:id` | **admin** | → {ok} |
| tasks.mine | GET | `/tasks/mine` | user | query ListMyTasksQuerySchema → {items,total,limit,offset} |
| activity.list | GET | `/workspaces/:idOrKey/activity` | user | query ListActivityQuerySchema → listOf(ActivityEventSchema) |
| inbox.list | GET | `/inbox` | user | query ListInboxQuerySchema → {items, unread, total, limit, offset} |
| inbox.update | POST | `/inbox/read` | user | query UpdateInboxQuerySchema → {ok, updated} |

Note the path `inbox.update` is POST `/inbox/read` (a verb-ish path even though it's the `.update` id). Keep it.

---

## 5. Exact schema column names (copy these into queries/inserts)

`comments`: `id, taskId, parentId, authorId, body, questionOptions, answerOptionIndex, createdAt, updatedAt`
- `parentId` null = root. One level of depth.
- `questionOptions` = JSON string array (or null). When set, comment is a question.
- `answerOptionIndex` = int, on a REPLY that cast a vote into its parent question.

`mentions`: `id, commentId, taskId, mentionedId, byId, createdAt`

`inboxItems`: `id, userId, workspaceId, taskId, actorId, kind, sourceCommentId, parentCommentId, readAt, createdAt`
- `kind` is a raw text column storing `"mention" | "reply"` (set by code).

`tags`: `id, workspaceId, name, color, createdAt` — unique `(workspaceId, name)`.

`taskTags`: `taskId, tagId` (NOT NULL both; no PK; index on both). **No id column.**

`taskAssociations`: `taskId, userId, associatedAt` — composite PK `(taskId,userId)`.

`activityEvents`: `id, workspaceId, taskId, actorId, action, metadata (JSON str, default "{}"), createdAt`.

`tasks` unchanged, but remember `number`, `key` is derived (`workspaces.key` + `-` + `tasks.number`).

`workspaces`: has `key`, `nextTaskNumber`.

---

## 6. Web layer plan (apps/web/app/(app)/) — build AFTER server+client+CLI are green

Route files live under `apps/web/app/(app)/`; top-level `index.tsx` = "Pick a workspace" overview. Actual nav/UI routes map from registry ids (e.g. a tasks view under `w/[key]/`).

- **TopBar/Sidebar** in `apps/web/app/(app)/_layout.tsx` currently has a `SidebarFooter` user dropdown. **Add two top-level nav items: "Inbox" and "Activity"/"My tasks".** Keep workspace picker too.
- **Unified Inbox screen** (top-level): list `inbox.list` items across workspaces; each shows workspace badge, task key/title (link → that task in its workspace), actor, source comment, `read`/`unread` state; a "Mark all read" button calls `inbox.update`; group/list mentions vs replies. Clicking a task opens that task.
- **Workspace task list** (`w/[key]/index.tsx`): add a **group-by control** (none / status / tag / assignee) that groups the task tiles client-side (server returns flat with `group_by` hint); render task tags as small colored pills; an admin-only tags manager (`tags.list/create/update/delete`) — probably a settings subview or a modal.
- **Ticket tray** (`w/[key]/t/[num].tsx`):
  - **@mention autocomplete** in the comment composer AND the description composer: on `@`, query `users.search`, show a picker, insert resolved mention.
  - **Render mentions as clickable chips/links.** Link a user mention → user profile; if the body references a task key (e.g. `TEM-42`) → make it a link to that task.
  - **Question/answer UI:** a comment with `question.options` shows inline multiple-choice buttons; clicking one posts a child reply with `answer_option_index`. In inbox, options render inline; in the ticket view, render attachment-style/under the comment. Show answered state (the parent's `answerOptionIndex`).
  - **Reply threading:** each comment gets a "Reply" affordance; replies render nested under the root (one level). Replying to a reply targets the root.
- **Activity view** (`/workspaces/:key/activity`): `activity.list` feed rows ("X created TEM-42", "Y assigned …", "…mentioned you", "…replied"), newest first, with a "mine" toggle (`?mine=1`). Rows link to the task.

---

## 7. Deviation caveats / gotchas (READ — these caused pain)

1. **`taskToApi` signature changed** — `attachmentRows` moved from 5th to 6th param, `tagRows` is 5th. Every call site must be updated. `TaskSchema.tags` is REQUIRED (not optional), so you can't skip it.
2. **`commentToApi` signature changed** — now `commentToApi(c, author, attachmentRows, replies?, replyTo?)`. The existing `comments.list/update/delete` handlers won't compile until rewritten. For `comments.update`/`comments.delete` you must re-serialize with the comment's replies too, or at least a valid empty/`replyTo` value — decide and be consistent.
3. **Comment threading semantics:** top-level of `comments.list` = roots only; replies nested in `replies`. Read-only consumers (old tests) may expect a flat list — **update any tap/route tests** accordingly.
4. **`engagement.ts`** has no tests; the `pushInbox` self-notify-skip and dedupe logic is subtle. Write a server route-parity-preserving test at minimum, ideally a behavioral test for mention→inbox and reply→inbox.
5. **`z.lazy` self-referential `CommentSchema` — RESOLVED.** `z.lazy` alone triggers TS7022/TS7024 (implicit-any through self-reference). The working fix is now in `entities.ts`: a separately-declared structural `Comment` type + `export const CommentSchema: z.ZodType<Comment> = z.object({ … replies: z.lazy(() => z.array(CommentSchema)) … })`. Do NOT revert this. If you extend `Comment`, extend the `Comment` type AND the schema together.
6. **Route-parity test** (`apps/server/test/route-parity.test.ts`) enforces shared registry ⇔ mounted handlers two-way. If you add a route id but forget the handler spread in `app.ts`, it fails. Similarly the client `ROUTE_METHOD_MAP` and CLI map must cover all ids.
7. **`ListTasksQuerySchema`** has `tag_id` and `group_by` — the server must filter by `tag_id` (JOIN `taskTags`). `group_by` is informational.
8. The `inbox.update` id is POST; `UpdateInboxQuerySchema` uses `QueryBoolSchema` for `mark_read`.
9. **Mentions in descriptions vs comments:** the user wants mentions clickable in BOTH. Decide where mention resolution is applied: description edits don't currently have a `mention_ids` field (only `comments.create` does, per the input schemas). If you want description mentions to notify, you'd need to extend `CreateTaskInputSchema`/`UpdateTaskInputSchema` + the routes registry — but the registry is already "complete." **Recommend: render mentions as links in descriptions (bonus, no notify) and only do notify+inbox for comment mentions** unless the user asks otherwise. Don't expand the registry scope silently.

---

## 8. Reference: where things live & conventions

- Shared types: `packages/shared/src/entities.ts` (zod), `packages/shared/src/routes.ts`.
- Server errors: `apps/server/src/errors.ts` → `notFound("x")`, `conflict(msg)`, `forbidden(msg)`, `validationError(msg)`.
- Server helpers: `apps/server/src/util.ts` → `newId()` (ulid), `now()` (ms). 
- Route plumbing: `apps/server/src/routes/types.ts` → `body<T>(c)`, `query<T>(c)`, `currentUser(c)`, `AppContext`, `Handlers`.
- Workspace/task lookups: `apps/server/src/routes/resolve.ts` → `requireWorkspace(db, idOrKey)`, `requireTask(db, idOrKey)` returns `{task, workspace}`.
- **Handler files each export `xxxHandlers(ctx): Pick<Handlers, ...>`** and are spread in `app.ts:79-90`. Auth middleware is derived from the registry (`requireAuth(def.auth, …)`), **NOT** in the handler. Admin-only routes = registry `auth:"admin"`.
- Serializer: `apps/server/src/serialize.ts` — `Row` types from tables.
- Client: `packages/client/src/index.ts` (typed methods + `ROUTE_METHOD_MAP`).
- CLI: `apps/cli/src/commands/`.
- DB: SQLite via better-sqlite3 through `src/db/index.ts` (`Db` = typed drizzle DB). Local dev DB path: `DATA_DIR=/tmp/temujira-local-data` (`temujira.db`). Login `admin@test.dev` / `password123`.
- Server dev: `tsx watch` auto-reloads on server code change (PID varies). Static `node apps/server/dist/index.js` serves `apps/web/dist` fresh per request — web UI changes only need an `apps/web` rebuild, no server restart. Read `package.json` scripts; don't assume.

---

## 9. Verification checklist (run in this order at the end)

1. `pnpm -r typecheck` — all packages green (start with shared; it gates everything).
2. `pnpm --filter @temujira/server test` — server tests, including route-parity.test.ts.
3. `pnpm --filter @temujira/cli test` — CLI tests (parity).
4. Rebuild web: `pnpm --filter @temujira/web build` (or the repo's web build script) — confirm bundle builds.
5. If you changed schema/entities: regenerate migration carefully (see below) and confirm the journal stays clean.
6. **Manual browser verification** via `playwright-cli` against `:3000` (web), logging in as `admin@test.dev`/`password123`. Exercise: create a tag (admin) → assign to a task → group-by tag; comment with `@admin` mention → confirm inbox item appears in that user's Inbox and is clickable; reply to a comment → confirm reply appears in original author's inbox and nests under the root; post a question comment → answer via child reply → confirm answer shown; confirm `tasks.mine` and activity feed reflect the same actions; CLI equivalents work.
7. Workspace should be left in a sane seed state when done (like `START-1`, status Backlog, admin assigned).

**Regenerating a single clean migration (only if you change schema after handoff):** `cd apps/server` → `pnpm db:generate` writes to `src/db/migrations` + `meta/*_snapshot.json`. To collapse to ONE migration: delete generated SQL + `meta/*_snapshot.json`, `git checkout -- meta/_journal.json` (restores journal to only `0000_…`), then re-run `db:generate`. Migrations auto-apply at DB startup via `src/db/index.ts`. **Do NOT hand-edit migration SQL unless you know what you're doing.**

---

## 10. Immediate next steps (recommended order)

1. `pnpm -r typecheck` — fix the shared `CommentSchema` issue if it's still present; then the server typecheck will list every broken call site (that's your TODO list for tasks/comments serialize integration).
2. Mount `tagsHandlers`; add + mount `activityHandlers`, `inboxHandlers`; add `users.search` and `tasks.mine` to `usersRoutes.ts`/`tasksRoutes.ts`.
3. Rewrite `commentsRoutes.ts` (threading + mentions + questions + replies + inbox/activity/assoc side effects) and `tasksRoutes.ts` (tag_ids + assoc + activity + tasks.mine + tags in serialization).
4. Implement `activity.list` and `inbox.list/update` handlers with the joins needed for serialization.
5. Typecheck server green → move to client (`ROUTE_METHOD_MAP` + methods) → CLI commands → web UI (§6).
6. Run the full verification checklist (§9).

Keep this doc in sync as you go — the next agent after you will rely on it.
