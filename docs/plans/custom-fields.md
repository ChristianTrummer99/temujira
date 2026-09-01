# Workspace custom fields — build spec

_Requirement source: SPEC.md FR-31..35. Follows the "statuses are the model" instruction
verbatim: field definitions are per-workspace rows users create as first-class actions
(no code change), values are set per task, select fields double as grouping keys and
filters, and everything is first-class in the API and CLI (the parity contract).

## 1. Data model

Two tables. Definitions are like `statuses` (name unique per workspace, `position`
column); values are a slim `(task, field) -> value` map.

- **field_defs**: id, workspace_id FK, name (unique per workspace, ≤50 chars), type
  CHECK IN (`'select'`,`'text'`,`'number'`), `options` (JSON string array — only
  `select` uses it, else `[]`), position INTEGER, created_by FK, created_at.
  Type is immutable after create (changing `select`→`text` orphans option semantics;
  rename + recreate instead). Deleting a def deletes its values (like `tags.delete`
  unlinks tasks).
- **field_values**: id, task_id FK, field_id FK, value TEXT, created_by, created_at,
  updated_at. UNIQUE(task_id, field_id) — one value per (task, field). A cleared value
  is a deleted row, so `value` is never nullable.

`field_values` rows are set via `tasks.create` / `tasks.update` (not a separate route):
they are task data, and editing a task is already a single PATCH. On update, only keys
present in `field_values` are touched; an empty-string value clears/deletes that cell.

## 2. Wire shapes

```ts
export const FieldTypeSchema = z.enum(["select", "text", "number"]);
export const FieldDefSchema = z.object({
  id: UlidSchema,
  workspace_id: UlidSchema,
  name: z.string(),
  type: FieldTypeSchema,
  options: z.array(z.string()),      // options for select; [] otherwise
  position: z.number().int(),
  created_at: TimestampSchema,
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const CreateFieldInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  type: FieldTypeSchema.default("select"),
  /** Options for `select` (deduped, non-empty on create). Ignored for other types. */
  options: z.array(z.string().trim().min(1).max(50)).min(1).max(50).optional(),
});
export const UpdateFieldInputSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  /** Replaces the whole option set (select only). */
  options: z.array(z.string().trim().min(1).max(50)).min(1).max(50).optional(),
});
export const ReorderFieldsInputSchema = z.object({ field_ids: z.array(UlidSchema).min(1) });
```

`TaskSchema` gains `field_values: z.record(UlidSchema, z.string())` — **embedded on every
serialization** (get/list/mine/create/update). Justification: the task list needs them
for columns, grouping, and filtering; a task has at most a handful, so the per-row cost
is a tiny JSON object. Covers `{}` when the task has no values.

`CreateTaskInputSchema` / `UpdateTaskInputSchema` gain `field_values:
z.record(UlidSchema, z.string().max(500)).optional()`.

## 3. Routes

```ts
"fields.list":   GET    /workspaces/:idOrKey/fields           user
"fields.create": POST   /workspaces/:idOrKey/fields           user   // statuses precedent, member-visible
"fields.update": PATCH  /fields/:id                            user
"fields.reorder": PUT   /workspaces/:idOrKey/fields/order      user   // statuses.reorder pattern
"fields.delete": DELETE /fields/:id                            user
```

Session precedent: statuses are member-managed (statuses.create/update/reorder/delete
are auth `user`, not `admin`), tags are admin-managed. Custom fields are the same kind
of workspace structure as statuses (FR-31: "the same way statuses are user-defined"), so
`user`. Values ride on `tasks.create`/`tasks.update`.

Semantics: name conflict → 409 (per workspace); create appends at `position = max+1`;
delete removes def + all its value rows in one transaction and returns `{ok:true}`
(no `move_to` — values are deleted with the field). Reorder mirrors statuses.reorder:
the body must contain this workspace's full field list, each exactly once.

## 4. Server

New `apps/server/src/routes/fieldsRoutes.ts` (handlers for all 5 field ids), patterned
on statusesRoutes.ts. Value handling lives in tasksRoutes.ts:

- **create**: `taskToApi(..., fieldValues)` — new optional-last param on
  `taskToApi` (like links/attachments): `fieldValues?: Record<string,string>` → spread
  `{ field_values: fieldValues }`, always passing it from every call site in
  tasksRoutes so the field is always present (list/mine pass the loaded map, so it
  defaults to `{}` only in tests that build tasks directly).
- **update/create**: validate `field_values` keys against the task's workspace field
  defs in one `inArray` query; `select` values must be one of `options` (else
  400); `number` must parse as a finite number (else 400) but is stored as its
  canonical string; non-select/non-number strings pass through trimmed. Empty string
  clears the cell (row deleted). Write inside the existing task transaction.
- **list filter** (FR-34): `ListTasksQuerySchema` gains `field_id?: UlidSchema` and
  `field_value?: z.string()` — `?field_id=<ulid>&field_value=Done` filters to tasks
  whose value for that field equals the given option (EXISTS semi-join, like the tag
  filter). `field_id` alone filters to tasks that have any value. One custom-field
  filter at a time; multiple simultaneous filters are out of v1 (documented).
- **group_by widening** (FR-34): `group_by` in ListTasksQuerySchema widens from the
  enum to `z.string().default("none")` so a select **field id** is passable; grouping
  itself is client-side (see §6). `TASK_GROUP_FIELDS` stays exported for the built-in
  keys but is no longer the query type.

## 5. Client

```ts
listFields(workspace)          // fields.list      -> { items: FieldDef[] }
createField(workspace, body)   // fields.create    -> { field: FieldDef }
updateField(id, body)          // fields.update    -> { field: FieldDef }
reorderFields(workspace, ids)  // fields.reorder   -> { items: FieldDef[] }
deleteField(id)                // fields.delete    -> { ok: true }
```
`listTasks` gains `field_id?`, `field_value?`, and `group_by?: string`. `createTask`/
`updateTask` gain `field_values?: Record<string,string>`. ROUTE_METHOD_MAP + re-exports
(`FieldDef`, `FieldType`).

## 6. CLI

New group `tmj field` (apps/cli/src/commands/field.ts), CLI-shaped after `status`:

```
tmj field list --workspace <idOrKey>
tmj field create --workspace <idOrKey> --name <name> [--type select|text|number] [--options a,b,c]
tmj field update <id> [--name <name>] [--options a,b,c]
tmj field reorder --workspace <idOrKey> <fieldIds...>
tmj field delete <id> [--force]      # --force skips the "still referenced" fear:
                                     # deleting a def always deletes its values
tmj task update <idOrKey> --field <nameOrId>=<value> ...   # repeatable; "" clears
tmj task list  --field-id <id> [--field-value <v>]
```

`tmj task update --field` is a convenience expanding to one `tasks.update` call with all
`--field` flags merged. Value validation errors (unknown field, disallowed option) come
from the server's 400 and print verbatim. PARITY: `field list`→fields.list,
`field create`→fields.create, `field update`→fields.update, `field reorder`→fields.reorder,
`field delete`→fields.delete, `task update`→tasks.update (already claimed).

## 7. Web

- **Settings → Workspaces** (`app/(app)/settings/workspaces.tsx`): a "Custom fields"
  section under/next to statuses — list with type badge + options preview, create
  (name, type, options comma-entry), rename, replace options, reorder, delete. Same
  RNR components as the status manager.
- **Task detail** (`t/[num].tsx`): a "Fields" row-set under the Assignee controls —
  one control per def: `select` → the installed Select fed by `options`; `text` →
  Input; `number` → Input keyboardType numeric. Save through `updateTask` with
  `field_values`, wired through the existing `setTask` merge.
- **Task list** (`w/[key]/index.tsx`): (a) group picker gains the workspace's select
  fields as "Field: <name>" options → `group_by` = that field id; `groupTasks()` gains
  a field mode grouping by `task.field_values[fieldId]` (empty → "No value"). (b) a
  "Field" filter pair (field select + value select, shown only when fields exist).
  (c) each row shows a compact field-value pill per field (like TagPills, muted).

## 8. Tests

New `apps/server/test/fields.test.ts`: definitions CRUD (create appends at end,
duplicate name 409, type immutable 400 on update attempting type change), value set via
task create/update (select option enforced 400, number parse 400, clear via `""`,
unknown field 400), list filtering by `field_id`/`field_value`, embedding on every task
serialization, delete cascades values, reorder full-array validations, and TaskSchema
shape-check via @temujira/shared parse. Free coverage: authz-matrix (anonymous → 401 on
all five), route-parity two-way diff, CLI parity claims, OpenAPI emit.

## 9. Notes / non-goals

- Types: select, text, number. No checkbox/date/user in v1 (same "deliberately hard to
  grow" posture as link types).
- Single custom-field filter at a time on `tasks.list`; attacking multi-field filters
  later is an additive query param, not a migration.
- No activity event per value change (tag changes don't emit one either unless status/
  assignee-shape; `task.updated` with `fields: ["field_value"]` covers it via the
  existing activity in tasks.update).
- Migration: `0002` (journal ends at `0001_lying_sentry`), purely additive.