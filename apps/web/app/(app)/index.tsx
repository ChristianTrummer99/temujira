import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import type { Workspace } from '@temujira/client';
import { useRouter } from 'expo-router';
import { FolderIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';

export default function HomeScreen() {
  const router = useRouter();
  const { client } = useAuth();
  const [workspaces, setWorkspaces] = React.useState<Workspace[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { items } = await client.listWorkspaces();
        if (!cancelled) setWorkspaces(items);
      } catch {
        if (!cancelled) setWorkspaces([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [client]);

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
          {workspaces === null ? (
            <View className="gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </View>
          ) : workspaces.length === 0 ? (
            <Text className="text-muted-foreground text-sm">No workspaces yet.</Text>
          ) : (
            workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant="outline"
                className="w-full flex-row justify-start gap-2"
                onPress={() => router.push(`/w/${workspace.key}`)}>
                <Icon as={FolderIcon} className="size-4" />
                <Text className="flex-1 text-left">{workspace.name}</Text>
                <Text className="text-muted-foreground text-xs">{workspace.key}</Text>
              </Button>
            ))
          )}
        </CardContent>
      </Card>
    </View>
  );
}
