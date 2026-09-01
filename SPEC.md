# Temujira — Product Spec (v1)

Self-hosted, open-source project management software for **humans and agents**. "JIRA, but
simpler" — plain ticket management with a first-class API and CLI so AI agents can be full
team members.

## Goal (v1 acceptance)

A working locally-hosted version with: functioning web app, functioning CLI, working
email/password authentication, API key management, and every feature below marked **v1**.

## The contract

> **Every action a user can take in the web UI must also be available via the API and the
> CLI.** UI ⇔ API ⇔ CLI parity is a standing contract, not a feature.

## Feature requests

### Platform & architecture

- **FR-01 (v1)** Self-hosted, open-source deployable app. Runs locally and on a VPS the
  "right way": single Docker image + `docker compose up` (no Kubernetes — overkill for v1).
- **FR-02 (v1)** HTTP API (versioned, `/api/v1`) exposing all app actions. No public docs
  site needed, but the API is the foundation the CLI and web app both sit on.
- **FR-03 (v1)** Robust CLI built on the API, usable by agents non-interactively
  (env-var auth, JSON output mode, meaningful exit codes).
- **FR-04 (v1)** Web app is an Expo app using **react-native-reusables**
  (https://github.com/founded-labs/react-native-reusables) so the same codebase later
  targets mobile. Web is the priority; mobile correctness is explicitly deferred.
- **FR-05 (post-v1)** Native mobile app polish (iOS/Android via the same Expo codebase).

### Auth, users, roles

- **FR-06 (v1)** Email + password authentication. No OAuth/Google — explicitly out of scope.
- **FR-07 (v1)** API key management: create, list, revoke API keys; keys authenticate API
  and CLI calls. This is how agents log in.
- **FR-08 (v1)** Users have roles (admin / member) with permissions. Admins manage users,
  and an agent can be provisioned as an admin **or** as a regular member account that just
  picks up tickets and works.
- **FR-09 (v1)** Admin can create user accounts (including accounts for agents).

### Workspaces

- **FR-10 (v1)** Workspaces group tasks (≈ JIRA projects). Tasks always belong to a workspace.
- **FR-11 (v1)** Workspaces are listed in the left-hand sidebar; selecting one shows its tasks.
- **FR-12 (v1)** Workspaces can be archived (and unarchived).

### Tasks

- **FR-13 (v1)** Task list view: **stacked rows, one row = one task** (classic JIRA backlog
  view). Explicitly NOT a kanban/Trello board.
- **FR-14 (v1)** Tasks have statuses; status is selectable on a task.
- **FR-15 (v1)** Statuses are user-editable: users can **create new statuses**, edit, and
  reorder them. Not a hardcoded enum.
- **FR-16 (v1)** Tasks can be archived (and unarchived) individually.
- **FR-17 (v1)** Tasks have an assignee (a user — human or agent).
- **FR-18 (v1)** Tasks support file attachments, any file type.
- **FR-19 (v1)** Tasks support comments.
- **FR-20 (v1)** Comments support file attachments too.
- **FR-21 (v1)** Markdown renders anywhere prose appears (task descriptions, comments).

### Per-user work queue

- **FR-36 (v2)** Every user (human or agent worker) has a **queue**: an ordered list of
  tickets giving a live view of the work they are doing, **in the order it will be done**.
  This is deliberately distinct from a task's status — status describes the ticket, the
  queue describes one worker's plan.
- **FR-37 (v2)** A queue entry has a state: **running now**, **ready to start**, or queued
  (the ordered remainder). "Running now" is the live signal of what a worker is doing at
  this moment.
- **FR-38 (v2)** Queue entries are reorderable, and a ticket can be added to or removed from
  a queue.
- **FR-39 (v2)** A queue entry surfaces whether it is **blocked** by a dependency — derived
  from the ticket's `blocks`/`blocked_by` links (FR-24), not a second dependency system.
- **FR-40 (v2)** The queue is primarily for humans watching and agents coordinating, so it
  must be first-class in the API and CLI: an agent asks what to work on next, marks it
  running, and completes it.

### Task list presentation

- **FR-29 (v2)** The task list renders as **collapsible list-groups** (JIRA-backlog style):
  each group is a card with a header showing a collapse chevron, the group name and a
  count, and the task rows sit inside it.
- **FR-30 (v2)** There is **always a grouping** — "no grouping" is not an option. Default is
  group by status; the user can switch the grouping key (status, tag, assignee, or a custom
  select field).

### Custom fields

- **FR-31 (v2)** Users can define **their own fields on tasks, per workspace** — the same
  way statuses are user-defined rather than a hardcoded enum. Creating a field is a
  first-class action, not a code change.
- **FR-32 (v2)** A field definition has a name and a type. At minimum a **select** type with
  user-defined options (mirroring how statuses work, which is the model the user pointed
  at), alongside simple scalar types.
- **FR-33 (v2)** Custom field values are set per task, displayed as **columns in the task
  list**, and editable in the task detail.
- **FR-34 (v2)** Select-type custom fields can be used as the **grouping key** and as a
  filter, like status/tag/assignee.
- **FR-35 (v2)** Field definitions and values are available via the API and CLI, like every
  other action (the parity contract).

### Linked tickets

- **FR-24 (v2)** A task can be linked to other tasks with a relationship modifier — e.g.
  "absorbs START-2", "related to START-3". Links are created and removed from either end,
  and the far side shows the inverse relationship ("absorbed by START-1").
- **FR-25 (v2)** Links are available in the UI, the API, and the CLI like every other
  action (the parity contract), and tasks are named by their human key (`START-2`).

### Attachment previews

- **FR-26 (v2)** Image attachments preview in-app rather than only downloading.
- **FR-27 (v2)** Markdown attachments render as formatted markdown.
- **FR-28 (v2)** Previews must not weaken the existing download-hardening policy: uploaded
  SVG and HTML stay non-inline on the cookie origin, and bytes are fetched through the
  authenticated client, never a bare URL.

### UI

- **FR-22 (v1)** Left-hand sidebar modeled on the **shadcn/ui sidebar** (use the
  react-native-reusables version if one exists; otherwise port shadcn's sidebar to
  Expo/React Native). Workspaces live in it.
- **FR-23 (post-v1)** On native/mobile, the sidebar becomes a full-screen slide-over from
  the left (tap top-left to open).

## Non-goals for v1

Kanban boards, OAuth/SSO, sprints/epics/story-points, notifications/email, real-time
collaboration, public API docs site, Kubernetes.
