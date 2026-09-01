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
