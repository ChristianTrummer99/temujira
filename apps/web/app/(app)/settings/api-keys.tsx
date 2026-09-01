import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import type { ApiKey } from '@temujira/client';
import { CopyIcon, KeyRoundIcon, PlusIcon, TrashIcon } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

export default function ApiKeysSettingsScreen() {
  const { client, user } = useAuth();
  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [newKeyOpen, setNewKeyOpen] = React.useState(false);
  const [keyName, setKeyName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { items } = await client.listApiKeys();
        if (!cancelled) setKeys(items);
      } catch {
        if (!cancelled) setKeys([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function onCreate() {
    if (creating || !keyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { apiKey, token } = await client.createApiKey({ name: keyName.trim() });
      setKeys((prev) => [...(prev ?? []), apiKey]);
      setKeyName('');
      setCreatedToken(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    try {
      await client.revokeApiKey(id);
      setKeys((prev) => (prev ?? []).filter((k) => k.id !== id));
    } catch {
      // ignore
    }
  }

  // Show creation token in a dedicated dialog until dismissed.
  function closeCreated() {
    setCreatedToken(null);
    setNewKeyOpen(false);
  }

  return (
    <View className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="gap-1">
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                Keys authenticate the CLI and AI agents. The full token is shown only once.
              </CardDescription>
            </View>
            <Button onPress={() => setNewKeyOpen(true)} className="gap-1">
              <Icon as={PlusIcon} className="text-primary-foreground size-4" />
              <Text>New key</Text>
            </Button>
          </View>
        </CardHeader>
        <CardContent className="gap-2">
          {keys === null ? (
            <View className="gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </View>
          ) : keys.length === 0 ? (
            <Text className="text-muted-foreground text-sm">
              No API keys yet. Create one for agent access.
            </Text>
          ) : (
            keys.map((k) => (
              <View key={k.id} className="border-border bg-card flex-row items-center gap-3 rounded-md border p-3">
                <Icon as={KeyRoundIcon} className="text-muted-foreground size-4" />
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-medium">{k.name}</Text>
                    {k.revoked_at ? <Badge variant="destructive"><Text>Revoked</Text></Badge> : null}
                  </View>
                  <Text className="text-muted-foreground font-mono text-xs">
                    {k.token_prefix}…{' '}
                    {k.revoked_at ? `revoked ${formatTime(k.revoked_at)}` : `created ${formatTime(k.created_at)}`}
                  </Text>
                </View>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={!!k.revoked_at}
                  onPress={() => onRevoke(k.id)}>
                  <Icon as={TrashIcon} className="text-destructive size-3.5" />
                </Button>
              </View>
            ))
          )}
        </CardContent>
      </Card>

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

      <Dialog open={newKeyOpen} onOpenChange={setNewKeyOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give the key a name so you can recognize it (e.g. &quot;cli&quot; or &quot;deploy agent&quot;).
            </DialogDescription>
          </DialogHeader>
          <View className="gap-1.5">
            <Label>Key name</Label>
            <Input
              value={keyName}
              onChangeText={setKeyName}
              placeholder="My key"
              onSubmitEditing={onCreate}
            />
          </View>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">
                <Text>Cancel</Text>
              </Button>
            </DialogClose>
            <Button onPress={onCreate} disabled={creating || !keyName.trim()}>
              <Text>{creating ? 'Creating...' : 'Create'}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdToken} onOpenChange={() => (createdToken ? closeCreated() : undefined)}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>Your API key</DialogTitle>
            <DialogDescription>
              Copy this now — it won&apos;t be shown again. Set it as{' '}
              <Text className="font-mono">TEMUJIRA_API_KEY</Text> for the CLI, or hand it to an agent.
            </DialogDescription>
          </DialogHeader>
          <View className="border-border bg-muted/50 gap-2 rounded-md border p-3">
            <Text className="font-mono text-sm" selectable>
              {createdToken}
            </Text>
            <Button
              variant="outline"
              size="sm"
              className="self-start gap-1"
              onPress={() => {
                if (createdToken && typeof navigator !== 'undefined') {
                  navigator.clipboard?.writeText(createdToken);
                }
              }}>
              <Icon as={CopyIcon} className="size-3.5" />
              <Text className="text-xs">Copy</Text>
            </Button>
          </View>
          <DialogFooter>
            <Button onPress={closeCreated}>
              <Text>Done</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
