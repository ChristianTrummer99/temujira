import { EmptyState } from '@/components/empty-state';
import { TagPills } from '@/components/tag-pill';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { formatRelative, initialsOf, splitTaskKey } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import type { Task } from '@temujira/client';
import { useRouter } from 'expo-router';
import { CircleUserIcon } from 'lucide-react-native';
import { Platform, Pressable, ScrollView, View } from 'react-native';

export default function MyTasksScreen() {
  const { client } = useAuth();
  const resource = useResource(() => client.listMyTasks({ limit: 100 }), [client]);
  const tasks = resource.data?.items ?? [];

  return (
    <View className="flex-1">
      <View className="border-border flex-row items-center gap-2 border-b p-4">
        <Text className="text-sm font-medium">My Tasks</Text>
        <Text className="text-muted-foreground text-sm">
          Everything you created, were assigned, commented on, or were mentioned in — across all
          workspaces.
        </Text>
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
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CircleUserIcon}
          title="Nothing associated with you yet."
          description="Create a task, comment on one, or get mentioned and it shows up here."
        />
      ) : (
        <ScrollView className="flex-1">
          {tasks.map((task) => (
            <MyTaskRow key={task.id} task={task} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function MyTaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const parsed = splitTaskKey(task.key);
  const archived = task.archived_at != null;

  return (
    <Pressable
      onPress={() => {
        if (parsed) router.push(`/w/${parsed.workspaceKey}/t/${task.number}`);
      }}
      className={
        'border-border active:bg-accent/70 flex-row items-center gap-3 border-b px-4 py-3' +
        (Platform.OS === 'web' ? ' hover:bg-accent/50 transition-colors' : '') +
        (archived ? ' opacity-55' : '')
      }>
      <View style={{ backgroundColor: task.status.color }} className="h-2.5 w-2.5 rounded-full" />
      <Badge variant="outline">
        <Text>{parsed?.workspaceKey ?? ''}</Text>
      </Badge>
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
