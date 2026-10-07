import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { formatAbsolute, splitTaskKey } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import type { ActivityEvent } from '@temujira/client';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

const LABELS: Record<string, string> = {
  'task.created': 'created the task', 'task.updated': 'updated the task',
  'task.assigned': 'assigned the task', 'task.unassigned': 'unassigned the task',
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
};

export function ActivityFeed({ workspace, task, mine = false }: { workspace?: string; task?: string; mine?: boolean }) {
  const { client } = useAuth();
  const [offset, setOffset] = React.useState(0);
  const resource = useResource(() => task
    ? client.listTaskActivity(task, { mine, limit: 50, offset })
    : client.listGlobalActivity({ workspace, mine, limit: 50, offset }), [client, workspace, task, mine, offset]);
  return (
    <View className="min-w-0 gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-muted-foreground text-xs">{resource.data ? `${resource.data.total} recorded actions` : 'Loading activity…'}</Text>
        <Button variant="ghost" size="sm" onPress={resource.reload}><Text>Refresh activity</Text></Button>
      </View>
      {resource.error ? <Text className="text-destructive text-sm">{resource.error}</Text> : null}
      {resource.data?.items.map((event) => <ActivityRow key={event.id} event={event} showTask={!task} />)}
      {resource.data?.total === 0 ? <Text className="text-muted-foreground py-6 text-sm">No recorded activity yet.</Text> : null}
      {resource.data && resource.data.total > 50 ? (
        <View className="flex-row justify-between gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 50))}><Text>Previous</Text></Button>
          <Text className="text-muted-foreground text-xs">{offset + 1}–{Math.min(resource.data.total, offset + 50)}</Text>
          <Button variant="outline" size="sm" disabled={offset + 50 >= resource.data.total} onPress={() => setOffset(offset + 50)}><Text>Next</Text></Button>
        </View>
      ) : null}
    </View>
  );
}

function ActivityRow({ event, showTask }: { event: ActivityEvent; showTask: boolean }) {
  const router = useRouter();
  const metadata = event.metadata;
  const changes = Array.isArray(metadata.changes) ? metadata.changes as Array<{ field: string; from: unknown; to: unknown }> : [];
  const value = (v: unknown) => v === null ? 'None' : String(v);
  return (
    <View className="border-border flex-row items-start gap-3 border-b pb-3">
      <UserAvatar user={event.actor} className="mt-1 size-6" textClassName="text-[10px]" />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text className="text-sm font-medium">{event.actor.name}</Text>
          <Text className="text-sm">{LABELS[event.action] ?? event.action.replace(/[._]/g, ' ')}</Text>
          {showTask && event.task_key ? <Pressable accessibilityRole="link" onPress={() => {
            const task = splitTaskKey(event.task_key!);
            if (task) router.push(`/w/${task.workspaceKey}/t/${task.number}`);
          }}><Text className="font-mono text-xs underline">{event.task_key}</Text></Pressable> : null}
          {typeof metadata.target_name === 'string' ? <Text className="text-muted-foreground text-sm">{metadata.target_name}</Text> : null}
        </View>
        <Text className="text-muted-foreground text-xs">{formatAbsolute(event.created_at)}{event.workspace_key ? ` · ${event.workspace_key}` : ''}{event.visibility === 'private' ? ' · Private' : ''}</Text>
        {changes.map((change, i) => <Text key={i} numberOfLines={3} className="text-muted-foreground text-xs">{change.field.replace(/_/g, ' ')}: {value(change.from)} → {value(change.to)}</Text>)}
        {!changes.length && Array.isArray(metadata.fields) && metadata.fields.length ? <Text className="text-muted-foreground text-xs">Changed: {metadata.fields.join(', ')}</Text> : null}
        {metadata.password_changed ? <Text className="text-muted-foreground text-xs">Password changed</Text> : null}
      </View>
    </View>
  );
}
