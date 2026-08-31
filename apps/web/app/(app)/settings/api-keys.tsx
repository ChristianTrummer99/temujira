import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { View } from 'react-native';

export default function ApiKeysSettingsScreen() {
  return (
    <View className="flex-1 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Create and revoke API keys for integrations and the CLI. Coming soon - this screen will
            be wired to the API.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    </View>
  );
}
