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
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

export default function SetupScreen() {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  // TODO(api): replace with the real first-run setup call via @temujira/client.
  function onCreateAccount() {
    router.replace('/');
  }

  return (
    <View className="bg-background flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up Temujira</CardTitle>
          <CardDescription>
            Create the first admin account for this self-hosted instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="gap-1.5">
            <Label nativeID="name-label">Name</Label>
            <Input
              aria-labelledby="name-label"
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChangeText={setName}
            />
          </View>
          <View className="gap-1.5">
            <Label nativeID="setup-email-label">Email</Label>
            <Input
              aria-labelledby="setup-email-label"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
            />
          </View>
          <View className="gap-1.5">
            <Label nativeID="setup-password-label">Password</Label>
            <Input
              aria-labelledby="setup-password-label"
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              placeholder="Choose a strong password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onCreateAccount}
            />
          </View>
        </CardContent>
        <CardFooter>
          <Button className="w-full" onPress={onCreateAccount}>
            <Text>Create admin account</Text>
          </Button>
        </CardFooter>
      </Card>
    </View>
  );
}
