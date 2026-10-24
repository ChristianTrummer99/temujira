import { ConfirmDelete } from '@/components/confirm-delete';
import { RowMenu } from '@/components/row-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type Option } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { splitTaskKey } from '@/lib/format';
import { invalidateResources } from '@/lib/invalidation';
import { hasScope } from '@/lib/scopes';
import type { Status, Task, User, Workspace } from '@temujira/client';
import { ArchiveIcon, ArrowRightLeftIcon, CopyIcon, PencilIcon, RotateCcwIcon, TrashIcon, UserCheckIcon, UserCogIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';

export function TaskActions({ task, users, onChanged, onDeleted, onMoved, hover = true }: {
  task: Task; users: User[]; onChanged?: (task: Task) => void; onDeleted?: () => void;
  /** Called after a cross-workspace move; lists may instead rely on invalidation. */
  onMoved?: (task: Task) => void;
  hover?: boolean;
}) {
  const { client, user } = useAuth();
  const canWrite = hasScope(user, 'tasks:write');
  const [dialog, setDialog] = React.useState<'rename' | 'assign' | 'move' | 'delete' | null>(null);
  const [title, setTitle] = React.useState(task.title);
  const [assignee, setAssignee] = React.useState<Option>(undefined);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [moveWorkspace, setMoveWorkspace] = React.useState<Option>(undefined);
  const [moveStatuses, setMoveStatuses] = React.useState<Status[]>([]);
  const [moveStatus, setMoveStatus] = React.useState<Option>(undefined);
  const [moveLoading, setMoveLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const parsed = splitTaskKey(task.key)!;
  const href = `/w/${parsed.workspaceKey}/t/${parsed.number}` as const;
  async function update(patch: Parameters<typeof client.updateTask>[1]) {
    setBusy(true); setError('');
    try {
      const { task: updated } = await client.updateTask(task.id, patch);
      onChanged?.(updated); invalidateResources(); setDialog(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update task'); }
    finally { setBusy(false); }
  }
  async function openMove() {
    setError('');
    setWorkspaces([]); setMoveWorkspace(undefined); setMoveStatuses([]); setMoveStatus(undefined);
    setDialog('move'); setMoveLoading(true);
    try {
      const { items } = await client.listWorkspaces();
      setWorkspaces(items.filter((workspace) => workspace.id !== task.workspace_id && workspace.archived_at === null));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load workspaces'); }
    finally { setMoveLoading(false); }
  }
  async function chooseWorkspace(option: Option) {
    setMoveWorkspace(option);
    setMoveStatuses([]); setMoveStatus(undefined);
    if (!option) return;
    try {
      const { items } = await client.listStatuses(option.value);
      setMoveStatuses(items);
      if (items[0]) setMoveStatus({ value: items[0].id, label: items[0].name });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load statuses'); }
  }
  async function move() {
    if (!moveWorkspace || busy) return;
    setBusy(true); setError('');
    try {
      const { task: moved } = await client.moveTask(task.id, {
        workspace_id: moveWorkspace.value,
        ...(moveStatus ? { status_id: moveStatus.value } : {}),
      });
      invalidateResources();
      setDialog(null);
      onMoved?.(moved);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not move task'); }
    finally { setBusy(false); }
  }
  return <>
    <RowMenu label={`Actions for ${task.key}`} hover={hover}>
      {typeof navigator !== 'undefined' && navigator.clipboard ? <DropdownMenuItem onPress={async () => {
        try { await navigator.clipboard.writeText(new URL(href, window.location.href).href); }
        catch { setError('Could not copy the link'); }
      }}><Icon as={CopyIcon} className="text-muted-foreground size-3.5" /><Text>Copy link</Text></DropdownMenuItem> : null}
      {canWrite ? <>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onPress={() => { setTitle(task.title); setError(''); setDialog('rename'); }}><Icon as={PencilIcon} className="text-muted-foreground size-3.5" /><Text>Rename</Text></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onPress={() => { setAssignee(task.assignee ? { value: task.assignee.id, label: task.assignee.name } : { value: 'none', label: 'Unassigned' }); setError(''); setDialog('assign'); }}><Icon as={UserCogIcon} className="text-muted-foreground size-3.5" /><Text>Change assignee</Text></DropdownMenuItem>
        {task.assignee_id !== user?.id ? <DropdownMenuItem disabled={busy} onPress={() => update({ assignee_id: user!.id })}><Icon as={UserCheckIcon} className="text-muted-foreground size-3.5" /><Text>Assign to me</Text></DropdownMenuItem> : null}
        <DropdownMenuItem disabled={busy} onPress={() => void openMove()}><Icon as={ArrowRightLeftIcon} className="text-muted-foreground size-3.5" /><Text>Move to workspace</Text></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onPress={() => update({ archived: !task.archived_at })}><Icon as={task.archived_at ? RotateCcwIcon : ArchiveIcon} className="text-muted-foreground size-3.5" /><Text>{task.archived_at ? 'Restore task' : 'Archive task'}</Text></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={busy} onPress={() => setDialog('delete')}><Icon as={TrashIcon} className="size-3.5" /><Text>Delete task</Text></DropdownMenuItem>
      </> : null}
    </RowMenu>
    <Dialog open={dialog === 'rename' || dialog === 'assign' || dialog === 'move' || (!!error && !dialog)} onOpenChange={(open) => { if (!open && !busy) { setDialog(null); setError(''); } }}>
      <DialogContent><DialogHeader><DialogTitle>{dialog === 'rename' ? `Rename ${task.key}` : dialog === 'assign' ? `Assign ${task.key}` : dialog === 'move' ? `Move ${task.key}` : 'Task action'}</DialogTitle></DialogHeader>
        {dialog === 'rename' ? <Input accessibilityLabel="Task title" value={title} onChangeText={setTitle} autoFocus maxLength={500} /> : null}
        {dialog === 'assign' ? <Select value={assignee} onValueChange={setAssignee}><SelectTrigger accessibilityLabel="Task assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
          <SelectContent><SelectItem value="none" label="Unassigned" />{users.filter((u) => !u.deactivated_at).map((u) => <SelectItem key={u.id} value={u.id} label={u.name} />)}</SelectContent>
        </Select> : null}
        {dialog === 'move' ? <View className="gap-3">
          <Text className="text-muted-foreground text-sm">
            The task keeps its comments, files, and links. It gets a new key. Tags and custom
            field values from the old workspace are removed.
          </Text>
          {moveLoading ? <Text className="text-muted-foreground text-sm">Loading workspaces…</Text>
            : workspaces.length === 0 ? <Text className="text-muted-foreground text-sm">No other active workspaces are available.</Text>
            : <>
              <View className="gap-1.5">
                <Text className="text-sm font-medium">Workspace</Text>
                <Select value={moveWorkspace} onValueChange={(option) => void chooseWorkspace(option)}>
                  <SelectTrigger className="w-full" accessibilityLabel="Target workspace"><SelectValue placeholder="Choose a workspace" /></SelectTrigger>
                  <SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id} label={`${workspace.key} · ${workspace.name}`} />)}</SelectContent>
                </Select>
              </View>
              {moveWorkspace ? <View className="gap-1.5">
                <Text className="text-sm font-medium">Status</Text>
                <Select value={moveStatus} onValueChange={setMoveStatus}>
                  <SelectTrigger className="w-full" accessibilityLabel="Target status"><SelectValue placeholder="First status" /></SelectTrigger>
                  <SelectContent>{moveStatuses.map((status) => <SelectItem key={status.id} value={status.id} label={status.name} />)}</SelectContent>
                </Select>
              </View> : null}
            </>}
        </View> : null}
        {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onPress={() => { setDialog(null); setError(''); }}><Text>Cancel</Text></Button>
          {dialog ? <Button
            disabled={busy || (dialog === 'rename' && !title.trim()) || (dialog === 'move' && !moveWorkspace)}
            onPress={dialog === 'move' ? move : () => update(dialog === 'rename' ? { title: title.trim() } : { assignee_id: assignee?.value === 'none' ? null : assignee?.value ?? null })}>
            <Text>{busy ? 'Saving...' : dialog === 'move' ? 'Move task' : 'Save'}</Text>
          </Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDelete open={dialog === 'delete'} onOpenChange={(open) => { if (!open) setDialog(null); }} title={`Delete ${task.key}?`}
      description="This permanently removes the task, its comments, files and links. This action cannot be undone."
      onConfirm={async () => { await client.deleteTask(task.id); invalidateResources(); onDeleted?.(); }} />
  </>;
}
