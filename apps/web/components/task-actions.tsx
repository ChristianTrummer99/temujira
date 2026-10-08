import { ConfirmDelete } from '@/components/confirm-delete';
import { RowMenu } from '@/components/row-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, type Option } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { splitTaskKey } from '@/lib/format';
import { invalidateResources } from '@/lib/invalidation';
import { hasScope } from '@/lib/scopes';
import type { Task, User } from '@temujira/client';
import { useRouter } from 'expo-router';
import * as React from 'react';

export function TaskActions({ task, users, onChanged, onDeleted, hover = true }: {
  task: Task; users: User[]; onChanged?: (task: Task) => void; onDeleted?: () => void; hover?: boolean;
}) {
  const { client, user } = useAuth();
  const router = useRouter();
  const canWrite = hasScope(user, 'tasks:write');
  const [dialog, setDialog] = React.useState<'rename' | 'assign' | 'delete' | null>(null);
  const [title, setTitle] = React.useState(task.title);
  const [assignee, setAssignee] = React.useState<Option>(undefined);
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
  return <>
    <RowMenu label={`Actions for ${task.key}`} hover={hover}>
      <DropdownMenuItem onPress={() => router.push(href)}><Text>Open task</Text></DropdownMenuItem>
      {typeof navigator !== 'undefined' && navigator.clipboard ? <DropdownMenuItem onPress={async () => {
        try { await navigator.clipboard.writeText(new URL(href, window.location.href).href); }
        catch { setError('Could not copy the link'); }
      }}><Text>Copy link</Text></DropdownMenuItem> : null}
      {canWrite ? <>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onPress={() => { setTitle(task.title); setError(''); setDialog('rename'); }}><Text>Rename</Text></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onPress={() => { setAssignee(task.assignee ? { value: task.assignee.id, label: task.assignee.name } : { value: 'none', label: 'Unassigned' }); setError(''); setDialog('assign'); }}><Text>Change assignee</Text></DropdownMenuItem>
        {task.assignee_id !== user?.id ? <DropdownMenuItem disabled={busy} onPress={() => update({ assignee_id: user!.id })}><Text>Assign to me</Text></DropdownMenuItem> : null}
        <DropdownMenuItem disabled={busy} onPress={() => update({ archived: !task.archived_at })}><Text>{task.archived_at ? 'Restore task' : 'Archive task'}</Text></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={busy} onPress={() => setDialog('delete')}><Text>Delete task</Text></DropdownMenuItem>
      </> : null}
    </RowMenu>
    <Dialog open={dialog === 'rename' || dialog === 'assign' || (!!error && !dialog)} onOpenChange={(open) => { if (!open && !busy) { setDialog(null); setError(''); } }}>
      <DialogContent><DialogHeader><DialogTitle>{dialog === 'rename' ? `Rename ${task.key}` : dialog === 'assign' ? `Assign ${task.key}` : 'Task action'}</DialogTitle></DialogHeader>
        {dialog === 'rename' ? <Input accessibilityLabel="Task title" value={title} onChangeText={setTitle} autoFocus maxLength={500} /> : null}
        {dialog === 'assign' ? <Select value={assignee} onValueChange={setAssignee}><SelectTrigger accessibilityLabel="Task assignee"><SelectValue placeholder="Unassigned" /></SelectTrigger>
          <SelectContent><SelectItem value="none" label="Unassigned" />{users.filter((u) => !u.deactivated_at).map((u) => <SelectItem key={u.id} value={u.id} label={u.name} />)}</SelectContent>
        </Select> : null}
        {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onPress={() => { setDialog(null); setError(''); }}><Text>Cancel</Text></Button>
          {dialog ? <Button disabled={busy || (dialog === 'rename' && !title.trim())} onPress={() => update(dialog === 'rename' ? { title: title.trim() } : { assignee_id: assignee?.value === 'none' ? null : assignee?.value ?? null })}><Text>{busy ? 'Saving...' : 'Save'}</Text></Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDelete open={dialog === 'delete'} onOpenChange={(open) => { if (!open) setDialog(null); }} title={`Delete ${task.key}?`}
      description="This permanently removes the task, its comments, files and links. This action cannot be undone."
      onConfirm={async () => { await client.deleteTask(task.id); invalidateResources(); onDeleted?.(); }} />
  </>;
}
