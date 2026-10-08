import { EmptyState } from '@/components/empty-state';
import { TaskStatusControl, TaskTagsControl } from '@/components/task-properties';
import { TaskActions } from '@/components/task-actions';
import { TaskDragHandle, TaskDropZone } from '@/components/task-drag';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TagPill } from '@/components/tag-pill';
import { UserAvatar } from '@/components/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type Option,
} from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownField } from '@/components/markdown-field';
import { useAuth } from '@/lib/auth';
import { hasScope } from '@/lib/scopes';
import { DEFAULT_GROUP_BY, groupTasks, type GroupBy, type TaskGroup } from '@/lib/group-tasks';
import { useResource } from '@/lib/use-resource';
import type { BulkUpdateTasksInput, FieldDef, Status, Tag, Task, User } from '@temujira/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  SlidersHorizontalIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'Group by status' },
  { value: 'tag', label: 'Group by tag' },
  { value: 'assignee', label: 'Group by assignee' },
];

const DEFAULT_GROUP_OPTION = GROUP_OPTIONS.find((o) => o.value === DEFAULT_GROUP_BY);

/**
 * Minimal structural typing for `localStorage` so this file typechecks without the
 * DOM lib, mirroring `components/ui/sidebar.tsx`.
 */
type WebGlobals = {
  localStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

/** Collapsed groups are remembered per workspace AND per grouping dimension. */
function collapsedStorageKey(workspaceKey: string, groupBy: GroupBy | string) {
  return `temujira.collapsed.${workspaceKey}.${groupBy}`;
}

function readCollapsed(workspaceKey: string, groupBy: GroupBy | string): Set<string> {
  if (Platform.OS !== 'web') return new Set();
  try {
    const raw = (globalThis as WebGlobals).localStorage?.getItem(
      collapsedStorageKey(workspaceKey, groupBy)
    );
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Unavailable (private mode, quota, malformed JSON) - start fully expanded.
    return new Set();
  }
}

function persistCollapsed(workspaceKey: string, groupBy: GroupBy | string, ids: Set<string>) {
  if (Platform.OS !== 'web') return;
  try {
    (globalThis as WebGlobals).localStorage?.setItem(
      collapsedStorageKey(workspaceKey, groupBy),
      JSON.stringify([...ids])
    );
  } catch {
    // localStorage unavailable - collapse still works for this session.
  }
}

export default function WorkspaceTasksScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const workspaceKey = (key ?? '').toUpperCase();
  const router = useRouter();
  const { client, user: me } = useAuth();
  const canWrite = hasScope(me, 'tasks:write');
  const [showFilters, setShowFilters] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dragged, setDragged] = React.useState<{ task: Task; groupId: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [sortOption, setSortOption] = React.useState<Option>({ value: 'position', label: 'Manual order' });

  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<Option>(undefined);
  const [assigneeFilter, setAssigneeFilter] = React.useState<Option>(undefined);
  const [tagFilter, setTagFilter] = React.useState<Option>(undefined);
  const [fieldFilter, setFieldFilter] = React.useState<Option>(undefined);
  const [fieldValueFilter, setFieldValueFilter] = React.useState<Option>(undefined);
  const [groupOption, setGroupOption] = React.useState<Option>(DEFAULT_GROUP_OPTION);
  const [includeArchived, setIncludeArchived] = React.useState(false);

  // debounce search into the API query
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const statusId = statusFilter?.value && statusFilter.value !== 'all' ? statusFilter.value : '';
  const assigneeValue = assigneeFilter?.value ?? 'all';
  const tagId = tagFilter?.value && tagFilter.value !== 'all' ? tagFilter.value : '';
  const fieldId = fieldFilter?.value && fieldFilter.value !== 'all' ? fieldFilter.value : '';
  const fieldValue =
    fieldId && fieldValueFilter?.value && fieldValueFilter.value !== 'all'
      ? fieldValueFilter.value
      : '';
  const groupBy = (groupOption?.value ?? DEFAULT_GROUP_BY) as GroupBy | string;
  const sort = (sortOption?.value ?? 'position') as 'position' | 'created_at' | 'updated_at' | 'title';
  const filterKey = JSON.stringify([workspaceKey, debouncedSearch, statusId, assigneeValue, tagId, fieldId, fieldValue, includeArchived, groupBy, sort]);
  const queryKey = `${filterKey}:${offset}`;
  React.useEffect(() => { setSelected(new Set()); setOffset(0); setActionError(''); setNotice(''); }, [filterKey]);

  const resource = useResource(
    async () => {
      const [statusRes, userRes, tagRes, fieldRes, taskRes] = await Promise.all([
        client.listStatuses(workspaceKey),
        client.listUsers(),
        client.listTags(workspaceKey),
        client.listFields(workspaceKey),
        client.listTasks(workspaceKey, {
          q: debouncedSearch || undefined,
          status_id: statusId || undefined,
          assignee_id:
            assigneeValue !== 'all' && assigneeValue !== 'unassigned' ? assigneeValue : undefined,
          unassigned: assigneeValue === 'unassigned',
          tag_id: tagId || undefined,
          field_id: fieldId || undefined,
          field_value: fieldValue || undefined,
          include_archived: includeArchived || undefined,
          sort,
          order: sort === 'position' || sort === 'title' ? 'asc' : 'desc',
          limit: 100,
          offset,
          group_by: groupBy,
        }),
      ]);
      return {
        statuses: statusRes.items,
        users: userRes.items,
        tags: tagRes.items,
        fields: fieldRes.items,
        tasks: taskRes.items,
        total: taskRes.total,
        queryKey,
      };
    },
    [
      client,
      workspaceKey,
      debouncedSearch,
      statusId,
      assigneeValue,
      tagId,
      fieldId,
      fieldValue,
      includeArchived,
      groupBy,
      sort,
      offset,
    ]
  );

  const statuses = resource.data?.statuses ?? [];
  const users = resource.data?.users ?? [];
  const tags = resource.data?.tags ?? [];
  const fields = resource.data?.fields ?? [];
  const selectFields = React.useMemo(() => fields.filter((f) => f.type === 'select'), [fields]);

  const ready = resource.data?.queryKey === queryKey;
  const tasks = React.useMemo(() => ready ? resource.data?.tasks ?? [] : [], [resource.data, ready]);
  React.useEffect(() => {
    if (ready && offset > 0 && offset >= (resource.data?.total ?? 0)) {
      setOffset(Math.max(0, Math.floor(((resource.data?.total ?? 0) - 1) / 100) * 100));
      setSelected(new Set());
    }
  }, [ready, offset, resource.data?.total]);
  React.useEffect(() => { setSelected(new Set()); }, [search]);

  const groupField = React.useMemo(
    () => (GROUP_OPTIONS.some((o) => o.value === groupBy) ? undefined : fields.find((f) => f.id === groupBy)),
    [groupBy, fields]
  );

  const groups = React.useMemo(
    () => groupTasks(tasks, groupBy, { statuses, tags, field: groupField, includeEmptyStatuses: tasks.length > 0 && canWrite && sort === 'position' && Platform.OS === 'web' }),
    [tasks, groupBy, statuses, tags, groupField, canWrite, sort]
  );

  // Groups start expanded; only the ids the user has explicitly collapsed live here.
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() =>
    readCollapsed(workspaceKey, groupBy)
  );
  React.useEffect(() => {
    setCollapsed(readCollapsed(workspaceKey, groupBy));
  }, [workspaceKey, groupBy]);

  function toggleGroup(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    persistCollapsed(workspaceKey, groupBy, next);
  }

  const groupOptions = React.useMemo(() => {
    const fieldItems = selectFields.map((f) => ({
      value: f.id,
      label: `Field: ${f.name}`,
    }));
    return [...GROUP_OPTIONS, ...fieldItems];
  }, [selectFields]);

  const activeField = React.useMemo(
    () => selectFields.find((f) => f.id === fieldId),
    [selectFields, fieldId]
  );

  const visibleIds = [...new Set(groups.filter((g) => !collapsed.has(g.id)).flatMap((g) => g.tasks.map((t) => t.id)))];
  const selectedIds = tasks.filter((t) => selected.has(t.id)).map((t) => t.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const filterChips = [
    ...(statusId ? [{ label: statuses.find((s) => s.id === statusId)?.name ?? 'Status', clear: () => setStatusFilter(undefined) }] : []),
    ...(assigneeValue !== 'all' ? [{ label: assigneeValue === 'unassigned' ? 'Unassigned' : users.find((u) => u.id === assigneeValue)?.name ?? 'Assignee', clear: () => setAssigneeFilter(undefined) }] : []),
    ...(tagId ? [{ label: tags.find((t) => t.id === tagId)?.name ?? 'Tag', clear: () => setTagFilter(undefined) }] : []),
    ...(fieldId ? [{ label: `${activeField?.name ?? 'Field'}${fieldValue ? `: ${fieldValue}` : ''}`, clear: () => { setFieldFilter(undefined); setFieldValueFilter(undefined); } }] : []),
    ...(includeArchived ? [{ label: 'Includes archived', clear: () => setIncludeArchived(false) }] : []),
  ];
  function toggleSelection(id: string) {
    setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function onTaskChanged(updated: Task) {
    resource.setData((old) => old ? { ...old, tasks: old.tasks.map((t) => t.id === updated.id ? updated : t) } : old);
    void resource.reload();
  }
  async function bulk(changes: Omit<BulkUpdateTasksInput, 'task_ids'>) {
    if (busy || !selectedIds.length || !ready) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      await client.bulkUpdateTasks(workspaceKey, { task_ids: selectedIds, ...changes });
      setNotice(`Updated ${selectedIds.length} tasks`); setSelected(new Set());
      await resource.reload();
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update tasks'); }
    finally { setBusy(false); }
  }
  async function move(task: Task, before: string | null, group: TaskGroup) {
    if (busy || !ready || task.id === before) return;
    setBusy(true); setActionError(''); setDragged(null);
    try {
      await client.reorderTask(workspaceKey, { task_id: task.id, before_id: before, status_id: groupBy === 'status' ? group.id : undefined });
      setNotice(`Saved order for ${task.key}`); await resource.reload();
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not save order'); }
    finally { setBusy(false); }
  }
  const canOrder = canWrite && sort === 'position' && !busy && ready;

  return (
    <View className="flex-1">
      <View className="border-border gap-3 border-b px-5 py-4">
        <View className="flex-row flex-wrap items-center gap-3">
          <View className="mr-2 flex-row items-baseline gap-2"><Text className="text-xl font-semibold tracking-tight">Tasks</Text><Text className="text-muted-foreground font-mono text-xs">{resource.data?.total ?? 0}</Text></View>
        <View className="relative min-w-40 flex-1">
          <View className="pointer-events-none absolute left-3 top-0 z-10 h-full justify-center">
            <Icon as={SearchIcon} className="text-muted-foreground size-4" />
          </View>
          <Input
            placeholder={`Search ${workspaceKey} tasks...`}
            value={search}
            onChangeText={setSearch}
            className="pl-9"
            accessibilityLabel="Search workspace tasks"
          />
        </View>
        <Button variant={showFilters || filterChips.length ? 'secondary' : 'outline'} size="sm" onPress={() => setShowFilters((v) => !v)} accessibilityLabel="Filters" aria-expanded={showFilters}>
          <Icon as={SlidersHorizontalIcon} className="size-4" /><Text>Filters{filterChips.length ? ` · ${filterChips.length}` : ''}</Text>
        </Button>
        <Select value={sortOption} onValueChange={setSortOption}><SelectTrigger size="sm" accessibilityLabel="Task order"><SelectValue placeholder="Manual order" /></SelectTrigger><SelectContent>
          <SelectItem value="position" label="Manual order" /><SelectItem value="created_at" label="Newest first" /><SelectItem value="updated_at" label="Recently updated" /><SelectItem value="title" label="Title A–Z" />
        </SelectContent></Select>
        <Select value={groupOption} onValueChange={setGroupOption}>
          <SelectTrigger size="sm" accessibilityLabel="Group tasks"><SelectValue placeholder="Group by status" /></SelectTrigger>
          <SelectContent>{groupOptions.map((o) => <SelectItem key={o.value} value={o.value} label={o.label} />)}</SelectContent>
        </Select>
        <NewTaskDialog workspaceKey={workspaceKey} statuses={statuses} users={users} tags={tags} fields={fields} onCreated={() => resource.reload()} />
        </View>
        {showFilters ? <View className="bg-muted/30 flex-row flex-wrap items-center gap-2 rounded-lg p-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="min-w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" label="All statuses" />
            {statuses.map((status) => (
              <SelectItem key={status.id} value={status.id} label={status.name} />
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="min-w-36">
            <SelectValue placeholder="All assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" label="All assignees" />
            <SelectItem value="unassigned" label="Unassigned" />
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id} label={user.name} />
            ))}
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="min-w-32">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" label="All tags" />
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id} label={tag.name} />
            ))}
          </SelectContent>
        </Select>
        {selectFields.length > 0 || groupField ? (
          <Select
            value={fieldFilter}
            onValueChange={(o) => {
              setFieldFilter(o);
              setFieldValueFilter(undefined);
            }}>
            <SelectTrigger className="min-w-36">
              <SelectValue placeholder="All fields" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label="All fields" />
              {selectFields.map((f) => (
                <SelectItem key={f.id} value={f.id} label={f.name} />
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {activeField ? (
          <Select value={fieldValueFilter} onValueChange={setFieldValueFilter}>
            <SelectTrigger className="min-w-32">
              <SelectValue placeholder={`All ${activeField.name} values`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={`All ${activeField.name} values`} />
              {activeField.options.map((option) => (
                <SelectItem key={option} value={option} label={option} />
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Pressable
          className="flex-row items-center gap-2 px-1"
          onPress={() => setIncludeArchived((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeArchived }}>
          <Checkbox checked={includeArchived} onCheckedChange={setIncludeArchived} />
          <Text className="text-muted-foreground text-sm">Archived</Text>
        </Pressable>
        <Button
          variant="outline"
          className="gap-1.5"
          onPress={() => router.push(`/w/${workspaceKey}/activity`)}>
          <Icon as={ActivityIcon} className="text-muted-foreground size-4" />
          <Text>Activity</Text>
        </Button>
        </View> : null}
        {filterChips.length ? <View className="flex-row flex-wrap items-center gap-2">
          {filterChips.map((chip, i) => <Button key={i} variant="secondary" size="sm" className="h-7 gap-1.5 rounded-full" onPress={chip.clear} accessibilityLabel={`Clear ${chip.label} filter`}><Text className="text-xs">{chip.label}</Text><Icon as={XIcon} className="size-3" /></Button>)}
          <Button variant="ghost" size="sm" className="h-7" onPress={() => filterChips.forEach((chip) => chip.clear())}><Text className="text-muted-foreground text-xs">Clear filters</Text></Button>
        </View> : null}
      </View>

      {canWrite ? <View className={`border-border flex-row flex-wrap items-center gap-3 border-b px-5 py-2 ${selectedIds.length ? 'bg-primary/5' : ''}`}>
        <Checkbox accessibilityLabel="Select visible tasks" checked={allSelected} disabled={busy || !ready || !visibleIds.length} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} />
        <Text className="text-muted-foreground min-w-24 text-xs">{selectedIds.length ? `${selectedIds.length} selected` : 'Select tasks'}</Text>
        {selectedIds.length ? <>
          <BulkSelect label="Set status" options={statuses.map((s) => ({ value: s.id, label: s.name }))} disabled={busy} onChoose={(id) => bulk({ status_id: id })} />
          <BulkSelect label="Assign" options={[{ value: 'none', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.name }))]} disabled={busy} onChoose={(id) => bulk({ assignee_id: id === 'none' ? null : id })} />
          <BulkSelect label="Add tag" options={tags.map((t) => ({ value: t.id, label: t.name }))} disabled={busy} onChoose={(id) => bulk({ add_tag_ids: [id] })} />
          <BulkSelect label="Remove tag" options={tags.map((t) => ({ value: t.id, label: t.name }))} disabled={busy} onChoose={(id) => bulk({ remove_tag_ids: [id] })} />
          <Button variant="ghost" size="sm" disabled={busy} onPress={() => bulk({ archived: true })}><Text>Archive</Text></Button>
          {includeArchived ? <Button variant="ghost" size="sm" disabled={busy} onPress={() => bulk({ archived: false })}><Text>Restore</Text></Button> : null}
          <Button variant="ghost" size="sm" disabled={busy} onPress={() => setSelected(new Set())} accessibilityLabel="Clear selection"><Icon as={XIcon} className="size-4" /></Button>
        </> : <Text className="text-muted-foreground text-xs">{sort === 'position' ? 'Drag a handle to reorder. Select tasks to edit them together.' : 'Use Manual order to drag tasks.'}</Text>}
      </View> : null}
      {actionError ? <Text role="alert" className="text-destructive px-5 py-2 text-sm">{actionError}</Text> : null}
      {notice ? <Text role="status" className="text-muted-foreground px-5 pt-2 text-xs">{notice}</Text> : null}

      {resource.loading || (!ready && !resource.error) ? (
        <View className="gap-3 p-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </View>
      ) : resource.error ? (
        <View className="items-center justify-center gap-3 p-12">
          <Text className="text-destructive text-sm">{resource.error}</Text>
          <Button variant="outline" size="sm" onPress={() => resource.reload()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="p-4">
          {groups.map((group) => (
            <TaskGroupCard
              key={group.id}
              group={group}
              workspaceKey={workspaceKey}
              expanded={!collapsed.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              field={groupField}
              canWrite={canWrite}
              canOrder={canOrder}
              showOrder={canWrite && sort === 'position' && Platform.OS === 'web'}
              busy={busy}
              statuses={statuses}
              users={users}
              tags={tags}
              selected={selected}
              onSelect={toggleSelection}
              onChanged={onTaskChanged}
              onTagsChanged={() => resource.reload()}
              onDragStart={(task) => setDragged({ task, groupId: group.id })}
              onDragEnd={() => setDragged(null)}
              dragEnabled={!!dragged && canOrder && (groupBy === 'status' || group.id === dragged.groupId)}
              onDrop={(before) => { if (dragged) void move(dragged.task, before, group); }}
              onMove={(task, direction) => {
                const index = group.tasks.findIndex((t) => t.id === task.id);
                const before = direction === -1 ? group.tasks[index - 1]?.id : group.tasks[index + 2]?.id ?? null;
                if (before !== undefined) void move(task, before, group);
              }}
            />
          ))}
          {groups.length === 0 ? (
            <EmptyState
              icon={ListTodoIcon}
              title="No tasks match the current filters."
              description="Adjust the filters above, or create the first task for this workspace."
            />
          ) : null}
          <View className="flex-row items-center justify-between gap-3 py-4">
            <Text className="text-muted-foreground text-xs">{tasks.length ? offset + 1 : 0}–{offset + tasks.length} of {resource.data?.total ?? 0} tasks</Text>
            <View className="flex-row gap-2"><Button variant="outline" size="sm" disabled={busy || offset === 0} onPress={() => { setSelected(new Set()); setOffset((v) => Math.max(0, v - 100)); }}><Text>Previous</Text></Button>
              <Button variant="outline" size="sm" disabled={busy || offset + tasks.length >= (resource.data?.total ?? 0)} onPress={() => { setSelected(new Set()); setOffset((v) => v + 100); }}><Text>Next</Text></Button></View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function BulkSelect({ label, options, disabled, onChoose }: { label: string; options: { value: string; label: string }[]; disabled: boolean; onChoose: (id: string) => void }) {
  return <Select value={undefined} onValueChange={(o) => { if (o) onChoose(o.value); }}>
    <SelectTrigger size="sm" accessibilityLabel={label} disabled={disabled || !options.length} className="h-7 min-w-24 bg-background"><SelectValue placeholder={label} className="text-xs" /></SelectTrigger>
    <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value} label={o.label} />)}</SelectContent>
  </Select>;
}

interface TaskGroupControls {
  canWrite: boolean;
  canOrder: boolean;
  showOrder: boolean;
  busy: boolean;
  statuses: Status[];
  users: User[];
  tags: Tag[];
  selected: Set<string>;
  onSelect: (id: string) => void;
  onChanged: (task: Task) => void;
  onTagsChanged: () => void;
  onDragStart: (task: Task) => void;
  onDragEnd: () => void;
  dragEnabled: boolean;
  onDrop: (before: string | null) => void;
  onMove: (task: Task, direction: -1 | 1) => void;
}

function TaskGroupCard({
  group,
  workspaceKey,
  expanded,
  onToggle,
  field,
  ...controls
}: {
  group: TaskGroup;
  workspaceKey: string;
  expanded: boolean;
  onToggle: () => void;
  field?: FieldDef;
} & TaskGroupControls) {
  const count = group.tasks.length;
  return (
    <View className="border-border mb-3 overflow-hidden rounded-lg border">
      <TaskDropZone enabled={controls.dragEnabled} onDrop={() => controls.onDrop(group.tasks[0]?.id ?? null)}><Pressable
        onPress={onToggle}
        accessibilityRole="button"
        // Both: RN Web 0.21 only forwards the ARIA prop to the DOM, native reads the state.
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        accessibilityLabel={`${group.label}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
        className={
          'border-border bg-muted/40 flex-row items-center gap-2 px-3 py-2' +
          (expanded ? ' border-b' : '') +
          (Platform.OS === 'web' ? ' hover:bg-muted/70 transition-colors' : '')
        }>
        <Icon
          as={expanded ? ChevronDownIcon : ChevronRightIcon}
          className="text-muted-foreground size-4"
        />
        {group.color ? (
          <View style={{ backgroundColor: group.color }} className="h-2.5 w-2.5 rounded-full" />
        ) : null}
        <Text className="text-sm font-semibold">{group.label}</Text>
        <Text className="text-muted-foreground text-xs">
          {count} {count === 1 ? 'task' : 'tasks'}
        </Text>
      </Pressable></TaskDropZone>
      {expanded
        ? group.tasks.map((task, i) => (
            <TaskRow
              key={`${group.id}:${task.id}`}
              task={task}
              workspaceKey={workspaceKey}
              last={i === count - 1}
              field={field}
              {...controls}
              canMoveUp={i > 0}
              canMoveDown={i < count - 1}
            />
          ))
        : null}
      {expanded && controls.showOrder ? <TaskDropZone enabled={controls.dragEnabled} onDrop={() => controls.onDrop(null)}>
        <View className={`border-border items-center border-t border-dashed py-2 ${controls.dragEnabled ? 'bg-muted/50' : 'bg-muted/10'}`}>
          <Text className="text-muted-foreground text-[11px]">{count ? `Drop at end of ${group.label}` : `Drop a task in ${group.label}`}</Text>
        </View>
      </TaskDropZone> : null}
    </View>
  );
}

function TaskRow({
  task,
  workspaceKey,
  last,
  field,
  canMoveUp,
  canMoveDown,
  ...controls
}: {
  task: Task;
  workspaceKey: string;
  /** The last row in a card skips its hairline so the card's own border is the only line. */
  last?: boolean;
  /** Set when the list is grouped by a custom field — show that field's value as a pill. */
  field?: FieldDef;
  canMoveUp: boolean;
  canMoveDown: boolean;
} & TaskGroupControls) {
  const router = useRouter();
  const archived = task.archived_at != null;
  const fieldValue = field ? (task.field_values ?? {})[field.id] : undefined;

  return (
    <TaskDropZone enabled={controls.dragEnabled} onDrop={() => controls.onDrop(task.id)}><View
      testID={`task-row-${task.key}`}
      className={
        'action-row border-border flex-row items-center gap-2 px-3 py-1' +
        (last ? '' : ' border-b') +
        (Platform.OS === 'web' ? ' hover:bg-accent/50 transition-colors' : '') +
        (controls.selected.has(task.id) ? ' bg-primary/5' : '') +
        (archived ? ' opacity-55' : '')
      }>
      {controls.canWrite ? <>
        <Checkbox accessibilityLabel={`Select ${task.key}`} checked={controls.selected.has(task.id)} disabled={controls.busy} onCheckedChange={() => controls.onSelect(task.id)} />
        <Popover><TaskDragHandle disabled={!controls.canOrder} onStart={() => controls.onDragStart(task)} onEnd={controls.onDragEnd}
          onMove={(dir) => { if (dir === -1 ? canMoveUp : canMoveDown) controls.onMove(task, dir); }}>
          <PopoverTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-6 p-0" disabled={!controls.canOrder} accessibilityLabel={`Reorder ${task.key}`}>
            <Icon as={GripVerticalIcon} className="text-muted-foreground size-3.5" />
          </Button></PopoverTrigger>
        </TaskDragHandle><PopoverContent className="w-44 gap-1 p-1" align="start">
          <Button variant="ghost" size="sm" disabled={!canMoveUp || controls.busy} onPress={() => controls.onMove(task, -1)}><Icon as={ArrowUpIcon} className="size-3" /><Text>Move up</Text></Button>
          <Button variant="ghost" size="sm" disabled={!canMoveDown || controls.busy} onPress={() => controls.onMove(task, 1)}><Icon as={ArrowDownIcon} className="size-3" /><Text>Move down</Text></Button>
          <Text className="text-muted-foreground p-2 text-xs">Keyboard: Alt + ↑ / ↓</Text>
        </PopoverContent></Popover>
      </> : null}
      <Pressable accessibilityRole="link" accessibilityLabel={`${task.key} ${task.title}`} onPress={() => router.push(`/w/${workspaceKey}/t/${task.number}`)} className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-3 gap-y-1 py-1">
        <Text className="text-muted-foreground w-16 shrink-0 font-mono text-xs">{task.key}</Text>
        <Text numberOfLines={1} className="min-w-24 flex-1 text-sm">{task.title}</Text>
      </Pressable>
      {fieldValue ? (
        <Badge variant="outline">
          <Text className="text-xs">{fieldValue}</Text>
        </Badge>
      ) : null}
      {archived ? (
        <Badge variant="outline">
          <Text>Archived</Text>
        </Badge>
      ) : null}
      <View className="hidden sm:flex"><TaskTagsControl task={task} tags={controls.tags} onChanged={controls.onChanged} onTagsChanged={controls.onTagsChanged} disabled={controls.busy} /></View>
      <TaskStatusControl task={task} statuses={controls.statuses} onChanged={controls.onChanged} disabled={controls.busy} />
      <View className="hidden sm:flex">{task.assignee ? (
        <UserAvatar user={task.assignee} className="size-6" textClassName="text-[10px]" />
      ) : (
        <View className="border-border size-6 items-center justify-center rounded-full border border-dashed">
          <Text className="text-muted-foreground text-[10px]">-</Text>
        </View>
      )}</View>
      <TaskActions task={task} users={controls.users} onChanged={controls.onChanged} />
    </View></TaskDropZone>
  );
}

function NewTaskDialog({
  workspaceKey,
  statuses,
  users,
  tags,
  fields,
  onCreated,
}: {
  workspaceKey: string;
  statuses: Status[];
  users: User[];
  tags: Tag[];
  fields: FieldDef[];
  onCreated: () => void;
}) {
  const { client, user: me } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [statusOption, setStatusOption] = React.useState<Option>(undefined);
  const [assigneeOption, setAssigneeOption] = React.useState<Option>(undefined);
  const [tagIds, setTagIds] = React.useState<string[]>([]);
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function close() {
    setOpen(false);
    setFieldValues({});
    setError(null);
  }

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onCreate() {
    if (submitting || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await client.createTask(workspaceKey, {
        title: title.trim(),
        description: description.trim(),
        status_id: statusOption?.value,
        assignee_id: assigneeOption?.value ?? undefined,
        tag_ids: tagIds.length > 0 ? tagIds : undefined,
        field_values: Object.keys(fieldValues).length > 0 ? fieldValues : undefined,
      });
      setTitle('');
      setDescription('');
      setStatusOption(undefined);
      setAssigneeOption(undefined);
      setTagIds([]);
      setFieldValues({});
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {hasScope(me, 'tasks:write') ? (
        <Button onPress={() => setOpen(true)}>
          <Icon as={PlusIcon} className="text-primary-foreground size-4" />
          <Text>New task</Text>
        </Button>
      ) : null}

      <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <SheetContent
          className="w-full max-w-[560px]"
          style={Platform.OS === 'web' ? { boxShadow: '0 0 40px rgba(0,0,0,0.2)' } : undefined}>
          {/* sheet header */}
          <View className="border-border flex-row items-center justify-between border-b px-4 py-2.5">
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="text-muted-foreground font-mono text-xs">{workspaceKey}</Text>
              </View>
            </View>
            <View className="flex-row items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onPress={close}
                accessibilityLabel="Close tray">
                <Icon as={XIcon} className="text-muted-foreground size-4" />
              </Button>
            </View>
          </View>

          <ScrollView className="flex-1" contentContainerClassName="gap-6 p-5">
              <View className="gap-1">
                <Text variant="h3">New task</Text>
                <Text className="text-muted-foreground text-sm">
                  Describe the work. You can refine details after creating it.
                </Text>
              </View>

              <View className="gap-1.5">
                <Label nativeID="task-title-label">Title</Label>
                <Input
                  aria-labelledby="task-title-label"
                  placeholder="Short summary of the task"
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View className="gap-1.5">
                <Label nativeID="task-description-label">Description</Label>
                <MarkdownField value={description} mentionUsers={users} label="new task description">
                  <Textarea
                    aria-labelledby="task-description-label"
                    placeholder="Add more context (supports markdown)..."
                    value={description}
                    onChangeText={setDescription}
                  />
                </MarkdownField>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1 gap-1.5">
                  <Label nativeID="task-status-label">Status</Label>
                  <Select value={statusOption} onValueChange={setStatusOption}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="First status" />
                    </SelectTrigger>
                    <SelectContent>
                      {statuses.map((status) => (
                        <SelectItem key={status.id} value={status.id} label={status.name} />
                      ))}
                    </SelectContent>
                  </Select>
                </View>
                <View className="flex-1 gap-1.5">
                  <Label nativeID="task-assignee-label">Assignee</Label>
                  <Select value={assigneeOption} onValueChange={setAssigneeOption}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id} label={user.name} />
                      ))}
                    </SelectContent>
                  </Select>
                </View>
              </View>

              {tags.length > 0 ? (
                <View className="gap-1.5">
                  <Label>Tags</Label>
                  <View className="flex-row flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const on = tagIds.includes(tag.id);
                      return (
                        <Pressable
                          key={tag.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => toggleTag(tag.id)}
                          className={on ? '' : 'opacity-45'}>
                          <TagPill tag={tag} />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {fields.length > 0 ? (
                <View className="gap-2.5">
                  <Text className="text-sm font-medium">Fields</Text>
                  {fields.map((field) => (
                    <FieldValueControl
                      key={field.id}
                      field={field}
                      value={fieldValues[field.id] ?? ''}
                      onValue={(value) =>
                        setFieldValues((prev) => {
                          const next = { ...prev };
                          if (value) next[field.id] = value;
                          else delete next[field.id];
                          return next;
                        })
                      }
                    />
                  ))}
                </View>
              ) : null}

              {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

              <View className="flex-row justify-end gap-2 pt-2">
                <Button variant="outline" onPress={close}>
                  <Text>Cancel</Text>
                </Button>
                <Button onPress={onCreate} disabled={submitting || !title.trim()}>
                  <Text>{submitting ? 'Creating...' : 'Create task'}</Text>
                </Button>
              </View>
            </ScrollView>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** One custom-field editor: select → dropdown (with a clear option), text/number → input. */
function FieldValueControl({
  field,
  value,
  onValue,
}: {
  field: FieldDef;
  value: string;
  onValue: (v: string) => void;
}) {
  if (field.type === 'select') {
    const selected: Option | undefined = value ? { value, label: value } : undefined;
    return (
      <View className="gap-1.5">
        <Label>{field.name}</Label>
        <Select
          value={selected}
          onValueChange={(o) => onValue(o?.value ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={`Select ${field.name}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option} label={option} />
            ))}
            <SelectItem value="" label="— None —" />
          </SelectContent>
        </Select>
      </View>
    );
  }
  return (
    <View className="gap-1.5">
      <Label>{field.name}</Label>
      <Input
        value={value}
        onChangeText={onValue}
        placeholder={field.type === 'number' ? `e.g. 5` : `${field.name}…`}
        keyboardType={field.type === 'number' ? 'numeric' : 'default'}
      />
    </View>
  );
}
