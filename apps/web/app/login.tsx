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
import { Link, useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';

export default function LoginScreen() {
  const router = useRouter();
  const { client, login, user, loading } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  React.useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const { needsSetup: needs } = await client.setupStatus();
        if (cancelled) return;
        setNeedsSetup(needs);
        // A fresh instance has no account to sign in with — go straight to setup.
        if (needs) router.replace('/setup');
      } catch {
        if (!cancelled) setNeedsSetup(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [client, router]);

  async function onSignIn() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign in');
    } finally {
      setSubmitting(false);
    }
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
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button className="w-full" onPress={onSignIn} disabled={submitting || loading}>
            <Text>{submitting ? 'Signing in...' : 'Sign in'}</Text>
          </Button>
          <View className="flex-row items-center gap-1">
            {needsSetup ? (
              <>
                <Text className="text-muted-foreground text-sm">First run?</Text>
                <Link href="/setup" asChild>
                  <Button variant="link" size="sm" className="h-auto px-0">
                    <Text className="text-sm">Set up your instance</Text>
                  </Button>
                </Link>
              </>
            ) : null}
          </View>
        </CardFooter>
      </Card>
    </View>
  );
}
