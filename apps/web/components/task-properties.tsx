import { TagPills } from '@/components/tag-pill';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { hasScope } from '@/lib/scopes';
import type { Status, Tag, Task } from '@temujira/client';
import { CheckIcon, PlusIcon, TagIcon } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

/** Same direct status control in the list and ticket. */
export function TaskStatusControl({ task, statuses, onChanged, disabled = false }: {
  task: Task; statuses: Status[]; onChanged: (task: Task) => void; disabled?: boolean;
}) {
  const { client, user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  return <View className="gap-1">
    <Select value={{ value: task.status_id, label: task.status.name }} onValueChange={async (o) => {
      if (!o || o.value === task.status_id || busy) return;
      setBusy(true); setError('');
      try { onChanged((await client.updateTask(task.id, { status_id: o.value })).task); }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not change status'); }
      finally { setBusy(false); }
    }}>
      <SelectTrigger disabled={disabled || busy || !hasScope(user, 'tasks:write')} accessibilityLabel={`Status for ${task.key}`} className="h-8 min-w-28 gap-2 border-transparent bg-transparent px-2 shadow-none">
        <View style={{ backgroundColor: task.status.color }} className="size-2 shrink-0 rounded-full" />
        <SelectValue placeholder="Status" className="text-xs" />
      </SelectTrigger>
      <SelectContent>{statuses.map((s) => <SelectItem key={s.id} value={s.id} label={s.name} />)}</SelectContent>
    </Select>
    {error ? <Text role="alert" className="text-destructive max-w-48 text-xs">{error}</Text> : null}
  </View>;
}

/** Searchable, immediate tag edits. Add/remove operations preserve concurrent unrelated tags. */
export function TaskTagsControl({ task, tags, onChanged, onTagsChanged, disabled = false, showTags = true }: {
  task: Task; tags: Tag[]; onChanged: (task: Task) => void; onTagsChanged?: () => void; disabled?: boolean; showTags?: boolean;
}) {
  const { client, user } = useAuth();
  const [search, setSearch] = React.useState('');
  const [created, setCreated] = React.useState<Tag[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const all = [...tags, ...created.filter((t) => !tags.some((x) => x.id === t.id))];
  const matches = all.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = new Set(task.tags.map((t) => t.id));
  const canWrite = hasScope(user, 'tasks:write');
  async function change(id: string, add: boolean) {
    const result = await client.bulkUpdateTasks(task.workspace_id, { task_ids: [task.id], ...(add ? { add_tag_ids: [id] } : { remove_tag_ids: [id] }) });
    onChanged(result.items[0]!);
  }
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not change tags'); }
    finally { setBusy(false); }
  }
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" disabled={disabled || !canWrite} accessibilityLabel={`Tags for ${task.key}`} className="h-8 max-w-64 gap-1 px-2">
        {showTags && task.tags.length ? <TagPills tags={task.tags.slice(0, 2)} /> : <Icon as={TagIcon} className="text-muted-foreground size-3.5" />}
        {!showTags ? <Text className="text-sm">Edit tags</Text> : null}
        {showTags && task.tags.length > 2 ? <Text className="text-muted-foreground text-xs">+{task.tags.length - 2}</Text> : null}
        <Icon as={PlusIcon} className="text-muted-foreground size-3" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-64 gap-2 p-2">
      <Input accessibilityLabel={`Find tags for ${task.key}`} placeholder="Find or create a tag…" value={search} onChangeText={setSearch} className="h-8 text-sm" />
      <ScrollView style={{ maxHeight: 240 }}>
        {matches.map((tag) => <Pressable key={tag.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(tag.id), disabled: busy }}
          accessibilityLabel={tag.name} disabled={busy} onPress={() => act(() => change(tag.id, !selected.has(tag.id)))} className="hover:bg-accent flex-row items-center gap-2 rounded px-2 py-2">
          <View className={`size-4 items-center justify-center rounded border ${selected.has(tag.id) ? 'border-primary bg-primary' : 'border-input'}`}>
            {selected.has(tag.id) ? <Icon as={CheckIcon} className="text-primary-foreground size-3" /> : null}
          </View>
          <View style={{ backgroundColor: tag.color }} className="size-2 rounded-full" /><Text className="flex-1 text-sm">{tag.name}</Text>
        </Pressable>)}
        {!matches.length ? <Text className="text-muted-foreground p-2 text-xs">No matching tags</Text> : null}
      </ScrollView>
      {search.trim() && search.trim().length <= 50 && !all.some((t) => t.name.toLowerCase() === search.trim().toLowerCase()) && hasScope(user, 'workspaces:manage') ?
        <Button variant="outline" size="sm" disabled={busy} onPress={() => act(async () => {
          const { tag } = await client.createTag(task.workspace_id, { name: search.trim() });
          setCreated((old) => [...old, tag]);
          await change(tag.id, true); setSearch(''); onTagsChanged?.();
        })}><Text numberOfLines={1}>Create “{search.trim()}”</Text></Button> : null}
      {error ? <Text role="alert" className="text-destructive text-xs">{error}</Text> : null}
    </PopoverContent>
  </Popover>;
}
