#!/usr/bin/env bash
# End-to-end acceptance test: builds the Docker image, boots it, and drives the REAL tmj
# CLI through the full product narrative. Exit 0 = v1 acceptance passes.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3789}"
IMG=temujira:e2e
CTR=temujira-e2e
export HOME_DIR="$(mktemp -d)" # isolated CLI config
DATA_TMP="$(mktemp -d)"
FAILED=0

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die() { printf '\033[31mE2E FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() {
  docker rm -f "$CTR" >/dev/null 2>&1 || true
  rm -rf "$HOME_DIR" "$DATA_TMP" 2>/dev/null || true
}
trap cleanup EXIT

tmj() { HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" node apps/cli/dist/index.js "$@"; }

say "Build CLI"
pnpm --filter @temujira/cli build >/dev/null

say "Build Docker image"
docker build -t "$IMG" . >/dev/null || die "docker build"

say "Boot container"
docker rm -f "$CTR" >/dev/null 2>&1 || true
docker run -d --name "$CTR" -p "$PORT:3000" -v "$DATA_TMP:/data" "$IMG" >/dev/null

say "Wait for health"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && die "server never became healthy"
  sleep 1
done
curl -fsS "http://localhost:$PORT/api/v1/health" | jq -e '.ok == true' >/dev/null || die "health payload"

say "First-run setup via CLI"
tmj --url "http://localhost:$PORT" setup --email admin@e2e.test --password e2e-password-1 --name "E2E Admin" || die "setup"
tmj auth whoami --json | jq -e '.user.role == "admin"' >/dev/null || die "whoami"

say "Setup self-disables"
curl -fsS "http://localhost:$PORT/api/v1/setup" | jq -e '.needsSetup == false' >/dev/null || die "needsSetup should be false"

say "Getting-started workspace was seeded"
tmj workspace list --json | jq -e '.items | map(.key) | index("START") != null' >/dev/null || die "START workspace missing"

say "Workspace CRUD + archive"
tmj workspace create --name "Engineering" --key ENG --json | jq -e '.workspace.key == "ENG"' >/dev/null || die "ws create"
tmj workspace archive START >/dev/null || die "ws archive"
tmj workspace list --json | jq -e '.items | map(.key) | index("START") == null' >/dev/null || die "archived ws still listed"
tmj workspace list --archived --json | jq -e '.items | map(.key) | index("START") != null' >/dev/null || die "archived ws not in --archived"
tmj workspace unarchive START >/dev/null || die "ws unarchive"

say "Statuses: defaults, create, reorder, delete-with-move"
tmj status list --workspace ENG --json | jq -e '.items | length == 3' >/dev/null || die "default statuses"
tmj status create --workspace ENG --name "In Review" --color '#a855f7' --json | jq -e '.status.name == "In Review"' >/dev/null || die "status create"
STATUS_IDS=$(tmj status list --workspace ENG --json | jq -r '.items | map(.id) | join(" ")')
# reverse the order (portable tac)
REVERSED=$(echo "$STATUS_IDS" | tr ' ' '\n' | awk '{a[NR]=$0} END{for(i=NR;i>0;i--)print a[i]}' | tr '\n' ' ')
# shellcheck disable=SC2086
tmj status reorder --workspace ENG $REVERSED >/dev/null || die "status reorder"
tmj status list --workspace ENG --json | jq -e '.items[0].name == "In Review"' >/dev/null || die "reorder did not apply"

say "Tasks: create, list, filters, move, assign"
T1=$(tmj task create --workspace ENG --title "Ship the API" --description "**bold** markdown body" --json | jq -r '.task.key')
T2=$(tmj task create --workspace ENG --title "Fix the login bug" --json | jq -r '.task.key')
[ -n "$T1" ] && [ -n "$T2" ] || die "task create"
tmj task list --workspace ENG --json | jq -e '.total == 2' >/dev/null || die "task list total"
tmj task list --workspace ENG --search login --json | jq -e '.total == 1' >/dev/null || die "task search"
tmj task move "$T1" --status "Done" >/dev/null || die "task move by status name"
tmj task get "$T1" --json | jq -e '.task.status.name == "Done"' >/dev/null || die "status did not move"
tmj task assign "$T1" --user admin@e2e.test >/dev/null || die "assign by email"
tmj task get "$T1" --json | jq -e '.task.assignee.email == "admin@e2e.test"' >/dev/null || die "assignee"
tmj task unassign "$T1" >/dev/null && tmj task get "$T1" --json | jq -e '.task.assignee == null' >/dev/null || die "unassign"

say "Task archive"
tmj task archive "$T2" >/dev/null || die "task archive"
tmj task list --workspace ENG --json | jq -e '.total == 1' >/dev/null || die "archived task still listed"
tmj task list --workspace ENG --archived --json | jq -e '.total == 2' >/dev/null || die "archived filter"
tmj task unarchive "$T2" >/dev/null || die "task unarchive"

say "Comments with markdown"
C1=$(tmj comment add --task "$T1" --body "Looks good to me. \`code\` and **bold**." --json | jq -r '.comment.id')
[ -n "$C1" ] || die "comment add"
tmj comment list --task "$T1" --json | jq -e '.items | length == 1' >/dev/null || die "comment list"

say "Attachments: upload, download, checksum, comment attachment"
echo "e2e attachment payload $(date +%s)" > "$HOME_DIR/upload.txt"
A1=$(tmj attach upload --task "$T1" "$HOME_DIR/upload.txt" --json | jq -r '.attachment.id')
[ -n "$A1" ] || die "attach upload"
tmj attach download "$A1" -o "$HOME_DIR/download.txt" >/dev/null || die "attach download"
cmp -s "$HOME_DIR/upload.txt" "$HOME_DIR/download.txt" || die "attachment bytes differ"
A2=$(tmj attach upload --comment "$C1" "$HOME_DIR/upload.txt" --json | jq -r '.attachment.id')
[ -n "$A2" ] || die "comment attachment"
tmj attach delete "$A2" >/dev/null || die "attach delete"

say "Agent onboarding: agent user + API key, works via env auth"
AGENT_KEY=$(tmj user create --email bot@e2e.test --name "Build Bot" --agent --with-key --json | jq -r '.token // .apiKey_token // .key // empty')
if [ -z "$AGENT_KEY" ]; then
  # fall back: mint explicitly
  AGENT_ID=$(tmj user list --json | jq -r '.items[] | select(.email == "bot@e2e.test") | .id')
  AGENT_KEY=$(tmj apikey create --name provisioning --user "$AGENT_ID" --json | jq -r '.token')
fi
[ -n "$AGENT_KEY" ] || die "agent key"
TEMUJIRA_URL="http://localhost:$PORT" TEMUJIRA_API_KEY="$AGENT_KEY" HOME="$HOME_DIR" \
  node apps/cli/dist/index.js auth whoami --json | jq -e '.user.is_agent == true' >/dev/null || die "agent env auth"
TEMUJIRA_URL="http://localhost:$PORT" TEMUJIRA_API_KEY="$AGENT_KEY" HOME="$HOME_DIR" \
  node apps/cli/dist/index.js comment add --task "$T1" --body "Agent reporting in." >/dev/null || die "agent comment"

say "Agent cannot use admin routes"
set +e
TEMUJIRA_URL="http://localhost:$PORT" TEMUJIRA_API_KEY="$AGENT_KEY" HOME="$HOME_DIR" \
  node apps/cli/dist/index.js user create --email x@x.co --name X --agent --json >/dev/null 2>&1
RC=$?
set -e
[ "$RC" = 3 ] || die "member agent creating users should exit 3, got $RC"

say "Key revocation"
AGENT_ID=$(tmj user list --json | jq -r '.items[] | select(.email == "bot@e2e.test") | .id')
KEY_ID=$(tmj apikey list --user "$AGENT_ID" --json | jq -r '.items[0].id')
tmj apikey revoke "$KEY_ID" >/dev/null || die "revoke"
set +e
TEMUJIRA_URL="http://localhost:$PORT" TEMUJIRA_API_KEY="$AGENT_KEY" HOME="$HOME_DIR" \
  node apps/cli/dist/index.js auth whoami >/dev/null 2>&1
RC=$?
set -e
[ "$RC" = 3 ] || die "revoked key should exit 3, got $RC"

say "Negative paths: wrong password (exit 3), missing task (exit 4)"
set +e
tmj api POST /auth/login --body '{"email":"admin@e2e.test","password":"wrong"}' >/dev/null 2>&1; RC1=$?
tmj task get ENG-999 >/dev/null 2>&1; RC2=$?
set -e
[ "$RC1" = 3 ] || die "wrong password exit code: $RC1"
[ "$RC2" = 4 ] || die "missing task exit code: $RC2"

say "Web app is served"
curl -fsS "http://localhost:$PORT/" | grep -qi "<html" || die "web root did not return HTML"
curl -fsS "http://localhost:$PORT/api/v1/openapi.json" | jq -e '.openapi' >/dev/null || die "openapi"

say "ALL E2E CHECKS PASSED"
