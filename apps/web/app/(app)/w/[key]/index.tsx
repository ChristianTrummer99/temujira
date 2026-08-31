import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import {
  getUser,
  getWorkspace,
  PLACEHOLDER_TASKS,
  PLACEHOLDER_USERS,
  STATUS_META,
  STATUS_ORDER,
  type PlaceholderTask,
} from '@/lib/placeholder-data';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlusIcon, SearchIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

export default function WorkspaceTasksScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const workspaceKey = (key ?? 'TEM').toUpperCase();
  const workspace = getWorkspace(workspaceKey);

  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<Option>(undefined);
  const [assigneeFilter, setAssigneeFilter] = React.useState<Option>(undefined);

  // TODO(api): replace PLACEHOLDER_TASKS with tasks fetched via @temujira/client.
  const tasks = PLACEHOLDER_TASKS.filter((task) => {
    if (search && !task.title.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (statusFilter?.value && statusFilter.value !== 'all' && task.status !== statusFilter.value) {
      return false;
    }
    if (assigneeFilter?.value && assigneeFilter.value !== 'all') {
      if (assigneeFilter.value === 'unassigned') {
        if (task.assigneeId !== null) return false;
      } else if (task.assigneeId !== assigneeFilter.value) {
        return false;
      }
    }
    return true;
  });

  return (
    <View className="flex-1">
      <View className="border-border flex-row flex-wrap items-center gap-2 border-b p-4">
        <View className="relative min-w-48 flex-1">
          <View className="pointer-events-none absolute left-3 top-0 z-10 h-full justify-center">
            <Icon as={SearchIcon} className="text-muted-foreground size-4" />
          </View>
          <Input
            placeholder={`Search ${workspace?.name ?? workspaceKey} tasks...`}
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
            {STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status} label={STATUS_META[status].label} />
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
            {PLACEHOLDER_USERS.map((user) => (
              <SelectItem key={user.id} value={user.id} label={user.name} />
            ))}
          </SelectContent>
        </Select>
        <NewTaskDialog workspaceKey={workspaceKey} />
      </View>
      <ScrollView className="flex-1">
        {tasks.map((task) => (
          <TaskRow key={task.num} task={task} workspaceKey={workspaceKey} />
        ))}
        {tasks.length === 0 ? (
          <View className="items-center justify-center p-12">
            <Text className="text-muted-foreground text-sm">No tasks match the current filters.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TaskRow({ task, workspaceKey }: { task: PlaceholderTask; workspaceKey: string }) {
  const router = useRouter();
  const status = STATUS_META[task.status];
  const assignee = getUser(task.assigneeId);

  return (
    <Pressable
      onPress={() => router.push(`/w/${workspaceKey}/t/${task.num}`)}
      className={
        'border-border active:bg-accent/70 flex-row items-center gap-3 border-b px-4 py-3' +
        (Platform.OS === 'web' ? ' hover:bg-accent/50 transition-colors' : '')
      }>
      <View className={`h-2.5 w-2.5 rounded-full ${status.dotClassName}`} />
      <Text className="text-muted-foreground w-16 shrink-0 font-mono text-xs">
        {workspaceKey}-{task.num}
      </Text>
      <Text numberOfLines={1} className="flex-1 text-sm">
        {task.title}
      </Text>
      <Badge variant="secondary" className="hidden sm:flex">
        <Text>{status.label}</Text>
      </Badge>
      {assignee ? (
        <Avatar alt={assignee.name} className="size-6">
          <AvatarFallback>
            <Text className="text-[10px]">{assignee.initials}</Text>
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

function NewTaskDialog({ workspaceKey }: { workspaceKey: string }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');

  // TODO(api): replace with a real create-task call via @temujira/client.
  function onCreate() {
    setTitle('');
    setDescription('');
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Icon as={PlusIcon} className="text-primary-foreground size-4" />
          <Text>New task</Text>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>New task in {workspaceKey}</DialogTitle>
          <DialogDescription>
            Describe the work. You can refine details after creating it.
          </DialogDescription>
        </DialogHeader>
        <View className="gap-4">
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
        </View>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onCreate}>
            <Text>Create task</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
