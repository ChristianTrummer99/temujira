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
tmj user deactivate <userId>
```

Human users require an email and password. Agent users are email-less, passwordless, and
API-key-only; their names are unique (case-insensitive) because mentions and assignee
pickers address them by name.
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

## Managed agents and reservations

Reservations are server-enforced exclusive leases: one managed agent identity bound to one
ticket, with its own API key. They exist so concurrent foremen cannot double-book a worker
identity or a ticket, and so a worker key can only write its own ticket.

```text
tmj agent list [--deactivated]
tmj agent admit <userId> [--note <note>]
tmj agent remove <userId>

tmj reservation claim --agent <userId> --task <idOrKey> --run <reference>
                      --request-id <id> [--adopt-existing-assignment]
tmj reservation list [--agent <userId>] [--task <idOrKey>]
                     [--status active|released] [--request-id <id>]
                     [--limit <n>] [--offset <n>]
tmj reservation get <reservationId>
tmj reservation lookup --request-id <id>
tmj reservation current
tmj reservation release <reservationId> [--reason <reason>]
```

Semantics that callers must design around:

- **Admission is explicit.** `agent admit` enters an existing agent account into the
  workflow; names never auto-admit. Unadmitted, deactivated, or actively reserved
  identities are not claimable. Availability is derived from reservation state — never
  infer it from idle processes, quiet logs, empty queues, or ticket status.
- **Claim is atomic and idempotent.** `--request-id` is the idempotency key: repeating the
  same claim returns the same reservation with `token: null` (the worker key is revealed
  only once) and `replayed: true`. Reusing a request id for different inputs conflicts.
  After a lost token, `reservation release` then claim again with a new request id.
- **One active reservation per identity and per ticket**, enforced by partial unique
  indexes. A claim cannot steal a ticket assigned to someone else; a ticket already
  assigned to the same agent without a reservation needs `--adopt-existing-assignment`.
- **Worker keys are reservation-bound.** A managed agent's ordinary keys can read but
  cannot perform job writes; only the claim's key may mutate the reserved ticket
  (status/assignment/title/description/comments/attachments, links involving that ticket).
  Worker credentials cannot mint keys, manage users, manage reservations, or write other
  tickets. Queue/inbox/read operations stay available.
- **Assignment into a managed identity requires the claim path** — ordinary
  `task assign` to a managed agent conflicts (409) by design. Reassigning a reserved
  ticket also requires releasing first; `release` clears the assignment only when the
  ticket is still assigned to that worker and never overwrites a different assignee.
- **Release is explicit** (no timeout/heartbeat expiry). It revokes the reservation's key
  and keeps the identity + history; the next claim mints a fresh key. Releasing does not
  certify the job complete, and it cannot stop a native process — quiesce the old session
  first. Repeated releases are harmless and stale releases never touch newer reservations.
- `reservation current` is the worker's self-check (identity, reservation, ticket, run
  reference). Secrets never appear in lists, inspection, or activity.

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
