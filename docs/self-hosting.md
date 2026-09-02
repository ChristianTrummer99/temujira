# Self-hosting Temujira

Temujira runs as one Node.js process serving both the API and the exported web app. Its
persistent state is one local SQLite database plus an uploads directory. Docker Compose is
the recommended deployment path; a bare Node.js deployment is also supported.

## Deployment constraints

- Run exactly one Temujira app process against a data directory. Do not run multiple
  replicas against the same SQLite database.
- Keep the data directory on reliable local storage, not an NFS/SMB network mount.
- Serve the web app and `/api/v1` from the same origin. Production cross-origin browser
  deployments and hosting below a URL subpath are not supported.
- Terminate TLS at a reverse proxy. Do not expose an unencrypted production login.
- Persist and back up the entire data directory, including both the database and uploads.

## Docker Compose

### Requirements

- Git
- Docker Engine with Docker Compose v2.20 or newer
- A DNS name and TLS-capable reverse proxy for an internet-facing deployment

### 1. Clone a pinned release

```sh
git clone https://github.com/ChristianTrummer99/temujira.git
cd temujira
git checkout <release-tag-or-commit>
```

Pinning a tag or commit identifies the application source used for upgrades and rollbacks.
For byte-for-byte image reproducibility, also retain the built image digest because the
Dockerfile currently uses the moving `node:22-slim` base tag. The checked-in Compose file
builds the selected source locally; it does not pull a published Temujira image.

### 2. Configure the service

```sh
cp .env.example .env
chmod 600 .env
mkdir -p data
chown -R 1000:1000 data
chmod 700 data
```

The container runs as uid 1000 (`node` user). The host `data` directory must be
owned by uid 1000 so the bind-mounted volume is writable inside the container.

The defaults bind Temujira to `127.0.0.1:3000`, which is appropriate when Caddy or nginx
runs on the same host. Important Compose values are:

```dotenv
TEMUJIRA_BIND=127.0.0.1
TEMUJIRA_PORT=3000
MAX_UPLOAD_MB=50
```

To provision the first administrator without a browser, also set:

```dotenv
TEMUJIRA_ADMIN_EMAIL=admin@example.com
TEMUJIRA_ADMIN_PASSWORD='use-a-long-random-password'
TEMUJIRA_ADMIN_NAME=Administrator
```

Use a long generated password. Single quotes keep characters such as `#`, `$`, and spaces
literal in Compose dotenv syntax. These provisioning values are read only while the
database has no users. After the first successful startup, remove all
`TEMUJIRA_ADMIN_*` lines from `.env`, force a container recreation, and verify the running
container no longer contains the email or password:

```sh
docker compose up -d --force-recreate app
docker compose exec app sh -c 'test -z "$TEMUJIRA_ADMIN_EMAIL$TEMUJIRA_ADMIN_PASSWORD"'
```

Do not commit `.env`. Keep the published port on loopback for production. Docker-published
ports can bypass common host-firewall rules, so changing `TEMUJIRA_BIND` to a public
address requires deliberate Docker-aware network controls.

The container runs as a non-root user (uid 1000) with a read-only root filesystem,
all Linux capabilities dropped, `no-new-privileges` enforced, and a 1 GB memory cap.
The `/tmp` tmpfs (64 MB) and the bind-mounted `/data` are the only writable paths.

Bootstrap values use the same validation as browser setup: a valid email, a nonblank name,
and an 8-256 character password. Invalid or partial values stop startup rather than opening
an unexpectedly unprovisioned service.

### 3. Build and start

```sh
docker compose build --pull
docker compose up -d --wait --wait-timeout 90
docker compose logs --tail=100 app
```

Verify the process and static web app:

```sh
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsSI http://127.0.0.1:3000/
```

The health response is a shallow liveness check. It does not verify database writes,
uploads, or web assets, so also test login and a representative attachment after a deploy.

### 4. Create the first administrator

If the environment provisioning values were set, startup creates the admin, a `START`
workspace, default statuses, and a welcome task before the port opens.

Otherwise, keep the new instance private and either:

- visit `http://127.0.0.1:3000` through an SSH tunnel or local browser and complete `/setup`;
  or
- run the bundled CLI (the variable avoids storing the password in shell history, although
  same-host process inspection can still see it briefly):

  ```bash
  read -rsp 'Admin password: ' TMJ_BOOTSTRAP_PASSWORD && printf '\n'
  docker compose exec app tmj setup \
    --url http://127.0.0.1:3000 \
    --email admin@example.com \
    --password "$TMJ_BOOTSTRAP_PASSWORD" \
    --name Administrator
  unset TMJ_BOOTSTRAP_PASSWORD
  ```

The setup endpoint is public only while there are no users. Do not expose a fresh instance
to the internet before provisioning it.

The container CLI stores its local config inside the disposable container. Its API key
remains valid in Temujira, but that config disappears when the container is recreated. For
long-lived automation, store an API key securely on the host or in your secret manager. If
the setup-created key is not needed, revoke it before recreating the container:

```sh
docker compose exec app tmj auth logout
```

`auth logout` reports a server-side revoke failure but still removes its local config and
exits successfully. Confirm that its human output says the API key was revoked. If not, use
another admin credential and the key ID shown during setup to run `tmj apikey revoke <id>`.

## TLS reverse proxy

The proxy must preserve the public host and overwrite forwarded protocol/client headers.
The app uses `X-Forwarded-Proto` for Secure cookies and host headers for its cookie-auth
origin check. The backend trusts forwarded headers, so only allow a trusted proxy to reach
the loopback-bound port.

### Caddy

```caddyfile
pm.example.com {
    request_body {
        max_size 55MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 2.10 or newer supplies the `request_body` limit shown here, the required forwarding
headers, and automatic TLS. Keep the proxy limit above `MAX_UPLOAD_MB` plus multipart
overhead; the app separately enforces a 2 MB JSON limit while streaming request bodies.

To rate-limit repeated login failures at the proxy layer (defense in depth over the
server-side in-memory limiter), use the Caddy `rate_limit` plugin or a Cloudflare/
Traefik rate-limiting middleware. A minimal Cloudflare example: create an Endpoint Rule
for `/api/v1/auth/login` that blocks requests exceeding 10/minute per IP.

Add HSTS, security headers, and a request-body cap at the Caddyfile level:

```caddyfile
pm.example.com {
    request_body {
        max_size 55MB
    }

    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "geolocation=(), camera=(), microphone=()"
    }

    reverse_proxy 127.0.0.1:3000
}
```

Do not publicly cache authenticated `/api/v1/attachments/*` responses.

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name pm.example.com;

    # Keep this above MAX_UPLOAD_MB plus multipart overhead.
    client_max_body_size 55m;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

For rate-limiting repeated login failures (defense in depth over the server-side
in-memory limiter), add an `limit_req_zone` + `limit_req` directive for `/api/v1/auth/login`.
A starting point:

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;

server {
    # ... inside the server block above ...
    location = /api/v1/auth/login {
        limit_req zone=login burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

Do not publicly cache authenticated `/api/v1/attachments/*` responses.

```sh
sudo nginx -t
sudo systemctl reload nginx
```

### Maintenance window

Before a restore or schema-changing upgrade, make the public virtual host return a static
`503` while leaving `127.0.0.1:3000` reachable for local checks. For example, temporarily
replace the Caddy route with:

```caddyfile
pm.example.com {
    respond "Temujira maintenance" 503
}
```

For nginx, temporarily replace the proxy location with `location / { return 503; }`. Validate
and reload the proxy, then confirm the public URL returns 503 before stopping Temujira. Keep
maintenance mode active until local login, task mutation, upload, and download checks pass.

## Persistent data

Docker stores state in the bind-mounted `./data` directory:

```text
data/
  temujira.db
  temujira.db-wal                 # may exist
  temujira.db-shm                 # may exist
  temujira.db.pre-migration-*.bak
  uploads/
```

SQLite uses WAL mode. The server runs pending migrations automatically before listening.
Before a migration of an existing database, it creates a consistent database-only snapshot
and keeps the three newest snapshots. Those files do not include uploads and are rollback
aids, not a complete backup strategy.

Do not place unrelated files or backups inside `data/uploads`; startup removes temporary
and unreferenced files there.

## Backups and restore

For a matched, point-in-time database and uploads backup, stop writes briefly and archive
the entire data directory:

```sh
set -eu
umask 077
backup="/safe/backups/temujira-$(date +%F-%H%M%S).tar.gz"
install -d -m 700 /safe/backups

docker compose stop app
trap 'docker compose start app >/dev/null' EXIT
tar -C . -czf "$backup" data
tar -tzf "$backup" >/dev/null
git rev-parse HEAD > "$backup.commit"
chmod 600 "$backup" "$backup.commit"
docker compose start app
trap - EXIT
```

Store backups off-host and test restoration periodically. The current image runs as root,
so host backup commands may require elevated permissions for bind-mounted files.

The archive contains a top-level `data/` directory. Restore it from the repository root so
you do not accidentally create `data/data/`:

```sh
set -eu
umask 077
backup=/safe/backups/temujira-YYYY-MM-DD-HHMMSS.tar.gz
old_data="data.before-restore-$(date +%F-%H%M%S)"
test -f "$backup"
test -f "$backup.commit"
tar -tzf "$backup" >/dev/null

# Select and build the backup's application version before touching live data.
restore_commit="$(cat "$backup.commit")"
git checkout "$restore_commit"
docker compose build

# Put the proxy in maintenance mode before this point.
docker compose stop app
if [ -d data ]; then mv data "$old_data"; fi
tar -C . -xzf "$backup"
test -f data/temujira.db
chmod -R go-rwx data
docker compose up -d --wait --wait-timeout 90
```

Verify health, login, a task read/write, an attachment download, and a new attachment upload
before leaving maintenance mode. Keep `$old_data` until verification is complete. If
restore fails, stop the app, move the failed `data` aside, and move `$old_data` back. On a
fresh host there is no `$old_data`; preserve the failed extraction for diagnosis and retry
from the untouched archive.

Do not mix a database snapshot with `-wal` or `-shm` files from another point in time. There
are no down migrations; rolling back application code after a schema migration requires a
matching pre-upgrade data backup.

## Upgrades

Compose builds from the current checkout. Build the new image while the old container is
still running, then block public traffic and take the final cold backup immediately before
cutover:

```sh
set -eu
umask 077
test -z "$(git status --porcelain)" || { printf '%s\n' 'working tree is not clean' >&2; exit 1; }
install -d -m 700 /safe/backups
old_commit="$(git rev-parse HEAD)"
git fetch --tags
git checkout <new-release-tag-or-commit>
docker compose build --pull

# Keep traffic blocked from this point until verification finishes.
backup="/safe/backups/temujira-upgrade-$(date +%F-%H%M%S).tar.gz"
docker compose stop app
tar -C . -czf "$backup" data
tar -tzf "$backup" >/dev/null
printf '%s\n' "$old_commit" > "$backup.commit"
chmod 600 "$backup" "$backup.commit"

docker compose up -d --wait --wait-timeout 90
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:3000/api/v1/health
```

Before reopening traffic, test login, a task mutation, an attachment upload, and an
attachment download. Never run old and new app processes concurrently against the same
data directory. Keep the manual backup until the upgrade is verified.

If backup creation fails before the new container starts, the old container and untouched
data still exist; run `docker compose start app`, return to the old commit, and investigate
before reopening traffic. Do not start old application code after the new version has
successfully migrated the database; use the full rollback procedure instead.

If rollback is required, keep traffic blocked and restore both code and data:

```sh
set -eu
umask 077
backup=/safe/backups/temujira-upgrade-YYYY-MM-DD-HHMMSS.tar.gz
test -f "$backup"
test -f "$backup.commit"
tar -tzf "$backup" >/dev/null
old_commit="$(cat "$backup.commit")"
git checkout "$old_commit"
docker compose build

docker compose stop app
mv data "data.failed-upgrade-$(date +%F-%H%M%S)"
tar -C . -xzf "$backup"
test -f data/temujira.db
chmod -R go-rwx data
docker compose up -d --wait --wait-timeout 90
```

Verify the restored version before reopening traffic. Writes accepted by the new version
after the backup are not present after rollback, which is why traffic stays blocked during
the verification window.

## Bare Node.js deployment

Use Node.js 22 and the pnpm version declared by the root `packageManager` field. Build on
the target OS and architecture because `better-sqlite3` is a native dependency. Clone and
pin the source as shown earlier, using `/opt/temujira` as the checkout in this example.

```sh
cd /opt/temujira
corepack enable
pnpm install --frozen-lockfile

# Empty means the web client calls same-origin /api/v1.
EXPO_PUBLIC_API_URL= pnpm build
```

Keep the production `node_modules`; the server bundle leaves third-party and native
dependencies external. Create a dedicated service account and private data directory on a
typical Linux host before the first start:

```sh
sudo useradd --system --user-group --home /var/lib/temujira \
  --shell /usr/sbin/nologin temujira
sudo install -d -m 0700 -o temujira -g temujira /var/lib/temujira
sudo chgrp -R temujira /opt/temujira
sudo chmod -R g+rX /opt/temujira
```

The process user needs full read/write access to `DATA_DIR` and read access to the checkout
and `WEB_DIST`. The server does not load `.env` itself, so inject variables through the
shell, systemd, or another process manager. A minimal `/etc/systemd/system/temujira.service`
is:

```ini
[Unit]
Description=Temujira
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=temujira
Group=temujira
WorkingDirectory=/opt/temujira
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/temujira
Environment=WEB_DIST=/opt/temujira/apps/web/dist
Environment=MAX_UPLOAD_MB=50
UMask=0077
ExecStart=/usr/bin/node /opt/temujira/apps/server/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Confirm the Node path with `command -v node`, then enable the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now temujira
sudo systemctl status temujira
```

Provision the first admin while the loopback service remains private, using the browser
through an SSH tunnel or temporary `TEMUJIRA_ADMIN_*` entries that you remove from the unit
after first startup. After removing temporary environment entries, run
`systemctl daemon-reload` and restart the service so the password leaves the process
environment.

For a consistent bare-server backup:

```sh
set -eu
umask 077
backup="/safe/backups/temujira-bare-$(date +%F-%H%M%S).tar.gz"
sudo install -d -m 0700 /safe/backups
sudo systemctl stop temujira
trap 'sudo systemctl start temujira >/dev/null' EXIT
sudo tar -C /var/lib -czf "$backup" temujira
sudo tar -tzf "$backup" >/dev/null
git -C /opt/temujira rev-parse HEAD | sudo tee "$backup.commit" >/dev/null
sudo chmod 600 "$backup" "$backup.commit"
sudo systemctl start temujira
trap - EXIT
```

For bare upgrades, build the new checkout in a separate release directory before entering
maintenance mode. Stop the service, take the final backup above without restarting it, swap
the `/opt/temujira` path to the new built release, and start the service. Keep the previous
release directory and backup until verification passes. Rollback requires stopping the
service, restoring both that previous release and its matching `/var/lib/temujira` archive,
then starting and verifying before reopening traffic.

`WEB_DIST` is required for the server to host the UI; without it, the API still works but
`/` returns a 404. Keep `EXPO_PUBLIC_API_URL` empty for the supported same-origin setup.

## Runtime configuration

| Variable                  | Default   | Notes                                                                  |
| ------------------------- | --------- | ---------------------------------------------------------------------- |
| `HOST`                    | `0.0.0.0` | Bare server listen address. Docker publishes through Compose.          |
| `PORT`                    | `3000`    | Internal HTTP port.                                                    |
| `DATA_DIR`                | `./data`  | Contains `temujira.db` and `uploads/`. Docker sets `/data`.            |
| `WEB_DIST`                | unset     | Exported web directory; unset means API-only. Docker sets `/app/web`.  |
| `NODE_ENV`                | unset     | Set exactly `production` outside development.                          |
| `MAX_UPLOAD_MB`           | `50`      | Positive per-file limit; invalid values stop startup.                  |
| `COOKIE_SECURE`           | auto      | Unset uses request protocol/`X-Forwarded-Proto`; `1` or `0` forces it. |
| `TEMUJIRA_ADMIN_EMAIL`    | unset     | First-boot provisioning only.                                          |
| `TEMUJIRA_ADMIN_PASSWORD` | unset     | Must accompany admin email.                                            |
| `TEMUJIRA_ADMIN_NAME`     | `Admin`   | Name for the provisioned first admin.                                  |
| `EXPO_PUBLIC_API_URL`     | empty     | Web build-time value; leave empty for same-origin.                     |

Every API route is under `/api/v1`. Runtime API discovery is available at
`/api/v1/openapi.json`.

## Operational checklist

- Pin a release commit or tag.
- Keep the app port private behind TLS.
- Provision the first admin before public exposure.
- Run only one app process per data directory.
- Monitor disk usage; there is no total upload quota.
- Back up the database and uploads together to another host.
- Verify more than the shallow health endpoint after deploys.
- Keep proxy upload limits above `MAX_UPLOAD_MB`.
- Do not use a URL subpath or a separate production browser API origin.
