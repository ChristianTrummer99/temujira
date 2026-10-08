# Web app build spec (feature wiring)

Verified against the tree on 2026-09-01. The v1 surface is **already wired to the real
API** — this document covers only what remains: the new feature UIs, plus one auth bug.

## Ground truth

- `lib/api.ts` — `createClient()` → `new TemujiraClient({ baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "" })`.
  **Bearer-token auth, not cookie mode.** Keep it: Bearer is CSRF-exempt by design, works
  identically on the :8081 dev origin and same-origin prod, and carries over to native.
- `lib/auth.tsx` — complete `AuthProvider` (bootstrap → `client.me()`, login/logout/refresh/
  setSession, token in `localStorage` key `temujira.session_token`). One client instance via
  `useMemo`; every screen gets it from `useAuth().client`.
- Already live against the API: login, setup, sidebar (workspaces + create dialog + user
  menu), workspace picker, task list (search/status/assignee filters, create tray), task
  detail (title/description/status/assignee/archive/attachments/comments), and all four
  settings screens (profile, api-keys with token-shown-once, users, workspaces with statuses
  CRUD/reorder/delete-with-move).
- `lib/placeholder-data.ts` is orphaned (zero imports) — delete it.
- No raw `fetch(` anywhere: a parity test forbids it. All I/O goes through `TemujiraClient`.

## Data layer

**No `@tanstack/react-query`.** Every existing screen uses the `useEffect` + cancelled-flag
idiom; adding react-query would either rewrite nine working screens or leave two patterns.
At this scale ("refetch after mutation", ≤200-row lists, local SQLite) a small hook wins.

`lib/use-resource.ts`:

```ts
export interface Resource<T> {
  data: T | null;      // null until first success; kept (stale) during refetch
  loading: boolean;    // in-flight AND data === null
  error: string | null;
  refetch: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}
export function useResource<T>(fetcher: () => Promise<T>, deps: React.DependencyList): Resource<T>
```

Discard stale responses with a generation counter. On `ApiError` 401 → `useAuth().refresh()`
(clears session → group layout redirects to `/login`), error "Session expired". `refetch()`
must not clear `data` (no skeleton flash).

Also: `lib/download.ts` (below), `lib/inbox.tsx` + `lib/workspaces.tsx` (contexts).

## Routes

New: `app/(app)/inbox.tsx`, `app/(app)/my.tsx`, `app/(app)/w/[key]/activity.tsx`.
Auth gating is inherited from `(app)/_layout.tsx`, so new screens get it free. One edit in
`app/login.tsx`: when `needsSetup` is true, `router.replace("/setup")`.

Providers wrap the sidebar tree in `(app)/_layout.tsx`:

- `WorkspaceListProvider` — `{ workspaces, archived, reload() }`, lifted from the logic
  currently inline in `AppSidebar`. Consumers: sidebar, TopBar (drop its own fetch),
  create-workspace dialog, `settings/workspaces.tsx` (call `reload()` after rename/archive).
- `InboxProvider` — `{ unread, refresh() }` via `client.listInbox({ limit: 1 })`, on mount
  plus a 60s interval cleared on unmount; swallow errors (badge goes stale, nothing breaks).

Sidebar gains a group **above** Workspaces: **Inbox** (with `SidebarMenuBadge` showing
unread, `99+` past 99) and **My Tasks**. TopBar breadcrumbs handle `/inbox`, `/my`, and
`…/activity`.

## Screens

**Task list** (`w/[key]/index.tsx`): add `listTags` to the existing `Promise.all`; add tag
Select, group-by Select (none/status/tag/assignee), Archived checkbox, and an Activity
button. Grouping is **client-side** over the flat list (`group_by` is only a server hint):
status groups ordered by `position` and colored; tag groups in `listTags` order where a
task with two tags appears in **both**, plus a trailing "No tag"; assignee groups
alphabetical plus "Unassigned". Task rows gain tag pills (max 3 + overflow), a dimmed
archived style, and a hover-revealed archive/unarchive button (nested Pressable — stop
propagation if the row also navigates on web). The create dialog gains tag toggles.

**Task detail** (`w/[key]/t/[num].tsx`):
- Tag editor via Popover with a checkbox per workspace tag → `updateTask({ tag_ids })`.
  Any member may tag; only tag CRUD is admin.
- Comment composer becomes `MentionInput`; posting sends `mention_ids`, and optionally
  `question_options` when the question toggle is on (2–10 non-empty options).
- Threading: `comments.list` returns roots with nested `replies`. Render replies indented
  one level with smaller avatars; a Reply affordance on a reply targets **the root's id**
  (the server coerces anyway). Structural changes (create/reply/answer/delete) trigger a
  full `listComments` refetch — local patching is wrong once server side effects run.
- Questions: render option buttons under a question comment. Unanswered → outline; pressing
  one posts a child reply `{ body: optionText, parent_id, answer_option_index: i }` then
  refetches. Answered → chosen option filled with a check, all disabled, "Answered" caption.
- Web descriptions use Atomic/CodeMirror; native descriptions use a text input. Description
  mentions do **not** notify (task updates have no `mention_ids`).
- Root/reply composers share `MessageComposer` and `ComposerAttachment`. Comment, reply,
  and edit drafts save on each change, under server/account/immutable-ID keys. Web storage
  is synchronous; native AsyncStorage operations are ordered per key. Restore text,
  mentions, question options, reply target, and file name. Require file selection again after
  restart. Save a posted comment ID before upload, so retries cannot duplicate its text.
- Web rich editors use source-level history with selection restore. Cmd/Ctrl+Z, Shift+Z,
  and Ctrl+Y also work across DOM decoration. Descriptions use CodeMirror history. Link
  actions share pointer/focus ownership with the link and have a padded crossing area.

**Inbox** (`inbox.tsx`): Unread/All tabs over server-grouped conversations, one item per
recipient/thread. The badge, totals, and pages count conversations. Only the accordion header
is shown while collapsed. Expansion shows the full original comment, choices, and replies,
loaded through `comments.list`. Expansion is read-only. Mark read is in the header and at
the bottom of the expanded thread. Each message is clickable; Open in ticket links to
`/w/{workspace.key}/t/{number}?comment={source_comment.id}`. Mark read resolves the item's
ID to the whole conversation. New replies update the existing item and make it unread again.
Decisions adds `needs_decision` to list and bulk read calls. Only unanswered root questions
with multiple choices match. Counts and pagination use the same server filter. Stale data
from a previous filter cannot enable the bulk action; the sidebar count stays global.

**My Tasks** (`my.tsx`): `listMyTasks`, rows like task rows plus a workspace badge derived
from `task.key`, navigating cross-workspace.

**Activity** (global, workspace, ticket): full-width content with small side gutters.
Use 28 px rows, 11 px summary text, 16 px avatars, inline timestamps and task links.
Full change values remain available through the row's detail popover. Multi-select action
pills use the shared category definitions and server-side filters. Clear filters with All;
reset pagination when a filter changes. Workspace/task permissions apply before counts.

**Identity settings**: `settings/access.tsx` hosts Users and API keys tabs. Both panels stay
mounted to preserve searches and filters. Tables use fixed-height rows, 50-row pages,
horizontal scrolling on narrow screens, and action menus. User actions include details,
rename, picture, access, keys, role, and activation as permitted by the caller's scopes.
API keys have owner/state/text filters and details/revoke menus; full tokens appear only
at creation. The old settings/users and settings/api-keys URLs redirect to the matching tab.
Measure the horizontal viewport to size each table, with a 640 px minimum on small screens.
Name/login/owner columns have minimum and maximum widths; fixed metadata columns stay narrow.
Full values are available on hover, keyboard focus, and tap through `TruncatedCell`.

**Admin gating rule**: hide or disable only controls whose registry route is `auth: "admin"`
(`tags.create/update/delete`, `users.create/update/deactivate`, `apiKeys.create` with
`user_id`). Never gate reads. The server enforces regardless — this is UX only.

## Markdown, mentions, task links

Extend `components/markdown.tsx` (web path) to accept `mentionUsers` and `onMentionPress`.
Preprocess the source **outside code spans** (split on ` ```…``` ` and `` `…` ``):

- Task keys → `[KEY-42](#task:KEY-42)` using the shared `TaskKeyPattern`.
- Mentions: mirror the server's token regex exactly
  (`/(?<![\w-])@([A-Za-z0-9_.' -]{1,64})/g` from `routes/engagement.ts`), then resolve by
  **longest-name-prefix** match against `mentionUsers` (the token is greedy, so "@Ada
  Lovelace and Bob" must resolve to Ada); unmatched tokens stay plain text.

Fragment hrefs (`#mention:` / `#task:`) are used deliberately: react-markdown's URL
transform strips custom protocols, so `mention://` would be dropped. Override the `a`
renderer to render mention chips (styled span, pressable when a user resolved) and task
links (`router.push`), leaving real links as `<a target="_blank">`. Keep inline overrides as
DOM `span`/`a` and block overrides as `Text`/`View` — returning an RN `View` from a phrasing
override breaks layout. Also fix react-markdown v10's removal of the `inline` prop on the
`code` renderer (detect block code via a newline or the `pre` wrapper).

Clicking a mention opens a small user dialog; there is no profile route. Screens without a
users list (Inbox) pass `mentionUsers={[]}` — chips render inert, task links still work.

## Uploads and downloads

Web upload uses a hidden `<input type="file">`; the `File` is a `Blob` passed to the typed
upload client. Comment/reply composers use `expo-document-picker` on native, passing a
cached file URI to React Native FormData. Draft storage retains only the file name.

**Download is currently broken** — `attachmentUrl`/`downloadAttachment` in `t/[num].tsx`
point a bare `<a href>` at the API with no Authorization header, so it 401s in dev and
depends on cookies in prod. Replace with `lib/download.ts` using
`client.downloadAttachment(id)` → `res.blob()` → object URL → synthetic `<a download>` →
revoke. Swap both call sites and delete the old helpers. For the same reason, never render
attachment images by URL.

## Components

Everything needed is already installed (tabs, select, popover, checkbox, alert-dialog,
badge, sidebar with `SidebarMenuBadge`, …) — **add no RNR components**; the CLI can touch
the lockfile in this hoisted monorepo for no gain.

Build: `TagPill`, `MentionInput`, `EmptyState`, extended `Markdown`, `UserInfoDialog`,
`groupTasks`, `InboxProvider`, `WorkspaceListProvider`, `useResource`, `saveAttachment`.

`MentionInput`: a `Textarea` in a relative `View`; track the caret via `onSelectionChange`;
detect the active token with `/(^|[\s(>])@([A-Za-z0-9_.' -]{0,64})$/` on the text before the
caret; debounce 200ms → `client.searchUsers({ q, limit: 8 })`. Render the suggestion list as
an absolutely-positioned view — **not** the RNR Popover, which is trigger-anchored and
fights textarea focus. Pick rows use **`onPressIn`** (it fires before the textarea's blur).
Recompute `mention_ids` on every change from the picks still present in the text, so
deleting a mention stops sending it. Escape closes; Enter always inserts a newline.

## Refetch rules

Entity-returning mutations (`tasks.update`, `statuses.*`, `tags.*`, `comments.update`) apply
the returned object locally; no optimistic writes (the server is local SQLite). Structural
comment mutations refetch the thread. Task create/archive refetches the list.
`markInboxRead` refetches the inbox and the badge. Workspace create/rename/archive calls
`reload()` so the sidebar and TopBar stay fresh.

**Errors**: no toasts (RNR has none — don't build one). Section-level error text plus a
Retry button for loads, inline errors in forms. Never silently swallow an error from a
user-initiated action.

## Risks

1. DOM elements (`input`, `label`, markdown overrides) crash native — keep them web-only or
   in files whose native path never reaches them. Web-first is the accepted v1 tradeoff.
2. Mention picker: click blurs the textarea before press fires → `onPressIn`; don't close on
   blur. `onKeyPress` gives key names on web; never bind Enter to submit.
3. Typed routes are on — after adding `/inbox`, `/my`, `/w/[key]/activity`, regenerate types
   (run the export once) or `tsc --noEmit` will reject the new `router.push` paths.
4. `<PortalHost />` is already mounted at root; don't add a second. The task tray is a
   `transparentModal` in the app-level `(ticket)` group. Keep it out of the workspace stack
   so Inbox, Search, Activity, and other screens can remain underneath it.
5. RNR `Select` options are `{ value, label }` — reuse the established empty-string trick for
   "Unassigned"; never pass `undefined` as a value.
6. Anything leaving the client without the Bearer header (raw `<a href>`, `<img src>` to the
   API) is unauthenticated — route it through the client.
