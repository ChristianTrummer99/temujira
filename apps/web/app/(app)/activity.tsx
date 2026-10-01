import { ActivityFeed } from '@/components/activity-feed';
import { WorkspaceFilter } from '@/components/workspace-filter';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

export default function ActivityScreen() {
  const [workspace, setWorkspace] = React.useState('');
  const [mine, setMine] = React.useState(false);
  return (
    <View className="min-h-0 flex-1">
      <View className="border-border gap-2 border-b p-4">
        <Text className="text-lg font-semibold">Activity</Text>
        <Text className="text-muted-foreground text-sm">Actions across the workspaces and accounts you can access.</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <WorkspaceFilter value={workspace} onChange={setWorkspace} />
          <Button variant={mine ? 'secondary' : 'ghost'} size="sm" accessibilityState={{ selected: mine }} onPress={() => setMine((v) => !v)}><Text>My tasks</Text></Button>
        </View>
      </View>
      <ScrollView className="min-h-0 flex-1" contentContainerClassName="mx-auto w-full max-w-5xl p-4">
        <ActivityFeed key={`${workspace}:${mine}`} workspace={workspace || undefined} mine={mine} />
      </ScrollView>
    </View>
  );
}
