# Temujira

**Self-hosted, open-source project management for humans and AI agents.**

JIRA-style ticket tracking, radically simplified: workspaces, tasks as stacked rows (no
kanban), user-editable statuses, assignees, markdown comments, file attachments — with a
first-class HTTP API and a `tmj` CLI so AI agents can be full team members.

Built for mixed human/agent teams: **@-mentions** and **threaded replies** feed a unified
cross-workspace **inbox**, comments can pose **multiple-choice questions** that get answered
with a reply, admin-managed **tags** group work across statuses, and every user — human or
agent — gets an **activity feed** and a **my tasks** view of everything they touched.

**Global search** finds tasks, discussions and files across your accessible workspaces,
with workspace/type filters and `Cmd/Ctrl+K` access. **Activity** records successful API
mutations, with global/workspace feeds and a ticket-level Activity tab. Markdown displays
support CommonMark and GitHub-flavored tables, nested lists, checklists, strikethrough,
autolinks and footnotes, with Write/Preview controls in composers.
File previews open almost full screen, with space around the edges to click and close.

> **The contract:** every action available in the web UI is also available via the API and
> the CLI. Agents authenticate with API keys and work tickets exactly like humans do.

## Quick start (Docker)

```sh
git clone https://github.com/ChristianTrummer99/temujira.git && cd temujira
docker compose up -d --build --wait --wait-timeout 90
# Visit http://localhost:3000; first visit creates the admin account.
```

Everything lives in `./data` (SQLite DB + uploaded files). One directory, one backup target.
The default Compose port is loopback-only so it can sit safely behind a host reverse proxy.
Keep it private until the first admin exists; the setup endpoint is public on a fresh
database.

Headless provisioning (no browser needed): copy `.env.example` to `.env`, set
`TEMUJIRA_ADMIN_EMAIL` and `TEMUJIRA_ADMIN_PASSWORD` before first boot, or follow the
complete container CLI setup in the [self-hosting guide](docs/self-hosting.md). The guide
also covers TLS, backups, upgrades, restore, and bare Node.js deployment.

## The CLI

AI agents working from this checkout should load
[the Temujira CLI skill](.agents/skills/temujira-cli/SKILL.md). It includes safe operating
workflows, identifier rules, destructive-action guardrails, and a complete command
reference.

The Docker image includes the CLI as `docker compose exec app tmj ...`. From a source
checkout, run it without relying on generated output via
`pnpm --filter @temujira/cli dev -- ...`. The examples below use `tmj` for readability.

```sh
# humans: interactive login stores an API key in ~/.config/temujira/config.json
tmj auth login --email you@example.com --url https://pm.example.com

# agents: pure environment auth, JSON output is automatic when piped
export TEMUJIRA_URL=https://pm.example.com
export TEMUJIRA_API_KEY=tmj_...

tmj workspace create --name Engineering --key ENG
tmj task create --workspace ENG --title "Ship v1" --description "- [ ] docs" --assignee me
tmj task list --workspace ENG --status "In Progress" --json
tmj task move ENG-42 --status Done
tmj comment add --task ENG-42 --body "Deployed in **v1.2.0**"
tmj attach upload --task ENG-42 ./build.log
tmj api GET /workspaces/ENG/tasks       # raw escape hatch: any API route
```

Working as part of a team — mentions, threads, questions and tags:

```sh
tmj tag create --workspace ENG --name Backend --color '#3b82f6'   # workspaces:manage
tmj task list --workspace ENG --tag Backend --group-by status

tmj comment add --task ENG-42 --body "@Ada can you review?" --mention ada@example.com
tmj comment add --task ENG-42 --body "Ship it today or tomorrow?" \
    --question "Today" --question "Tomorrow"
tmj comment add --task ENG-42 --body "Tomorrow" --reply-to <question-id> --answer 1

tmj inbox list          # mentions and replies aimed at you, across every workspace
tmj inbox read <itemId> # intentionally clear one notification (ID from inbox list)
tmj inbox read          # mark them all read
tmj task mine           # active tasks you created, were assigned, commented on or were mentioned in
tmj activity list --workspace ENG --mine
tmj activity list --task ENG-42
tmj activity list                           # global, filtered by your permissions
tmj search "calibration" --workspace ENG --type attachment --json
```

An agent's loop is usually: `tmj inbox list --json` → work the task → `tmj comment add`
→ `tmj task move`. Replies are one level deep (replying to a reply targets its root), so
threads stay flat enough to reason about.

Opening an inbox item keeps it unread and opens the exact source comment in the ticket.
The inbox shows the full comment and all question options. Replies also show the original
comment or question, including the selected answer when available.
Use the item's **Mark read** button to clear it. When the recipient replies in a thread
(including an answer to a question), their existing notifications in that thread become
read. Other threads and other recipients are not cleared. New responses arrive unread.

### Profile pictures

Set or remove your picture in **Settings → Profile**. User managers can also change pictures
in **Settings → Users**, including agent accounts. Without a picture, each user has initials
on a stable color derived from their user ID. Pictures support PNG, JPEG, GIF, and WebP,
up to 2 MB. They are stored in the data directory and included in instance backups.

```sh
tmj user avatar upload ./picture.png
tmj user avatar download --output ./saved-picture.png
tmj user avatar remove
```

Use `--user <userId>` to manage another user's picture with the `users:manage` scope.
Non-admin managers cannot change an admin's picture. Downloads require authentication.

Exit codes: `0` ok · `1` server/network · `2` usage · `3` auth · `4` not found ·
`5` invalid/conflict. `--json` forces machine output; `--quiet` emits compact,
command-specific output such as an ID, task key, or downloaded path.

### Onboarding an agent

```sh
tmj user create --name "Build Bot" --agent --with-key
# prints the bot's API key once — hand it to your agent as TEMUJIRA_API_KEY
```

Agent accounts have no email or password (API-key-only) and can be `member` or `admin` like anyone
else. Deactivate an agent with `tmj user deactivate <id>`; its keys stop working instantly.

Use one shared identity and API key for normal agent sessions. Existing `TEMUJIRA_URL`
and `TEMUJIRA_API_KEY` variables continue to work. `tmj auth status` shows the active
identity and credential source without showing the key.

To save an existing key, send it through standard input:

```sh
tmj auth use-key --url https://pm.example.com --key-stdin < /secure/agent-key
# Optional: a different key for this directory and its children.
tmj auth use-key --url https://pm.example.com --directory . --key-stdin < /secure/project-key
tmj auth forget --directory .   # remove the binding; the shared key stays active
```

Credentials are stored with mode 0600 under the user's Temujira config directory, never
inside the project. Precedence: flags → nearest directory binding → environment → shared
config. `--global-auth` skips directory bindings. `auth forget` removes stored credentials
without revocation. `auth logout` revokes only a global key minted by CLI login/setup;
imported shared keys have no automatic revocation ID.

### Task selection and order

Use row checkboxes to select tasks. The toolbar applies a status, assignee, tag, or archive
change to the selection. “Select visible tasks” covers expanded groups on the current page.
Selection clears when filters or pages change. Tags have separate add/remove actions.

Choose **Manual order** and drag a row handle. Drag between status groups to change status
and position together. Click the handle for Move up/Move down, or use Alt + ↑ / ↓.
Status and tag controls also work directly in each row. The Filters button opens the filter
controls; active filter chips can be cleared one at a time.

```sh
tmj task bulk ENG-1 ENG-2 --workspace ENG --status "In Progress" --add-tag review --json
tmj task reorder ENG-2 --before ENG-1 --json
tmj task list --workspace ENG --sort position --order asc --unassigned --json
```

Bulk changes accept up to 200 tasks from one workspace and apply all or none. Task order
is shared by the workspace. Personal queues have been removed; old stored rows and audit
history are retained.

### Watch notifications

```sh
tmj inbox watch --json --cursor-file ~/.config/temujira/inbox-cursor.json
tmj inbox watch --after 0 --once --json   # replay retained events, then exit
```

The watcher starts with new events by default and polls every five seconds. It follows
mentions and replies for the active identity, with current workspace access checks.
It does not mark items read. JSON output is one object per line: `notification` records
contain `cursor` and `item`; `checkpoint` records contain the resume `cursor`.
Use `--after` or `--cursor-file`, not both. A cursor file is tied to its server and user.
Delivery can repeat after an interrupted output/checkpoint write; deduplicate by inbox
item ID. Deleted notifications are no longer available for replay. Temporary request
failures retry with a delay; authentication failures exit. Stop with Ctrl+C.
The web inbox and unread badge check for changes every 15 seconds.

## The API

Everything is under `/api/v1` — plain REST + JSON, documented by the server itself at
`/api/v1/openapi.json`. Authenticate with `Authorization: Bearer tmj_…` (API key) or
`Bearer tms_…` (session token from `POST /api/v1/auth/login`). Browser login also sets an
HttpOnly cookie; the web client uses that cookie. Native clients use the returned token.
Use HTTPS in production.

## Development

```sh
pnpm install
pnpm dev            # API server on :3000 (tsx watch)
pnpm dev:web        # Expo dev server on :8081 (press w for web)
pnpm test           # all unit/integration tests
pnpm e2e            # full acceptance: builds the Docker image and drives the real CLI
```

Monorepo layout: `apps/server` (Hono + SQLite/Drizzle), `apps/web` (Expo +
react-native-reusables; web today, iOS/Android later), `apps/cli` (`tmj`),
`packages/shared` (zod route registry — **the contract**), `packages/client` (typed API
client used by both the web app and the CLI).

## Self-hosting

Temujira is one app process with one persistent data directory. The recommended deployment
is Docker Compose behind a TLS-terminating reverse proxy:

```caddyfile
pm.example.com {
    request_body {
        max_size 55MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

The complete [self-hosting guide](docs/self-hosting.md) covers first-admin provisioning,
Caddy/nginx headers, Docker and bare Node.js installs, persistent files, consistent backups,
restore, and source-based upgrades. Keep the web app and API on the same origin, use local
storage for SQLite, and run only one app process per data directory.

## Design decisions (v1)

- **SQLite on purpose.** A self-hosted team tool doesn't need Postgres ops. One process,
  one file, WAL mode; `sqlite3` CLI debuggability. The storage layer is swappable later.
- **Global roles with scopes and workspace access.** Roles are `admin` and `member`.
  Members can have a workspace allowlist and capability grants; admins have full access.
- **Archive, don't delete.** Workspaces and tasks archive/unarchive; users deactivate.
  Taxonomy, comments, attachments, and links can hard-delete, so inspect
  targets before destructive CLI/API calls (deleting a root comment also takes its replies).
- **Threads are one level deep.** Replying to a reply targets its root, so a discussion is
  always a root plus its replies — never a tree you have to walk.
- **Explicit write scopes.** Task edits need `tasks:write`. Status and tag definitions
  need `workspaces:manage`.
- **Mentions notify, descriptions don't.** `@`-mentions in comments create inbox items;
  mentions in task descriptions render as links but stay quiet.
- **No kanban.** Tasks are stacked rows, the way a backlog actually gets worked.
- **Email/password only.** No OAuth in v1.

## License

MIT
