import { EmptyState } from '@/components/empty-state';
import { Markdown } from '@/components/markdown';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { formatRelative, initialsOf, splitTaskKey } from '@/lib/format';
import { useInbox } from '@/lib/inbox';
import { useResource } from '@/lib/use-resource';
import type { InboxItem } from '@temujira/client';
import { useRouter } from 'expo-router';
import { AtSignIcon, CheckCheckIcon, InboxIcon, ReplyIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

export default function InboxScreen() {
  const { client } = useAuth();
  const { refresh: refreshBadge } = useInbox();
  const [tab, setTab] = React.useState<'unread' | 'all'>('unread');
  const [marking, setMarking] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const includeRead = tab === 'all';
  const resource = useResource(
    () => client.listInbox({ include_read: includeRead, limit: 100 }),
    [client, includeRead]
  );

  const items = resource.data?.items ?? [];
  const unread = resource.data?.unread ?? 0;

  async function markAllRead() {
    if (marking) return;
    setMarking(true);
    setActionError(null);
    try {
      // The API has no per-item mark-read — "mark all" is the only mutation.
      await client.markInboxRead({ mark_read: true });
      await resource.reload();
      await refreshBadge();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mark inbox read');
    } finally {
      setMarking(false);
    }
  }

  return (
    <View className="flex-1">
      <View className="border-border flex-row flex-wrap items-center gap-3 border-b p-4">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v === 'all' ? 'all' : 'unread')}
          className="w-auto">
          <TabsList>
            <TabsTrigger value="unread">
              <Text>Unread</Text>
            </TabsTrigger>
            <TabsTrigger value="all">
              <Text>All</Text>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {unread > 0 ? (
          <Badge variant="secondary">
            <Text>{unread} unread</Text>
          </Badge>
        ) : null}
        <View className="flex-1" />
        <Button
          variant="outline"
          className="gap-1.5"
          disabled={marking || unread === 0}
          onPress={markAllRead}>
          <Icon as={CheckCheckIcon} className="text-muted-foreground size-4" />
          <Text>{marking ? 'Marking...' : 'Mark all read'}</Text>
        </Button>
      </View>

      {actionError ? (
        <View className="px-4 pt-3">
          <Text className="text-destructive text-sm">{actionError}</Text>
        </View>
      ) : null}

      {resource.loading ? (
        <View className="gap-2 p-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </View>
      ) : resource.error ? (
        <View className="items-center justify-center gap-3 p-12">
          <Text className="text-destructive text-sm">{resource.error}</Text>
          <Button variant="outline" size="sm" onPress={() => resource.reload()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="You're all caught up."
          description={
            tab === 'unread'
              ? 'Mentions and replies land here. Switch to All to see what you already read.'
              : 'Nothing has mentioned or replied to you yet.'
          }
        />
      ) : (
        <ScrollView className="flex-1">
          {items.map((item) => (
            <InboxRow key={item.id} item={item} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const router = useRouter();
  const parsed = splitTaskKey(item.task_key);
  const unread = item.read_at == null;

  function open() {
    if (!parsed) return;
    router.push(`/w/${item.workspace.key}/t/${parsed.number}`);
  }

  return (
    <Pressable
      onPress={open}
      className={
        'border-border flex-row gap-3 border-b px-4 py-3' +
        (Platform.OS === 'web' ? ' hover:bg-accent/40 transition-colors' : '') +
        (unread ? '' : ' opacity-70')
      }>
      <View className="w-2 pt-2">
        {unread ? <View className="bg-primary size-2 rounded-full" /> : null}
      </View>
      <Avatar alt={item.actor.name} className="size-8">
        <AvatarFallback>
          <Text className="text-xs">{initialsOf(item.actor.name)}</Text>
        </AvatarFallback>
      </Avatar>
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Icon
            as={item.kind === 'mention' ? AtSignIcon : ReplyIcon}
            className="text-muted-foreground size-3.5"
          />
          <Text className="text-sm font-medium">{item.actor.name}</Text>
          <Text className="text-muted-foreground text-sm">
            {item.kind === 'mention' ? 'mentioned you in' : 'replied to you in'}
          </Text>
          <Text className="font-mono text-sm">{item.task_key}</Text>
          <Badge variant="outline">
            <Text>{item.workspace.key}</Text>
          </Badge>
          <Text className="text-muted-foreground text-xs">{formatRelative(item.created_at)}</Text>
        </View>
        <Text numberOfLines={1} className="text-muted-foreground text-sm">
          {item.task_title}
        </Text>
        <View className="border-border bg-card mt-1 rounded-md border p-2.5">
          {/* No user list on this screen: mention chips render inert, task links still work. */}
          <Markdown mentionUsers={[]}>{item.source_comment.body}</Markdown>
        </View>
      </View>
    </Pressable>
  );
}
