import type { Status, Tag, Task } from '@temujira/client';

/** The list is always grouped — there is no "no grouping" mode. */
export const GROUP_BY_VALUES = ['status', 'tag', 'assignee'] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

export const DEFAULT_GROUP_BY: GroupBy = 'status';

export interface TaskGroup {
  id: string;
  label: string;
  /** Swatch color for status/tag groups. */
  color?: string;
  tasks: Task[];
}

/**
 * Grouping is client-side on purpose: `group_by` is only a presentational hint on
 * `tasks.list` — the server always returns a flat page.
 *
 * Empty groups are never returned: a group only exists once at least one task
 * (after filtering) lands in it.
 *
 * - status: workspace status order (`position`), colored.
 * - tag: `listTags` order; a task with two tags appears in BOTH groups, plus "No tag".
 * - assignee: alphabetical, plus "Unassigned".
 */
export function groupTasks(
  tasks: Task[],
  groupBy: GroupBy,
  opts: { statuses: Status[]; tags: Tag[] }
): TaskGroup[] {
  if (groupBy === 'status') {
    const ordered = [...opts.statuses].sort((a, b) => a.position - b.position);
    const groups: TaskGroup[] = [];
    for (const status of ordered) {
      const inGroup = tasks.filter((t) => t.status_id === status.id);
      if (inGroup.length > 0) {
        groups.push({ id: status.id, label: status.name, color: status.color, tasks: inGroup });
      }
    }
    // Any task whose status isn't in the list (shouldn't happen) still shows up.
    const known = new Set(ordered.map((s) => s.id));
    const orphans = tasks.filter((t) => !known.has(t.status_id));
    if (orphans.length > 0) {
      groups.push({ id: '__other', label: 'Other', tasks: orphans });
    }
    return groups;
  }

  if (groupBy === 'tag') {
    const groups: TaskGroup[] = [];
    for (const tag of opts.tags) {
      const inGroup = tasks.filter((t) => t.tags.some((x) => x.id === tag.id));
      if (inGroup.length > 0) {
        groups.push({ id: tag.id, label: tag.name, color: tag.color, tasks: inGroup });
      }
    }
    const untagged = tasks.filter((t) => t.tags.length === 0);
    if (untagged.length > 0) {
      groups.push({ id: '__untagged', label: 'No tag', tasks: untagged });
    }
    return groups;
  }

  // assignee
  const byAssignee = new Map<string, { label: string; tasks: Task[] }>();
  const unassigned: Task[] = [];
  for (const task of tasks) {
    if (!task.assignee) {
      unassigned.push(task);
      continue;
    }
    const entry = byAssignee.get(task.assignee.id);
    if (entry) entry.tasks.push(task);
    else byAssignee.set(task.assignee.id, { label: task.assignee.name, tasks: [task] });
  }
  const groups: TaskGroup[] = [...byAssignee.entries()]
    .map(([id, v]) => ({ id, label: v.label, tasks: v.tasks }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (unassigned.length > 0) {
    groups.push({ id: '__unassigned', label: 'Unassigned', tasks: unassigned });
  }
  return groups;
}
