/**
 * Placeholder data for the app shell.
 *
 * IMPORTANT: This file is the single source of dummy data for every screen.
 * When wiring the real API (@temujira/client), replace usages of these
 * exports with live data - the screens only consume these shapes.
 */

export type PlaceholderUser = {
  id: string;
  name: string;
  initials: string;
};

export type PlaceholderWorkspace = {
  key: string;
  name: string;
  count: number;
};

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';

export type PlaceholderTask = {
  num: number;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  description: string;
};

export const STATUS_META: Record<TaskStatus, { label: string; dotClassName: string }> = {
  todo: { label: 'To Do', dotClassName: 'bg-zinc-400' },
  in_progress: { label: 'In Progress', dotClassName: 'bg-blue-500' },
  in_review: { label: 'In Review', dotClassName: 'bg-amber-500' },
  done: { label: 'Done', dotClassName: 'bg-emerald-500' },
  blocked: { label: 'Blocked', dotClassName: 'bg-red-500' },
};

export const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked'];

export const PLACEHOLDER_USERS: PlaceholderUser[] = [
  { id: 'u1', name: 'Ada Lovelace', initials: 'AL' },
  { id: 'u2', name: 'Grace Hopper', initials: 'GH' },
  { id: 'u3', name: 'Linus Torvalds', initials: 'LT' },
];

export const CURRENT_USER: PlaceholderUser = PLACEHOLDER_USERS[0];

export const PLACEHOLDER_WORKSPACES: PlaceholderWorkspace[] = [
  { key: 'TEM', name: 'Temujira Core', count: 9 },
  { key: 'OPS', name: 'Operations', count: 4 },
  { key: 'DSG', name: 'Design', count: 2 },
];

export const ARCHIVED_WORKSPACES: PlaceholderWorkspace[] = [
  { key: 'LEG', name: 'Legacy Migration', count: 12 },
];

export const PLACEHOLDER_TASKS: PlaceholderTask[] = [
  {
    num: 1,
    title: 'Set up self-hosted deployment guide',
    status: 'done',
    assigneeId: 'u2',
    description:
      'Write the docker-compose based deployment guide covering reverse proxy setup, TLS, and backups.',
  },
  {
    num: 2,
    title: 'Design task list keyboard navigation',
    status: 'in_review',
    assigneeId: 'u1',
    description:
      'Arrow keys should move the row focus, Enter opens the task, and j/k should work as vim-style aliases.',
  },
  {
    num: 3,
    title: 'API keys should support scoped permissions',
    status: 'in_progress',
    assigneeId: 'u3',
    description:
      'Allow read-only keys for CI integrations. A key should be scoped to one workspace or all workspaces.',
  },
  {
    num: 4,
    title: 'Fix avatar upload failing for HEIC images',
    status: 'blocked',
    assigneeId: 'u2',
    description:
      'HEIC uploads currently 500 on the server. Blocked on picking an image conversion library.',
  },
  {
    num: 5,
    title: 'Add markdown preview to comment composer',
    status: 'todo',
    assigneeId: null,
    description: 'Render a live preview tab next to the write tab, using the shared markdown pipeline.',
  },
  {
    num: 6,
    title: 'Workspace archive and restore flow',
    status: 'in_progress',
    assigneeId: 'u1',
    description:
      'Archived workspaces should disappear from the sidebar default view but stay reachable and restorable.',
  },
  {
    num: 7,
    title: 'Email notifications for mentions',
    status: 'todo',
    assigneeId: 'u3',
    description: 'Send a digest email when a user is @mentioned in a task description or comment.',
  },
  {
    num: 8,
    title: 'Rate-limit login attempts',
    status: 'done',
    assigneeId: 'u3',
    description: 'Five failed attempts per 15 minutes per IP, with a clear lockout message.',
  },
  {
    num: 9,
    title: 'Bulk status change from the task list',
    status: 'todo',
    assigneeId: null,
    description:
      'Multi-select rows with checkboxes and apply a status change to all selected tasks at once.',
  },
];

export function getUser(id: string | null): PlaceholderUser | null {
  if (!id) return null;
  return PLACEHOLDER_USERS.find((user) => user.id === id) ?? null;
}

export function getWorkspace(key: string): PlaceholderWorkspace | null {
  return (
    [...PLACEHOLDER_WORKSPACES, ...ARCHIVED_WORKSPACES].find(
      (workspace) => workspace.key.toLowerCase() === key.toLowerCase()
    ) ?? null
  );
}

export function getTask(num: number): PlaceholderTask | null {
  return PLACEHOLDER_TASKS.find((task) => task.num === num) ?? null;
}
