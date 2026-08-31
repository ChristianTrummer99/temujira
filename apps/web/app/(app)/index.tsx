import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { PLACEHOLDER_WORKSPACES } from '@/lib/placeholder-data';
import { useRouter } from 'expo-router';
import { FolderIcon } from 'lucide-react-native';
import { View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Pick a workspace</CardTitle>
          <CardDescription>
            Choose a workspace from the sidebar or the list below to see its tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          {PLACEHOLDER_WORKSPACES.map((workspace) => (
            <Button
              key={workspace.key}
              variant="outline"
              className="w-full flex-row justify-start gap-2"
              onPress={() => router.push(`/w/${workspace.key}`)}>
              <Icon as={FolderIcon} className="size-4" />
              <Text className="flex-1 text-left">{workspace.name}</Text>
              <Text className="text-muted-foreground text-xs">{workspace.count} tasks</Text>
            </Button>
          ))}
        </CardContent>
      </Card>
    </View>
  );
}
