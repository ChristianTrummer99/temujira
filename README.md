# Temujira

**Self-hosted, open-source project management for humans and AI agents.**

JIRA-style ticket tracking, radically simplified: workspaces, tasks as stacked rows (no
kanban), user-editable statuses, assignees, markdown comments, file attachments — with a
first-class HTTP API and a `tmj` CLI so AI agents can be full team members.

> **The contract:** every action available in the web UI is also available via the API and
> the CLI. Agents authenticate with API keys and work tickets exactly like humans do.

## Quick start (Docker)

```sh
git clone <this-repo> temujira && cd temujira
docker compose up -d
open http://localhost:3000        # first visit walks you through creating the admin account
```

Everything lives in `./data` (SQLite DB + uploaded files). One directory, one backup target.

Headless provisioning (no browser needed): set `TEMUJIRA_ADMIN_EMAIL` and
`TEMUJIRA_ADMIN_PASSWORD` in the environment before first boot, or run
`tmj setup --url http://localhost:3000 --email you@example.com --password …`.

## The CLI

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

Exit codes: `0` ok · `1` server/network · `2` usage · `3` auth · `4` not found ·
`5` invalid/conflict. `--json` forces machine output, `--quiet` prints ids only.

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
`Bearer tms_…` (session token from `POST /api/v1/auth/login`). Browsers use the HttpOnly
session cookie instead.

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

## Deploying on a VPS

Temujira is a single container with a single volume. Run it behind any TLS-terminating
reverse proxy:

```caddyfile
pm.example.com {
    reverse_proxy localhost:3000
}
```

nginx equivalent: proxy_pass with `proxy_set_header Host $host;` and
`proxy_set_header X-Forwarded-Proto $scheme;`. The server uses `X-Forwarded-Proto` to turn
on Secure cookies and `Host`/`X-Forwarded-Host` for its CSRF origin check — no base-URL
configuration needed. No Kubernetes required, on purpose.

### Backups

The `data` directory is everything. For a live, consistent snapshot don't copy the DB file
raw — use SQLite's backup command, then copy uploads:

```sh
sqlite3 ./data/temujira.db ".backup ./backups/temujira-$(date +%F).db"
cp -R ./data/uploads ./backups/uploads-$(date +%F)
```

Upgrades: pull a new image and restart — migrations run automatically at boot, and the
server snapshots the DB (`temujira.db.pre-migration-*.bak`, last 3 kept) before applying
them.

## Design decisions (v1)

- **SQLite on purpose.** A self-hosted team tool doesn't need Postgres ops. One process,
  one file, WAL mode; `sqlite3` CLI debuggability. The storage layer is swappable later.
- **Global roles, no per-workspace membership.** Every member sees every workspace —
  it's a small-team tool. Roles are `admin` and `member`.
- **Archive, don't delete.** Workspaces and tasks archive/unarchive; users deactivate.
  Only comments and attachments hard-delete.
- **No kanban.** Tasks are stacked rows, the way a backlog actually gets worked.
- **Email/password only.** No OAuth in v1.

## License

MIT
