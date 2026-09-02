---
name: temujira-cli
description: Operate Temujira safely through its `tmj` CLI. Use this skill whenever an AI agent needs to inspect or change Temujira workspaces, tasks, statuses, tags, custom fields, links, comments, inbox items, personal queues, attachments, users, or API keys; receives a task key such as ENG-42; or is asked to update a ticket, check what to work on, leave a project update, or automate project work, even when the user does not explicitly mention `tmj`.
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

Explicit `--url` and `--api-key` override environment variables. Environment variables
override `$XDG_CONFIG_HOME/temujira/config.json` or
`~/.config/temujira/config.json`.

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
  tmj user create --email bot@example.com --name "Build Bot" --agent --with-key --json
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
- Queue state/remove commands accept a queue-entry ID, task ID, or task key. Queue reorder
  accepts queue-entry IDs only.

Quote shell values beginning with `#`, such as colors.

## Work tasks and queues

A typical agent loop is:

```sh
tmj inbox list --json
tmj queue next --json
tmj task get ENG-42 --json
tmj queue start ENG-42 --json

# Perform the work, then communicate and update explicit task state.
tmj comment add --task ENG-42 --body "Implemented and verified." --json
tmj task move ENG-42 --status Done --json
tmj queue complete ENG-42 --json
```

Queue state is personal metadata, independent of task status:

- `queue start`, `queue ready`, and `queue pause` set `running`, `ready`, and `queued`.
- `queue next` returns the first running entry, otherwise ready, otherwise queued.
- `queue complete` and `queue remove` only remove the queue entry. They never mark the
  task Done.
- A blocked flag is advisory and derived from task links. Run `task links`, fetch every
  `blocked_by` task with `task get`, and inspect its full state before proceeding. Do not
  treat embedded link summaries as sufficient blocker inspection.

After completion, assert that the task has the intended status and that the selected queue
entry ID is absent. A final `task get` or `queue list` that is not checked is not verification.

Create or update tasks with repeated tag and field flags:

```sh
tmj task create --workspace ENG --title "Fix login redirect" \
  --tag bug --tag frontend --field Priority=high --json

tmj task update ENG-42 --field Priority=medium --field Estimate=3 --json
```

Task field updates are partial. An empty value clears that one field. By contrast,
supplying any `--tag` flags to `task update` replaces the task's complete tag set; read the
current task first and include every tag that should remain.

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
- `inbox read`: marks every inbox item read; there is no single-item command.
- Status, field, and queue reorders: require a fresh, complete list of all relevant IDs.
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
