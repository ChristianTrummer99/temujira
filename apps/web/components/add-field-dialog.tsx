import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { invalidateResources } from '@/lib/invalidation';
import { hasScope } from '@/lib/scopes';
import type { FieldDef, FieldType } from '@temujira/client';
import { PlusIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';

const FIELD_TYPES = ['text', 'number', 'select'] as const;
const TYPE_LABELS = { text: 'Text', number: 'Number', select: 'Choice' };

/** A field definition belongs to the workspace, not to one ticket or its tags. */
export function AddFieldDialog({ workspace, onAdded }: {
  workspace: string;
  onAdded: (field: FieldDef) => void;
}) {
  const { client, user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<FieldType>('text');
  const [optionsText, setOptionsText] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState('');
  const inFlight = React.useRef(false);
  const options = [...new Set(optionsText.split(',').map((option) => option.trim()).filter(Boolean))];
  const valid = !!name.trim() && (type !== 'select' || (options.length > 0 && options.length <= 50 && options.every((option) => option.length <= 50)));

  function changeOpen(next: boolean) {
    if (inFlight.current) return;
    setOpen(next);
    if (next) {
      setName(''); setType('text'); setOptionsText(''); setError('');
    }
  }

  async function create() {
    if (inFlight.current || !valid || !hasScope(user, 'workspaces:manage')) return;
    inFlight.current = true;
    setCreating(true); setError('');
    try {
      const { field } = await client.createField(workspace, {
        name: name.trim(), type, ...(type === 'select' ? { options } : {}),
      });
      onAdded(field);
      setOpen(false);
      invalidateResources();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create field');
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }

  if (!hasScope(user, 'workspaces:manage')) return null;

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <Button variant="ghost" size="sm" className="h-7 gap-1 sm:h-7">
        <Icon as={PlusIcon} className="text-muted-foreground size-3.5" />
        <Text className="text-xs">Add field</Text>
      </Button>
    </DialogTrigger>
    <DialogContent className="w-full max-w-sm">
      <DialogHeader>
        <DialogTitle>New custom field</DialogTitle>
        <DialogDescription>This field is available on every ticket in this workspace. Each ticket has its own value.</DialogDescription>
      </DialogHeader>
      <View className="gap-4">
        <View className="gap-1.5">
          <Label>Field name</Label>
          <Input accessibilityLabel="Field name" value={name} onChangeText={setName} placeholder="Customer reference" maxLength={50} autoFocus editable={!creating} />
        </View>
        <View className="gap-1.5">
          <Label>Type</Label>
          <View className="flex-row gap-2">
            {FIELD_TYPES.map((fieldType) => <Button key={fieldType} variant={type === fieldType ? 'default' : 'outline'} size="sm" className="flex-1"
              disabled={creating} accessibilityState={{ selected: type === fieldType }} onPress={() => setType(fieldType)}>
              <Text>{TYPE_LABELS[fieldType]}</Text>
            </Button>)}
          </View>
          <Text className="text-muted-foreground text-xs">The type cannot change after creation.</Text>
        </View>
        {type === 'select' ? <View className="gap-1.5">
          <Label>Choices</Label>
          <Input accessibilityLabel="Field choices" value={optionsText} onChangeText={setOptionsText} placeholder="Low, Medium, High" autoCapitalize="none" editable={!creating} />
          <Text className="text-muted-foreground text-xs">Separate choices with commas. Use up to 50 choices, with up to 50 characters each.</Text>
        </View> : null}
        {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
      </View>
      <DialogFooter>
        <Button variant="outline" disabled={creating} onPress={() => changeOpen(false)}><Text>Cancel</Text></Button>
        <Button disabled={creating || !valid} onPress={() => void create()}><Text>{creating ? 'Creating…' : 'Create field'}</Text></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
