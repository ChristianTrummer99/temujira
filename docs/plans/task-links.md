# Task links — build spec

_Chosen by a design panel (two competing designs, judged). This is the ratified spec._

VERDICT: **Design B wins**, with four grafts from Design A. Scores (each /10, order: fidelity / agent-unambiguity / data-model / one-session cost / no-surprises):

- **Design A: 8 / 7 / 9 / 7 / 9.** Correct core (one canonical row, computed inverse, no side effects), and it alone catches the direct-inverse contradiction (A blocks B + B blocks A → 409) and the cross-workspace activity asymmetry. But it loses on house fit and agent ergonomics: `taskLinks.*` with `DELETE /tasks/:idOrKey/links/:linkId` would be the registry's only 2-param path and breaks the verified precedent (`comments.create` under `/tasks/:idOrKey/comments`, but `comments.delete`/`attachments.delete` at top-level `/:id` — routes.ts:398-404, 437-443). Its wire shape needs three coupled fields (`type` + `direction` + `label`) where one enum suffices, and `duplicates` vs `absorbs` is a near-synonym fork an agent must resolve nondeterministically.
- **Design B: 9 / 9 / 8 / 9 / 8.** The 5-string relation vocabulary is the same string for read and write, and `jq -r '"\(.type) \(.task.key)"'` prints literally `absorbs START-2` — the user's sentence. Route naming/paths match the codebase precedent exactly. Its `setTask` embed-drop finding is REAL and verified: [num].tsx:83-88 replaces `prev.task` wholesale and tasks.update responses embed no attachments (tasksRoutes.ts:315), so status changes already blank attachments today — links would inherit the bug. B's weaknesses: allows the contradictory 2-cycle, logs cross-workspace activity in only one feed, uses naive `key.split("-")` instead of the existing `splitTaskKey` (format.ts:34), and drops A's good compositional absorb-then-archive affordances.

Grafts from A into B: (1) reject the direct inverse of a directional link (409); (2) mirrored activity event for cross-workspace links; (3) explicit, non-magical absorb→archive composition (CLI flag + web follow-up prompt — precedent: `tmj user create --agent --with-key`, ARCHITECTURE.md:135); (4) web polish (splitTaskKey navigation, search-driven task picker, ACTION_LABELS entries, section placement).

---

# RECOMMENDED DESIGN — Task Links (build spec)

## 1. Decisions on the four flagged questions

**(a) `absorbs` side effect: NO automatic archive.** Links are pure metadata; no link type mutates either task. Justification: (1) retry-safety — an agent recording a relationship must never make a ticket vanish from default lists as a byproduct; (2) unlink has no clean inverse (unabsorb ≠ unarchive; the archive may predate or outlive the link); (3) audit integrity — an archive smuggled into a link insert corrupts the activity trail; (4) JIRA/Linear precedent: links never mutate the linked issue. The workflow is composed explicitly from the existing `tasks.update {archived:true}`: CLI `tmj task link A absorbs B --archive` (second, separate API call) and a web follow-up prompt "Archive START-2? [Archive] [Dismiss]" after creating an outward absorbs link. Same rule bars `blocks` from gating status moves (documented v1 boundary; adding a gate later is an additive 409, not a migration).

**(b) Inverse display: computed at serialization, never stored.** One canonical row `src <type> dst`. GET on src serializes `type: row.type`; GET on dst serializes `type: LINK_INVERSE[row.type]` (`blocked_by`, `absorbed_by`) with the other endpoint embedded. Both ends can never disagree because there is only one fact. Human label = `type.replace("_", " ")` — no separate label field on the wire.

**(c) Read surface: embed on tasks.get only. No list route.** Exactly the attachments precedent (`/** Embedded on tasks.get only. */`, entities.ts:129-130). Each embedded link carries the far task's key/title/status/archived_at, so no follow-up fetch. tasks.list/tasks.mine/tasks.create/tasks.update responses carry NO links (perf + precedent). CLI `tmj task links` is a convenience over tasks.get; `tmj api GET /tasks/START-1` stays the raw floor. A standalone route would cost 5 parity artifacts for a read tasks.get already answers.

**(d) Naming the other ticket: ULID or human key, key-first.** Body field `task` accepts either (`START-2` per FR-25); server resolves through the existing `requireTask` (resolve.ts:26-45) so unknown → 404, garbage → 400. Keys are globally unambiguous (workspaces_key_unique, schema.ts:76). Web uppercases typed keys before sending.

## 2. Link-type taxonomy (final)

Three canonical stored types, five wire relations. NO `duplicates` — near-synonym of `absorbs`, anti-ergonomic for agents that must pick deterministically; `absorbs` covers duplicate/supersede/merge (document this). Growing the enum later = one migration + one constant (deliberately hard).

| stored type | wire (src side) | wire (dst side) | directional |
|---|---|---|---|
| `relates` | `relates` | `relates` | no (canonicalized src<dst) |
| `blocks` | `blocks` | `blocked_by` | yes |
| `absorbs` | `absorbs` | `absorbed_by` | yes |

In `packages/shared/src/entities.ts`:

```ts
export const LINK_TYPES = ["relates", "blocks", "absorbs"] as const;                                  // storage
export const LINK_RELATIONS = ["relates", "blocks", "blocked_by", "absorbs", "absorbed_by"] as const; // wire
export const LinkRelationSchema = z.enum(LINK_RELATIONS);
export type LinkType = (typeof LINK_TYPES)[number];
export type LinkRelation = (typeof LINK_RELATIONS)[number];
/** relation → canonical storage type + whether src/dst are flipped. */
export const LINK_CANONICAL: Record<LinkRelation, { type: LinkType; flip: boolean }> = {
  relates: { type: "relates", flip: false },
  blocks: { type: "blocks", flip: false },
  blocked_by: { type: "blocks", flip: true },
  absorbs: { type: "absorbs", flip: false },
  absorbed_by: { type: "absorbs", flip: true },
};
/** storage type → relation shown on the dst side. */
export const LINK_INVERSE: Record<LinkType, LinkRelation> = {
  relates: "relates", blocks: "blocked_by", absorbs: "absorbed_by",
};
```

## 3. Drizzle DDL (final)

In `apps/server/src/db/schema.ts` after `taskTags` (schema.ts:256-270). `check`/`uniqueIndex` already imported. Tasks are archive-only, never hard-deleted (ARCHITECTURE.md:98,106) — no ON DELETE machinery, matching every other FK.

```ts
/**
 * Typed edge between two tasks: "src <type> dst" (e.g. src absorbs dst).
 * Only canonical types are stored (relates/blocks/absorbs); inverse spellings
 * (blocked_by/absorbed_by) exist only on the wire, computed per viewpoint at
 * serialization. `relates` rows are stored src < dst (ULID order) so the unique
 * index dedupes both directions. Links are pure metadata: no side effects,
 * no enforcement, task rows untouched.
 */
export const taskLinks = sqliteTable(
  "task_links",
  {
    id: text("id").primaryKey(),
    srcTaskId: text("src_task_id").notNull().references(() => tasks.id),
    type: text("type").notNull(),
    dstTaskId: text("dst_task_id").notNull().references(() => tasks.id),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("task_links_edge_unique").on(t.srcTaskId, t.type, t.dstTaskId),
    index("task_links_src_idx").on(t.srcTaskId),
    index("task_links_dst_idx").on(t.dstTaskId),
    check("task_links_type_check", sql`${t.type} IN ('relates','blocks','absorbs')`),
    check("task_links_no_self_check", sql`${t.srcTaskId} != ${t.dstTaskId}`),
  ],
);
```

Migration: `cd apps/server && pnpm drizzle-kit generate` → `0002_*.sql` (journal currently ends at `0001_lying_sentry`). Purely additive; auto-applies at boot behind the pre-migration snapshot. Never hand-edit 0000/0001.

## 4. Route registry entries (final)

`packages/shared/src/routes.ts`, new `// ---- links ----` section after tasks. Naming/paths follow the comments/attachments precedent (create under the parent, delete at top-level `/:id`):

```ts
"links.create": {
  method: "POST",
  path: "/tasks/:idOrKey/links",
  auth: "user",
  summary: "Link this task to another (relation + target id or key, e.g. absorbs START-2); either-end spellings accepted (blocked_by, absorbed_by)",
  body: CreateTaskLinkInputSchema,
  response: z.object({ link: TaskLinkSchema }),
},
"links.delete": {
  method: "DELETE",
  path: "/links/:id",
  auth: "user",
  summary: "Remove a link by id; one call removes it from both tasks",
  response: okResponse,
},
```

Input schema (A's refine form — better error messages than a union):

```ts
/** ULID or human key like "START-2" (FR-25). */
export const TaskRefSchema = z.string().trim().refine(
  (s) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s) || TaskKeyPattern.test(s),
  "task must be a task id or a key like TEM-42",
);
export const CreateTaskLinkInputSchema = z.object({
  /** Relation as seen from the task in the URL. */
  type: LinkRelationSchema,
  /** The other task, by ULID or key. */
  task: TaskRefSchema,
});
```

Handler wiring: new `apps/server/src/routes/linksRoutes.ts` exporting `linksHandlers(ctx): Pick<Handlers, "links.create" | "links.delete">`, spread into the exhaustive Handlers record in app.ts (missing = compile error). Both new paths are parameterized, so the literal-first param-count mount sort in app.ts is unaffected (`/tasks/mine` still mounts first). authz-matrix, route-parity, and OpenAPI emit pick both routes up automatically via ROUTE_IDS.

## 5. Serialized shape (final)

Always from the viewpoint of the task embedding it (for links.create's response: the URL task).

```ts
export const LinkedTaskRefSchema = z.object({
  id: UlidSchema,
  key: z.string(),            // built from the OTHER task's own workspace key
  workspace_id: UlidSchema,
  title: z.string(),
  status: StatusSchema,
  archived_at: TimestampSchema.nullable(),
});
export const TaskLinkSchema = z.object({
  id: UlidSchema,
  /** Relation as seen from the embedding task: "absorbs" on START-1, "absorbed_by" on START-2. */
  type: LinkRelationSchema,
  task: LinkedTaskRefSchema,   // the OTHER endpoint
  created_by: UlidSchema,
  created_at: TimestampSchema,
});
```

`TaskSchema` gains `/** Embedded on tasks.get only. */ links: z.array(TaskLinkSchema).optional()` beside `attachments` (entities.ts:129-131).

`serialize.ts`: add `TaskLinkRow = typeof taskLinks.$inferSelect`; add `taskLinkToApi(row, perspectiveTaskId, other: { task: TaskRow; workspaceKey: string; status: StatusRow })` — `outward = row.srcTaskId === perspectiveTaskId`, `type = outward ? row.type : LINK_INVERSE[row.type]`, far-end key built as `` `${other.workspaceKey}-${other.task.number}` `` (MUST join the far task's OWN workspace — reusing the viewpoint workspace key silently mints wrong keys cross-workspace). `taskToApi` (currently 6 params, serialize.ts:108-115) gains optional-LAST param `links?: TaskLink[]`, spread `...(links ? { links } : {})` beside the attachments spread — all existing call sites (tasksRoutes.ts:111,147,209,225,315) compile unchanged; pass it ONLY in tasks.get.

Loader in linksRoutes.ts (loadTagsForTasks batching pattern, tasksRoutes.ts:42-58): one query `where(or(eq(srcTaskId,id), eq(dstTaskId,id)))` ordered by createdAt,id asc; one `inArray` select joining tasks+workspaces+statuses for the far ends.

## 6. Semantics rules (final)

All create-side checks inside one `ctx.db.transaction` (the number-allocation pattern, tasksRoutes.ts:177-198), DB constraints as backstop:

1. **Normalization**: map posted relation through `LINK_CANONICAL`; `flip:true` swaps (src,dst); for `relates`, then order (src,dst)=(min,max) by ULID compare. Exactly one possible row per real-world link — this is what makes "created and removed from either end" (SPEC.md) literal: `{type:"absorbed_by", task:"START-1"}` on START-2 ≡ `{type:"absorbs", task:"START-2"}` on START-1.
2. **Self-link**: 400 `validation_error` "a task cannot link to itself" (handler; CHECK as belt). Compare resolved ULIDs, not input strings.
3. **Exact duplicate** (same canonical src,type,dst): 409 `conflict` "these tasks are already linked as <type>" (pre-check select; unique index backstop).
4. **Direct inverse of a directional type** [graft from A]: A blocks B exists, attempt B blocks A (any spelling) → 409 naming the existing link ("START-2 already blocks START-1 — remove that link first"). One indexed lookup on (dst,type,src); the 2-cycle is always a user/agent error.
5. **Longer cycles** (A→B→C→A): ALLOWED. Links carry zero enforcement, so a cycle is inert; detection needs graph traversal — out of scope, documented.
6. **Same pair, different type**: allowed (distinct facts).
7. **Cross-workspace**: allowed (every member sees every workspace, ARCHITECTURE.md:77-78; keys globally unique). Far-end ref always carries the other task's own key + workspace_id.
8. **Archived tasks**: linking to/from and unlinking allowed (consistent with tasks.update/comments having no archived guard); ref's `archived_at` lets UIs dim it.
9. **Delete**: `DELETE /links/:id` removes the single row — both sides disappear atomically. Any authenticated user may link/unlink (auth "user", no owner gate — links are metadata like tag assignment); `created_by` is audit only. Re-delete → 404.
10. **No side effects**: nothing archives, nothing gates status, and link create/delete does NOT bump either task's `updated_at` (no surprise reshuffling of `sort=updated_at` lists).
11. **Activity** [graft from A]: `task.linked` / `task.unlinked` via recordActivity (engagement.ts:47-68), anchored on the URL-viewpoint task in its workspace, metadata `{link_id, type: <relation as seen from the anchored task>, other_task_id, other_task_key}`; when the two tasks are in DIFFERENT workspaces, record a second mirrored event anchored on the other task in its workspace (each per-workspace feed sees it, viewpoint-correct); one event when same-workspace. No pushInbox (links target tasks, not people), no associate().
12. **Errors reuse the fixed code set**: 400 validation_error / 404 not_found / 409 conflict — no new codes.

## 7. CLI surface (final)

In the existing `task` group (apps/cli/src/commands/task.ts); positional, so invocations read as the user's sentence:

```
tmj task link <idOrKey> <relation> <otherIdOrKey> [--archive]
    # tmj task link START-1 absorbs START-2
    # tmj task link START-2 absorbed_by START-1     (identical canonical link)
    # tmj task link INFRA-3 blocks APP-9            (cross-workspace)
  <relation> validated against LINK_RELATIONS client-side → exit 2 on a bad string
  --archive: only with absorbs/absorbed_by (else exit 2); after linking, a second
             explicit client.updateTask(<absorbed task>, {archived:true}) call
             (precedent: `tmj user create --agent --with-key`)
  human: "linked: START-1 absorbs START-2"; --json: {link}; --quiet: link id

tmj task links <idOrKey>          # reads tasks.get, prints embedded links
  human table: ID | TYPE | TASK | STATUS | TITLE; --json: {items}; --quiet: ids

tmj task unlink <idOrKey> <relation> <otherIdOrKey>
tmj task unlink <idOrKey> --id <linkId>            # skips the lookup
  # resolves via tasks.get: match on relation string + far end (ULID → link.task.id,
  #   else case-insensitive link.task.key); no match → exit 4; then links.delete
```

`task get` renders a `links:` section in renderTask (beside the attachments table): `<relation with _→space> <key>  [<status>] <title>`. Exit codes per the existing table: 404→4, 409→5, bad relation→2.

`COMMAND_ROUTES` additions (picked up by parity.ts via the TASK_ROUTES spread):

```ts
"task link": ["links.create", "tasks.update"],   // tasks.update claims --archive
"task links": ["tasks.get"],
"task unlink": ["links.delete", "tasks.get"],
```

Client (`packages/client/src/index.ts`): `createTaskLink(task: string, body: { type: LinkRelation; task: string })` → `{link: TaskLink}` via `this.call("links.create", { idOrKey: task }, { body })`; `deleteTaskLink(id: string)` → `{ok: true}`. Add both to ROUTE_METHOD_MAP (index.ts:389) and re-export `TaskLink`, `LinkRelation`, `LINK_RELATIONS`, `LINK_INVERSE`.

## 8. Web UI (final)

One `LinksSection` in `apps/web/app/(app)/w/[key]/t/[num].tsx`, after InlineDescriptionEditor and before TaskAttachments (the JIRA position). Only already-installed RNR components (Popover, Select, Input, Badge, Button, Icon, Text) + lucide icons.

- **List**: `task.links ?? []` (free on the page's existing getTask). Row: relation label (`type.replace("_"," ")`), mono key, truncated title, status Badge colored from `link.task.status.color`, dimmed/struck when `archived_at != null`; X button → `client.deleteTaskLink(link.id)` then filter locally via setTask. Navigation via **`splitTaskKey`** (lib/format.ts:34 — house helper, used by activity/inbox/my) → `router.push('/w/'+workspaceKey+'/t/'+number)`; works cross-workspace because the ref key carries the far task's own workspace key. Never naive `key.split('-')`.
- **Add** [graft from A]: "Link" Button → Popover with (1) Select over the 5 relations (default `relates`); (2) task picker: Input driving debounced `client.listTasks(workspaceKey, { q, limit: 10 })` result rows (current task filtered out), plus — when the text matches TaskKeyPattern after trim+uppercase — a verbatim "Link OTHER-3" row so cross-workspace links are typable by key; (3) submit `client.createTaskLink(task.key, { type, task })`, splice `res.link` into `task.links`, surface ApiError.message inline (the 400/404/409 messages are user-readable).
- **Absorb follow-up** [graft from A]: after a successful outward `absorbs` link to a non-archived target, transient inline row "Archive {key}? [Archive] [Dismiss]" → `client.updateTask(link.task.key, { archived: true })`, update the ref's archived_at locally. Pure composition, nothing hidden.
- **MANDATORY fix** [B's verified find]: `setTask` ([num].tsx:83-88) currently replaces the task wholesale, and tasks.update responses embed neither links nor attachments — a status change would blank the links section (attachments already silently suffer this). Change to merge: `resource.setData(prev => prev ? { ...prev, task: { ...updated, links: updated.links ?? prev.task.links, attachments: updated.attachments ?? prev.task.attachments } } : prev)`.
- ACTION_LABELS in activity.tsx:20: add `'task.linked': 'linked'`, `'task.unlinked': 'unlinked'` (fallback would render "task linked" anyway).
- All I/O through TemujiraClient — no-raw-fetch grep stays green. No new npm deps or RNR components.

## 9. Tests

New `apps/server/test/links.test.ts` (in-process app.request + helpers.ts makeTestApp/setupAdmin/makeMember/makeWorkspace/makeTask):

1. Create each relation A→B → 200; response `link.type` echoes the posted relation; `link.task.key` = B's key; `created_by` = actor.
2. Inverse presentation: after "A absorbs B", GET A shows `{type:"absorbs", task.key:B}`; GET B shows `{type:"absorbed_by", task.key:A}` — same link id.
3. Either-end creation: POST on B `{type:"absorbed_by", task:A}` → 200; subsequent `{type:"absorbs", task:B}` on A → 409 (one canonical fact).
4. relates canonicalization: A relates B → 200; B relates A → 409.
5. Exact duplicate → 409 conflict; same pair different type → 200.
6. Self-link by own key AND own ULID → 400.
7. **Direct inverse 409**: A blocks B, then B blocks A (and via `blocked_by` spelling) → 409; 3-cycle A→B→C→A all blocks → three 200s (pinned allowance).
8. Target forms: ULID → 200; unknown key "NOPE-99" → 404; garbage → 400 (TaskRefSchema, not a 500).
9. Cross-workspace: each side's ref key uses the OTHER task's own workspace prefix; activity shows task.linked in BOTH workspaces, and exactly one event when same-workspace.
10. Archived: link to/from archived → 200 with `archived_at` set in the ref.
11. No side effects: after "A absorbs B", B.archived_at null and neither task's updated_at changed; blocked task still moves status freely.
12. Embedding contract: tasks.get orders links createdAt,id asc; tasks.list/tasks.mine/tasks.update responses contain NO links key.
13. Delete: member who didn't create it → 200 (any-member rule); both GETs drop it; re-delete → 404; unknown id → 404.
14. Activity metadata `{link_id, type, other_task_key}` viewpoint-correct; no inbox rows created.
15. Shape check: parse create response and tasks.get against TaskLinkSchema/TaskSchema from @temujira/shared.

Free coverage (zero new test code): authz-matrix (anonymous/revoked → 401 on both routes), route-parity two-way diff, CLI parity (both route ids claimed; `task link`/`task links`/`task unlink` registered), boot OpenAPI emit.

## 10. One-session build order

shared (constants + schemas + 2 routes) → schema.ts + `drizzle-kit generate` 0002 → linksRoutes.ts + serialize.ts (taskLinkToApi, taskToApi 7th optional-last param) + tasks.get wiring + app.ts spread → server tests → client (2 methods + ROUTE_METHOD_MAP + re-exports) → CLI (link/links/unlink + renderTask section + COMMAND_ROUTES) → web (LinksSection + setTask merge fix + ACTION_LABELS) → full suite (`pnpm test` server + CLI, typecheck all 5 packages).

Top pitfalls, in order: keep LINK_CANONICAL/LINK_INVERSE only in packages/shared (never re-declared server-side); run all create checks inside the transaction so the unique index surfaces as 409, not a raw SQLITE_CONSTRAINT 500; join the far task's own workspace for its key; keep `links` optional-last on taskToApi and pass it only in tasks.get; don't forget the setTask merge fix — it's the demo path (change status → links vanish).