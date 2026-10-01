import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWorkspaceList } from '@/lib/workspaces';

/** Empty value means global, within the caller's visible workspaces. */
export function WorkspaceFilter({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const { all } = useWorkspaceList();
  const workspace = all.find((w) => w.key === value);
  return (
    <Select
      value={{ value: value || 'all', label: workspace ? `${workspace.name} (${workspace.key})` : 'All workspaces' }}
      onValueChange={(option) => onChange(option?.value === 'all' ? '' : option?.value ?? '')}>
      <SelectTrigger accessibilityLabel="Workspace scope" className="min-w-48 max-w-full">
        <SelectValue placeholder="All workspaces" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" label="All workspaces" />
        {all.map((w) => <SelectItem key={w.id} value={w.key} label={`${w.name} (${w.key})`} />)}
      </SelectContent>
    </Select>
  );
}
