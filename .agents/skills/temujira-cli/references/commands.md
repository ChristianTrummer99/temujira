# Temujira CLI command reference

Use `tmj <group> <command> --help` as the live authority. All leaf commands accept
`--url <url>`, `--api-key <key>`, `--json`, and `--quiet`.

## Setup, authentication, and account

```text
tmj setup --email <email> --password <password> [--name <name>]

tmj auth login --email <email> [--password <password>]
tmj auth whoami
tmj auth logout

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
```

Human users require an email and password. Agent users are email-less, passwordless, and
API-key-only; their names are unique (case-insensitive) because mentions and assignee
pickers address them by name.
`--exclusive` / `--shared` set the per-identity access policy (agent accounts only, see
Identity sessions); the default is shared.
`--deactivated` includes deactivated users rather than filtering exclusively to them.

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

Tag writes are admin-only. Deletion permanently unlinks the tag from all tasks.

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
              [--assignee <userIdOrEmailOrMe>]
              [--tag <tagIdOrName>]
              [--field-id <fieldId>] [--field-value <value>]
              [--search <query>] [--archived]
              [--sort created_at|updated_at|number|title]
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
```

Task list defaults to 50 results and groups only the returned page. `--search` is a title
substring search. `--archived` includes archived tasks. JSON stays flat when human output
uses `--group-by`. `task mine` includes tasks associated through creation, assignment,
comments, or mentions.

`--description-file -` reads stdin. Repeated task-create tags form the initial set.
Supplying tags to task update replaces the full set. Fields update only the supplied
values; `Field=` clears a value. Select values must exactly match an option.

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

## Personal queue

```text
tmj queue list
tmj queue next
tmj queue add <taskIdOrKey>
tmj queue start <entryIdOrTaskIdOrTaskKey>
tmj queue ready <entryIdOrTaskIdOrTaskKey>
tmj queue pause <entryIdOrTaskIdOrTaskKey>
tmj queue complete <entryIdOrTaskIdOrTaskKey>
tmj queue remove <entryIdOrTaskIdOrTaskKey>
tmj queue reorder <allQueueEntryIds...>
```

Queues are owner-scoped. New entries append as queued; duplicate task addition conflicts.
`next` prefers running, then ready, then queued. Complete/remove only removes queue
metadata. Reorder requires the full exact list of queue-entry IDs.

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

## Activity and inbox

```text
tmj activity list --workspace <workspaceIdOrKey>
                  [--mine] [--limit <n>] [--offset <n>]

tmj inbox list [--all] [--limit <n>] [--offset <n>]
tmj inbox read
```

Activity is newest first. `activity --mine` means events on tasks associated with the
current user, not only actions performed by that user. Inbox defaults to unread;
`--all` includes read items. `inbox read` marks every item read.

## Raw API

```text
tmj api <GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS> <path-under-/api/v1>
        [--body <json|->]
        [--query <key=value>]...
```

Do not include `/api/v1` in the path argument. `--body -` reads stdin. Raw API always
prints JSON and is unsuitable for binary/multipart routes; use attachment commands.
