# Per-user work queue — build spec

_Requirement source: SPEC.md FR-36..40. Every user (human or agent) has an ordered list
of tickets — "the order it will be done" — distinct from task status. Three states
(running now / ready to start / queued remainder), reorderable, add/remove, blocked
surface derived from the task-links graph (FR-24), and first-class in API and CLI so an
agent can ask what to do next, mark running, and complete. Pure metadata: a queue change
never mutates a task (the links precedent).

## 1. Data model

One table, one row per (owner, task):

```ts
/**
 * A user's ordered plan: tickets in the order they intend to do them.
 * state is pure signal ("running"/"ready"/"queued"); nothing auto-transitions and no
 * status/filter reads it. A task can sit in a queue in any state — status and queue
 * are deliberately orthogonal.
 */
export const queueEntries = sqliteTable("queue_entries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  position: integer("position").notNull(),
  state: text("state").notNull().default("queued"),
  addedBy: text("added_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (t) => [
  uniqueIndex("queue_entries_user_task_unique").on(t.userId, t.taskId),
  index("queue_entries_user_id_idx").on(t.userId),
  check("queue_entries_state_check", sql`${t.state} IN ('queued','ready','running')`),
]);
```

- Fresh entries append at the end (`position = max+1`). State default `queued`.
- Adding a task already in the queue → 409 (one slot per task per user; reorder, don't
  duplicate).
- Any user owns exactly their own queue (`queue.*` routes read/写 `currentUser`); no
  cross-user views in v1.
- Removing an entry is both "remove" and "complete" (states never include `done` —
  completion leaves the queue, optionally followed by an explicit `tasks.update` to a
  Done status, as the queue is pure metadata). FR-37's three states are the whole enum.

## 2. Wire shapes

```ts
export const QUEUE_STATES = ["queued", "ready", "running"] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export const QueueEntrySchema = z.object({
  id: UlidSchema,
  task: TaskSchema,          // full task, tags included, attachments/links absent
  state: z.enum(QUEUE_STATES),
  /** Derived from task links: true when any ablocker has a `blocks` edge to this task. */
  blocked: z.boolean(),
  position: z.number().int(),
  created_at: TimestampSchema,
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
```

AddTaskToQueueInputSchema = `{ task: TaskRefSchema }` (ULID or human key, like links).
QueueStateInputSchema = `{ state: z.enum(QUEUE_STATES) }`.
ReorderQueueInputSchema = `{ entry_ids: z.array(UlidSchema).min(1) }`.

## 3. Routes

```ts
"queue.get":      GET    /queue            user   // current user's queue, ordered by position
"queue.next":     GET    /queue/next       user   // the one to do next, or {entry: null}
"queue.add":      POST   /queue            user   // body {task}; 409 when already queued
"queue.remove":   DELETE /queue/:id        user   // owner's own entry only
"queue.reorder":  PUT    /queue/order      user   // full ordered array of own entry ids
"queue.setState": PATCH  /queue/:id        user   // {state}; owner only
```

`/queue/next` and `/queue/order` are literal 0-param paths; the param-count mount sort
already puts them before `/queue/:id`. `queue.next` = the first entry whose state is
`running`, else the first `ready`, else the first `queued`; if that entry is `blocked`
the response carries `blocked: true` so an agent can decide to skip (say, look at the
blocker's ticket instead); empty queue → `{entry: null}`. It does NOT auto-advance
anything — the agent acts (`queue.setState` running) and later completes (removes).

Semantics: all routes are owner-scoped (match `entry.userId === currentUser.id` → else
404). No `recordActivity`/inbox (queue changes are per-person state; task links already
produce the task-visible trail). No side effects on tasks.

## 4. Server

New `apps/server/src/routes/queueRoutes.ts`. Loader pattern from linksRoutes/loadTags:
one query `join(queueEntries, tasks)` ordered by `position, createdAt`; then a second
batch query joining `workspaces`+`statuses` + leftJoin `users` for the task rows
(tasks.mine does the same join shape), one `inArray` query for tags (loadTagsForTasks),
and one `task_links` query `where type='blocks'` collecting `dstTaskId`s to compute the
`blocked` set. Serialize each entry with `taskToApi(task, wsKey, status, assignee, tags)`
(no attachments/links params → omitted) + `{state, blocked, position, created_at, id}`.

Reorder/state-set/remove all `currentUser`-scoped; add resolves the task by
ULID-or-key via the existing `requireTask` (404/400 behavior free).

## 5. Client

```ts
getQueue()                    // queue.get      -> { items: QueueEntry[] }
queueNext()                   // queue.next     -> { entry: QueueEntry | null }
addToQueue(task)              // queue.add      -> { entry: QueueEntry }
removeFromQueue(id)           // queue.remove   -> { ok: true }
reorderQueue(entry_ids)       // queue.reorder  -> { items: QueueEntry[] }
setQueueState(id, state)      // queue.setState -> { entry: QueueEntry }
```
ROUTE_METHOD_MAP + re-exports (`QueueEntry`, `QueueState`, `QUEUE_STATES`).

## 6. CLI

New group `tmj queue` (apps/cli/src/commands/queue.ts) — the agent ergonomics FR-40
demands. Every subcommand accepts `<idOrKey>` for entry resolution (via GET /queue)
besides raw entry ids:

```
tmj queue list                        # human table: POS | STATE | TASK | BLOCKED | TITLE
tmj queue next                        # "next: START-3 [running]" or "queue is empty"
tmj queue add <taskIdOrKey>           # appends; 409 if present
tmj queue start <entryIdOrTaskKey>    # queue.setState running
tmj queue ready <entryIdOrTaskKey>    # queue.setState ready
tmj queue pause <entryIdOrTaskKey>    # queue.setState queued
tmj queue complete <entryIdOrTaskKey> # queue.remove (the "done" act — queue is metadata)
tmj queue remove  <entryIdOrTaskKey>  # queue.remove (alias)
tmj queue reorder <entryIds...>       # full ordered array
```

COMMAND_ROUTES: `queue list`→[queue.get], `queue next`→[queue.next],
`queue add`→[queue.add], `queue start`→[queue.setState, queue.get],
`queue ready`→[queue.setState, queue.get], `queue pause`→[queue.setState, queue.get],
`queue complete`→[queue.remove, queue.get], `queue remove`→[queue.remove, queue.get],
`queue reorder`→[queue.reorder]. Every queue.* RouteId claimed.

## 7. Web

- **My queue screen** (`app/(app)/queue.tsx`, sidebar "Queue" entry): ordered
  list; each row = state badge (running=primary / ready=secondary / queued=muted) +
  blocked badge (destructive dot + key) + task key/title, Up/Down reorder buttons
  (full `reorderQueue(entry_ids)` from the new order), a state cycle control, and a
  remove (Trash) button acting as complete. Computed `bf` badge hover shows nothing —
  keep the surface dumb: the badge is the signal.
- **Task detail** (`t/[num].tsx`): a small "Queue" button in the tray header or under
  ArchiveControl → `addToQueue(task.key)`; shows "Queued" state if already present the
  q confirm. (Label reflects result.)
- No drag-drop in v1 (buttons are pointer- and keyboard-safe and testable).

## 8. Tests

New `apps/server/test/queue.test.ts`: add→append order, duplicate add 409, get ordered,
state set running/ready/queued (owner only; other user's entry → 404), reorder
full-array validation + effect, remove hides it, `queue.next` precedence
(running > ready > queued) and empty → null, `blocked` true when a `blocks` link targets
the task and false otherwise (create via links.create in-test), task fields untouched by
all queue ops (title/status/updated_at unchanged), shape-check QueueEntrySchema via
@temujira/shared. Free: authz-matrix (401 on all six), route-parity, CLI parity,
OpenAPI emit.

## 9. Notes / non-goals

- No cross-user queues, no queue sharing, no auto-advance, no "dvcs sync". Priority is
  the ordered position — `ready` is a nickname, not a subset of "queued".
- `queue.next` is advisory; the agent still calls `queue.setState` before starting so the
  "running now" signal is honest.
- Migration rides the same `0002` as custom fields (one additive migration total).