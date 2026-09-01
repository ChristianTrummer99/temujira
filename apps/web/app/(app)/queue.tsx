import { EmptyState } from '@/components/empty-state';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { initialsOf, splitTaskKey } from '@/lib/format';
import type { QueueEntry, QueueState } from '@temujira/client';
import { useRouter } from 'expo-router';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  ListOrderedIcon,
  PauseIcon,
  PlayIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

const SECTION_ORDER: { state: QueueState; label: string }[] = [
  { state: 'running', label: 'Running' },
  { state: 'ready', label: 'Ready' },
  { state: 'queued', label: 'Queued' },
];

const STATE_BADGE_VARIANT: Record<QueueState, 'default' | 'secondary' | 'outline'> = {
  running: 'default',
  ready: 'secondary',
  queued: 'outline',
};

/**
 * The current user's personal, ordered work queue (FR-36..40). Pure metadata: state
 * transitions never touch the task. `queue.next` picks running > ready > queued.
 */
export default function QueueScreen() {
  const { client } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [next, setNext] = React.useState<QueueEntry | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState<string | null>(null);

  async function load() {
    try {
      const [{ items }, nextRes] = await Promise.all([client.getQueue(), client.queueNext()]);
      setEntries(items);
      setNext(nextRes.entry);
      setError(null);
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : 'Failed to load queue');
    }
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function act(id: string, fn: () => Promise<unknown>) {
    if (working === id) return;
    setWorking(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update queue');
    } finally {
      setWorking(null);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const ordered = (entries ?? []).slice().sort((a, b) => a.position - b.position);
    const i = ordered.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    await act(id, () => client.reorderQueue(ordered.map((e) => e.id)));
  }

  if (entries === null) {
    return (
      <View className="gap-3 p-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </View>
    );
  }

  const sections = SECTION_ORDER.map(({ state, label }) => ({
    state,
    label,
    items: entries
      .filter((e) => e.state === state)
      .sort((a, b) => a.position - b.position),
  })).filter((s) => s.items.length > 0);

  return (
    <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-3xl gap-4 p-4">
      <NextUpCard
        entry={next}
        working={working}
        onStart={(id) => act(id, () => client.setQueueState(id, 'running'))}
        onRemove={(id) => act(id, () => client.removeFromQueue(id))}
      />

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

      {sections.length === 0 ? (
        <EmptyState
          icon={ListOrderedIcon}
          title="Your queue is empty."
          description="Open a task and press “Add to queue” to plan what to work on next. Blocks are
            derived from task links, so a task you're blocked on is flagged when it comes up."
        />
      ) : (
        sections.map((section) => (
          <View key={section.state} className="gap-2">
            <View className="flex-row items-center gap-2 px-1">
              <Text className="text-sm font-semibold">{section.label}</Text>
              <Badge variant="secondary">
                <Text>{section.items.length}</Text>
              </Badge>
            </View>
            <View className="border-border overflow-hidden rounded-lg border">
              {section.items.map((entry, i) => (
                <QueueRow
                  key={entry.id}
                  entry={entry}
                  last={i === section.items.length - 1}
                  working={working === entry.id}
                  canUp={entry.position > 0}
                  canDown={entry.position < entries.length - 1}
                  onMoveUp={() => move(entry.id, -1)}
                  onMoveDown={() => move(entry.id, 1)}
                  onSetState={(state) => act(entry.id, () => client.setQueueState(entry.id, state))}
                  onRemove={() => act(entry.id, () => client.removeFromQueue(entry.id))}
                  onOpen={() => {
                    const split = splitTaskKey(entry.task.key);
                    if (split) router.push(`/w/${split.workspaceKey}/t/${split.number}`);
                  }}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function NextUpCard({
  entry,
  working,
  onStart,
  onRemove,
}: {
  entry: QueueEntry | null;
  working: string | null;
  onStart: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const router = useRouter();
  if (!entry) return null;
  const alreadyRunning = entry.state === 'running';
  const busy = working === entry.id;
  return (
    <View className="border-border bg-card gap-3 rounded-lg border p-4">
      <View className="flex-row items-center gap-2">
        <Icon as={PlayIcon} className="text-foreground size-4" />
        <Text className="text-sm font-medium">Next up</Text>
        <Badge variant={STATE_BADGE_VARIANT[entry.state]}>
          <Text>{entry.state}</Text>
        </Badge>
        {entry.blocked ? (
          <Badge variant="destructive">
            <View className="flex-row items-center gap-1">
              <Icon as={CircleAlertIcon} className="size-3" />
              <Text>Blocked</Text>
            </View>
          </Badge>
        ) : null}
      </View>
      <Pressable
        onPress={() => {
          const split = splitTaskKey(entry.task.key);
          if (split) router.push(`/w/${split.workspaceKey}/t/${split.number}`);
        }}
        accessibilityRole="link"
        className="hover:bg-accent/50 -mx-2 rounded-md px-2 py-1">
        <Text numberOfLines={2} className="text-sm font-medium">
          {entry.task.key} — {entry.task.title}
        </Text>
      </Pressable>
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          {entry.task.assignee ? (
            <Avatar alt={entry.task.assignee.name} className="size-5">
              <AvatarFallback>
                <Text className="text-[9px]">{initialsOf(entry.task.assignee.name)}</Text>
              </AvatarFallback>
            </Avatar>
          ) : null}
          <Badge variant="outline">
            <View className="flex-row items-center gap-1">
              <View
                style={{ backgroundColor: entry.task.status.color }}
                className="h-2 w-2 rounded-full"
              />
              <Text>{entry.task.status.name}</Text>
            </View>
          </Badge>
        </View>
        <View className="flex-row gap-2">
          {alreadyRunning ? null : (
            <Button size="sm" disabled={busy} onPress={() => onStart(entry.id)}>
              <Icon as={PlayIcon} className="text-primary-foreground size-3.5" />
              <Text>Start</Text>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onPress={() => onRemove(entry.id)}>
            <Icon as={CheckCircle2Icon} className="text-muted-foreground size-3.5" />
            <Text>Complete</Text>
          </Button>
        </View>
      </View>
    </View>
  );
}

function QueueRow({
  entry,
  last,
  working,
  canUp,
  canDown,
  onMoveUp,
  onMoveDown,
  onSetState,
  onRemove,
  onOpen,
}: {
  entry: QueueEntry;
  last: boolean;
  working: boolean;
  canUp: boolean;
  canDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetState: (state: QueueState) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const isRunning = entry.state === 'running';
  const isReady = entry.state === 'ready';
  const isQueued = entry.state === 'queued';

  return (
    <View
      className={
        'border-border bg-card flex-row items-center gap-3 px-4 py-3' + (last ? '' : ' border-b')
      }>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="w-24 shrink-0 font-mono text-xs">{entry.task.key}</Text>
          {entry.blocked ? (
            <Icon as={CircleAlertIcon} className="text-destructive size-3.5" />
          ) : null}
        </View>
        <Text numberOfLines={1} className="mt-0.5 text-sm">
          {entry.task.title}
        </Text>
      </Pressable>
      <Badge variant="outline" className="hidden sm:flex">
        <Text>{splitTaskKey(entry.task.key)?.workspaceKey ?? ''}</Text>
      </Badge>
      {entry.task.assignee ? (
        <Avatar alt={entry.task.assignee.name} className="size-6">
          <AvatarFallback>
            <Text className="text-[10px]">{initialsOf(entry.task.assignee.name)}</Text>
          </AvatarFallback>
        </Avatar>
      ) : null}
      <View className="flex-row items-center gap-0.5">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!canUp} onPress={onMoveUp}>
          <Icon as={ChevronUpIcon} className="text-muted-foreground size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={!canDown} onPress={onMoveDown}>
          <Icon as={ChevronDownIcon} className="text-muted-foreground size-3.5" />
        </Button>
      </View>
      <View className="flex-row items-center gap-1.5">
        {!isRunning ? (
          <Button variant="ghost" size="sm" className="h-7" disabled={working} onPress={() => onSetState('running')}>
            <Icon as={PlayIcon} className="text-muted-foreground size-3.5" />
            <Text className="text-xs">Start</Text>
          </Button>
        ) : null}
        {!isReady ? (
          <Button variant="ghost" size="sm" className="h-7" disabled={working} onPress={() => onSetState('ready')}>
            <Text className="text-xs">Ready</Text>
          </Button>
        ) : null}
        {!isQueued ? (
          <Button variant="ghost" size="sm" className="h-7" disabled={working} onPress={() => onSetState('queued')}>
            <Icon as={PauseIcon} className="text-muted-foreground size-3.5" />
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 gap-1" disabled={working} onPress={onRemove}>
          <Icon as={CheckCircle2Icon} className="text-muted-foreground size-3.5" />
          <Text className="text-xs">Done</Text>
        </Button>
      </View>
    </View>
  );
}