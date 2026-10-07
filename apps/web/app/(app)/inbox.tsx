import { EmptyState } from '@/components/empty-state';
import { Markdown } from '@/components/markdown';
import { UserAvatar } from '@/components/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { formatRelative, splitTaskKey } from '@/lib/format';
import { useInbox } from '@/lib/inbox';
import { useResource } from '@/lib/use-resource';
import type { Comment, InboxItem } from '@temujira/client';
import { useRouter } from 'expo-router';
import { AtSignIcon, CheckCheckIcon, InboxIcon, ReplyIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

export default function InboxScreen() {
  const { client } = useAuth();
  const { refresh: refreshBadge, version } = useInbox();
  const [tab, setTab] = React.useState<'unread' | 'all'>('unread');
  const [marking, setMarking] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const includeRead = tab === 'all';
  const resource = useResource(
    () => client.listInbox({ include_read: includeRead, limit: 100 }),
    [client, includeRead, version]
  );

  const items = resource.data?.items ?? [];
  const unread = resource.data?.unread ?? 0;

  async function markRead(id?: string) {
    if (marking) return;
    setMarking(id ?? 'all');
    setActionError(null);
    try {
      if (id !== undefined) await client.markInboxItemRead(id);
      else await client.markInboxRead({ mark_read: true });
      await resource.reload();
      await refreshBadge();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mark inbox read');
    } finally {
      setMarking(null);
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
          disabled={!!marking || unread === 0}
          onPress={() => markRead()}>
          <Icon as={CheckCheckIcon} className="text-muted-foreground size-4" />
          <Text>{marking === 'all' ? 'Marking...' : 'Mark all read'}</Text>
        </Button>
      </View>

      <Text className="text-muted-foreground px-4 py-3 text-sm">
        Opening a message keeps it unread. Reply in its thread or select Mark read to clear it.
      </Text>

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
            <InboxRow key={item.id} item={item} marking={marking} onMarkRead={() => markRead(item.id)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function InboxRow({ item, marking, onMarkRead }: { item: InboxItem; marking: string | null; onMarkRead: () => void }) {
  const router = useRouter();
  const parsed = splitTaskKey(item.task_key);
  const unread = item.read_at == null;

  function open() {
    if (!parsed) return;
    router.push(`/w/${item.workspace.key}/t/${parsed.number}?comment=${item.source_comment.id}`);
  }

  return (
    <View testID={`inbox-item-${item.id}`}
      className={
        'border-border gap-3 border-b px-4 py-3 sm:flex-row sm:items-start' +
        (Platform.OS === 'web' ? ' hover:bg-accent/40 transition-colors' : '') +
        (unread ? '' : ' opacity-70')
      }>
      <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={`Open comment on ${item.task_key}`} className="min-w-0 flex-1 flex-row gap-3">
      <View className="w-2 pt-2">
        {unread ? <View className="bg-primary size-2 rounded-full" /> : null}
      </View>
      <UserAvatar user={item.actor} className="size-8" />
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
        {item.parent_comment ? (
          <InboxComment comment={item.parent_comment} label={`In reply to ${item.parent_comment.author.name}`} />
        ) : null}
        <InboxComment comment={item.source_comment} label={item.parent_comment ? 'Reply' : undefined} />
      </View>
      </Pressable>
      {unread ? (
        <Button variant="outline" size="sm" className="self-end sm:self-start" disabled={!!marking}
          accessibilityLabel={`Mark message on ${item.task_key} as read`} onPress={onMarkRead}>
          <Icon as={CheckCheckIcon} className="size-4" />
          <Text>{marking === item.id ? 'Marking...' : 'Mark read'}</Text>
        </Button>
      ) : <Text className="text-muted-foreground self-end text-xs sm:self-start">Read</Text>}
    </View>
  );
}

/** Full text and every option are readable here; no clipping or ticket navigation is needed. */
function InboxComment({ comment, label }: { comment: Comment; label?: string }) {
  return (
    <View testID={`inbox-comment-${comment.id}`} className="border-border bg-card mt-1 min-w-0 gap-2 rounded-md border p-3">
      {label ? <Text className="text-muted-foreground text-xs font-medium">{label}</Text> : null}
      <Markdown mentionUsers={[]}>{comment.body}</Markdown>
      {comment.question ? (
        <View className="gap-1.5 pt-1">
          <Text className="text-muted-foreground text-xs font-medium">Question options</Text>
          {comment.question.options.map((option, index) => {
            const selected = comment.question!.answer_option_index === index;
            return (
              <View key={index} className={`flex-row items-start gap-2 rounded border px-3 py-2 ${selected ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
                <Text className="text-muted-foreground font-mono text-xs">{index + 1}.</Text>
                <Text className="min-w-0 flex-1 text-sm">{option}</Text>
                {selected ? <Text className="text-muted-foreground text-xs font-medium">Selected</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
