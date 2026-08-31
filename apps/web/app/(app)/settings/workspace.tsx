import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { View } from 'react-native';

export default function WorkspaceSettingsScreen() {
  return (
    <View className="flex-1 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            Rename, archive, or delete workspaces. Coming soon - this screen will be wired to the
            API.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <Skeleton className="h-9 w-full max-w-sm" />
          <Skeleton className="h-9 w-48" />
        </CardContent>
      </Card>
    </View>
  );
}
