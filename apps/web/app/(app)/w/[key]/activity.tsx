import { ActivityFeed } from '@/components/activity-feed';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

export default function WorkspaceActivityScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const [mine, setMine] = React.useState(false);
  return (
    <View className="min-h-0 flex-1">
      <View className="border-border flex-row items-center justify-between border-b p-4">
        <Text className="text-sm font-medium">{key} activity</Text>
        <Button size="sm" variant={mine ? 'secondary' : 'ghost'} onPress={() => setMine((v) => !v)}><Text>My tasks</Text></Button>
      </View>
      <ScrollView className="min-h-0 flex-1" contentContainerClassName="mx-auto w-full max-w-5xl p-4">
        <ActivityFeed key={`${key}:${mine}`} workspace={key} mine={mine} />
      </ScrollView>
    </View>
  );
}
