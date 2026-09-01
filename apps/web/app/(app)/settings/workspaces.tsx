import { TagPill } from '@/components/tag-pill';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  DialogTrigger,
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
import { useWorkspaceList } from '@/lib/workspaces';
import type { FieldDef, Status, Tag, Workspace } from '@temujira/client';
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';

const PRESET_COLORS = ['#6b7280', '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#f43f5e'];

export default function WorkspacesSettingsScreen() {
  const { client, user } = useAuth();
  const { all, loading, reload } = useWorkspaceList();
  const isAdmin = user?.role === 'admin';

  return (
    <View className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      {loading ? (
        <View className="gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </View>
      ) : all.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <Text className="text-muted-foreground text-sm">No workspaces yet.</Text>
          </CardContent>
        </Card>
      ) : (
        all.map((ws) => (
          <WorkspaceCard
            key={ws.id}
            workspace={ws}
            onReload={reload}
            client={client}
            isAdmin={isAdmin}
          />
        ))
      )}
    </View>
  );
}

function WorkspaceCard({
  workspace,
  onReload,
  client,
  isAdmin,
}: {
  workspace: Workspace;
  onReload: () => void;
  client: ReturnType<typeof useAuth>['client'];
  isAdmin: boolean;
}) {
  const [statuses, setStatuses] = React.useState<Status[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { items } = await client.listStatuses(workspace.key);
        if (!cancelled) setStatuses(items);
      } catch {
        if (!cancelled) setStatuses([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [client, workspace.key]);

  const archived = workspace.archived_at != null;

  async function toggleArchive() {
    try {
      await client.updateWorkspace(workspace.key, { archived: !archived });
      onReload();
    } catch {
      // ignore
    }
  }

  async function onMove(id: string, dir: -1 | 1) {
    if (!statuses) return;
    const idx = statuses.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= statuses.length) return;
    const next = [...statuses];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    try {
      const { items } = await client.reorderStatuses(workspace.key, {
        status_ids: next.map((s) => s.id),
      });
      setStatuses(items);
    } catch {
      // ignore
    }
  }

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center justify-between">
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <CardTitle>{workspace.name}</CardTitle>
              <Badge variant="outline">
                <Text>{workspace.key}</Text>
              </Badge>
              {archived ? (
                <Badge variant="secondary">
                  <Text>Archived</Text>
                </Badge>
              ) : null}
            </View>
            <CardDescription>Statuses, tags, and workspace settings.</CardDescription>
          </View>
          <View className="flex-row gap-1">
            <RenameDialog workspace={workspace} onDone={onReload} />
            <Button variant="outline" size="sm" className="h-8 gap-1" onPress={toggleArchive}>
              <Icon as={ArchiveIcon} className="size-3.5" />
              <Text className="text-xs">{archived ? 'Unarchive' : 'Archive'}</Text>
            </Button>
          </View>
        </View>
      </CardHeader>
      <CardContent className="gap-4">
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium">Statuses</Text>
            <AddStatusDialog
              workspaceKey={workspace.key}
              onAdded={(s) => setStatuses((prev) => [...(prev ?? []), s])}
            />
          </View>
          {statuses === null ? (
            <View className="gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </View>
          ) : (
            statuses.map((status, i) => (
              <View
                key={status.id}
                className="border-border bg-card flex-row items-center gap-3 rounded-md border p-2.5">
                <View style={{ backgroundColor: status.color }} className="size-3 rounded-full" />
                <Text className="flex-1 text-sm">{status.name}</Text>
                <View className="flex-row gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={i === 0}
                    onPress={() => onMove(status.id, -1)}>
                    <Icon as={ChevronUpIcon} className="text-muted-foreground size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    disabled={i === statuses.length - 1}
                    onPress={() => onMove(status.id, 1)}>
                    <Icon as={ChevronDownIcon} className="text-muted-foreground size-3.5" />
                  </Button>
                </View>
                <EditStatusDialog
                  status={status}
                  statuses={statuses}
                  onUpdated={(updated) =>
                    setStatuses((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)))
                  }
                  onDeleted={(id) => setStatuses((prev) => (prev ?? []).filter((s) => s.id !== id))}
                  client={client}
                />
              </View>
            ))
          )}
        </View>

        <TagsSection workspaceKey={workspace.key} client={client} isAdmin={isAdmin} />

        <FieldsSection workspaceKey={workspace.key} client={client} />
      </CardContent>
    </Card>
  );
}

/** Tag CRUD is GLOBAL ADMIN only (unlike statuses, which any member may add). */
function TagsSection({
  workspaceKey,
  client,
  isAdmin,
}: {
  workspaceKey: string;
  client: ReturnType<typeof useAuth>['client'];
  isAdmin: boolean;
}) {
  const [tags, setTags] = React.useState<Tag[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const { items } = await client.listTags(workspaceKey);
      setTags(items);
      setError(null);
    } catch (e) {
      setTags([]);
      setError(e instanceof Error ? e.message : 'Failed to load tags');
    }
  }, [client, workspaceKey]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium">Tags</Text>
        {isAdmin ? (
          <AddTagDialog
            workspaceKey={workspaceKey}
            client={client}
            onAdded={(t) => setTags((prev) => [...(prev ?? []), t])}
          />
        ) : null}
      </View>
      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
      {tags === null ? (
        <Skeleton className="h-9 w-full" />
      ) : tags.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          No tags yet.{isAdmin ? '' : ' An admin can add them.'}
        </Text>
      ) : isAdmin ? (
        <View className="gap-2">
          {tags.map((tag) => (
            <View
              key={tag.id}
              className="border-border bg-card flex-row items-center gap-3 rounded-md border p-2.5">
              <TagPill tag={tag} />
              <View className="flex-1" />
              <EditTagDialog
                tag={tag}
                client={client}
                onUpdated={(updated) =>
                  setTags((prev) => (prev ?? []).map((t) => (t.id === updated.id ? updated : t)))
                }
                onDeleted={(id) => setTags((prev) => (prev ?? []).filter((t) => t.id !== id))}
              />
            </View>
          ))}
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-1.5">
          {tags.map((tag) => (
            <TagPill key={tag.id} tag={tag} />
          ))}
        </View>
      )}
    </View>
  );
}

function ColorPicker({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {PRESET_COLORS.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          className={`size-8 rounded-full ${color === c ? 'ring-2 ring-black dark:ring-white' : ''}`}
          style={{ backgroundColor: c }}
          accessibilityRole="button"
        />
      ))}
    </View>
  );
}

function AddTagDialog({
  workspaceKey,
  client,
  onAdded,
}: {
  workspaceKey: string;
  client: ReturnType<typeof useAuth>['client'];
  onAdded: (t: Tag) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(PRESET_COLORS[1]);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onCreate() {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { tag } = await client.createTag(workspaceKey, { name: name.trim(), color });
      onAdded(tag);
      setName('');
      setColor(PRESET_COLORS[1]);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tag');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1">
          <Icon as={PlusIcon} className="text-muted-foreground size-3.5" />
          <Text className="text-xs">Add</Text>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>New tag</DialogTitle>
          <DialogDescription>
            Tags are per workspace and admin-managed. Any member can apply them to tasks.
          </DialogDescription>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} placeholder="bug" />
          </View>
          <View className="gap-1.5">
            <Label>Color</Label>
            <ColorPicker color={color} onChange={setColor} />
          </View>
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onCreate} disabled={creating || !name.trim()}>
            <Text>{creating ? 'Creating...' : 'Create'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTagDialog({
  tag,
  client,
  onUpdated,
  onDeleted,
}: {
  tag: Tag;
  client: ReturnType<typeof useAuth>['client'];
  onUpdated: (t: Tag) => void;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(tag.name);
  const [color, setColor] = React.useState(tag.color);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { tag: updated } = await client.updateTag(tag.id, {
        name: name.trim() || tag.name,
        color,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save tag');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.deleteTag(tag.id);
      onDeleted(tag.id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete tag');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" accessibilityLabel={`Edit ${tag.name}`}>
          <Icon as={PencilIcon} className="text-muted-foreground size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit tag</DialogTitle>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} />
          </View>
          <View className="gap-1.5">
            <Label>Color</Label>
            <ColorPicker color={color} onChange={setColor} />
          </View>
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter className="flex-row justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={saving}>
                <Icon as={TrashIcon} className="size-3.5" />
                <Text>Delete</Text>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{tag.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the tag from every task that uses it. Tasks themselves are not
                  affected. This can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Text>Cancel</Text>
                </AlertDialogCancel>
                <AlertDialogAction onPress={onDelete}>
                  <Text>Delete tag</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onSave} disabled={saving}>
            <Text>{saving ? 'Saving...' : 'Save'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ workspace, onDone }: { workspace: Workspace; onDone: () => void }) {
  const { client } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(workspace.name);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSave() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await client.updateWorkspace(workspace.key, { name: name.trim() });
      setOpen(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-8 p-0">
          <Icon as={PencilIcon} className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename workspace</DialogTitle>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} />
          </View>
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onSave} disabled={saving || !name.trim()}>
            <Text>{saving ? 'Saving...' : 'Save'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddStatusDialog({
  workspaceKey,
  onAdded,
}: {
  workspaceKey: string;
  onAdded: (s: Status) => void;
}) {
  const { client } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState(PRESET_COLORS[0]);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onCreate() {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { status } = await client.createStatus(workspaceKey, { name: name.trim(), color });
      onAdded(status);
      setName('');
      setColor(PRESET_COLORS[0]);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create status');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1">
          <Icon as={PlusIcon} className="text-muted-foreground size-3.5" />
          <Text className="text-xs">Add</Text>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>New status</DialogTitle>
          <DialogDescription>Statuses are custom per workspace.</DialogDescription>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} placeholder="In Review" />
          </View>
          <View className="gap-1.5">
            <Label>Color</Label>
            <ColorPicker color={color} onChange={setColor} />
          </View>
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onCreate} disabled={creating || !name.trim()}>
            <Text>{creating ? 'Creating...' : 'Create'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditStatusDialog({
  status,
  statuses,
  onUpdated,
  onDeleted,
  client,
}: {
  status: Status;
  statuses: Status[];
  onUpdated: (s: Status) => void;
  onDeleted: (id: string) => void;
  client: ReturnType<typeof useAuth>['client'];
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(status.name);
  const [color, setColor] = React.useState(status.color);
  const [moveTo, setMoveTo] = React.useState<Option>(undefined);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const others = statuses.filter((s) => s.id !== status.id);

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { status: updated } = await client.updateStatus(status.id, {
        name: name.trim() || status.name,
        color,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.deleteStatus(status.id, { move_to: moveTo?.value });
      onDeleted(status.id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete status');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <Icon as={PencilIcon} className="text-muted-foreground size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit status</DialogTitle>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} />
          </View>
          <View className="gap-1.5">
            <Label>Color</Label>
            <ColorPicker color={color} onChange={setColor} />
          </View>
          {others.length > 0 ? (
            <View className="gap-1.5">
              <Label>Move tasks to (on delete)</Label>
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose status to move tasks to" />
                </SelectTrigger>
                <SelectContent>
                  {others.map((s) => (
                    <SelectItem key={s.id} value={s.id} label={s.name} />
                  ))}
                </SelectContent>
              </Select>
              <Text className="text-muted-foreground text-xs">
                Required before deleting this status if any tasks use it.
              </Text>
            </View>
          ) : null}
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter className="flex-row justify-between">
          <Button variant="destructive" size="sm" onPress={onDelete} disabled={saving}>
            <Icon as={TrashIcon} className="size-3.5" />
            <Text>Delete</Text>
          </Button>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button onPress={onSave} disabled={saving}>
            <Text>{saving ? 'Saving...' : 'Save'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Custom field definitions (FR-31..35). Any member may maintain them, matching the
 * statuses model: the field list is a per-workspace shape definition, and values live
 * on tasks. Type is immutable once created; options are editable for select fields.
 */
function FieldsSection({
  workspaceKey,
  client,
}: {
  workspaceKey: string;
  client: ReturnType<typeof useAuth>['client'];
}) {
  const [fields, setFields] = React.useState<FieldDef[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const { items } = await client.listFields(workspaceKey);
      setFields(items);
      setError(null);
    } catch (e) {
      setFields([]);
      setError(e instanceof Error ? e.message : 'Failed to load custom fields');
    }
  }, [client, workspaceKey]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function onMove(id: string, dir: -1 | 1) {
    if (!fields) return;
    const idx = fields.findIndex((f) => f.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= fields.length) return;
    const next = [...fields];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    try {
      const { items } = await client.reorderFields(workspaceKey, next.map((f) => f.id));
      setFields(items);
    } catch {
      // ignore
    }
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium">Custom fields</Text>
        <AddFieldDialog
          workspaceKey={workspaceKey}
          client={client}
          onAdded={(f) => setFields((prev) => [...(prev ?? []), f])}
        />
      </View>
      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
      {fields === null ? (
        <Skeleton className="h-9 w-full" />
      ) : fields.length === 0 ? (
        <Text className="text-muted-foreground text-sm">
          No custom fields yet. Add one (select, text, or number) to capture structured
          data on tasks — select fields can also group and filter the task list.
        </Text>
      ) : (
        <View className="gap-2">
          {fields.map((field, i) => (
            <View
              key={field.id}
              className="border-border bg-card flex-row items-center gap-3 rounded-md border p-2.5">
              <Text className="w-28 shrink-0 text-sm font-medium">{field.name}</Text>
              <Badge variant="outline">
                <Text className="text-xs">{field.type}</Text>
              </Badge>
              {field.type === 'select' ? (
                <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-1">
                  {field.options.slice(0, 3).map((option) => (
                    <Badge key={option} variant="secondary">
                      <Text className="text-xs">{option}</Text>
                    </Badge>
                  ))}
                  {field.options.length > 3 ? (
                    <Text className="text-muted-foreground text-xs">
                      +{field.options.length - 3} more
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View className="flex-1" />
              )}
              <View className="flex-row gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={i === 0}
                  onPress={() => onMove(field.id, -1)}>
                  <Icon as={ChevronUpIcon} className="text-muted-foreground size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={i === fields.length - 1}
                  onPress={() => onMove(field.id, 1)}>
                  <Icon as={ChevronDownIcon} className="text-muted-foreground size-3.5" />
                </Button>
              </View>
              <EditFieldDialog
                field={field}
                client={client}
                onUpdated={(updated) =>
                  setFields((prev) =>
                    (prev ?? []).map((x) => (x.id === updated.id ? updated : x))
                  )
                }
                onDeleted={(id) => setFields((prev) => (prev ?? []).filter((x) => x.id !== id))}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const FIELD_TYPES = ['select', 'text', 'number'] as const;

function AddFieldDialog({
  workspaceKey,
  client,
  onAdded,
}: {
  workspaceKey: string;
  client: ReturnType<typeof useAuth>['client'];
  onAdded: (f: FieldDef) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<(typeof FIELD_TYPES)[number]>('text');
  const [optionsText, setOptionsText] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function parseOptions(): string[] {
    return [...new Set(optionsText.split(',').map((o) => o.trim()).filter(Boolean))];
  }

  async function onCreate() {
    if (creating || !name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const options = parseOptions();
      const { field } = await client.createField(workspaceKey, {
        name: name.trim(),
        type,
        options: type === 'select' ? options : undefined,
      });
      onAdded(field);
      setName('');
      setType('text');
      setOptionsText('');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create field');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1">
          <Icon as={PlusIcon} className="text-muted-foreground size-3.5" />
          <Text className="text-xs">Add</Text>
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>New custom field</DialogTitle>
          <DialogDescription>
            A named field every task in this workspace can carry a value for.
          </DialogDescription>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} placeholder="Priority" />
          </View>
          <View className="gap-1.5">
            <Label>Type (can&apos;t change later)</Label>
            <View className="flex-row gap-2">
              {FIELD_TYPES.map((t) => (
                <Button
                  key={t}
                  variant={type === t ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onPress={() => setType(t)}>
                  <Text>{t === 'select' ? 'select' : t}</Text>
                </Button>
              ))}
            </View>
          </View>
          {type === 'select' ? (
            <View className="gap-1.5">
              <Label>Options (comma-separated)</Label>
              <Input
                value={optionsText}
                onChangeText={setOptionsText}
                placeholder="low, medium, high"
                autoCapitalize="none"
              />
              <Text className="text-muted-foreground text-xs">
                Select fields power grouping and filtering on the task list.
              </Text>
            </View>
          ) : null}
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button
            onPress={onCreate}
            disabled={
              creating ||
              !name.trim() ||
              (type === 'select' && parseOptions().length === 0)
            }>
            <Text>{creating ? 'Creating...' : 'Create'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditFieldDialog({
  field,
  client,
  onUpdated,
  onDeleted,
}: {
  field: FieldDef;
  client: ReturnType<typeof useAuth>['client'];
  onUpdated: (f: FieldDef) => void;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(field.name);
  const [optionsText, setOptionsText] = React.useState(field.options.join(', '));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isSelect = field.type === 'select';

  function parseOptions(): string[] {
    return [...new Set(optionsText.split(',').map((o) => o.trim()).filter(Boolean))];
  }

  async function onSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { field: updated } = await client.updateField(field.id, {
        name: name.trim() || field.name,
        options: isSelect ? parseOptions() : undefined,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save field');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.deleteField(field.id);
      onDeleted(field.id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete field');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" accessibilityLabel={`Edit ${field.name}`}>
          <Icon as={PencilIcon} className="text-muted-foreground size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-full max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit field</DialogTitle>
        </DialogHeader>
        <View className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} />
          </View>
          {isSelect ? (
            <View className="gap-1.5">
              <Label>Options (comma-separated)</Label>
              <Input
                value={optionsText}
                onChangeText={setOptionsText}
                autoCapitalize="none"
              />
              <Text className="text-muted-foreground text-xs">
                Tasks already carrying a removed option keep their value until it&apos;s
                cleared on the task.
              </Text>
            </View>
          ) : null}
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
        </View>
        <DialogFooter className="flex-row justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={saving}>
                <Icon as={TrashIcon} className="size-3.5" />
                <Text>Delete</Text>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{field.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the field and every task value recorded for it in this
                  workspace. This can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Text>Cancel</Text>
                </AlertDialogCancel>
                <AlertDialogAction onPress={onDelete}>
                  <Text>Delete field</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DialogClose asChild>
            <Button variant="outline">
              <Text>Cancel</Text>
            </Button>
          </DialogClose>
          <Button
            onPress={onSave}
            disabled={saving || (isSelect && parseOptions().length === 0)}>
            <Text>{saving ? 'Saving...' : 'Save'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
