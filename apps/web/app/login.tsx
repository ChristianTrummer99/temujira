import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { Link, useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  // TODO(api): replace with a real login call via @temujira/client.
  function onSignIn() {
    router.replace('/');
  }

  return (
    <View className="bg-background flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Temujira</CardTitle>
          <CardDescription>Enter your email and password to continue.</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="gap-1.5">
            <Label nativeID="email-label">Email</Label>
            <Input
              aria-labelledby="email-label"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
            />
          </View>
          <View className="gap-1.5">
            <Label nativeID="password-label">Password</Label>
            <Input
              aria-labelledby="password-label"
              autoCapitalize="none"
              autoComplete="password"
              secureTextEntry
              placeholder="********"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSignIn}
            />
          </View>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button className="w-full" onPress={onSignIn}>
            <Text>Sign in</Text>
          </Button>
          <View className="flex-row items-center gap-1">
            <Text className="text-muted-foreground text-sm">First run?</Text>
            <Link href="/setup" asChild>
              <Button variant="link" size="sm" className="h-auto px-0">
                <Text className="text-sm">Set up your instance</Text>
              </Button>
            </Link>
          </View>
        </CardFooter>
      </Card>
    </View>
  );
}
