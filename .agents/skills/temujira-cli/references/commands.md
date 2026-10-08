# Temujira CLI command reference

Use `tmj <group> <command> --help` as the live authority. All leaf commands accept
`--url <url>`, `--api-key <key>`, `--global-auth`, `--json`, and `--quiet`.

## Setup, authentication, and account

```text
tmj setup --email <email> --password <password> [--name <name>]

tmj auth login --email <email> [--password <password>]
tmj auth whoami
tmj auth logout
tmj auth status
tmj auth use-key --key-stdin [--directory <path>]
tmj auth forget [--directory <path>]

tmj me update [--name <name>] [--password]
              [--current-password <password>] [--new-password <password>]

tmj apikey list [--user <userId>] [--all]
tmj apikey create --name <name> [--user <userId>]
tmj apikey revoke <apiKeyId>
```

`setup` creates the first admin only. Login and setup mint and save an API key. Hidden
password prompts require a TTY; automation must pass password options or use an API key.
Admin-only `--user` API-key operations act on another user; `apikey list --all`
lists every user's keys (metadata only — secrets are never retrievable).

Normal agent sessions reuse a shared identity/key. `use-key` verifies an existing key from
stdin and never prints it. It saves shared credentials by default; `--directory` creates
an explicit binding for that directory and its children. Files are mode 0600 in private user
configuration, outside the project. Nearest directory binding overrides environment/shared
config; flags override the binding. `--global-auth` skips bindings. `auth status` reports
the resolved identity and source. `forget` removes local credentials without revocation.
Only keys minted by CLI login/setup have a saved revocation ID used by global `auth logout`.

## Users

```text
tmj user list [--deactivated]
tmj user search <query> [--limit <n>]
tmj user create --name <name>
                (--email <email> --password <password> | --agent)
                [--role admin|member] [--with-key]
tmj user get <userId>
tmj user update <userId> [--name <name>] [--role admin|member]
                [--password [password]] [--reactivate]
                [--exclusive|--shared]
tmj user deactivate <userId>

tmj user avatar upload <file> [--user <idOrEmailOrMe>]
tmj user avatar download --output <path> [--user <idOrEmailOrMe>] [--force]
tmj user avatar remove [--user <idOrEmailOrMe>]
```

Human users require an email and password. Agent users are email-less, passwordless, and
API-key-only; their names are unique (case-insensitive) because mentions and assignee
pickers address them by name.
`--exclusive` / `--shared` set the per-identity access policy (agent accounts only, see
Identity sessions); the default is shared.
`--deactivated` includes deactivated users rather than filtering exclusively to them.

Avatar commands default to `--user me`. PNG, JPEG, GIF, and WebP pictures up to 2 MB are
supported. File signatures determine the served image type. Self-service needs no write
scope. Changing another user's picture needs `users:manage`; only admins can change other
admins. Downloads require authentication and refuse to overwrite a file unless `--force`.
Removing a picture restores stable per-user colored initials. User JSON includes the
current `avatar_id` or null, not picture bytes.

## Workspaces

```text
tmj workspace list [--archived]
tmj workspace create --name <name> --key <KEY>
tmj workspace get <workspaceIdOrKey>
tmj workspace update <workspaceIdOrKey> --name <name>
tmj workspace archive <workspaceIdOrKey>
tmj workspace unarchive <workspaceIdOrKey>
```

`--archived` includes archived workspaces. New workspaces receive Backlog, In Progress,
and Done statuses.

## Statuses

```text
tmj status list --workspace <workspaceIdOrKey>
tmj status create --workspace <workspaceIdOrKey> --name <name> [--color <#hex>]
tmj status update <statusId> [--name <name>] [--color <#hex>]
tmj status reorder --workspace <workspaceIdOrKey> <allStatusIds...>
tmj status delete <statusId> [--move-to <statusId>]
```

Reorder requires every status ID exactly once. Deleting a referenced status requires a
same-workspace `--move-to` ID. The final status cannot be deleted.

## Tags

```text
tmj tag list --workspace <workspaceIdOrKey>
tmj tag create --workspace <workspaceIdOrKey> --name <name> [--color <#hex>]
tmj tag update <tagId> [--name <name>] [--color <#hex>]
tmj tag delete <tagId>
```

Tag definitions require `workspaces:manage`. Deletion permanently unlinks the tag from all tasks.

## Custom fields

```text
tmj field list --workspace <workspaceIdOrKey>
tmj field create --workspace <workspaceIdOrKey> --name <name>
                 [--type select|text|number] [--options <comma-list>]
tmj field update <fieldId> [--name <name>] [--options <comma-list>]
tmj field reorder --workspace <workspaceIdOrKey> <allFieldIds...>
tmj field delete <fieldId>
```

`field create` defaults to `select`, which requires at least one option. Field type is
immutable. Updating options replaces the entire option set. Reorder requires every field
ID exactly once. Updating options does not rewrite existing task values, so migrate values
before removing options. Deletion also deletes all task values for that field.

## Tasks

```text
tmj task list --workspace <workspaceIdOrKey>
              [--status <statusIdOrName>]
              [--assignee <userIdOrEmailOrMe> | --unassigned]
              [--tag <tagIdOrName>]
              [--field-id <fieldId>] [--field-value <value>]
              [--search <query>] [--archived]
              [--sort created_at|updated_at|number|title|position]
              [--order asc|desc]
              [--group-by none|status|tag|assignee|<selectFieldId>]
              [--limit <n>] [--offset <n>]

tmj task mine [--limit <n>] [--offset <n>]

tmj task create --workspace <workspaceIdOrKey> --title <title>
                [--description <markdown> | --description-file <path|->]
                [--status <statusIdOrName>]
                [--assignee <userIdOrEmailOrMe>]
                [--tag <tagIdOrName>]...
                [--field <fieldNameOrId=value>]...

tmj task get <taskIdOrKey>

tmj task update <taskIdOrKey>
                [--title <title>]
                [--description <markdown> | --description-file <path|->]
                [--tag <tagIdOrName>]...
                [--field <fieldNameOrId=value>]...

tmj task move <taskIdOrKey> --status <statusIdOrName>
tmj task assign <taskIdOrKey> --user <userIdOrEmailOrMe>
tmj task unassign <taskIdOrKey>
tmj task archive <taskIdOrKey>
tmj task unarchive <taskIdOrKey>

tmj task bulk <idsOrKeys...> --workspace <idOrKey>
              [--status <idOrName>] [--assignee <idOrEmailOrMe> | --unassign]
              [--add-tag <idOrName>]... [--remove-tag <idOrName>]...
              [--field <nameOrId=value>]... [--archive | --unarchive]
tmj task reorder <idOrKey> (--before <idOrKey> | --end) [--status <idOrName>]
```

Task list defaults to 50 results and groups only the returned page. `--search` finds task
text, comments, filenames, and indexed attachment text. `--archived` includes archived tasks. JSON stays flat when human output
uses `--group-by`. `task mine` includes tasks associated through creation, assignment,
comments, or mentions.

`--description-file -` reads stdin. Repeated task-create tags form the initial set.
Supplying tags to task update replaces the full set. Fields update only the supplied
values; `Field=` clears a value. Select values must exactly match an option.

Bulk edits are atomic and limited to 200 unique tasks in one workspace. Add/remove tag
deltas preserve other tags. No changes apply if any target or value is invalid.
Reorder moves one task relative to another in the saved workspace order (null anchor via
`--end`). Use `--sort position --order asc` to read that order. All other tasks are retained.

## Task links

```text
tmj task link <taskIdOrKey> <relation> <otherTaskIdOrKey> [--archive]
tmj task links <taskIdOrKey>
tmj task unlink <taskIdOrKey> <relation> <otherTaskIdOrKey>
tmj task unlink <taskIdOrKey> --id <linkId>
```

Relations are `relates`, `blocks`, `blocked_by`, `absorbs`, and `absorbed_by`, viewed from
the first task. Inverse links are computed automatically. `--archive` is valid only for
absorption and runs as a second, non-atomic request.

## Comments, threads, questions, and mentions

```text
tmj comment list --task <taskIdOrKey>

tmj comment add --task <taskIdOrKey>
                (--body <markdown> | --body-file <path|->)
                [--reply-to <commentId>]
                [--question <option>]...
                [--answer <zeroBasedIndex>]
                [--mention <userIdOrNameOrEmail>]...

tmj comment update <commentId>
                   [--body <markdown>]
                   [--question <option>]...
                   [--clear-question]

tmj comment delete <commentId>
```

Questions require 2-10 options and can only be root comments. Answers require a reply and
use a zero-based index. Threads are one level deep; replying to a reply targets the root.
Use `--mention` to create notifications; visible `@text` alone does not do so.

## Identity sessions (optional exclusive identities)

An identity's access policy is `shared` (default) or `exclusive`. Shared means every key of
that identity may use it concurrently. Exclusive means exactly one credential may act as
the identity at a time: the active session's key. Use this when several agent threads must
not share one identity's assignments, inbox, or comment authorship.

```text
tmj user update <userId> --exclusive      # turn the policy on (agent accounts; users:manage)
tmj user update <userId> --shared         # turn it off (requires no active session)

tmj identity acquire <userId>             # mint the session key (api_keys:manage); token once
tmj identity current                      # worker self-check (run with the session key)
tmj identity release <userId> [--reason <reason>]
tmj identity get <userId>                 # active session, or none
tmj identity list                         # every active session
```

Semantics that callers must design around:

- **Policy and ownership are separate.** Enabling exclusive mode does not pick an owner;
  existing keys are simply suspended (never deleted, never silently adopted). Releasing a
  session does not disable exclusive mode. Workers cannot change the policy — only
  `users:manage` can, and a session key is refused.
- **Acquisition is atomic.** At most one active session per identity (partial unique
  index); concurrent acquires conflict (409, with the current `session_id` in details).
  Acquisition takes no ticket: it assigns nothing, changes no status, and needs no task.
- **Only the session key may authenticate as the identity.** Every other key — older keys,
  freshly minted keys — is rejected for reads ("my tasks", inbox, task lists), comments,
  writes, and every other operation, whether or not a session is active. Suspended keys
  resume working when the policy returns to shared.
- **The worker releases itself** with its own session key (`tmj identity release <self>`,
  no management scope needed). Release revokes that key and makes the identity available;
  a later acquisition mints a new key.
- **Old credentials cannot come back.** A released session's key is revoked, cannot
  authenticate, and cannot release a newer session.
- **Management recovery:** a caller with `api_keys:manage` can release an abandoned
  session by identity (record a `--reason`). Deactivating or revoking the worker key leaves
  the session visible and recoverable; it never silently frees the identity.
- Sessions survive server restarts. There is no timeout, heartbeat, or completion
  detector — the worker (or a manager) releases explicitly. Quiesce the native process
  before releasing, since the identity can be acquired again immediately.

## Attachments

```text
tmj attach upload (--task <taskIdOrKey> | --comment <commentId>) <file>
tmj attach list --task <taskIdOrKey>
tmj attach get <attachmentId>
tmj attach download <attachmentId> [-o, --output <path>] [--force]
tmj attach delete <attachmentId>
```

Upload requires exactly one parent. Download refuses to overwrite unless `--force` and
verifies SHA-256. A checksum mismatch keeps the file and exits 1. Comment attachments are
embedded in comment output; `attach list` is task-only.

## Global and workspace search

```text
tmj search <query> [--workspace <idOrKey>] [--type all|task|comment|attachment]
                   [--archived] [--limit <n>] [--offset <n>]
```

Search is global by default, limited to the caller's accessible workspaces. Results include
task titles/descriptions, comments/replies (including question options), attachment filenames,
and UTF-8 text-file contents up to 1 MiB. Supported text includes Markdown, JSON, CSV/TSV,
HTML/XML/SVG, logs, configuration, code, and G-code. Binary files (including PDFs, Office
documents and images) and larger files are searchable by filename, without content extraction
or OCR. Existing files are indexed on startup; edits and deletes update the index automatically.

Keywords are ANDed prefix matches; quote a phrase for a phrase match, e.g.
`tmj search '"bearing clearance"' --workspace ENG --json`. SQL/FTS operators are not exposed.
The response is `{items, total, limit, offset}`. Each hit includes `type`, `id`, `task_id`,
`task_key`, `workspace_id`, `workspace_key`, `title`, a plain-text `snippet`, and nullable
`comment_id`/`attachment_id` so a caller can open the exact match. Counts and pagination are
permission-filtered too. Archived tasks/workspaces are excluded unless `--archived` is set.
`--quiet` prints result IDs. The existing `task list --search` workspace filter also finds
matching descriptions, comments and attachments.

## Activity and inbox

```text
tmj activity list [--workspace <workspaceIdOrKey>] [--task <taskIdOrKey>]
                  [--actor <userId>] [--action <action>] [--mine]
                  [--category <group>]...
                  [--limit <n>] [--offset <n>]

tmj inbox list [--all] [--limit <n>] [--offset <n>]
tmj inbox read [itemId]
tmj inbox watch [--after <cursor> | --cursor-file <path>]
                [--once] [--interval <seconds>] [--limit <n>]
```

Activity is global by default and newest first. Every successful mutating API operation
records its actor, action, target and timestamp. This includes edits/deletes of comments and
files, account/key/session operations, inbox actions, workspace settings and bulk
changes. Ticket history resolves indirect targets (comment/file/link IDs) back to the ticket.
Read requests and failed mutations do not add success events. Existing history is retained;
previously unlogged actions cannot be reconstructed retroactively. Passwords, key tokens and
session secrets are never written to activity metadata.

Repeat `--category` to combine action groups: `tasks`, `comments`, `replies`, `mentions`,
`assignments`, `files`, `links`, `settings`, `accounts`. Groups combine with OR. Other filters
combine with AND. The API uses comma-separated `categories` and supports these filters on
global, workspace, and ticket feeds. Filtering occurs before pagination and counts.

Workspace activity requires current workspace access. Private account/key/inbox
events are visible to their owner and admins; user-administration events are admin-only.
Cross-workspace link events require access to both ends. Permissions are applied before
pagination/counting, including ticket feeds. Global/ticket responses include
`{items,total,limit,offset}`; the legacy workspace-only endpoint retains `{items}`.

`activity list --mine` means events on tasks associated with the
current user, not only actions performed by that user. Inbox defaults to unread;
`--all` includes read conversations. `inbox read <itemId>` marks a whole conversation read
(use an inbox ID, not the source/root comment ID). Without an ID, it marks all accessible
conversations read. The response's `updated` count is the number of conversations changed.
Reading or opening items never marks them read. A successful reply or question answer
marks only the replying user's existing notifications in that thread read. Notifications
for other threads and other users stay unchanged. New responses start unread.

Inbox `items`, `total`, `unread`, `limit`, and `offset` now describe conversations, grouped
before pagination. `thread_id` identifies the root comment. `id` comes from the oldest
retained notification in that conversation; `source_comment`, `actor`, `kind`, and
`created_at` describe the latest notification. `read_at` is null if any notification in the
conversation is unread. New replies update that same item. Any retained notification ID can
acknowledge the conversation. Use `comment list --task <taskId>` for its complete replies.

`inbox watch` starts now by default. `--after 0` replays retained events, including read
items; `--once` drains all pages and exits. Poll interval is 1–300 seconds (default 5), page
size 1–200 (default 100). Each poll applies current permissions. Output does not mark read.
NDJSON uses `notification` records with `cursor,item` and `checkpoint` records with `cursor`.
The watcher is a per-notification stream, not the grouped inbox list. A new reply still
gets its own event. Replies that also mention the same recipient send one notification.
Cursor files are server/user-bound and mode 0600. Advance happens after output succeeds;
deduplicate by inbox item ID after restart. Deleted items cannot be replayed. Temporary
failures retry with capped backoff; authentication errors exit. Ctrl+C stops cleanly.

## Raw API

```text
tmj api <GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS> <path-under-/api/v1>
        [--body <json|->]
        [--query <key=value>]...
```

Do not include `/api/v1` in the path argument. `--body -` reads stdin. Raw API always
prints JSON and is unsuitable for binary/multipart routes; use attachment commands.
