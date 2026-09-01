import { EmptyState } from '@/components/empty-state';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { formatRelative, initialsOf, splitTaskKey } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import type { ActivityEvent } from '@temujira/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

/**
 * Exact action strings recorded by `recordActivity(...)` in the server routes; anything
 * new falls back to a prettifier so the feed never shows a raw id.
 */
const ACTION_LABELS: Record<string, string> = {
  'task.created': 'created',
  'task.updated': 'updated',
  'task.assigned': 'assigned',
  'task.unassigned': 'unassigned',
  'task.archived': 'archived',
  'task.unarchived': 'unarchived',
  'task.tags_updated': 'retagged',
  'task.linked': 'linked',
  'task.unlinked': 'unlinked',
  'comment.created': 'commented on',
  'comment.replied': 'replied on',
  'comment.mentioned': 'mentioned someone in',
};

function labelFor(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

export default function WorkspaceActivityScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const workspaceKey = (key ?? '').toUpperCase();
  const { client } = useAuth();
  const [tab, setTab] = React.useState<'all' | 'mine'>('all');

  const mine = tab === 'mine';
  const resource = useResource(
    () => client.listActivity(workspaceKey, { mine, limit: 100 }),
    [client, workspaceKey, mine]
  );
  const events = resource.data?.items ?? [];

  return (
    <View className="flex-1">
      <View className="border-border flex-row flex-wrap items-center gap-3 border-b p-4">
        <Text className="text-sm font-medium">{workspaceKey} activity</Text>
        <View className="flex-1" />
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v === 'mine' ? 'mine' : 'all')}
          className="w-auto">
          <TabsList>
            <TabsTrigger value="all">
              <Text>All</Text>
            </TabsTrigger>
            <TabsTrigger value="mine">
              <Text>Mine</Text>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </View>

      {resource.loading ? (
        <View className="gap-2 p-4">
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
      ) : events.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title={mine ? 'No activity on your tasks yet.' : 'No activity in this workspace yet.'}
          description="Creating tasks, commenting, and assigning all show up here."
        />
      ) : (
        <ScrollView className="flex-1">
          {events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const router = useRouter();
  const parsed = event.task_key ? splitTaskKey(event.task_key) : null;

  return (
    <View
      className={
        'border-border flex-row items-center gap-3 border-b px-4 py-2.5' +
        (Platform.OS === 'web' ? ' hover:bg-accent/30 transition-colors' : '')
      }>
      <Avatar alt={event.actor.name} className="size-6">
        <AvatarFallback>
          <Text className="text-[10px]">{initialsOf(event.actor.name)}</Text>
        </AvatarFallback>
      </Avatar>
      <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-1.5">
        <Text className="text-sm font-medium">{event.actor.name}</Text>
        <Text className="text-muted-foreground text-sm">{labelFor(event.action)}</Text>
        {event.task_key ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              if (parsed) router.push(`/w/${parsed.workspaceKey}/t/${parsed.number}`);
            }}>
            <Text className="font-mono text-sm underline underline-offset-2">{event.task_key}</Text>
          </Pressable>
        ) : null}
        {event.task_title ? (
          <Text numberOfLines={1} className="text-muted-foreground min-w-0 text-sm">
            {event.task_title}
          </Text>
        ) : null}
      </View>
      <Text className="text-muted-foreground shrink-0 text-xs">
        {formatRelative(event.created_at)}
      </Text>
    </View>
  );
}
