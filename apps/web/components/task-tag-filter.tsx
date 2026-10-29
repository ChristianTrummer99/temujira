import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Text } from '@/components/ui/text';
import type { Tag } from '@temujira/client';
import { MAX_TASK_FILTER_TAGS, TASK_TAG_MATCH_MODES, type TaskTagMatchMode } from '@temujira/shared';
import * as CheckboxPrimitive from '@rn-primitives/checkbox';
import { CheckIcon, ChevronDownIcon, TagsIcon } from 'lucide-react-native';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

/** A tag filter stays open while the user selects more than one tag. */
export function TaskTagFilter({ tags, selected, match, onSelectedChange, onMatchChange }: {
  tags: Tag[];
  selected: string[];
  match: TaskTagMatchMode;
  onSelectedChange: (ids: string[]) => void;
  onMatchChange: (match: TaskTagMatchMode) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const matches = tags.filter((tag) => tag.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <Popover onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); }}>
    <PopoverTrigger asChild>
      <Button variant={selected.length ? 'secondary' : 'outline'} className="min-w-32 gap-2" accessibilityLabel="Filter by tags" aria-expanded={open}>
        <Icon as={TagsIcon} className="text-muted-foreground size-4" />
        <Text>{selected.length ? `Tags · ${selected.length}` : 'All tags'}</Text>
        <Icon as={ChevronDownIcon} className="text-muted-foreground size-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 max-w-[90vw] gap-3 p-3">
      <Text className="text-sm font-medium">Match selected tags</Text>
      <View className="flex-row gap-1">
        {TASK_TAG_MATCH_MODES.map((mode) => <Button key={mode} size="sm" className="flex-1" variant={match === mode ? 'default' : 'outline'}
          accessibilityLabel={mode === 'all' ? 'Match all selected tags' : 'Match any selected tag'}
          accessibilityState={{ selected: match === mode }} aria-pressed={match === mode} onPress={() => onMatchChange(mode)}>
          <Text>{mode === 'all' ? 'All selected' : 'Any selected'}</Text>
        </Button>)}
      </View>
      <Input accessibilityLabel="Find filter tags" placeholder="Find tags…" value={search} onChangeText={setSearch} className="h-8 text-sm sm:h-8" />
      <ScrollView style={{ maxHeight: 240 }}>
        {matches.map((tag) => {
          const checked = selected.includes(tag.id);
          const disabled = !checked && selected.length >= MAX_TASK_FILTER_TAGS;
          return <CheckboxPrimitive.Root key={tag.id} checked={checked} accessibilityRole="checkbox" accessibilityLabel={tag.name}
            accessibilityState={{ checked, disabled }} aria-checked={checked} disabled={disabled}
            onCheckedChange={(next) => onSelectedChange(next ? [...selected, tag.id] : selected.filter((id) => id !== tag.id))}
            className={`hover:bg-accent flex-row items-center gap-2 rounded px-2 py-2 ${disabled ? 'opacity-50' : ''}`}>
            <View className={`size-4 items-center justify-center rounded border ${checked ? 'border-primary bg-primary' : 'border-input'}`}>
              {checked ? <Icon as={CheckIcon} className="text-primary-foreground size-3" /> : null}
            </View>
            <View style={{ backgroundColor: tag.color }} className="size-2 shrink-0 rounded-full" />
            <Text className="min-w-0 flex-1 text-sm">{tag.name}</Text>
          </CheckboxPrimitive.Root>;
        })}
        {!matches.length ? <Text className="text-muted-foreground px-2 py-3 text-xs">{tags.length ? 'No matching tags.' : 'No tags in this workspace.'}</Text> : null}
      </ScrollView>
      {selected.length >= MAX_TASK_FILTER_TAGS ? <Text className="text-muted-foreground text-xs">Select up to {MAX_TASK_FILTER_TAGS} tags.</Text> : null}
      <View className="flex-row justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={!selected.length} onPress={() => onSelectedChange([])}><Text>Clear tags</Text></Button>
        <PopoverClose asChild><Button variant="outline" size="sm"><Text>Done</Text></Button></PopoverClose>
      </View>
    </PopoverContent>
  </Popover>;
}
