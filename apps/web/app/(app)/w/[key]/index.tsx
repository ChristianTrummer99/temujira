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
import { groupTasks, type GroupBy } from '@/lib/group-tasks';
import { useResource } from '@/lib/use-resource';
import type { Status, Tag, Task, User } from '@temujira/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIcon,
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

export default function WorkspaceTasksScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const workspaceKey = (key ?? '').toUpperCase();
  const router = useRouter();
  const { client } = useAuth();

  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<Option>(undefined);
  const [assigneeFilter, setAssigneeFilter] = React.useState<Option>(undefined);
  const [tagFilter, setTagFilter] = React.useState<Option>(undefined);
  const [groupOption, setGroupOption] = React.useState<Option>(GROUP_OPTIONS[0]);
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
  const groupBy = (groupOption?.value ?? 'none') as GroupBy;

  const resource = useResource(
    async () => {
      const [statusRes, userRes, tagRes, taskRes] = await Promise.all([
        client.listStatuses(workspaceKey),
        client.listUsers(),
        client.listTags(workspaceKey),
        client.listTasks(workspaceKey, {
          q: debouncedSearch || undefined,
          status_id: statusId || undefined,
          assignee_id:
            assigneeValue !== 'all' && assigneeValue !== 'unassigned' ? assigneeValue : undefined,
          tag_id: tagId || undefined,
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
      includeArchived,
      groupBy,
    ]
  );

  const statuses = resource.data?.statuses ?? [];
  const users = resource.data?.users ?? [];
  const tags = resource.data?.tags ?? [];

  // "Unassigned" has no server-side representation (assignee_id is a ulid) — filter locally.
  const tasks = React.useMemo(() => {
    const all = resource.data?.tasks ?? [];
    return assigneeValue === 'unassigned' ? all.filter((t) => t.assignee_id === null) : all;
  }, [resource.data, assigneeValue]);

  const groups = React.useMemo(
    () => groupTasks(tasks, groupBy, { statuses, tags }),
    [tasks, groupBy, statuses, tags]
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
        <Select value={groupOption} onValueChange={setGroupOption}>
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="No grouping" />
          </SelectTrigger>
          <SelectContent>
            {GROUP_OPTIONS.map((o) => (
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
          onCreated={() => resource.reload()}
        />
      </View>

      {resource.loading ? (
        <View className="gap-0 px-4 py-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </View>
      ) : resource.error ? (
        <View className="items-center justify-center gap-3 p-12">
          <Text className="text-destructive text-sm">{resource.error}</Text>
          <Button variant="outline" size="sm" onPress={() => resource.reload()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : (
        <ScrollView className="flex-1">
          {groups.map((group) => (
            <View key={group.id}>
              {groupBy !== 'none' ? (
                <View className="border-border bg-muted/40 flex-row items-center gap-2 border-b px-4 py-1.5">
                  {group.color ? (
                    <View
                      style={{ backgroundColor: group.color }}
                      className="h-2.5 w-2.5 rounded-full"
                    />
                  ) : null}
                  <Text className="text-xs font-semibold uppercase tracking-wide">
                    {group.label}
                  </Text>
                  <Text className="text-muted-foreground text-xs">{group.tasks.length}</Text>
                </View>
              ) : null}
              {group.tasks.map((task) => (
                <TaskRow key={`${group.id}:${task.id}`} task={task} workspaceKey={workspaceKey} />
              ))}
            </View>
          ))}
          {tasks.length === 0 ? (
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

function TaskRow({ task, workspaceKey }: { task: Task; workspaceKey: string }) {
  const router = useRouter();
  const archived = task.archived_at != null;

  // Archiving lives in the task view, not here: a control that only appears on hover
  // changes the row's height as the pointer crosses it, which reads as a flicker.
  return (
    <Pressable
      onPress={() => router.push(`/w/${workspaceKey}/t/${task.number}`)}
      className={
        'border-border active:bg-accent/70 flex-row items-center gap-3 border-b px-4 py-3' +
        (Platform.OS === 'web' ? ' hover:bg-accent/50 transition-colors' : '') +
        (archived ? ' opacity-55' : '')
      }>
      <View style={{ backgroundColor: task.status.color }} className="h-2.5 w-2.5 rounded-full" />
      <Text className="text-muted-foreground w-16 shrink-0 font-mono text-xs">{task.key}</Text>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
        {task.title}
      </Text>
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
  onCreated,
}: {
  workspaceKey: string;
  statuses: Status[];
  users: User[];
  tags: Tag[];
  onCreated: () => void;
}) {
  const { client } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [statusOption, setStatusOption] = React.useState<Option>(undefined);
  const [assigneeOption, setAssigneeOption] = React.useState<Option>(undefined);
  const [tagIds, setTagIds] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function close() {
    setOpen(false);
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
      });
      setTitle('');
      setDescription('');
      setStatusOption(undefined);
      setAssigneeOption(undefined);
      setTagIds([]);
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
