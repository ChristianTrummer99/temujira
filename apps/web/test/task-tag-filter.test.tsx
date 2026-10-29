import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Tag } from '@temujira/client';
import { describe, expect, it, vi } from 'vitest';
import { TaskTagFilter } from '../components/task-tag-filter';

vi.mock('@/components/ui/text', async () => ({ Text: (await import('react-native')).Text, TextClassContext: React.createContext('') }));
vi.mock('@/components/ui/icon', () => ({ Icon: () => null }));
vi.mock('lucide-react-native', () => ({ CheckIcon: () => null, ChevronDownIcon: () => null, TagsIcon: () => null }));
// Browser checks cover the platform checkbox's keyboard and pointer actions.
vi.mock('@rn-primitives/checkbox', async () => ({ Root: (await import('react-native')).Pressable }));
vi.mock('@/components/ui/popover', () => {
  const Children = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { Popover: Children, PopoverContent: Children, PopoverTrigger: Children, PopoverClose: Children };
});

const tags = [
  { id: 'backend', name: 'Backend', color: '#3b82f6' },
  { id: 'urgent', name: 'Urgent', color: '#ef4444' },
  { id: 'review', name: 'Review', color: '#22c55e' },
] as Tag[];
const render = (selected: string[], match: 'all' | 'any' = 'all', options = tags) => renderToStaticMarkup(
  <TaskTagFilter tags={options} selected={selected} match={match} onSelectedChange={() => {}} onMatchChange={() => {}} />,
);

describe('Multi-tag filter controls', () => {
  it('shows tags as independent checkboxes instead of a single select', () => {
    const html = render([]);
    expect(html.match(/role="checkbox"/g)).toHaveLength(3);
    expect(html).toContain('All tags');
    expect(html).toContain('Find filter tags');
  });

  it('shows multiple checked tags and their selected count', () => {
    const html = render(['backend', 'urgent']);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(1);
    expect(html).toContain('Tags · 2');
    expect(html).toContain('Clear tags');
  });

  it('offers explicit all-tag and any-tag matching', () => {
    const html = render(['backend', 'urgent'], 'any');
    expect(html).toContain('Match all selected tags');
    expect(html).toContain('Match any selected tag');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  });

  it('shows an empty state when a workspace has no tags', () => {
    expect(render([], 'all', [])).toContain('No tags in this workspace.');
  });
});
