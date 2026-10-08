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
import type { Comment, InboxConversation } from '@temujira/client';
import { useRouter } from 'expo-router';
import { AtSignIcon, CheckCheckIcon, ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, InboxIcon, ReplyIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

export default function InboxScreen() {
  const { client } = useAuth();
  const { refresh: refreshBadge, version } = useInbox();
  const [tab, setTab] = React.useState<'unread' | 'all'>('unread');
  const [marking, setMarking] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [offset, setOffset] = React.useState(0);
  const [decisions, setDecisions] = React.useState(false);

  const includeRead = tab === 'all';
  const filterKey = JSON.stringify([includeRead, decisions, offset]);
  const resource = useResource(
    async () => ({ ...await client.listInbox({ include_read: includeRead, needs_decision: decisions, limit: 50, offset }), filterKey }),
    [client, includeRead, decisions, version, offset]
  );

  const ready = resource.data?.filterKey === filterKey;
  const items = ready ? resource.data?.items ?? [] : [];
  const unread = ready ? resource.data?.unread ?? 0 : 0;
  React.useEffect(() => {
    if (resource.data && offset > 0 && offset >= resource.data.total) setOffset(Math.max(0, offset - 50));
  }, [resource.data, offset]);

  async function markRead(id?: string) {
    if (marking) return;
    setMarking(id ?? 'all');
    setActionError(null);
    try {
      if (id !== undefined) await client.markInboxItemRead(id);
      else await client.markInboxRead({ mark_read: true, needs_decision: decisions });
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
          onValueChange={(v) => { setTab(v === 'all' ? 'all' : 'unread'); setOffset(0); }}
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
        <Button variant={decisions ? 'default' : 'outline'} size="sm" accessibilityLabel="Filter inbox: Decisions" aria-pressed={decisions}
          onPress={() => { setDecisions((v) => !v); setOffset(0); }}><Text>Decisions</Text></Button>
        {unread > 0 ? (
          <Badge variant="secondary">
            <Text>{unread} unread</Text>
          </Badge>
        ) : null}
        <View className="flex-1" />
        <Button
          variant="outline"
          className="gap-1.5"
          disabled={!!marking || !ready || !!resource.error || unread === 0}
          onPress={() => markRead()}>
          <Icon as={CheckCheckIcon} className="text-muted-foreground size-4" />
          <Text>{marking === 'all' ? 'Marking...' : decisions ? `Mark all decisions read (${unread})` : `Mark all read (${unread})`}</Text>
        </Button>
      </View>

      <Text className="text-muted-foreground px-4 py-2 text-xs">
        One item per conversation. Expanding it keeps it unread. Reply or select Mark read to clear it.
        {decisions ? ' Showing unanswered questions. Mark all applies only to this filter.' : ''}
      </Text>

      {actionError ? (
        <View className="px-4 pt-3">
          <Text className="text-destructive text-sm">{actionError}</Text>
        </View>
      ) : null}

      {resource.loading || (!ready && !resource.error) ? (
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
          title={decisions ? 'No decisions match this view.' : "You're all caught up."}
          description={
            tab === 'unread'
              ? 'Mentions and replies land here. Switch to All to see what you already read.'
              : 'Nothing has mentioned or replied to you yet.'
          }
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-2 px-3 pb-4">
          {items.map((item) => (
            <InboxRow key={item.thread_id} item={item} marking={marking} onMarkRead={() => markRead(item.id)} />
          ))}
          {resource.data && resource.data.total > 50 ? <View className="flex-row items-center justify-between py-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 50))}><Text>Previous</Text></Button>
            <Text className="text-muted-foreground text-xs">{offset + 1}–{Math.min(offset + items.length, resource.data.total)} of {resource.data.total} conversations</Text>
            <Button variant="outline" size="sm" disabled={offset + 50 >= resource.data.total} onPress={() => setOffset(offset + 50)}><Text>Next</Text></Button>
          </View> : null}
        </ScrollView>
      )}
    </View>
  );
}

function InboxRow({ item, marking, onMarkRead }: { item: InboxConversation; marking: string | null; onMarkRead: () => void }) {
  const router = useRouter();
  const [expanded, setExpanded] = React.useState(false);
  const parsed = splitTaskKey(item.task_key);
  const unread = item.read_at == null;
  const original = item.parent_comment ?? item.source_comment;
  const contentId = `inbox-thread-${item.thread_id}`;
  const subject = original.body.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, '') ?? item.task_title;

  function open() {
    if (!parsed) return;
    router.push(`/w/${item.workspace.key}/t/${parsed.number}?comment=${item.source_comment.id}`);
  }

  return (
    <View testID={`inbox-item-${item.id}`} className="border-border bg-card overflow-hidden rounded-lg border">
      <View className="flex-row items-center gap-1 px-2 py-1">
      <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button"
        accessibilityLabel={`Conversation on ${item.task_key}: ${item.task_title}`}
        accessibilityState={{ expanded }} aria-expanded={expanded} aria-controls={contentId}
        className={`min-w-0 flex-1 flex-row items-center gap-2 rounded px-1 py-2 ${Platform.OS === 'web' ? 'hover:bg-accent/40' : ''}`}>
        <Icon as={expanded ? ChevronUpIcon : ChevronDownIcon} className="text-muted-foreground size-3.5" />
        <View className="w-2">{unread ? <View className="bg-primary size-1.5 rounded-full" /> : null}</View>
        <UserAvatar user={item.actor} className="size-5" textClassName="text-[9px]" />
        <Icon as={item.kind === 'mention' ? AtSignIcon : ReplyIcon} className="text-muted-foreground size-3" />
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs"><Text className="text-xs font-medium">{item.actor.name}</Text> · {subject}</Text>
        <Text className="text-muted-foreground font-mono text-[10px]">{item.task_key}</Text>
        <Text className="text-muted-foreground hidden text-[10px] sm:flex">{formatRelative(item.created_at)}</Text>
      </Pressable>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" accessibilityLabel={`Open comment on ${item.task_key}`} onPress={open}>
          <Icon as={ExternalLinkIcon} className="size-3" /><Text className="hidden text-xs sm:flex">Open in ticket</Text>
        </Button>
        {unread ? <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={!!marking}
          accessibilityLabel={`Mark conversation on ${item.task_key} as read`} onPress={onMarkRead}>
          <Icon as={CheckCheckIcon} className="size-3" /><Text className="hidden text-xs sm:flex">{marking === item.id ? 'Marking...' : 'Mark read'}</Text>
        </Button> : <Text className="text-muted-foreground px-2 text-xs">Read</Text>}
      </View>
      {expanded ? <View nativeID={contentId} className="border-border border-t px-3 py-2">
        <InboxThread item={item} />
        {unread ? <View className="flex-row justify-end pt-2">
          <Button variant="outline" size="sm" disabled={!!marking} onPress={onMarkRead}
            accessibilityLabel={`Mark conversation on ${item.task_key} as read at end`}>
            <Icon as={CheckCheckIcon} className="size-3" /><Text className="text-xs">{marking === item.id ? 'Marking...' : 'Mark read'}</Text>
          </Button>
        </View> : null}
      </View> : null}
    </View>
  );
}

/** Fetch the complete conversation only when opened, including the recipient's own
 * responses. Notification summaries alone would hide intermediate replies. */
function InboxThread({ item }: { item: InboxConversation }) {
  const { client } = useAuth();
  const router = useRouter();
  function open(commentId: string) {
    const task = splitTaskKey(item.task_key);
    if (task) router.push(`/w/${task.workspaceKey}/t/${task.number}?comment=${commentId}`);
  }
  const resource = useResource(async () => {
    const { items } = await client.listComments(item.task_id);
    const root = items.find((comment) => comment.id === item.thread_id);
    if (!root) throw new Error('This conversation is no longer available.');
    return root;
  }, [client, item.task_id, item.thread_id, item.source_comment.id, item.source_comment.updated_at, item.parent_comment?.updated_at]);
  if (resource.loading) return <Text className="text-muted-foreground py-4 text-xs">Loading conversation…</Text>;
  if (resource.error) return <View className="gap-2 py-3"><Text className="text-destructive text-xs">{resource.error}</Text><Button variant="outline" size="sm" onPress={resource.reload}><Text>Retry</Text></Button></View>;
  if (!resource.data) return null;
  return <View className="gap-2 pb-2" testID={`inbox-conversation-${item.thread_id}`}>
    <InboxComment comment={resource.data} label={`${resource.data.author.name} · Original message`} onOpen={() => open(resource.data!.id)} />
    {resource.data.replies.map((reply) => <InboxComment key={reply.id} comment={reply} label={`${reply.author.name} · ${formatRelative(reply.created_at)}`} onOpen={() => open(reply.id)} />)}
  </View>;
}

/** Full text and every option are readable here; no clipping or ticket navigation is needed. */
function InboxComment({ comment, label, onOpen }: { comment: Comment; label?: string; onOpen: () => void }) {
  return (
    <Pressable testID={`inbox-comment-${comment.id}`} accessibilityRole="link" accessibilityLabel={`Open message from ${comment.author.name}`}
      onPress={(event) => {
        if (Platform.OS === 'web') {
          const anchor = (event.target as unknown as HTMLElement).closest?.('a');
          if (anchor && anchor !== (event.currentTarget as unknown as HTMLElement)) return;
        }
        onOpen();
      }} className="border-border bg-card hover:bg-accent/30 mt-1 min-w-0 gap-2 rounded-md border p-3">
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
    </Pressable>
  );
}
