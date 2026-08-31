import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { View } from 'react-native';

export default function ProfileSettingsScreen() {
  return (
    <View className="flex-1 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update your name, email, and password. Coming soon - this screen will be wired to the
            API.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-3">
          <Skeleton className="h-9 w-full max-w-sm" />
          <Skeleton className="h-9 w-full max-w-sm" />
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    </View>
  );
}
