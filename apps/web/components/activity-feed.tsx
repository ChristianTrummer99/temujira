import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { formatAbsolute, splitTaskKey } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import type { ActivityEvent } from '@temujira/client';
import { ACTIVITY_CATEGORIES, type ActivityCategory } from '@temujira/shared';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { RefreshCwIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

const PAGE_SIZE = 100;

const LABELS: Record<string, string> = {
  'task.created': 'created the task', 'task.updated': 'updated the task',
  'task.assigned': 'assigned the task', 'task.unassigned': 'unassigned the task',
  'task.reordered': 'changed task order',
  'task.deleted': 'deleted the task', 'workspace.deleted': 'deleted the workspace',
  'task.linked': 'linked tasks', 'task.unlinked': 'removed a task link',
  'comment.created': 'added a comment', 'comment.replied': 'replied to a comment',
  'comment.updated': 'edited a comment', 'comment.deleted': 'deleted a comment',
  'comment.mentioned': 'mentioned someone',
  'attachment.uploaded': 'uploaded a file', 'attachment.deleted': 'deleted a file',
  'workspace.created': 'created the workspace', 'workspace.updated': 'updated the workspace',
  'api_key.created': 'created an API key', 'api_key.revoked': 'revoked an API key',
  'auth.signed_in': 'signed in', 'auth.signed_out': 'signed out',
  'profile.updated': 'updated their profile', 'identity.acquired': 'acquired an identity session',
  'identity.released': 'released an identity session',
  'avatar.updated': 'changed a profile picture', 'avatar.removed': 'removed a profile picture',
  'inbox.read': 'marked a conversation read',
};

export function ActivityFeed({ workspace, task, mine = false }: { workspace?: string; task?: string; mine?: boolean }) {
  const { client } = useAuth();
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState<ActivityCategory[]>([]);
  const categories = selected.length ? selected.join(',') : undefined;
  const queryKey = JSON.stringify([task, workspace, mine, categories, offset]);
  React.useEffect(() => { setOffset(0); }, [workspace, task, mine]);
  const resource = useResource(async () => {
    const result = task
      ? await client.listTaskActivity(task, { mine, categories, limit: PAGE_SIZE, offset })
      : await client.listGlobalActivity({ workspace, mine, categories, limit: PAGE_SIZE, offset });
    return { ...result, queryKey };
  }, [client, workspace, task, mine, categories, offset]);
  const ready = resource.data?.queryKey === queryKey;
  function toggle(id: ActivityCategory) {
    setSelected((prev) => ACTIVITY_CATEGORIES.map((c) => c.id).filter((key) => key === id ? !prev.includes(id) : prev.includes(key)));
    setOffset(0);
  }
  return (
    <View className="min-w-0 gap-2" testID="activity-feed">
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Button variant={selected.length ? 'outline' : 'default'} size="sm" className="h-7 rounded-full px-2.5"
          accessibilityLabel="Filter activity: All" aria-pressed={!selected.length} accessibilityState={{ selected: !selected.length }}
          onPress={() => { setSelected([]); setOffset(0); }}><Text className="text-xs">All</Text></Button>
        {ACTIVITY_CATEGORIES.map((category) => <Button key={category.id}
          variant={selected.includes(category.id) ? 'default' : 'outline'} size="sm" className="h-7 rounded-full px-2.5"
          accessibilityLabel={`Filter activity: ${category.label}`} aria-pressed={selected.includes(category.id)} accessibilityState={{ selected: selected.includes(category.id) }}
          onPress={() => toggle(category.id)}><Text className="text-xs">{category.label}</Text></Button>)}
      </View>
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-muted-foreground text-[11px]">{ready ? `${resource.data!.total} ${resource.data!.total === 1 ? 'action' : 'actions'} · Select a row for full details` : 'Loading activity…'}</Text>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2" accessibilityLabel="Refresh activity" onPress={resource.reload}>
          <Icon as={RefreshCwIcon} className="text-muted-foreground size-3" /><Text className="text-xs">Refresh</Text>
        </Button>
      </View>
      {resource.error ? <Text className="text-destructive text-sm">{resource.error}</Text> : null}
      {ready && resource.data!.items.length > 0 ? <View className="border-border overflow-hidden rounded border">
        {resource.data!.items.map((event) => <ActivityRow key={event.id} event={event} showTask={!task} />)}
      </View> : null}
      {ready && resource.data?.total === 0 ? <Text className="text-muted-foreground py-4 text-xs">{selected.length ? 'No activity matches these filters.' : 'No recorded activity yet.'}</Text> : null}
      {ready && resource.data && resource.data.total > PAGE_SIZE ? (
        <View className="flex-row justify-between gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><Text>Previous</Text></Button>
          <Text className="text-muted-foreground text-xs">{offset + 1}–{Math.min(resource.data.total, offset + PAGE_SIZE)}</Text>
          <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= resource.data.total} onPress={() => setOffset(offset + PAGE_SIZE)}><Text>Next</Text></Button>
        </View>
      ) : null}
    </View>
  );
}

function ActivityRow({ event, showTask }: { event: ActivityEvent; showTask: boolean }) {
  const router = useRouter();
  const metadata = event.metadata;
  const changes = Array.isArray(metadata.changes) ? metadata.changes as Array<{ field: string; from: unknown; to: unknown }> : [];
  const value = (v: unknown) => v === null ? 'None' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const details = changes.map((change) => `${change.field.replace(/_/g, ' ')}: ${value(change.from)} → ${value(change.to)}`);
  if (!changes.length && Array.isArray(metadata.fields) && metadata.fields.length) details.push(`Changed: ${metadata.fields.join(', ')}`);
  if (metadata.password_changed) details.push('Password changed');
  if (event.workspace_key) details.push(event.workspace_key);
  if (event.visibility === 'private') details.push('Private');
  const action = LABELS[event.action] ?? event.action.replace(/[._]/g, ' ');
  const summary = `${event.actor.name} ${action}${typeof metadata.target_name === 'string' ? ` · ${metadata.target_name}` : ''}${details.length ? ` · ${details.join(' · ')}` : ''}`;
  function openTask() {
    const target = event.task_id && event.task_key ? splitTaskKey(event.task_key) : null;
    if (target) router.push(`/w/${target.workspaceKey}/t/${target.number}`);
  }
  return (
    <View testID={`activity-row-${event.id}`} className="border-border hover:bg-accent/40 h-7 flex-row items-center gap-2 border-b px-2">
      <UserAvatar user={event.actor} className="size-4" textClassName="text-[8px] leading-none" />
      <Popover className="h-full min-w-0 flex-1">
        <PopoverTrigger asChild><Pressable accessibilityLabel={`Activity details: ${event.actor.name} ${action}`} className="min-w-0 flex-1 justify-center self-stretch">
          <Text numberOfLines={1} className="text-[11px] leading-4">{summary.replace(/\s+/g, ' ')}</Text>
        </Pressable></PopoverTrigger>
        <PopoverContent align="start" className="w-96 max-w-[90vw] gap-2 p-3">
          <Text className="text-xs font-medium">{formatAbsolute(event.created_at)} · {event.action}</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            <Text selectable className="text-sm">{summary}</Text>
            {event.task_title ? <Text selectable className="text-muted-foreground mt-2 text-xs">Task: {event.task_title}</Text> : null}
          </ScrollView>
          {event.task_id && event.task_key ? <Button variant="outline" size="sm" onPress={openTask}><Text>Open task · {event.task_key}</Text></Button> : null}
        </PopoverContent>
      </Popover>
      {showTask && event.task_key ? event.task_id ? <Pressable accessibilityRole="link" onPress={openTask}><Text className="font-mono text-[10px] leading-4 underline">{event.task_key}</Text></Pressable> : <Text className="text-muted-foreground font-mono text-[10px]">{event.task_key} · Deleted</Text> : null}
      <Text numberOfLines={1} className="text-muted-foreground w-28 text-right text-[10px] leading-4 sm:w-36">{formatAbsolute(event.created_at)}</Text>
    </View>
  );
}
