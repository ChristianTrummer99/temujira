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
import { Button } from '@/components/ui/button';
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
import { useResource } from '@/lib/use-resource';
import { invalidateResources } from '@/lib/invalidation';
import { RowMenu } from '@/components/row-menu';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FilterPill, IDENTITY_PAGE_SIZE, ListPagination } from './list-controls';
import { formatRelative } from '@/lib/format';
import type { ApiKey, User } from '@temujira/client';
import {
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

function formatTime(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

const MINE = { value: 'me', label: 'Me' };

export default function ApiKeysPanel({ userId, onClearUser }: { userId?: string; onClearUser: () => void }) {
  const { client, user: me } = useAuth();
  // UX-only gating: the server enforces api_keys:manage on other users' keys.
  const canManageKeys = hasScope(me, 'api_keys:manage');

  const [search, setSearch] = React.useState('');
  const [stateFilter, setStateFilter] = React.useState<'active' | 'revoked' | 'all'>('active');
  const [page, setPage] = React.useState(0);
  const [details, setDetails] = React.useState<ApiKey | null>(null);
  const [newKeyOpen, setNewKeyOpen] = React.useState(false);
  const [keyName, setKeyName] = React.useState('');
  const [mintFor, setMintFor] = React.useState<Option>(MINE);
  const [creating, setCreating] = React.useState(false);
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<ApiKey | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const resource = useResource(async () => {
    const [keysRes, usersRes] = await Promise.all([
      client.listApiKeys(canManageKeys ? { all: true } : {}),
      canManageKeys
        ? client.listUsers({ include_deactivated: true })
        : Promise.resolve({ items: [] as User[] }),
    ]);
    return { keys: keysRes.items, users: usersRes.items };
  }, [client, canManageKeys]);
  const keys = resource.data?.keys ?? null;
  const users = resource.data?.users ?? [];

  const userById = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  function ownerLabel(userId: string): string {
    if (userId === me?.id) return `${me.name} (you)`;
    return userById.get(userId)?.name ?? userId;
  }

  const ownerOptions = React.useMemo<{ value: string; label: string }[]>(
    () =>
      users
        .filter((u) => !u.deactivated_at && u.id !== me?.id)
        .map((u) => ({ value: u.id, label: `${u.name}${u.is_agent ? ' (agent)' : ''}` })),
    [users, me?.id]
  );

  const revokedCount = (keys ?? []).filter((k) => k.revoked_at != null).length;
  const visibleKeys = React.useMemo(
    () => (keys ?? []).filter((k) =>
      (!userId || k.user_id === userId) &&
      (stateFilter === 'all' || (stateFilter === 'revoked') === !!k.revoked_at) &&
      `${k.name} ${k.token_prefix} ${k.id} ${ownerLabel(k.user_id)}`.toLowerCase().includes(search.trim().toLowerCase())),
    [keys, users, me?.id, userId, search, stateFilter]
  );
  React.useEffect(() => { setPage(0); }, [search, stateFilter, userId]);
  React.useEffect(() => { setPage((p) => Math.min(p, Math.max(0, Math.ceil(visibleKeys.length / IDENTITY_PAGE_SIZE) - 1))); }, [visibleKeys.length]);
  const pageKeys = visibleKeys.slice(page * IDENTITY_PAGE_SIZE, (page + 1) * IDENTITY_PAGE_SIZE);

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
      resource.setData((prev) => ({ keys: [apiKey, ...(prev?.keys ?? [])], users: prev?.users ?? [] }));
      setKeyName('');
      setMintFor(MINE);
      setCreatedToken(token);
      setStateFilter('active'); setSearch(''); setPage(0); invalidateResources();
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
      await resource.reload(); invalidateResources();
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
    <ScrollView className="min-h-0 flex-1" contentContainerClassName="w-full gap-3 p-3">
      <View className="gap-3">
          <View className="flex-row flex-wrap items-center gap-2">
            <Input accessibilityLabel="Search API keys" placeholder="Search key name, prefix, owner, or ID…" value={search} onChangeText={setSearch} className="h-8 min-w-48 flex-1 text-xs" />
            <View className="flex-row items-center gap-2">
              <Button onPress={() => setNewKeyOpen(true)} className="gap-1">
                <Icon as={PlusIcon} className="text-primary-foreground size-4" />
                <Text>New key</Text>
              </Button>
            </View>
          </View>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <FilterPill label="Active" selected={stateFilter === 'active'} onPress={() => setStateFilter('active')} />
            <FilterPill label={`Revoked (${revokedCount})`} selected={stateFilter === 'revoked'} onPress={() => setStateFilter('revoked')} />
            <FilterPill label="All states" selected={stateFilter === 'all'} onPress={() => setStateFilter('all')} />
            {userId ? <Button variant="secondary" size="sm" className="h-7 rounded-full sm:h-7" onPress={onClearUser}><Text className="text-xs">Owner: {ownerLabel(userId)} ×</Text></Button> : null}
          </View>
          <Text className="text-muted-foreground text-xs">{canManageKeys ? 'Keys for all users. ' : 'Your keys. '}Tokens are shown only when created.</Text>
        <View className="gap-2">
          {resource.error ? <View className="gap-2"><Text className="text-destructive text-sm">{resource.error}</Text><Button variant="outline" onPress={resource.reload}><Text>Retry</Text></Button></View> : keys === null ? (
            <View className="gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </View>
          ) : (
            <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}><View style={{ minWidth: 1000, flex: 1 }} className="border-border rounded border">
              <View className="border-border bg-muted/40 h-8 flex-row items-center gap-3 border-b px-3">
                <View className="w-4" /><Text className="text-muted-foreground min-w-40 flex-1 text-[11px]">Name</Text><Text className="text-muted-foreground w-32 text-[11px]">Prefix</Text>
                <Text className="text-muted-foreground w-44 text-[11px]">Owner</Text><Text className="text-muted-foreground w-28 text-[11px]">Created</Text><Text className="text-muted-foreground w-28 text-[11px]">Last used</Text><Text className="text-muted-foreground w-20 text-[11px]">State</Text><View className="w-7" />
              </View>
            {pageKeys.map((k) => (
              <View
                  key={k.id}
                testID={`api-key-row-${k.id}`} className="action-row border-border hover:bg-accent/30 h-10 flex-row items-center gap-3 border-b px-3">
                <Icon as={KeyRoundIcon} className="text-muted-foreground size-4" />
                <Text numberOfLines={1} className="min-w-40 flex-1 text-xs font-medium">{k.name}</Text>
                <Text className="text-muted-foreground w-32 font-mono text-[11px]">{k.token_prefix}…</Text>
                <Text numberOfLines={1} className="w-44 text-[11px]">{ownerLabel(k.user_id)}</Text>
                <Text className="text-muted-foreground w-28 text-[11px]">{formatRelative(k.created_at)}</Text>
                <Text className="text-muted-foreground w-28 text-[11px]">{k.last_used_at ? formatRelative(k.last_used_at) : 'Never'}</Text>
                <Text className={`w-20 text-[11px] ${k.revoked_at ? 'text-muted-foreground' : ''}`}>{k.revoked_at ? 'Revoked' : 'Active'}</Text>
                <RowMenu label={`Actions for API key ${k.name}`} hover={false}>
                  <DropdownMenuItem onPress={() => setDetails(k)}><Text>Key details</Text></DropdownMenuItem>
                  {typeof navigator !== 'undefined' && navigator.clipboard ? <DropdownMenuItem onPress={() => navigator.clipboard.writeText(k.id).catch(() => setError('Could not copy key ID'))}><Text>Copy key ID</Text></DropdownMenuItem> : null}
                  {!k.revoked_at ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onPress={() => setConfirmRevoke(k)}><Text>Revoke key</Text></DropdownMenuItem></> : null}
                </RowMenu>
              </View>
            ))}
            {!visibleKeys.length ? <Text className="text-muted-foreground p-4 text-xs">No API keys match these filters.</Text> : null}
            </View></ScrollView>
          )}
        </View>
        <ListPagination page={page} total={visibleKeys.length} onPage={setPage} kind="keys" />
      </View>

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

      <Dialog open={!!details} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent><DialogHeader><DialogTitle>{details?.name}</DialogTitle></DialogHeader>
          {details ? <View className="gap-2"><Text selectable className="font-mono text-xs">{details.id}</Text>
            <Text className="text-sm">Owner: {ownerLabel(details.user_id)}</Text><Text className="text-sm">Prefix: {details.token_prefix}…</Text>
            <Text className="text-sm">Created: {formatTime(details.created_at)}</Text><Text className="text-sm">Last used: {formatTime(details.last_used_at)}</Text>
            <Text className="text-sm">Revoked: {formatTime(details.revoked_at)}</Text></View> : null}
        </DialogContent>
      </Dialog>

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
                    {ownerOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} label={o.label} />
                    ))}
                  </SelectContent>
                </Select>
                <Text className="text-muted-foreground text-xs">
                  Choose the account that will use this key.
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
