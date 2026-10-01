import { WorkspaceFilter } from '@/components/workspace-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { splitTaskKey } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import { SEARCH_TYPES } from '@temujira/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

type SearchType = (typeof SEARCH_TYPES)[number];
const LABELS = { all: 'Everything', task: 'Tasks', comment: 'Comments', attachment: 'Files' };

export default function SearchScreen() {
  const params = useLocalSearchParams<{ workspace?: string }>();
  const [workspace, setWorkspace] = React.useState(params.workspace ?? '');
  const [text, setText] = React.useState('');
  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState<SearchType>('all');
  const [archived, setArchived] = React.useState(false);
  React.useEffect(() => { setWorkspace(params.workspace ?? ''); }, [params.workspace]);
  React.useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <View className="min-h-0 flex-1">
      <View className="border-border gap-3 border-b p-4">
        <Text className="text-lg font-semibold">Search</Text>
        <Input
          accessibilityLabel="Search tasks, comments and files"
          placeholder="Search tasks, comments and files…"
          value={text}
          onChangeText={setText}
          autoFocus
          autoCorrect={false}
        />
        <View className="flex-row flex-wrap items-center gap-3">
          <WorkspaceFilter value={workspace} onChange={setWorkspace} />
          <View className="flex-row flex-wrap gap-1">
            {SEARCH_TYPES.map((value) => (
              <Button key={value} size="sm" variant={type === value ? 'secondary' : 'ghost'}
                accessibilityState={{ selected: type === value }} onPress={() => setType(value)}>
                <Text>{LABELS[value]}</Text>
              </Button>
            ))}
          </View>
          <View className="flex-row items-center gap-2">
            <Checkbox accessibilityLabel="Include archived" checked={archived} onCheckedChange={setArchived} />
            <Text className="text-muted-foreground text-xs">Include archived</Text>
          </View>
        </View>
      </View>
      {q ? (
        <SearchResults key={`${q}:${workspace}:${type}:${archived}`} q={q} workspace={workspace} type={type} archived={archived} />
      ) : (
        <View className="gap-2 p-6">
          <Text className="font-medium">Find the task, discussion, or file you need.</Text>
          <Text className="text-muted-foreground text-sm">Search by keywords, ticket key, or a quoted phrase. Results include attachment names and supported text-file contents.</Text>
        </View>
      )}
    </View>
  );
}

function SearchResults({ q, workspace, type, archived }: { q: string; workspace: string; type: SearchType; archived: boolean }) {
  const { client } = useAuth();
  const router = useRouter();
  const [offset, setOffset] = React.useState(0);
  const resource = useResource(
    () => client.search({ q, workspace: workspace || undefined, type, include_archived: archived, limit: 30, offset }),
    [client, q, workspace, type, archived, offset]
  );
  if (resource.error) return <View className="gap-3 p-6"><Text className="text-destructive text-sm">{resource.error}</Text><Button onPress={resource.reload}><Text>Retry</Text></Button></View>;
  if (!resource.data) return <Text className="text-muted-foreground p-6 text-sm">Searching…</Text>;
  const { items, total } = resource.data;
  return (
    <ScrollView className="min-h-0 flex-1" contentContainerClassName="mx-auto w-full max-w-5xl gap-3 p-4">
      <Text accessibilityLiveRegion="polite" className="text-muted-foreground text-xs">{total} result{total === 1 ? '' : 's'}</Text>
      {items.map((result) => (
        <Pressable key={`${result.type}:${result.id}`} accessibilityRole="link"
          className="border-border bg-card hover:bg-accent/40 gap-2 rounded-lg border p-4"
          onPress={() => {
            const task = splitTaskKey(result.task_key);
            if (task) router.push({ pathname: '/w/[key]/t/[num]', params: {
              key: task.workspaceKey, num: task.number,
              ...(result.comment_id ? { comment: result.comment_id } : {}),
              ...(result.attachment_id ? { attachment: result.attachment_id } : {}),
            } });
          }}>
          <View className="flex-row flex-wrap items-center gap-2">
            <Badge variant="outline"><Text>{result.type === 'attachment' ? 'File' : result.type === 'comment' ? 'Comment' : 'Task'}</Text></Badge>
            <Text className="text-muted-foreground font-mono text-xs">{result.task_key}</Text>
            <Text className="text-muted-foreground text-xs">{result.workspace_name}</Text>
          </View>
          <Text className="text-sm font-medium">{result.title}</Text>
          <Text numberOfLines={3} className="text-muted-foreground text-sm leading-5">{result.snippet}</Text>
        </Pressable>
      ))}
      {total === 0 ? <Text className="text-muted-foreground py-8 text-center text-sm">No matches. Try fewer words or a different workspace.</Text> : null}
      {total > 30 ? (
        <View className="flex-row items-center justify-between gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - 30))}><Text>Previous</Text></Button>
          <Text className="text-muted-foreground text-xs">{offset + 1}–{Math.min(total, offset + items.length)} of {total}</Text>
          <Button variant="outline" size="sm" disabled={offset + 30 >= total} onPress={() => setOffset(offset + 30)}><Text>Next</Text></Button>
        </View>
      ) : null}
    </ScrollView>
  );
}
