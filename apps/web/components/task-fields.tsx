import { AddFieldDialog } from '@/components/add-field-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { hasScope } from '@/lib/scopes';
import type { FieldDef, Task } from '@temujira/client';
import * as React from 'react';
import { View } from 'react-native';

type ValueSaved = (fieldId: string, value: string, updatedAt: number) => void;

/** Workspace fields and ticket values are separate from tags. */
export function TaskFields({ task, fields, onAdded, onValueSaved }: {
  task: Task;
  fields: FieldDef[];
  onAdded: (field: FieldDef) => void;
  onValueSaved: ValueSaved;
}) {
  return <View className="gap-2">
    <View className="flex-row items-center justify-between">
      <Text className="text-sm font-medium">Custom fields</Text>
      <AddFieldDialog workspace={task.workspace_id} onAdded={onAdded} />
    </View>
    <View role="table" accessibilityLabel="Custom fields" className="border-border overflow-hidden rounded-md border">
      <View role="row" className="border-border bg-muted/40 flex-row border-b">
        <View role="columnheader" className="border-border w-2/5 border-r px-3 py-2"><Text className="text-muted-foreground text-xs font-medium">Field</Text></View>
        <View role="columnheader" className="min-w-0 flex-1 px-3 py-2"><Text className="text-muted-foreground text-xs font-medium">Value</Text></View>
      </View>
      {fields.length === 0 ? <View role="row">
        <View role="cell" className="p-3"><Text className="text-muted-foreground text-sm">No custom fields in this workspace.</Text></View>
      </View> : fields.map((field, index) => <View key={field.id} role="row" className={`border-border flex-row ${index < fields.length - 1 ? 'border-b' : ''}`}>
        <View role="rowheader" className="border-border w-2/5 justify-center border-r px-3 py-2">
          <Text className="text-sm">{field.name}</Text>
        </View>
        <View role="cell" className="min-w-0 flex-1 p-2">
          <FieldValueEditor taskId={task.id} field={field} value={task.field_values[field.id] ?? ''} onSaved={onValueSaved} />
        </View>
      </View>)}
    </View>
  </View>;
}

function FieldValueEditor({ taskId, field, value, onSaved }: {
  taskId: string;
  field: FieldDef;
  value: string;
  onSaved: ValueSaved;
}) {
  const { client, user } = useAuth();
  const canWrite = hasScope(user, 'tasks:write');
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const dirty = React.useRef(false);
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  async function save(raw: string) {
    const next = raw.trim();
    if (!canWrite || inFlight.current) return;
    if (next === value) {
      dirty.current = false;
      setDraft(value); setError('');
      return;
    }
    inFlight.current = true;
    setSaving(true); setError('');
    try {
      // Send only this field so a save cannot replace another field's newer value.
      const { task: updated } = await client.updateTask(taskId, { field_values: { [field.id]: next } });
      const saved = updated.field_values[field.id] ?? '';
      dirty.current = false;
      setDraft(saved);
      onSaved(field.id, saved, updated.updated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save field');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return <View className="gap-1">
    {!canWrite ? <Text selectable className={`px-1 py-1 text-sm ${value ? '' : 'text-muted-foreground'}`}>{value || 'Not set'}</Text>
      : field.type === 'select' ? <Select value={value ? { value, label: value } : undefined} onValueChange={(option) => void save(option?.value ?? '')}>
        <SelectTrigger accessibilityLabel={field.name} disabled={saving} className="h-8 w-full min-w-0 px-2 sm:h-8">
          <SelectValue placeholder="Not set" className="min-w-0 flex-1" />
        </SelectTrigger>
        <SelectContent>{field.options.map((option) => <SelectItem key={option} value={option} label={option} />)}<SelectItem value="" label="Not set" /></SelectContent>
      </Select>
      : <Input accessibilityLabel={field.name} value={draft} editable={!saving} maxLength={500}
        className="h-8 px-2 text-sm sm:h-8" placeholder="Not set"
        onChangeText={(text) => { dirty.current = true; setDraft(text); }}
        onBlur={() => void save(draft)} onSubmitEditing={() => void save(draft)}
        keyboardType={field.type === 'number' ? 'numeric' : 'default'} />}
    {saving ? <Text role="status" className="text-muted-foreground text-xs">Saving…</Text> : null}
    {error ? <Text role="alert" className="text-destructive text-xs">{error}</Text> : null}
  </View>;
}
