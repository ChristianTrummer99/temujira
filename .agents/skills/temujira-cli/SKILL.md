---
name: temujira-cli
description: Operate Temujira safely through its `tmj` CLI. Use this skill whenever an AI agent needs to inspect or change Temujira workspaces, tasks, statuses, tags, custom fields, links, comments, notifications, attachments, users, or API keys; receives a task key such as ENG-42; or is asked to update tickets, watch an inbox, check what to work on, leave a project update, or automate project work, even when the user does not explicitly mention `tmj`.
compatibility: Requires access to a Temujira server and the `tmj` CLI, Docker Compose service, or this repository with Node.js 22 and pnpm.
---

# Temujira CLI

Use `tmj` as the normal interface to Temujira. It shares the typed API contract with the
web app and is safer than editing SQLite or assembling HTTP requests by hand.

## Choose the invocation

Use the first available form:

```sh
# Installed binary
tmj ...

# CLI bundled in a self-hosted container
docker compose exec app tmj ...

# Current repository source; avoids stale dist output while developing
pnpm --filter @temujira/cli dev -- ...

# Built repository output
pnpm --filter @temujira/cli build
node apps/cli/dist/index.js ...
```

Run repository commands from its root. Rebuild `apps/cli/dist` after changing CLI,
client, or shared source. A fresh clone has no tracked `dist` directory.

Consult `tmj --help` and `tmj <group> <command> --help` when syntax is uncertain. The
running CLI and route registry are authoritative; prose plans can lag implementation.
See [references/commands.md](references/commands.md) for the command index and edge cases.

## Authenticate without leaking credentials

Agents should normally use environment variables:

```sh
export TEMUJIRA_URL=https://pm.example.com
export TEMUJIRA_API_KEY=tmj_...
tmj auth whoami --json
```

Use one shared identity/key for normal agent sessions. Do not create a new account or key
for each session. Run `tmj auth status --json` to check the active identity, server, and
credential source without printing the key.

Precedence: explicit flags → nearest directory binding → environment → shared config
(`$XDG_CONFIG_HOME/temujira/config.json`, otherwise `~/.config/temujira/config.json`).
Use `--global-auth` to skip directory bindings, including when a job must use its explicit
environment credential.

`tmj auth use-key --url <server> --key-stdin` verifies and saves an existing shared key.
Pass `--directory <path>` only when a separate directory credential is needed. Supply the
key through protected standard input. The binding covers that directory and its children;
credentials stay in the private user config, not in the project. Invalid bindings fail
instead of falling back to another identity. `auth forget [--directory <path>]` removes
stored credentials without revoking the key. Imported keys have no automatic revocation ID.

Protect credentials:

- Do not print, commit, paste into tickets, or include API keys in shell traces.
- Prefer `TEMUJIRA_API_KEY` over a command-line `--api-key`, which may appear in process
  listings and shell history.
- Setup, login, API-key creation, and `user create --with-key` reveal a token only once.
  Capture it deliberately and never use `--quiet` when the token is needed.
- If a non-interactive job captures a token response in a temporary file, use restrictive
  permissions, install cleanup immediately, import the token into the secret manager, and
  verify the new credential before that process exits. Do not let an exit trap delete the
  only copy before import succeeds.
- `auth logout` only revokes the key saved in the CLI config. It does not revoke an
  environment-only key; use `apikey revoke <apiKeyId>` for that key.
- For a passwordless agent account, an admin should use:

  ```sh
  tmj user create --name "Build Bot" --agent --with-key --json
  ```

## Use machine-readable output

Pass `--json` explicitly for automation even though non-TTY output usually becomes JSON.
Parse stdout only after a zero exit status; errors are written to stderr.

```sh
tmj task get ENG-42 --json
tmj task list --workspace ENG --limit 100 --json
```

Use `--quiet` only when its command-specific scalar output is known to be sufficient.
It often prints an ID, but task lists print task keys, attachment downloads print a path,
and credential-creation commands do not print the new token.

Exit codes:

| Code | Meaning                                                  |
| ---: | -------------------------------------------------------- |
|    0 | Success                                                  |
|    1 | Network, server, checksum, or unexpected failure         |
|    2 | CLI usage error                                          |
|    3 | Missing credentials, unauthenticated, or forbidden       |
|    4 | Not found or local resolver miss                         |
|    5 | Invalid input, conflict, upload too large, or rate limit |

There is no automatic retry. Inspect the JSON error code before deciding whether retrying
is safe, especially for exit 3 or 5.

## Follow a safe operating loop

For mutations, prefer this sequence:

1. Verify identity with `tmj auth whoami --json` when the credential context is not clear.
2. Read the target with `list` or `get`; capture exact IDs from JSON.
3. Confirm the workspace, task, current state, and destructive scope.
4. Make the smallest mutation.
5. Re-fetch the target and assert the resulting state rather than merely printing it.

For broad or destructive changes, save the before-state JSON to a protected location
outside the repository. Derive every mutation target from that discovery output; never
leave plausible example task keys or IDs in an executable block.

Prefer stable IDs for destructive operations and complete reorders. Human keys and names
are convenient for reads, but names can collide or drift.

Identifier rules:

- Workspace keys are uppercase, 2-6 alphanumeric characters, beginning with a letter.
- Task keys are uppercase workspace keys plus a positive number, such as `ENG-42`.
- Workspace and task `idOrKey` arguments accept ULIDs or keys.
- Status moves accept a status ID or case-insensitive status name, but require the
  `--status` flag: `tmj task move ENG-42 --status Done`.
- Assignment accepts a user ID, exact email, or `me`; it does not resolve display names.
- Task tags accept a tag ID or case-insensitive name.
- Task fields accept a field ID or case-insensitive name in `field=value` form.

Quote shell values beginning with `#`, such as colors.

## Find and work tasks

Find existing work before creating duplicates:

```sh
tmj search "bearing clearance" --json                       # global, permission-filtered
tmj search '"bearing clearance"' --workspace ENG --type comment --json
tmj search "calibration" --type attachment --json           # filename + supported text
tmj activity list --task ENG-42 --json                        # complete recorded ticket history
tmj activity list --workspace ENG --action comment.updated --json
tmj activity list --json                                     # global history you may read
```

Search results identify the matching task/comment/attachment and include a plain-text
snippet. Only accessible workspaces contribute results or counts. Text attachments up to
1 MiB are indexed; binary/large files are filename-only. Activity is newest-first and logs
successful mutations without credential values. Private account/inbox events stay
owner/admin-only. See the command reference for filters, pagination and exact coverage.

A typical agent loop is:

```sh
tmj inbox list --json
tmj task list --workspace ENG --assignee me --tag review --json
tmj task get ENG-42 --json
tmj task move ENG-42 --status "In Progress" --json

# Perform the work, then communicate and update explicit task state.
tmj comment add --task ENG-42 --body "Implemented and verified." --json
tmj task move ENG-42 --status Done --json
```

Personal queues are retired. Use task filters, tags, assignees, and explicit statuses.
Run `task links`, fetch each `blocked_by` task with `task get`, and inspect its state before
starting dependent work. Embedded link summaries are not enough to inspect blockers.
After completion, fetch the task and assert the intended status.

For bulk edits, first read the selected tasks and verify their workspace. Then use:

```sh
tmj task bulk ENG-1 ENG-2 --workspace ENG --status "In Progress" --add-tag review --json
tmj task bulk ENG-1 ENG-2 --workspace ENG --remove-tag review --unassign --json
tmj task reorder ENG-2 --before ENG-1 --json
tmj task list --workspace ENG --sort position --order asc --json
```

Bulk requests accept up to 200 unique tasks in one workspace and apply all or none.
`--add-tag` and `--remove-tag` preserve unrelated tags. Custom fields, archive, and restore
are also supported. Task reorder moves one task relative to an anchor; it does not need
every task ID. Manual order is shared by the workspace. Verify each selected task after a
bulk change. Do not assume a selected page represents all matching tasks.

### Watch messages

```sh
tmj inbox watch --json --cursor-file ~/.config/temujira/inbox-cursor.json
tmj inbox watch --after 0 --once --json
```

The watcher starts now unless a cursor is supplied. Zero replays retained events. `--once`
drains all pages and exits. Default polling is five seconds; `--interval` sets 1–300 seconds.
It emits read and unread notifications without marking them read. Current user/workspace
permissions apply on every poll. Send messages with comments and `--mention`, or replies.

Reading the inbox or opening a ticket does not mark notifications read. Use
`tmj inbox read <itemId> --json` to clear one item, using its inbox ID from `inbox list`.
Omitting the ID marks all accessible items read. A successful reply, including a question
answer, marks the replying user's existing notifications in that thread read. Other threads
and recipients stay unchanged; later incoming responses start unread. Reply to the actual
source comment ID to notify that comment's author, even when it is a nested reply.

`--json` emits NDJSON: `{type:"notification",cursor,item}` and `{type:"checkpoint",cursor}`.
Use `--after` or `--cursor-file`, not both. Cursor files are bound to the server and user,
and saved only after output succeeds. A crash can repeat a page; deduplicate by `item.id`.
Deleted items cannot be replayed. Temporary request failures retry; authentication failures
exit. Stop with Ctrl+C. Do not treat this stream as an exactly-once job runner.

Create or update tasks with repeated tag and field flags:

```sh
tmj task create --workspace ENG --title "Fix login redirect" \
  --tag bug --tag frontend --field Priority=high --json

tmj task update ENG-42 --field Priority=medium --field Estimate=3 --json
```

Task field updates are partial. An empty value clears that one field. By contrast,
supplying any `--tag` flags to `task update` replaces the task's complete tag set; read the
current task first and include every tag that should remain.

## Profile pictures

Use `tmj user avatar upload <file> --json` to set your picture, `user avatar download
--output <file>` to save it, and `user avatar remove` to use colored initials again.
Supported files: PNG, JPEG, GIF, WebP, up to 2 MB. Each command defaults to the caller;
`--user <idOrEmailOrMe>` selects another user. Changing another user's picture requires
`users:manage`; non-admin managers cannot change admin pictures. Download needs login.
The upload response is `{user}` with an `avatar_id`; no image bytes enter user JSON.

## Exclusive identity sessions

By default an identity is **shared**: several API keys (several agent threads) can use it
concurrently and they share its assignments, inbox and comment authorship. When that must
not happen, turn on the **exclusive** policy for that identity. Exclusive means exactly one
credential may act as the identity at a time — the active session's key.

```sh
# Configure (once; users:manage). Agent accounts only. Existing keys are suspended, not
# deleted, and no key is adopted as the owner.
tmj user update <userId> --exclusive --json

# Acquire: mint the session key (api_keys:manage). No ticket is named or touched.
tmj identity acquire <userId> --json      # prints the session key exactly once

# Use: run worker commands with the session key. `identity current` self-checks.
tmj identity current --json
tmj task update ENG-42 --title "..." --json

# Release: the worker does this itself with its own session key; no management scope.
tmj identity release <userId> --reason "job done" --json
```

Rules that change how you write automation:

- Only the session key may authenticate as the identity. Every other key of that identity —
  older keys, keys minted later — is rejected for reads, "my tasks", inbox, comments and
  writes alike, whether or not a session is active. Do not plan around a second key as a
  fallback; suspend-and-acquire is the only path.
- Acquisition is atomic: concurrent acquires conflict (409). Acquisition and release never
  assign or unassign tickets and never change task status, and need no ticket reference.
- Release revokes that session's key and makes the identity available; the next acquire
  mints a new key. An old key never regains access and cannot release a newer session.
- Releasing does not disable exclusive mode, and workers cannot change the policy
  (management must). To return to shared use, release the session first, then
  `tmj user update <userId> --shared`.
- Management recovery for a vanished worker: a caller with `api_keys:manage` runs
  `tmj identity release <userId> --reason "..."`. Quiesce the native process first — the
  identity can be acquired again immediately after release.
- No timeouts, heartbeats or completion detection: sessions stay active until released.
  Sessions survive server restarts.

## Collaborate through comments and links

Use both visible mention text and `--mention` so humans can read the comment and Temujira
can create the inbox notification:

```sh
tmj comment add --task ENG-42 \
  --body "@Ada can you review the migration?" \
  --mention ada@example.com --json
```

Questions require 2-10 repeated options. Answer indices are zero-based and require the
question comment ID:

```sh
tmj comment add --task ENG-42 --body "Which rollout?" \
  --question Canary --question All-at-once --json
tmj comment add --task ENG-42 --body "Canary" \
  --reply-to <question-comment-id> --answer 0 --json
```

Read link relations from the first task's point of view:

```sh
tmj task link ENG-42 blocks ENG-57 --json
tmj task link ENG-57 blocked_by ENG-42 --json  # equivalent direction
```

Allowed relations are `relates`, `blocks`, `blocked_by`, `absorbs`, and `absorbed_by`.
Cross-workspace links are allowed. `task link --archive` is only valid for absorption and
is not atomic: the link can be created even if the later archive operation fails.

## Treat broad mutations as destructive

The CLI does not ask for confirmation. Read the target first and obtain user confirmation
when intent is ambiguous or the operation is hard to reverse.

Pay particular attention to:

- `status delete`: hard-deletes a status and may move all referencing tasks via
  `--move-to`; a workspace's final status cannot be deleted.
- `tag delete`: hard-deletes the tag and unlinks it from every task.
- `field delete`: hard-deletes the field and all task values stored for it.
- `field update --options`: replaces the complete select option set.
- `task update --tag`: replaces the complete task tag set.
- `comment delete`: hard-deletes the comment; deleting a root also deletes replies and
  related attachments/notifications.
- `attach delete`: permanently deletes metadata and stored bytes.
- `inbox read` without an ID marks all accessible inbox items read. Prefer an explicit ID
  when resolving only one notification.
- Status and field reorders: require a fresh, complete list of all relevant IDs.
- `apikey revoke` and `user deactivate`: immediately stop affected credentials.

Changing select options does not migrate stored task values. Before removing an option,
list every task using the field, agree on how each old value maps to a retained option or
an empty value, and migrate those tasks explicitly. A temporary union of old and new
options can keep a multi-step migration resumable; narrow to the final options only after
all values have been verified.

Tasks and workspaces use reversible archive/unarchive operations; prefer those over trying
to invent deletion through the raw API.

## Use raw API only as an escape hatch

`tmj api` accepts a path relative to `/api/v1`; do not repeat that prefix:

```sh
tmj api GET /openapi.json
tmj api PATCH /tasks/ENG-42 --body '{"tag_ids":[]}'
tmj api POST /tasks/ENG-42/comments --body - < payload.json
```

Use it only when a dedicated CLI command cannot express the operation, such as clearing
all task tags. Dedicated attachment commands are required for multipart upload and binary
download. Inspect `/openapi.json` before constructing unfamiliar raw requests.
