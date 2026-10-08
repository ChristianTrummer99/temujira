import { ConfirmDelete } from '@/components/confirm-delete';
import { RowMenu } from '@/components/row-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { useBackgroundRoute } from '@/lib/background-route';
import { invalidateResources } from '@/lib/invalidation';
import { hasScope } from '@/lib/scopes';
import type { Workspace } from '@temujira/client';
import { useRouter } from 'expo-router';
import * as React from 'react';

export function WorkspaceActions({ workspace, onChanged, className }: { workspace: Workspace; onChanged: () => Promise<void>; className?: string }) {
  const { client, user } = useAuth();
  const { pathname } = useBackgroundRoute();
  const router = useRouter();
  const [dialog, setDialog] = React.useState<'rename' | 'delete' | null>(null);
  const [name, setName] = React.useState(workspace.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  async function update(patch: { name?: string; archived?: boolean }) {
    setBusy(true); setError('');
    try { await client.updateWorkspace(workspace.id, patch); await onChanged(); invalidateResources(); setDialog(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update workspace'); }
    finally { setBusy(false); }
  }
  return <>
    <RowMenu label={`Actions for workspace ${workspace.name}`} className={className}>
      <DropdownMenuItem onPress={() => router.push(`/w/${workspace.key}`)}><Text>Open workspace</Text></DropdownMenuItem>
      <DropdownMenuItem onPress={() => router.push(`/w/${workspace.key}/activity`)}><Text>Workspace activity</Text></DropdownMenuItem>
      {hasScope(user, 'workspaces:manage') ? <>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onPress={() => { setName(workspace.name); setError(''); setDialog('rename'); }}><Text>Rename workspace</Text></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onPress={() => update({ archived: !workspace.archived_at })}><Text>{workspace.archived_at ? 'Restore workspace' : 'Archive workspace'}</Text></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={busy} onPress={() => setDialog('delete')}><Text>Delete workspace</Text></DropdownMenuItem>
      </> : null}
    </RowMenu>
    <Dialog open={dialog === 'rename' || (!!error && !dialog)} onOpenChange={(open) => { if (!open && !busy) { setDialog(null); setError(''); } }}>
      <DialogContent><DialogHeader><DialogTitle>Rename workspace</DialogTitle></DialogHeader>
        <Input accessibilityLabel="Workspace name" value={name} onChangeText={setName} autoFocus />
        {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onPress={() => { setDialog(null); setError(''); }}><Text>Cancel</Text></Button>
          <Button disabled={busy || !name.trim()} onPress={() => update({ name: name.trim() })}><Text>{busy ? 'Saving...' : 'Save'}</Text></Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDelete open={dialog === 'delete'} onOpenChange={(open) => { if (!open) setDialog(null); }} title={`Delete ${workspace.name}?`}
      description="This permanently removes the workspace and all its tasks, comments and files. This action cannot be undone."
      onConfirm={async () => {
        await client.deleteWorkspace(workspace.id);
        await onChanged(); invalidateResources();
        if (pathname === `/w/${workspace.key}` || pathname.startsWith(`/w/${workspace.key}/`)) router.replace('/');
      }} />
  </>;
}
