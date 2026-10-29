import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FieldDef, Task } from '@temujira/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskFields } from '../components/task-fields';

const auth = vi.hoisted(() => ({ user: { role: 'member', scopes: [] as string[] }, client: {} }));
vi.mock('@/lib/auth', () => ({ useAuth: () => auth }));
// Test the table and permission gates with real RN-web primitives. Portal behavior is
// checked in the browser; it does not run during a server render.
vi.mock('@/components/ui/text', async () => ({
  Text: (await import('react-native')).Text,
  TextClassContext: React.createContext(''),
}));
vi.mock('@/components/ui/icon', () => ({ Icon: () => null }));
vi.mock('@/components/ui/label', async () => ({ Label: (await import('react-native')).Text }));
vi.mock('lucide-react-native', () => ({ PlusIcon: () => null }));
vi.mock('@/components/ui/dialog', () => {
  const Children = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    Dialog: Children, DialogTrigger: Children, DialogContent: () => null,
    DialogDescription: Children, DialogFooter: Children, DialogHeader: Children, DialogTitle: Children,
  };
});
vi.mock('@/components/ui/select', () => {
  const Children = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { Select: Children, SelectTrigger: Children, SelectContent: () => null, SelectItem: () => null, SelectValue: () => null };
});

const fields = [
  { id: 'reference', name: 'Customer reference', type: 'text', options: [] },
  { id: 'estimate', name: 'Estimate', type: 'number', options: [] },
  { id: 'priority', name: 'Priority', type: 'select', options: ['Low', 'High'] },
] as FieldDef[];
const task = { id: 'task', workspace_id: 'workspace', field_values: { reference: 'ABC-123', estimate: '3.5', priority: 'High' } } as unknown as Task;
const render = (definitions = fields) => renderToStaticMarkup(<TaskFields task={task} fields={definitions} onAdded={() => {}} onValueSaved={() => {}} />);

beforeEach(() => { auth.user.scopes = []; });

describe('Ticket custom fields', () => {
  it('keeps the table visible before a workspace has fields', () => {
    auth.user.scopes = ['workspaces:manage'];
    const html = render([]);
    expect(html).toContain('role="table"');
    expect(html).toContain('aria-label="Custom fields"');
    expect(html).toContain('No custom fields in this workspace.');
    expect(html).toContain('Add field');
  });

  it('shows field names and values in separate table columns', () => {
    const html = render();
    expect(html.match(/role="columnheader"/g)).toHaveLength(2);
    expect(html.match(/role="rowheader"/g)).toHaveLength(3);
    for (const text of ['Field', 'Value', 'Customer reference', 'ABC-123', 'Estimate', '3.5', 'Priority', 'High']) {
      expect(html).toContain(text);
    }
  });

  it('keeps values read-only without tasks:write', () => {
    const html = render();
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Add field');
  });

  it('lets task writers edit values without creating workspace fields', () => {
    auth.user.scopes = ['tasks:write'];
    const html = render();
    expect(html).toContain('aria-label="Customer reference"');
    expect(html).toContain('value="ABC-123"');
    expect(html).toContain('aria-label="Estimate"');
    expect(html).not.toContain('Add field');
  });
});
