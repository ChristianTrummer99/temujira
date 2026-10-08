import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import * as React from 'react';

export function ConfirmDelete({ open, onOpenChange, title, description, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { if (open) setError(''); }, [open]);
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try { await onConfirm(); onOpenChange(false); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete'); }
    finally { setBusy(false); }
  }
  return <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
      <AlertDialogFooter>
        <Button variant="outline" disabled={busy} onPress={() => onOpenChange(false)}><Text>Cancel</Text></Button>
        <Button variant="destructive" disabled={busy} onPress={remove}><Text>{busy ? 'Deleting...' : 'Delete permanently'}</Text></Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
