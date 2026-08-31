import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type Option,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import {
  getTask,
  getUser,
  PLACEHOLDER_USERS,
  STATUS_META,
  STATUS_ORDER,
} from '@/lib/placeholder-data';
import { useLocalSearchParams } from 'expo-router';
import { PaperclipIcon } from 'lucide-react-native';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

export default function TaskDetailScreen() {
  const { key, num } = useLocalSearchParams<{ key: string; num: string }>();
  const workspaceKey = (key ?? 'TEM').toUpperCase();
  const taskNum = Number.parseInt(num ?? '1', 10);

  // TODO(api): replace with a task fetched via @temujira/client.
  const task = getTask(taskNum) ?? {
    num: taskNum,
    title: 'Unknown task',
    status: 'todo' as const,
    assigneeId: null,
    description: 'This task does not exist in the placeholder data set.',
  };
  const assignee = getUser(task.assigneeId);

  const [status, setStatus] = React.useState<Option>({
    value: task.status,
    label: STATUS_META[task.status].label,
  });
  const [assigneeOption, setAssigneeOption] = React.useState<Option>(
    assignee ? { value: assignee.id, label: assignee.name } : undefined
  );
  const [comment, setComment] = React.useState('');

  return (
    <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-3xl gap-6 p-6">
      <View className="gap-1">
        <Text className="text-muted-foreground font-mono text-xs">
          {workspaceKey}-{task.num}
        </Text>
        <Text variant="h3">{task.title}</Text>
      </View>

      <View className="flex-row flex-wrap gap-6">
        <View className="gap-1.5">
          <Label nativeID="status-label">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="min-w-40">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_ORDER.map((value) => (
                <SelectItem key={value} value={value} label={STATUS_META[value].label} />
              ))}
            </SelectContent>
          </Select>
        </View>
        <View className="gap-1.5">
          <Label nativeID="assignee-label">Assignee</Label>
          <Select value={assigneeOption} onValueChange={setAssigneeOption}>
            <SelectTrigger className="min-w-40">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              {PLACEHOLDER_USERS.map((user) => (
                <SelectItem key={user.id} value={user.id} label={user.name} />
              ))}
            </SelectContent>
          </Select>
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium">Description</Text>
        <View className="border-border bg-card rounded-md border p-4">
          <Text className="text-sm leading-6">{task.description}</Text>
        </View>
        <View className="flex-row">
          <View className="border-border bg-muted/50 flex-row items-center gap-1.5 rounded-md border px-2 py-1">
            <Icon as={PaperclipIcon} className="text-muted-foreground size-3.5" />
            <Text className="text-xs">design-mock.png</Text>
            <Text className="text-muted-foreground text-xs">214 KB</Text>
          </View>
        </View>
      </View>

      <Separator />

      <View className="gap-4">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium">Comments</Text>
          <Badge variant="secondary">
            <Text>1</Text>
          </Badge>
        </View>

        <View className="flex-row gap-3">
          <Avatar alt="Grace Hopper" className="size-8">
            <AvatarFallback>
              <Text className="text-xs">GH</Text>
            </AvatarFallback>
          </Avatar>
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-medium">Grace Hopper</Text>
              <Text className="text-muted-foreground text-xs">2 days ago</Text>
            </View>
            <Text className="text-sm leading-6">
              I looked into this - we should be able to reuse the shared validation from the server
              package once it lands. Marking my draft PR as related.
            </Text>
          </View>
        </View>

        <View className="gap-2">
          <Textarea
            placeholder="Write a comment (supports markdown)..."
            value={comment}
            onChangeText={setComment}
          />
          <View className="flex-row justify-end">
            {/* TODO(api): post the comment via @temujira/client. */}
            <Button disabled={comment.trim().length === 0} onPress={() => setComment('')}>
              <Text>Comment</Text>
            </Button>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
