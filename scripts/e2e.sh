#!/usr/bin/env bash
# End-to-end acceptance test: boots the server and drives the REAL tmj CLI through the full
# product narrative. Exit 0 = acceptance passes.
#
#   scripts/e2e.sh              # docker mode: builds the image and runs it (full acceptance)
#   E2E_MODE=local scripts/e2e.sh   # local mode: runs the built server directly (fast)
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-3789}"
MODE="${E2E_MODE:-docker}"
IMG=temujira:e2e
CTR=temujira-e2e
export HOME_DIR="$(mktemp -d)" # isolated CLI config
DATA_TMP="$(mktemp -d)"
SERVER_PID=""

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die() { printf '\033[31mE2E FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  docker rm -f "$CTR" >/dev/null 2>&1 || true
  rm -rf "$HOME_DIR" "$DATA_TMP" 2>/dev/null || true
}
trap cleanup EXIT

tmj() { HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" node apps/cli/dist/index.js "$@"; }

say "Build CLI"
pnpm --filter @temujira/cli build >/dev/null

if [ "$MODE" = "local" ]; then
  say "Build and boot server locally"
  pnpm --filter @temujira/server build >/dev/null || die "server build"
  DATA_DIR="$DATA_TMP" PORT="$PORT" WEB_DIST=apps/web/dist node apps/server/dist/index.js >"$HOME_DIR/server.log" 2>&1 &
  SERVER_PID=$!
else
  say "Build Docker image"
  docker build -t "$IMG" . >/dev/null || die "docker build"

  say "Boot container"
  docker rm -f "$CTR" >/dev/null 2>&1 || true
  docker run -d --name "$CTR" -p "$PORT:3000" -v "$DATA_TMP:/data" "$IMG" >/dev/null
fi

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

say "Tags: admin CRUD, task tagging, filter by tag"
TAG_BACKEND=$(tmj tag create --workspace ENG --name Backend --color '#3b82f6' --json | jq -r '.tag.id')
TAG_URGENT=$(tmj tag create --workspace ENG --name Urgent --color '#ef4444' --json | jq -r '.tag.id')
[ -n "$TAG_BACKEND" ] && [ -n "$TAG_URGENT" ] || die "tag create"
tmj tag list --workspace ENG --json | jq -e '.items | length == 2' >/dev/null || die "tag list"
tmj task update "$T1" --tag Backend --tag Urgent >/dev/null || die "task tagging by name"
tmj task get "$T1" --json | jq -e '.task.tags | length == 2' >/dev/null || die "task tags not embedded"
tmj task list --workspace ENG --tag Backend --json | jq -e '.total == 1' >/dev/null || die "tag filter"
tmj task update "$T1" --tag Backend >/dev/null || die "tag replace"
tmj task get "$T1" --json | jq -e '.task.tags | length == 1' >/dev/null || die "tag set was not replaced"
tmj tag update "$TAG_URGENT" --name Critical --json | jq -e '.tag.name == "Critical"' >/dev/null || die "tag rename"
tmj tag delete "$TAG_URGENT" >/dev/null || die "tag delete"
tmj tag list --workspace ENG --json | jq -e '.items | length == 1' >/dev/null || die "tag not removed"

say "Comment threading: replies collapse to one level"
ROOT=$(tmj comment add --task "$T1" --body "Root comment" --json | jq -r '.comment.id')
REPLY=$(tmj comment add --task "$T1" --body "A reply" --reply-to "$ROOT" --json | jq -r '.comment.parent_id')
[ "$REPLY" = "$ROOT" ] || die "reply parent mismatch"
REPLY_ID=$(tmj comment add --task "$T1" --body "Second reply" --reply-to "$ROOT" --json | jq -r '.comment.id')
NESTED=$(tmj comment add --task "$T1" --body "Reply to a reply" --reply-to "$REPLY_ID" --json | jq -r '.comment.parent_id')
[ "$NESTED" = "$ROOT" ] || die "reply-to-reply should collapse to root, got $NESTED"
tmj comment list --task "$T1" --json | jq -e --arg r "$ROOT" '.items | map(select(.id == $r)) | .[0].replies | length == 3' >/dev/null || die "replies not nested"
tmj comment list --task "$T1" --json | jq -e --arg id "$REPLY_ID" '.items | map(.id) | index($id) == null' >/dev/null || die "reply leaked to top level"

say "Question comments answered via child reply"
Q=$(tmj comment add --task "$T1" --body "Ship today or tomorrow?" --question "Today" --question "Tomorrow" --json | jq -r '.comment.id')
tmj comment list --task "$T1" --json | jq -e --arg q "$Q" '.items[] | select(.id == $q) | .question.options | length == 2' >/dev/null || die "question options"
tmj comment add --task "$T1" --body "Tomorrow works" --reply-to "$Q" --answer 1 >/dev/null || die "answer via reply"
tmj comment list --task "$T1" --json | jq -e --arg q "$Q" '.items[] | select(.id == $q) | .question.answer_option_index == 1' >/dev/null || die "answer not recorded on question"

say "Mentions land in the mentioned user's inbox"
MEMBER_PW=member-pass-123
tmj user create --email dev@e2e.test --name "Dev Human" --password "$MEMBER_PW" >/dev/null || die "member create"
tmj user search dev --json | jq -e '.items | map(.email) | index("dev@e2e.test") != null' >/dev/null || die "user search"
tmj comment add --task "$T1" --body "Please review @Dev Human" --mention dev@e2e.test >/dev/null || die "mention comment"
MEMBER_KEY=$(tmj apikey create --name dev-cli --user "$(tmj user list --json | jq -r '.items[] | select(.email=="dev@e2e.test") | .id')" --json | jq -r '.token')
[ -n "$MEMBER_KEY" ] || die "member key"
as_member() { TEMUJIRA_URL="http://localhost:$PORT" TEMUJIRA_API_KEY="$MEMBER_KEY" HOME="$HOME_DIR" node apps/cli/dist/index.js "$@"; }
as_member inbox list --json | jq -e '.unread >= 1 and (.items[0].kind == "mention")' >/dev/null || die "mention did not reach inbox"
as_member inbox list --json | jq -e '.items[0].task_key != null and .items[0].workspace.key == "ENG"' >/dev/null || die "inbox item missing task/workspace context"

say "Replies notify the parent author; mark-read clears the inbox"
MEMBER_ROOT=$(as_member comment add --task "$T1" --body "Member question here" --json | jq -r '.comment.id')
tmj comment add --task "$T1" --body "Admin answering" --reply-to "$MEMBER_ROOT" >/dev/null || die "admin reply"
as_member inbox list --json | jq -e '[.items[] | select(.kind == "reply")] | length >= 1' >/dev/null || die "reply did not reach inbox"
as_member inbox read --json | jq -e '.ok == true and .updated >= 1' >/dev/null || die "mark read"
as_member inbox list --json | jq -e '.unread == 0 and (.items | length == 0)' >/dev/null || die "inbox not cleared"
as_member inbox list --all --json | jq -e '.items | length >= 1' >/dev/null || die "--all should show read items"

say "Self-mention does not notify"
BEFORE=$(tmj inbox list --all --json | jq -r '.total')
tmj comment add --task "$T1" --body "Note to self @E2E Admin" --mention admin@e2e.test >/dev/null || die "self mention comment"
AFTER=$(tmj inbox list --all --json | jq -r '.total')
[ "$BEFORE" = "$AFTER" ] || die "self-mention should not create an inbox item ($BEFORE -> $AFTER)"

say "Activity feed and my tasks"
tmj activity list --workspace ENG --json | jq -e '[.items[].action] | index("task.created") != null' >/dev/null || die "activity feed missing task.created"
tmj activity list --workspace ENG --json | jq -e '[.items[].action] | index("comment.created") != null' >/dev/null || die "activity feed missing comment.created"
tmj activity list --workspace ENG --mine --json | jq -e '.items | length >= 1' >/dev/null || die "mine activity"
tmj task mine --json | jq -e '.total >= 1' >/dev/null || die "task mine"
as_member task mine --json | jq -e '[.items[].key] | index("'"$T1"'") != null' >/dev/null || die "mentioned user should be associated with the task"

say "Tag writes are admin-only"
set +e
as_member tag create --workspace ENG --name Nope >/dev/null 2>&1
RC=$?
set -e
[ "$RC" = 3 ] || die "member creating a tag should exit 3, got $RC"

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
