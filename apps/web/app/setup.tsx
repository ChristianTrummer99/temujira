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
import { useInstance } from '@/lib/instance';
import { InstanceNameSchema } from '@temujira/shared';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

export default function SetupScreen() {
  const router = useRouter();
  const { client, setSession, user } = useAuth();
  const { instance, setInstance } = useInstance();
  const [displayName, setDisplayName] = React.useState(instance.display_name);
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
    const parsed = InstanceNameSchema.safeParse(displayName);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter an app name.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { user: newUser, token } = await client.runSetup({ email, name, password, display_name: parsed.data });
      setInstance({ display_name: parsed.data });
      setSession(token, newUser);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView className="bg-background flex-1" contentContainerClassName="grow items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up {instance.display_name}</CardTitle>
          <CardDescription>
            Create the first admin account for this self-hosted instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="gap-1.5">
            <Label nativeID="setup-app-name-label">App name</Label>
            <Input aria-labelledby="setup-app-name-label" value={displayName} onChangeText={setDisplayName} maxLength={80} />
            <Text className="text-muted-foreground text-xs">You can change this later in Settings → Branding.</Text>
          </View>
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
    </ScrollView>
  );
}
