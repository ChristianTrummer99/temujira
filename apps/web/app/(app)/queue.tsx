import { EmptyState } from '@/components/empty-state';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
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
import { useAuth } from '@/lib/auth';
import { initialsOf, splitTaskKey } from '@/lib/format';
import type { QueueEntry, QueueState } from '@temujira/client';
import { useRouter } from 'expo-router';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  GripVerticalIcon,
  ListOrderedIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

const SECTION_ORDER: { state: QueueState; label: string }[] = [
  { state: 'running', label: 'Running' },
  { state: 'ready', label: 'Next up' },
  { state: 'queued', label: 'Queued' },
];

const GROUP_OPTIONS: NonNullable<Option>[] = [
  { value: 'running', label: 'Running' },
  { value: 'ready', label: 'Next up' },
  { value: 'queued', label: 'Queued' },
];

/**
 * The current user's personal, ordered work queue (FR-36..40). Pure metadata: state
 * transitions never touch the task. State only drives the bucket an entry shows in;
 * order is what the user controls (drag on web, chevrons on native).
 */
export default function QueueScreen() {
  const { client } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = React.useState<QueueEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);

  async function load() {
    try {
      const { items } = await client.getQueue();
      setEntries(items);
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

  async function dropInto(targetId: string, before: boolean) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const ordered = [...(entries ?? [])].sort((a, b) => a.position - b.position);
    const from = ordered.findIndex((e) => e.id === dragId);
    if (from < 0) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const mover = ordered[from];
    const targetEntry = ordered.find((entry) => entry.id === targetId);
    if (!targetEntry || mover.state !== targetEntry.state) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const rest = ordered.filter((_, i) => i !== from);
    const target = rest.findIndex((e) => e.id === targetId);
    if (target < 0) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    rest.splice(before ? target : target + 1, 0, mover);
    const dragged = dragId;
    setDragId(null);
    setDragOverId(null);
    await act(dragged, () => client.reorderQueue(rest.map((e) => e.id)));
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
    items: entries.filter((e) => e.state === state).sort((a, b) => a.position - b.position),
  })).filter((s) => s.items.length > 0);
  const draggedState = entries.find((entry) => entry.id === dragId)?.state;

  return (
    <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-3xl gap-4 p-4">
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

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
            <View className="overflow-hidden rounded-lg border border-border">
              {section.items.map((entry, i) => (
                <QueueRow
                  key={entry.id}
                  entry={entry}
                  last={i === section.items.length - 1}
                  working={working === entry.id}
                  canUp={entry.position > 0}
                  canDown={entry.position < entries.length - 1}
                  dragging={dragId === entry.id}
                  dragOver={
                    dragOverId === entry.id && entry.id !== dragId && draggedState === entry.state
                  }
                  onDragStart={setDragId}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  onDragOverItem={setDragOverId}
                  onDropInto={dropInto}
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

function QueueRow({
  entry,
  last,
  working,
  canUp,
  canDown,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOverItem,
  onDropInto,
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
  dragging: boolean;
  dragOver: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOverItem: (id: string) => void;
  onDropInto: (id: string, before: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetState: (state: QueueState) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const rowRef = React.useRef<View>(null);
  const handleRef = React.useRef<View>(null);

  const current = GROUP_OPTIONS.find((o) => o.value === entry.state) ?? GROUP_OPTIONS[0];

  // Web-only HTML5 drag & drop: react-native-web doesn't forward drag props, so
  // attach native listeners to the DOM nodes directly.
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const row = rowRef.current as unknown as HTMLElement | null;
    if (!row) return;
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      onDragOverItem(entry.id);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      onDropInto(entry.id, e.clientY < r.top + r.height / 2);
    };
    row.addEventListener('dragover', onOver);
    row.addEventListener('drop', onDrop);
    return () => {
      row.removeEventListener('dragover', onOver);
      row.removeEventListener('drop', onDrop);
    };
  }, [entry.id, onDragOverItem, onDropInto]);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handle = handleRef.current as unknown as HTMLElement | null;
    if (!handle) return;
    handle.draggable = !working;
    const onStart = (e: DragEvent) => {
      if (working) {
        e.preventDefault();
        return;
      }
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', entry.id);
      }
      onDragStart(entry.id);
    };
    const onEnd = () => onDragEnd();
    const onKeyDown = (e: KeyboardEvent) => {
      if (working) return;
      if (e.key === 'ArrowUp' && canUp) {
        e.preventDefault();
        onMoveUp();
      } else if (e.key === 'ArrowDown' && canDown) {
        e.preventDefault();
        onMoveDown();
      }
    };
    handle.addEventListener('dragstart', onStart);
    handle.addEventListener('dragend', onEnd);
    handle.addEventListener('keydown', onKeyDown);
    return () => {
      handle.removeEventListener('dragstart', onStart);
      handle.removeEventListener('dragend', onEnd);
      handle.removeEventListener('keydown', onKeyDown);
    };
  }, [canDown, canUp, entry.id, onDragEnd, onDragStart, onMoveDown, onMoveUp, working]);

  const rowClass =
    'border-border bg-card flex-row items-center gap-3 px-4 py-3' +
    (last ? '' : ' border-b') +
    (dragging ? ' opacity-40' : '') +
    (dragOver ? ' bg-accent/60' : '');

  return (
    <View ref={rowRef} className={rowClass}>
      {Platform.OS === 'web' ? (
        <View
          ref={handleRef}
          accessibilityRole="button"
          className="cursor-grab px-0.5 py-2 text-muted-foreground active:cursor-grabbing"
          accessibilityLabel={`Reorder ${entry.task.key} in queue`}
          accessibilityHint="Use the up and down arrow keys to reorder">
          <Icon as={GripVerticalIcon} className="size-4" />
        </View>
      ) : (
        <View className="flex-row items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!canUp}
            onPress={onMoveUp}>
            <Icon as={ChevronUpIcon} className="size-3.5 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!canDown}
            onPress={onMoveDown}>
            <Icon as={ChevronDownIcon} className="size-3.5 text-muted-foreground" />
          </Button>
        </View>
      )}
      <Pressable onPress={onOpen} accessibilityRole="link" className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="w-24 shrink-0 font-mono text-xs">{entry.task.key}</Text>
          {entry.blocked ? (
            <Icon as={CircleAlertIcon} className="size-3.5 text-destructive" />
          ) : null}
        </View>
        <Text numberOfLines={1} className="mt-0.5 text-sm">
          {entry.task.title}
        </Text>
      </Pressable>
      {entry.task.assignee ? (
        <Avatar alt={entry.task.assignee.name} className="size-6">
          <AvatarFallback>
            <Text className="text-[10px]">{initialsOf(entry.task.assignee.name)}</Text>
          </AvatarFallback>
        </Avatar>
      ) : null}
      <Select
        value={current}
        disabled={working}
        onValueChange={(o) => o && onSetState(o.value as QueueState)}>
        <SelectTrigger className="h-7 w-32">
          <SelectValue placeholder="Bucket" />
        </SelectTrigger>
        <SelectContent>
          {GROUP_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} label={option.label} />
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" className="h-7 gap-1" disabled={working} onPress={onRemove}>
        <Icon as={CheckCircle2Icon} className="size-3.5 text-muted-foreground" />
        <Text className="text-xs">Done</Text>
      </Button>
    </View>
  );
}
