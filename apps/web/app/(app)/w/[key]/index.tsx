import { EmptyState } from '@/components/empty-state';
import { TagPill, TagPills } from '@/components/tag-pill';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { formatRelative, initialsOf } from '@/lib/format';
import { DEFAULT_GROUP_BY, groupTasks, type GroupBy, type TaskGroup } from '@/lib/group-tasks';
import { useResource } from '@/lib/use-resource';
import type { FieldDef, Status, Tag, Task, User } from '@temujira/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

/** The list is always grouped; "status" is the default. */
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
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
  const { client } = useAuth();

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
          tag_id: tagId || undefined,
          field_id: fieldId || undefined,
          field_value: fieldValue || undefined,
          include_archived: includeArchived || undefined,
          sort: 'created_at',
          order: 'desc',
          limit: 200,
          group_by: groupBy,
        }),
      ]);
      return {
        statuses: statusRes.items,
        users: userRes.items,
        tags: tagRes.items,
        fields: fieldRes.items,
        tasks: taskRes.items,
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
    ]
  );

  const statuses = resource.data?.statuses ?? [];
  const users = resource.data?.users ?? [];
  const tags = resource.data?.tags ?? [];
  const fields = resource.data?.fields ?? [];
  const selectFields = React.useMemo(() => fields.filter((f) => f.type === 'select'), [fields]);

  // "Unassigned" has no server-side representation (assignee_id is a ulid) — filter locally.
  const tasks = React.useMemo(() => {
    const all = resource.data?.tasks ?? [];
    return assigneeValue === 'unassigned' ? all.filter((t) => t.assignee_id === null) : all;
  }, [resource.data, assigneeValue]);

  const groupField = React.useMemo(
    () => (GROUP_OPTIONS.some((o) => o.value === groupBy) ? undefined : fields.find((f) => f.id === groupBy)),
    [groupBy, fields]
  );

  const groups = React.useMemo(
    () => groupTasks(tasks, groupBy, { statuses, tags, field: groupField }),
    [tasks, groupBy, statuses, tags, groupField]
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

  return (
    <View className="flex-1">
      <View className="border-border flex-row flex-wrap items-center gap-2 border-b p-4">
        <View className="relative min-w-48 flex-1">
          <View className="pointer-events-none absolute left-3 top-0 z-10 h-full justify-center">
            <Icon as={SearchIcon} className="text-muted-foreground size-4" />
          </View>
          <Input
            placeholder={`Search ${workspaceKey} tasks...`}
            value={search}
            onChangeText={setSearch}
            className="pl-9"
          />
        </View>
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
        <Select value={groupOption} onValueChange={setGroupOption}>
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="Group by status" />
          </SelectTrigger>
          <SelectContent>
            {groupOptions.map((o) => (
              <SelectItem key={o.value} value={o.value} label={o.label} />
            ))}
          </SelectContent>
        </Select>
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
        <NewTaskDialog
          workspaceKey={workspaceKey}
          statuses={statuses}
          users={users}
          tags={tags}
          fields={fields}
          onCreated={() => resource.reload()}
        />
      </View>

      {resource.loading ? (
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
            />
          ))}
          {groups.length === 0 ? (
            <EmptyState
              icon={ListTodoIcon}
              title="No tasks match the current filters."
              description="Adjust the filters above, or create the first task for this workspace."
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * One grouping bucket, rendered as a JIRA-backlog-style card: a tinted header row
 * that toggles collapse, and the task rows hairline-separated inside it.
 */
function TaskGroupCard({
  group,
  workspaceKey,
  expanded,
  onToggle,
  field,
}: {
  group: TaskGroup;
  workspaceKey: string;
  expanded: boolean;
  onToggle: () => void;
  field?: FieldDef;
}) {
  const count = group.tasks.length;
  return (
    <View className="border-border mb-3 overflow-hidden rounded-lg border">
      <Pressable
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
      </Pressable>
      {expanded
        ? group.tasks.map((task, i) => (
            <TaskRow
              key={`${group.id}:${task.id}`}
              task={task}
              workspaceKey={workspaceKey}
              last={i === count - 1}
              field={field}
            />
          ))
        : null}
    </View>
  );
}

function TaskRow({
  task,
  workspaceKey,
  last,
  field,
}: {
  task: Task;
  workspaceKey: string;
  /** The last row in a card skips its hairline so the card's own border is the only line. */
  last?: boolean;
  /** Set when the list is grouped by a custom field — show that field's value as a pill. */
  field?: FieldDef;
}) {
  const router = useRouter();
  const archived = task.archived_at != null;
  const fieldValue = field ? (task.field_values ?? {})[field.id] : undefined;

  // Archiving lives in the task view, not here: a control that only appears on hover
  // changes the row's height as the pointer crosses it, which reads as a flicker.
  return (
    <Pressable
      onPress={() => router.push(`/w/${workspaceKey}/t/${task.number}`)}
      className={
        'border-border active:bg-accent/70 flex-row items-center gap-3 px-4 py-3' +
        (last ? '' : ' border-b') +
        (Platform.OS === 'web' ? ' hover:bg-accent/50 transition-colors' : '') +
        (archived ? ' opacity-55' : '')
      }>
      <View style={{ backgroundColor: task.status.color }} className="h-2.5 w-2.5 rounded-full" />
      <Text className="text-muted-foreground w-16 shrink-0 font-mono text-xs">{task.key}</Text>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
        {task.title}
      </Text>
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
      <TagPills tags={task.tags} />
      <Badge variant="secondary" className="hidden sm:flex">
        <Text>{task.status.name}</Text>
      </Badge>
      <Text className="text-muted-foreground hidden w-16 text-xs sm:flex">
        {task.updated_at ? formatRelative(task.updated_at) : ''}
      </Text>
      {task.assignee ? (
        <Avatar alt={task.assignee.name} className="size-6">
          <AvatarFallback>
            <Text className="text-[10px]">{initialsOf(task.assignee.name)}</Text>
          </AvatarFallback>
        </Avatar>
      ) : (
        <View className="border-border size-6 items-center justify-center rounded-full border border-dashed">
          <Text className="text-muted-foreground text-[10px]">-</Text>
        </View>
      )}
    </Pressable>
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
  const { client } = useAuth();
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
      <Button onPress={() => setOpen(true)}>
        <Icon as={PlusIcon} className="text-primary-foreground size-4" />
        <Text>New task</Text>
      </Button>

      {open ? (
        <View className="absolute inset-0 flex-row bg-black/30">
          <Pressable
            onPress={close}
            className="flex-1"
            accessibilityRole="button"
            accessibilityLabel="Close new task tray"
          />
          <View
            className="border-border bg-background h-full w-[560px] flex-col overflow-hidden border-l"
            style={Platform.OS === 'web' ? { boxShadow: '0 0 40px rgba(0,0,0,0.2)' } : undefined}>
            {/* tray header */}
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
                <Textarea
                  aria-labelledby="task-description-label"
                  placeholder="Add more context (supports markdown)..."
                  value={description}
                  onChangeText={setDescription}
                />
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
          </View>
        </View>
      ) : null}
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
