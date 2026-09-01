import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
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
import { initialsOf } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import type { User } from '@temujira/client';
import { CopyIcon, KeyRoundIcon, PlusIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';

export default function UsersSettingsScreen() {
  const { client, user: me } = useAuth();
  // UX-only gating: the server enforces `auth: "admin"` on create/update/deactivate
  // regardless. Reads are never gated.
  const isAdmin = me?.role === 'admin';

  const resource = useResource(
    () => client.listUsers({ include_deactivated: true }),
    [client]
  );
  const users = resource.data?.items ?? null;

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

  async function onCreate() {
    if (creating || !name.trim() || !email.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await client.createUser({
        email: email.trim(),
        name: name.trim(),
        role: role?.value as 'admin' | 'member',
        is_agent: isAgent,
        ...(isAgent ? {} : { password }),
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

  return (
    <View className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="gap-1">
              <CardTitle>Users</CardTitle>
              <CardDescription>
                Human teammates and agent accounts. Agents log in with API keys only.
              </CardDescription>
            </View>
            {isAdmin ? (
              <Button onPress={() => setCreateOpen(true)} className="gap-1">
                <Icon as={PlusIcon} className="text-primary-foreground size-4" />
                <Text>Add user</Text>
              </Button>
            ) : null}
          </View>
        </CardHeader>
        <CardContent className="gap-2">
          {!isAdmin ? (
            <Text className="text-muted-foreground text-xs">
              Only admins can add users, change roles, deactivate accounts, or mint keys for
              others.
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
            users.map((u) => {
              const isMe = u.id === me?.id;
              return (
                <View
                  key={u.id}
                  className="border-border bg-card flex-row items-center gap-3 rounded-md border p-3">
                  <Avatar alt={u.name} className="size-8">
                    <AvatarFallback>
                      <Text className="text-xs">{initialsOf(u.name)}</Text>
                    </AvatarFallback>
                  </Avatar>
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm font-medium">
                        {u.name}
                        {isMe ? ' (you)' : ''}
                      </Text>
                      {u.deactivated_at ? (
                        <Badge variant="destructive">
                          <Text>Deactivated</Text>
                        </Badge>
                      ) : null}
                    </View>
                    <Text className="text-muted-foreground text-xs">{u.email}</Text>
                  </View>
                  <Badge variant="secondary">
                    <Text>{u.role === 'admin' ? 'Admin' : 'Member'}</Text>
                  </Badge>
                  <Badge variant={u.is_agent ? 'default' : 'outline'}>
                    <Text>{u.is_agent ? 'Agent' : 'Human'}</Text>
                  </Badge>
                  {isAdmin ? (
                    <View className="flex-row gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1"
                        accessibilityLabel={`Mint API key for ${u.name}`}
                        onPress={() => {
                          setMintFor(u);
                          setKeyName(`${u.name.split(/\s+/)[0].toLowerCase()}-key`);
                        }}>
                        <Icon as={KeyRoundIcon} className="text-muted-foreground size-3.5" />
                        <Text className="text-xs">API key</Text>
                      </Button>
                      {!isMe ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            onPress={() => toggleRole(u)}>
                            <Text className="text-xs">
                              {u.role === 'admin' ? 'Demote' : 'Promote'}
                            </Text>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            onPress={() => toggleDeactivate(u)}>
                            <Text className="text-destructive text-xs">
                              {u.deactivated_at ? 'Reactivate' : 'Deactivate'}
                            </Text>
                          </Button>
                        </>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </CardContent>
      </Card>

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

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
                Agent accounts use API keys for authentication and cannot sign in with a password.
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
            <Button onPress={onCreate} disabled={creating || !name.trim() || !email.trim()}>
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
    </View>
  );
}
