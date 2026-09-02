# Temujira

**Self-hosted, open-source project management for humans and AI agents.**

JIRA-style ticket tracking, radically simplified: workspaces, tasks as stacked rows (no
kanban), user-editable statuses, assignees, markdown comments, file attachments — with a
first-class HTTP API and a `tmj` CLI so AI agents can be full team members.

Built for mixed human/agent teams: **@-mentions** and **threaded replies** feed a unified
cross-workspace **inbox**, comments can pose **multiple-choice questions** that get answered
with a reply, admin-managed **tags** group work across statuses, and every user — human or
agent — gets an **activity feed** and a **my tasks** view of everything they touched.

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
tmj tag create --workspace ENG --name Backend --color '#3b82f6'   # admin only
tmj task list --workspace ENG --tag Backend --group-by status

tmj comment add --task ENG-42 --body "@Ada can you review?" --mention ada@example.com
tmj comment add --task ENG-42 --body "Ship it today or tomorrow?" \
    --question "Today" --question "Tomorrow"
tmj comment add --task ENG-42 --body "Tomorrow" --reply-to <question-id> --answer 1

tmj inbox list          # mentions and replies aimed at you, across every workspace
tmj inbox read          # mark them all read
tmj task mine           # active tasks you created, were assigned, commented on or were mentioned in
tmj activity list --workspace ENG --mine
```

An agent's loop is usually: `tmj inbox list --json` → work the task → `tmj comment add`
→ `tmj task move`. Replies are one level deep (replying to a reply targets its root), so
threads stay flat enough to reason about.

Exit codes: `0` ok · `1` server/network · `2` usage · `3` auth · `4` not found ·
`5` invalid/conflict. `--json` forces machine output; `--quiet` emits compact,
command-specific output such as an ID, task key, or downloaded path.

### Onboarding an agent

```sh
tmj user create --email bot@example.com --name "Build Bot" --agent --with-key
# prints the bot's API key once — hand it to your agent as TEMUJIRA_API_KEY
```

Agent accounts have no password (API-key-only) and can be `member` or `admin` like anyone
else. Deactivate an agent with `tmj user deactivate <id>`; its keys stop working instantly.

## The API

Everything is under `/api/v1` — plain REST + JSON, documented by the server itself at
`/api/v1/openapi.json`. Authenticate with `Authorization: Bearer tmj_…` (API key) or
`Bearer tms_…` (session token from `POST /api/v1/auth/login`). Browser login also sets an
HttpOnly cookie; the current web client sends the returned session token as a bearer token.
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
- **Global roles, no per-workspace membership.** Every member sees every workspace —
  it's a small-team tool. Roles are `admin` and `member`.
- **Archive, don't delete.** Workspaces and tasks archive/unarchive; users deactivate.
  Taxonomy, comments, attachments, links, and queue entries can hard-delete, so inspect
  targets before destructive CLI/API calls (deleting a root comment also takes its replies).
- **Threads are one level deep.** Replying to a reply targets its root, so a discussion is
  always a root plus its replies — never a tree you have to walk.
- **Statuses are member-editable, tags are admin-managed.** Statuses change constantly
  during work; tags are taxonomy and shouldn't drift per-person.
- **Mentions notify, descriptions don't.** `@`-mentions in comments create inbox items;
  mentions in task descriptions render as links but stay quiet.
- **No kanban.** Tasks are stacked rows, the way a backlog actually gets worked.
- **Email/password only.** No OAuth in v1.

## License

MIT
