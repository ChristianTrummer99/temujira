import { UserAvatar } from '@/components/user-avatar';
import { UserInfoDialog } from '@/components/user-info-dialog';
import { TruncatedCell } from '@/components/truncated-cell';
import { ProfilePictureEditor } from '@/components/profile-picture-editor';
import { RowMenu } from '@/components/row-menu';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { FilterPill, IDENTITY_PAGE_SIZE, ListPagination } from './list-controls';
import { invalidateResources } from '@/lib/invalidation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { User } from '@temujira/client';
import { SCOPES, type ScopeId } from '@temujira/shared';
import { CopyIcon, PlusIcon } from 'lucide-react-native';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

export default function UsersPanel({ onShowKeys }: { onShowKeys: (userId: string) => void }) {
  const { client, user: me, setUser } = useAuth();
  const [pictureFor, setPictureFor] = React.useState<User | null>(null);
  const [detailsFor, setDetailsFor] = React.useState<User | null>(null);
  const [search, setSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'human' | 'agent'>('all');
  const [stateFilter, setStateFilter] = React.useState<'active' | 'inactive' | 'all'>('active');
  const [adminsOnly, setAdminsOnly] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [tableWidth, setTableWidth] = React.useState(640);
  const [renameFor, setRenameFor] = React.useState<User | null>(null);
  const [renameName, setRenameName] = React.useState('');
  const [renaming, setRenaming] = React.useState(false);
  // UX-only gating: the server enforces scopes on the routes regardless. Reads are never gated.
  const isAdmin = me?.role === 'admin';
  const canManageUsers = hasScope(me, 'users:manage');
  const canManageKeys = hasScope(me, 'api_keys:manage');
  const myScopes = me?.scopes ?? [];

  const resource = useResource(
    () => client.listUsers({ include_deactivated: true }),
    [client]
  );
  const users = resource.data?.items ?? null;
  const filtered = React.useMemo(() => (users ?? []).filter((u) => {
    const text = `${u.name} ${u.email ?? ''} ${u.id}`.toLowerCase();
    return text.includes(search.trim().toLowerCase()) &&
      (typeFilter === 'all' || (typeFilter === 'agent') === u.is_agent) &&
      (stateFilter === 'all' || (stateFilter === 'inactive') === !!u.deactivated_at) &&
      (!adminsOnly || u.role === 'admin');
  }), [users, search, typeFilter, stateFilter, adminsOnly]);
  React.useEffect(() => { setPage(0); }, [search, typeFilter, stateFilter, adminsOnly]);
  React.useEffect(() => { setPage((p) => Math.min(p, Math.max(0, Math.ceil(filtered.length / IDENTITY_PAGE_SIZE) - 1))); }, [filtered.length]);
  const visibleUsers = filtered.slice(page * IDENTITY_PAGE_SIZE, (page + 1) * IDENTITY_PAGE_SIZE);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState<Option>({ value: 'member', label: 'Member' });
  const [isAgent, setIsAgent] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Per-row API key minting (admin provisioning an agent).
  const [mintFor, setMintFor] = React.useState<User | null>(null);
  const [keyName, setKeyName] = React.useState('');
  const [minting, setMinting] = React.useState(false);
  const [mintedToken, setMintedToken] = React.useState<string | null>(null);
  const [mintError, setMintError] = React.useState<string | null>(null);

  // Per-row access editing (scopes + workspace allowlist).
  const [accessFor, setAccessFor] = React.useState<User | null>(null);
  const [accessScopes, setAccessScopes] = React.useState<ScopeId[]>([]);
  const [accessAll, setAccessAll] = React.useState(true);
  const [accessWsIds, setAccessWsIds] = React.useState<string[]>([]);
  const [accessExclusive, setAccessExclusive] = React.useState(false);
  const [accessBusy, setAccessBusy] = React.useState(false);
  const [accessError, setAccessError] = React.useState<string | null>(null);
  const wsResource = useResource(
    () => client.listWorkspaces({ include_archived: true }),
    [client]
  );
  const workspaces = wsResource.data?.items ?? [];

  function openAccess(u: User) {
    setAccessFor(u);
    setAccessScopes(u.scopes);
    setAccessAll(u.workspace_access_all);
    setAccessWsIds(u.workspace_ids);
    setAccessExclusive(u.exclusive_identity);
    setAccessError(null);
  }

  function closeAccess() {
    setAccessFor(null);
    setAccessError(null);
  }

  function toggleAccessScope(id: ScopeId) {
    setAccessScopes((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function toggleAccessWs(id: string) {
    setAccessWsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function saveAccess() {
    if (!accessFor || accessBusy) return;
    setAccessBusy(true);
    setAccessError(null);
    try {
      await client.updateUser(accessFor.id, {
        scopes: accessScopes,
        workspace_access_all: accessAll,
        // Persist the selection even when "all" is on, so toggling back restores it.
        workspace_ids: accessWsIds,
        // Exclusive mode applies to agent accounts only.
        ...(accessFor.is_agent ? { exclusive_identity: accessExclusive } : {}),
      });
      closeAccess();
      await resource.reload();
    } catch (e) {
      setAccessError(e instanceof Error ? e.message : 'Failed to save access');
    } finally {
      setAccessBusy(false);
    }
  }

  /** A non-admin manager may only grant scopes they hold themselves. */
  function canGrantScope(id: ScopeId): boolean {
    return isAdmin || myScopes.includes(id);
  }

  async function onCreate() {
    if (creating || !name.trim() || (!isAgent && !email.trim())) return;
    setCreating(true);
    setError(null);
    try {
      await client.createUser({
        name: name.trim(),
        role: role?.value as 'admin' | 'member',
        is_agent: isAgent,
        ...(isAgent ? {} : { email: email.trim(), password }),
      });
      setName('');
      setEmail('');
      setPassword('');
      setRole({ value: 'member', label: 'Member' });
      setIsAgent(false);
      setCreateOpen(false);
      await resource.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  async function toggleRole(u: User) {
    if (u.id === me?.id) return;
    const nextRole = u.role === 'admin' ? 'member' : 'admin';
    setError(null);
    try {
      await client.updateUser(u.id, { role: nextRole });
      await resource.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change role');
    }
  }

  async function toggleDeactivate(u: User) {
    if (u.id === me?.id) return;
    setError(null);
    try {
      if (u.deactivated_at) {
        await client.updateUser(u.id, { reactivate: true });
      } else {
        await client.deactivateUser(u.id);
      }
      await resource.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update user');
    }
  }

  async function onMint() {
    if (minting || !mintFor || !keyName.trim()) return;
    setMinting(true);
    setMintError(null);
    try {
      const { token } = await client.createApiKey({ name: keyName.trim(), user_id: mintFor.id });
      setMintedToken(token);
      invalidateResources();
      setKeyName('');
    } catch (e) {
      setMintError(e instanceof Error ? e.message : 'Failed to mint API key');
    } finally {
      setMinting(false);
    }
  }

  function closeMint() {
    setMintFor(null);
    setMintedToken(null);
    setKeyName('');
    setMintError(null);
  }

  const isAgentOption = (v: boolean): Option => ({ value: String(v), label: v ? 'Agent' : 'Human' });

  async function saveName() {
    if (!renameFor || !renameName.trim() || renaming) return;
    setRenaming(true); setError(null);
    try {
      const result = renameFor.id === me?.id ? await client.updateMe({ name: renameName.trim() }) : await client.updateUser(renameFor.id, { name: renameName.trim() });
      if (result.user.id === me?.id) setUser(result.user);
      await resource.reload(); setRenameFor(null); invalidateResources();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not rename user'); }
    finally { setRenaming(false); }
  }

  return (
    <ScrollView className="min-h-0 flex-1" contentContainerClassName="w-full gap-3 p-3">
      <View className="gap-3">
          <View className="flex-row flex-wrap items-center gap-2">
            <Input accessibilityLabel="Search users" placeholder="Search name, email, or ID…" value={search} onChangeText={setSearch} className="h-8 min-w-48 flex-1 text-xs" />
            {canManageUsers ? (
              <Button onPress={() => setCreateOpen(true)} className="gap-1">
                <Icon as={PlusIcon} className="text-primary-foreground size-4" />
                <Text>Add user</Text>
              </Button>
            ) : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <FilterPill label="Everyone" selected={typeFilter === 'all'} onPress={() => setTypeFilter('all')} />
            <FilterPill label="Humans" selected={typeFilter === 'human'} onPress={() => setTypeFilter('human')} />
            <FilterPill label="Agents" selected={typeFilter === 'agent'} onPress={() => setTypeFilter('agent')} />
            <View className="bg-border mx-1 h-4 w-px" />
            <FilterPill label="Active" selected={stateFilter === 'active'} onPress={() => setStateFilter('active')} />
            <FilterPill label="Inactive" selected={stateFilter === 'inactive'} onPress={() => setStateFilter('inactive')} />
            <FilterPill label="All states" selected={stateFilter === 'all'} onPress={() => setStateFilter('all')} />
            <FilterPill label="Admins" selected={adminsOnly} onPress={() => setAdminsOnly((v) => !v)} />
          </View>
        <View className="gap-2">
          {!canManageUsers ? (
            <Text className="text-muted-foreground text-xs">
              Managing users needs the users:manage scope. Ask an admin to grant it.
            </Text>
          ) : null}
          {resource.error ? (
            <View className="gap-2">
              <Text className="text-destructive text-sm">{resource.error}</Text>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onPress={() => resource.reload()}>
                <Text>Retry</Text>
              </Button>
            </View>
          ) : users === null ? (
            <View className="gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </View>
          ) : (
            <ScrollView horizontal onLayout={({ nativeEvent }) => setTableWidth(Math.max(640, nativeEvent.layout.width))}>
            <View style={{ width: tableWidth }} className="border-border rounded border">
            <View className="border-border bg-muted/40 h-8 flex-row items-center gap-2 border-b px-2">
              <View className="w-6" /><Text className="text-muted-foreground min-w-20 max-w-48 flex-1 text-[11px]">Name</Text>
              <Text className="text-muted-foreground min-w-24 max-w-56 flex-1 text-[11px]">Login</Text><Text className="text-muted-foreground w-12 text-[11px]">Type</Text>
              <Text className="text-muted-foreground w-12 text-[11px]">Role</Text><Text className="text-muted-foreground w-16 text-[11px]">Identity</Text>
              <Text className="text-muted-foreground w-14 text-[11px]">State</Text><View className="ml-auto w-7" />
            </View>
            {visibleUsers.map((u) => {
              const isMe = u.id === me?.id;
              const canEdit = isMe || isAdmin || u.role !== 'admin';
              return (
                <View
                  key={u.id}
                  testID={`user-row-${u.id}`} className="action-row border-border hover:bg-accent/30 h-10 flex-row items-center gap-2 border-b px-2">
                  <UserAvatar user={u} className="size-6" textClassName="text-[10px]" />
                  <TruncatedCell value={`${u.name}${isMe ? ' (you)' : ''}`} className="min-w-20 max-w-48 flex-1" textClassName="font-medium" />
                  <TruncatedCell value={u.is_agent ? 'API-key login' : u.email ?? '—'} className="min-w-24 max-w-56 flex-1" textClassName="text-muted-foreground" />
                  <Text className="w-12 text-[11px]">{u.is_agent ? 'Agent' : 'Human'}</Text>
                  <Text className="w-12 text-[11px]">{u.role === 'admin' ? 'Admin' : 'Member'}</Text>
                  <Text className="w-16 text-[11px]">{u.is_agent ? u.exclusive_identity ? 'Exclusive' : 'Shared' : '—'}</Text>
                  <Text className={`w-14 text-[11px] ${u.deactivated_at ? 'text-muted-foreground' : ''}`}>{u.deactivated_at ? 'Inactive' : 'Active'}</Text>
                  <RowMenu label={`Actions for user ${u.name}`} hover={false} className="ml-auto">
                    <DropdownMenuItem onPress={() => setDetailsFor(u)}><Text>User details</Text></DropdownMenuItem>
                    {canManageKeys || isMe ? <DropdownMenuItem onPress={() => onShowKeys(u.id)}><Text>View API keys</Text></DropdownMenuItem> : null}
                    {canManageKeys || isMe ? <DropdownMenuItem onPress={() => { setMintFor(u); setKeyName(`${u.name.split(/\s+/)[0].toLowerCase()}-key`); }}><Text>Create API key</Text></DropdownMenuItem> : null}
                    {isMe || (canManageUsers && canEdit) ? <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onPress={() => { setRenameFor(u); setRenameName(u.name); setError(null); }}><Text>Rename user</Text></DropdownMenuItem>
                      <DropdownMenuItem onPress={() => setPictureFor(u)}><Text>Change picture</Text></DropdownMenuItem>
                    </> : null}
                    {canManageUsers && canEdit ? <DropdownMenuItem onPress={() => openAccess(u)}><Text>Edit access</Text></DropdownMenuItem> : null}
                    {isAdmin && !isMe ? <DropdownMenuItem onPress={() => toggleRole(u)}><Text>{u.role === 'admin' ? 'Change to member' : 'Change to admin'}</Text></DropdownMenuItem> : null}
                    {canManageUsers && canEdit && !isMe ? <DropdownMenuItem variant={u.deactivated_at ? 'default' : 'destructive'} onPress={() => toggleDeactivate(u)}><Text>{u.deactivated_at ? 'Reactivate' : 'Deactivate'}</Text></DropdownMenuItem> : null}
                    {typeof navigator !== 'undefined' && navigator.clipboard ? <DropdownMenuItem onPress={() => navigator.clipboard.writeText(u.id).catch(() => setError('Could not copy user ID'))}><Text>Copy user ID</Text></DropdownMenuItem> : null}
                  </RowMenu>
                </View>
              );
            })}
            {filtered.length === 0 ? <Text className="text-muted-foreground p-4 text-xs">No users match these filters.</Text> : null}
            </View></ScrollView>
          )}
        </View>
        <ListPagination page={page} total={filtered.length} onPage={setPage} kind="users" />
      </View>

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
      <UserInfoDialog user={detailsFor} onClose={() => setDetailsFor(null)} />

      <Dialog open={!!renameFor} onOpenChange={(open) => { if (!open) setRenameFor(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Rename {renameFor?.name}</DialogTitle></DialogHeader>
          <Input accessibilityLabel="User name" value={renameName} onChangeText={setRenameName} autoFocus />
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
          <DialogFooter><Button variant="outline" onPress={() => setRenameFor(null)}><Text>Cancel</Text></Button><Button disabled={renaming || !renameName.trim()} onPress={saveName}><Text>{renaming ? 'Saving...' : 'Save'}</Text></Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pictureFor} onOpenChange={(open) => { if (!open) setPictureFor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Picture for {pictureFor?.name}</DialogTitle></DialogHeader>
          {pictureFor ? <ProfilePictureEditor key={pictureFor.id} user={pictureFor} onChanged={(updated) => {
            setPictureFor(updated);
            if (updated.id === me?.id) setUser(updated);
            void resource.reload();
          }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Create a human account (with password) or an agent account (API-key login only).
            </DialogDescription>
          </DialogHeader>
          <View className="gap-4">
            <View className="gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChangeText={setName} placeholder="Ada Lovelace" />
            </View>
            {!isAgent ? (
              <View className="gap-1.5">
                <Label>Email</Label>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  inputMode="email"
                  placeholder="you@example.com"
                />
              </View>
            ) : null}
            <View className="flex-row gap-3">
              <View className="flex-1 gap-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member" label="Member" />
                    <SelectItem value="admin" label="Admin" />
                  </SelectContent>
                </Select>
              </View>
              <View className="flex-1 gap-1.5">
                <Label>Type</Label>
                <Select
                  value={isAgentOption(isAgent)}
                  onValueChange={(o) => setIsAgent(o?.value === 'true')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false" label="Human" />
                    <SelectItem value="true" label="Agent" />
                  </SelectContent>
                </Select>
              </View>
            </View>
            {!isAgent ? (
              <View className="gap-1.5">
                <Label>Password</Label>
                <Input
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="At least 8 characters"
                />
              </View>
            ) : (
              <Text className="text-muted-foreground text-xs">
                Agent accounts use API keys for authentication — no email or password.
              </Text>
            )}
            {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
          </View>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">
                <Text>Cancel</Text>
              </Button>
            </DialogClose>
            <Button onPress={onCreate} disabled={creating || !name.trim() || (!isAgent && !email.trim())}>
              <Text>{creating ? 'Creating...' : 'Create'}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mint a key for a specific user; the token is shown exactly once. */}
      <Dialog open={!!mintFor} onOpenChange={(open) => (open ? undefined : closeMint())}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mintedToken ? 'API key' : `New API key for ${mintFor?.name ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {mintedToken
                ? "Copy this now — it won't be shown again. Hand it to the agent or set it as TEMUJIRA_API_KEY."
                : 'Name the key so you can recognize it later.'}
            </DialogDescription>
          </DialogHeader>
          {mintedToken ? (
            <View className="border-border bg-muted/50 gap-2 rounded-md border p-3">
              <Text className="font-mono text-sm" selectable>
                {mintedToken}
              </Text>
              <Button
                variant="outline"
                size="sm"
                className="gap-1 self-start"
                onPress={() => {
                  if (typeof navigator !== 'undefined') {
                    navigator.clipboard?.writeText(mintedToken);
                  }
                }}>
                <Icon as={CopyIcon} className="size-3.5" />
                <Text className="text-xs">Copy</Text>
              </Button>
            </View>
          ) : (
            <View className="gap-1.5">
              <Label>Key name</Label>
              <Input
                value={keyName}
                onChangeText={setKeyName}
                placeholder="agent key"
                onSubmitEditing={onMint}
              />
              {mintError ? <Text className="text-destructive text-sm">{mintError}</Text> : null}
            </View>
          )}
          <DialogFooter>
            {mintedToken ? (
              <Button onPress={closeMint}>
                <Text>Done</Text>
              </Button>
            ) : (
              <>
                <Button variant="outline" onPress={closeMint}>
                  <Text>Cancel</Text>
                </Button>
                <Button onPress={onMint} disabled={minting || !keyName.trim()}>
                  <Text>{minting ? 'Creating...' : 'Create key'}</Text>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scopes + workspace allowlist for one user. */}
      <Dialog open={!!accessFor} onOpenChange={(open) => (open ? undefined : closeAccess())}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>Access for {accessFor?.name ?? ''}</DialogTitle>
            <DialogDescription>
              Scopes decide what they can do. Workspace access decides what they can see.
            </DialogDescription>
          </DialogHeader>
          <ScrollView className="max-h-[60vh]" contentContainerClassName="gap-5">
            <View className="gap-2">
              <Text className="text-sm font-medium">Permissions</Text>
              {SCOPES.map((s) => {
                const checked = accessScopes.includes(s.id);
                const grantable = canGrantScope(s.id);
                return (
                  <View key={s.id} className="flex-row items-start gap-3">
                    <Checkbox
                      checked={checked}
                      disabled={!grantable}
                      onCheckedChange={() => grantable && toggleAccessScope(s.id)}
                    />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm">{s.label}</Text>
                      <Text className="text-muted-foreground text-xs">
                        {s.description}
                        {!grantable ? ' (you don’t hold this scope)' : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {accessFor?.is_agent ? (
              <View className="gap-2">
                <Text className="text-sm font-medium">Identity access</Text>
                <View className="flex-row items-start gap-3">
                  <Checkbox
                    checked={accessExclusive}
                    onCheckedChange={() => setAccessExclusive((v) => !v)}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm">Exclusive identity</Text>
                    <Text className="text-muted-foreground text-xs">
                      Only one active session key may use this identity at a time. Workers
                      acquire a session (<Text className="font-mono">tmj identity acquire</Text>)
                      and release it when finished; other keys cannot read or write as this
                      identity meanwhile.
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            <View className="gap-2">
              <Text className="text-sm font-medium">Workspace access</Text>
              <View className="flex-row items-center gap-3">
                <Checkbox
                  checked={accessAll}
                  onCheckedChange={() => {
                    if (isAdmin || !accessAll) setAccessAll(!accessAll);
                  }}
                  disabled={!isAdmin && !accessAll}
                />
                <View className="flex-1">
                  <Text className="text-sm">All workspaces</Text>
                  <Text className="text-muted-foreground text-xs">
                    Includes workspaces created later.
                    {!isAdmin && !accessAll ? ' (only admins can grant all)' : ''}
                  </Text>
                </View>
              </View>
              {!accessAll ? (
                <View className="gap-1 pl-7">
                  {workspaces.length === 0 ? (
                    <Text className="text-muted-foreground text-xs">No workspaces available.</Text>
                  ) : (
                    workspaces.map((w) => (
                      <View key={w.id} className="flex-row items-center gap-3 py-1">
                        <Checkbox
                          checked={accessWsIds.includes(w.id)}
                          onCheckedChange={() => toggleAccessWs(w.id)}
                        />
                        <Text className="text-sm">
                          {w.name}{' '}
                          <Text className="text-muted-foreground font-mono text-xs">{w.key}</Text>
                          {w.archived_at ? (
                            <Text className="text-muted-foreground text-xs"> (archived)</Text>
                          ) : null}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </View>
            {accessError ? <Text className="text-destructive text-sm">{accessError}</Text> : null}
          </ScrollView>
          <DialogFooter>
            <Button variant="outline" onPress={closeAccess}>
              <Text>Cancel</Text>
            </Button>
            <Button onPress={saveAccess} disabled={accessBusy}>
              <Text>{accessBusy ? 'Saving...' : 'Save'}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollView>
  );
}
