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
import { useAuth } from '@/lib/auth';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

export default function SetupScreen() {
  const router = useRouter();
  const { client, setSession, user } = useAuth();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    async function check() {
      try {
        const { needsSetup } = await client.setupStatus();
        if (!cancelled && !needsSetup) {
          router.replace('/login');
        }
      } catch {
        // ignore — leave setup screen
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [client, router, user]);

  async function onCreateAccount() {
    if (submitting) return;
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { user: newUser, token } = await client.runSetup({ email, name, password });
      setSession(token, newUser);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
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
            />
          </View>
          <View className="gap-1.5">
            <Label nativeID="setup-confirm-label">Confirm password</Label>
            <Input
              aria-labelledby="setup-confirm-label"
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              placeholder="Repeat your password"
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={onCreateAccount}
            />
          </View>
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </CardContent>
        <CardFooter>
          <Button className="w-full" onPress={onCreateAccount} disabled={submitting}>
            <Text>{submitting ? 'Creating...' : 'Create admin account'}</Text>
          </Button>
        </CardFooter>
      </Card>
    </View>
  );
}
