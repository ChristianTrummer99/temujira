import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type Option,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { hasScope } from '@/lib/scopes';
import type { ApiKey, User } from '@temujira/client';
import {
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

const MINE = { value: 'me', label: 'Me' };

export default function ApiKeysSettingsScreen() {
  const { client, user: me } = useAuth();
  // UX-only gating: the server enforces api_keys:manage on other users' keys.
  const canManageKeys = hasScope(me, 'api_keys:manage');

  const [keys, setKeys] = React.useState<ApiKey[] | null>(null);
  const [users, setUsers] = React.useState<User[]>([]);
  const [newKeyOpen, setNewKeyOpen] = React.useState(false);
  const [keyName, setKeyName] = React.useState('');
  const [mintFor, setMintFor] = React.useState<Option>(MINE);
  const [creating, setCreating] = React.useState(false);
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<ApiKey | null>(null);
  const [showRevoked, setShowRevoked] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [keysRes, usersRes] = await Promise.all([
      client.listApiKeys(canManageKeys ? { all: true } : {}),
      canManageKeys
        ? client.listUsers({ include_deactivated: true })
        : Promise.resolve({ items: [] as User[] }),
    ]);
    setKeys(keysRes.items);
    setUsers(usersRes.items);
  }, [client, canManageKeys]);

  React.useEffect(() => {
    let cancelled = false;
    load().catch(() => {
      if (!cancelled) setKeys([]);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const userById = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  function ownerLabel(userId: string): string {
    if (userId === me?.id) return 'You';
    return userById.get(userId)?.name ?? userId;
  }

  const agentOptions = React.useMemo<{ value: string; label: string }[]>(
    () =>
      users
        .filter((u) => u.is_agent && !u.deactivated_at)
        .map((u) => ({ value: u.id, label: `${u.name} (agent)` })),
    [users]
  );

  const revokedCount = (keys ?? []).filter((k) => k.revoked_at != null).length;
  const visibleKeys = React.useMemo(
    () => (keys ?? []).filter((k) => showRevoked || !k.revoked_at),
    [keys, showRevoked]
  );

  async function onCreate() {
    if (creating || !keyName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const target = mintFor?.value && mintFor.value !== 'me' ? mintFor.value : undefined;
      const { apiKey, token } = await client.createApiKey({
        name: keyName.trim(),
        ...(target ? { user_id: target } : {}),
      });
      setKeys((prev) => [apiKey, ...(prev ?? [])]);
      setKeyName('');
      setMintFor(MINE);
      setCreatedToken(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(key: ApiKey) {
    setError(null);
    try {
      await client.revokeApiKey(key.id);
      setKeys((prev) =>
        (prev ?? []).map((k) => (k.id === key.id ? { ...k, revoked_at: Date.now() } : k))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke key');
    } finally {
      setConfirmRevoke(null);
    }
  }

  // Show creation token in a dedicated dialog until dismissed.
  function closeCreated() {
    setCreatedToken(null);
    setNewKeyOpen(false);
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-4xl gap-4 p-6">
      <Card>
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="gap-1">
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                {canManageKeys
                  ? 'Keys for you and every other user on this instance. The full token is shown only once.'
                  : 'Keys authenticate the CLI and AI agents. The full token is shown only once.'}
              </CardDescription>
            </View>
            <View className="flex-row items-center gap-2">
              {revokedCount > 0 ? (
                <Button
                  variant="outline"
                  className="gap-1"
                  accessibilityLabel={showRevoked ? 'Hide revoked keys' : 'Show revoked keys'}
                  onPress={() => setShowRevoked((v) => !v)}>
                  <Icon
                    as={showRevoked ? EyeOffIcon : EyeIcon}
                    className="text-muted-foreground size-4"
                  />
                  <Text>{showRevoked ? 'Hide revoked' : `Show revoked (${revokedCount})`}</Text>
                </Button>
              ) : null}
              <Button onPress={() => setNewKeyOpen(true)} className="gap-1">
                <Icon as={PlusIcon} className="text-primary-foreground size-4" />
                <Text>New key</Text>
              </Button>
            </View>
          </View>
        </CardHeader>
        <CardContent className="gap-2">
          {keys === null ? (
            <View className="gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </View>
          ) : visibleKeys.length === 0 ? (
            <Text className="text-muted-foreground text-sm">
              {keys.length === 0
                ? 'No API keys yet. Create one for agent access.'
                : 'No active keys — revoked keys are hidden.'}
            </Text>
          ) : (
            visibleKeys.map((k) => (
              <View
                key={k.id}
                className="border-border bg-card flex-row flex-wrap items-center gap-3 rounded-md border p-3">
                <Icon as={KeyRoundIcon} className="text-muted-foreground size-4" />
                <View className="min-w-[220px] flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-medium">{k.name}</Text>
                    {k.revoked_at ? (
                      <Badge variant="destructive">
                        <Text>Revoked</Text>
                      </Badge>
                    ) : null}
                  </View>
                  <Text className="text-muted-foreground font-mono text-xs">
                    {k.token_prefix}…{' '}
                    {k.revoked_at
                      ? `revoked ${formatTime(k.revoked_at)}`
                      : `created ${formatTime(k.created_at)}`}
                  </Text>
                </View>
                {canManageKeys ? (
                  <Text className="text-muted-foreground text-xs">{ownerLabel(k.user_id)}</Text>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  accessibilityLabel={`Revoke ${k.name}`}
                  disabled={!!k.revoked_at}
                  onPress={() => setConfirmRevoke(k)}>
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
              Give the key a name so you can recognize it (e.g. &quot;cli&quot; or &quot;deploy
              agent&quot;).
            </DialogDescription>
          </DialogHeader>
          <View className="gap-4">
            <View className="gap-1.5">
              <Label>Key name</Label>
              <Input
                value={keyName}
                onChangeText={setKeyName}
                placeholder="My key"
                onSubmitEditing={onCreate}
              />
            </View>
            {canManageKeys ? (
              <View className="gap-1.5">
                <Label>Owner</Label>
                <Select value={mintFor} onValueChange={setMintFor}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="me" label="Me" />
                    {agentOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} label={o.label} />
                    ))}
                  </SelectContent>
                </Select>
                <Text className="text-muted-foreground text-xs">
                  Mint agent accounts their keys here; humans manage their own.
                </Text>
              </View>
            ) : null}
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
            <DialogTitle>API key</DialogTitle>
            <DialogDescription>
              Copy this now — it won&apos;t be shown again. Set it as{' '}
              <Text className="font-mono">TEMUJIRA_API_KEY</Text> for the CLI, or hand it to the
              agent.
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

      <AlertDialog
        open={!!confirmRevoke}
        onOpenChange={(open) => (open ? undefined : setConfirmRevoke(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &quot;{confirmRevoke?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRevoke && confirmRevoke.user_id !== me?.id
                ? `This key belongs to ${ownerLabel(confirmRevoke.user_id)}. Anything using it stops working immediately.`
                : 'Anything using this key stops working immediately.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction onPress={() => confirmRevoke && onRevoke(confirmRevoke)}>
              <Text>Revoke key</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollView>
  );
}
