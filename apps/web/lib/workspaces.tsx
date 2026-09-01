import type { Workspace } from '@temujira/client';
import * as React from 'react';
import { useAuth } from './auth';

export interface WorkspaceListState {
  /** Active (non-archived) workspaces. */
  workspaces: Workspace[];
  /** Archived workspaces only. */
  archived: Workspace[];
  /** Everything, active first — what settings/workspaces renders. */
  all: Workspace[];
  loading: boolean;
  reload: () => Promise<void>;
}

const WorkspaceListContext = React.createContext<WorkspaceListState | null>(null);

/**
 * One workspace list for the whole app shell: the sidebar, the TopBar breadcrumb, the
 * create-workspace dialog and settings/workspaces all read it, and every mutation calls
 * `reload()` so they stay in sync.
 */
export function WorkspaceListProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const [all, setAll] = React.useState<Workspace[]>([]);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    try {
      const { items } = await client.listWorkspaces({ include_archived: true });
      setAll(items);
    } catch {
      // Sidebar degrades to its empty state; nothing else depends on this succeeding.
    } finally {
      setLoading(false);
    }
  }, [client]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const value = React.useMemo<WorkspaceListState>(() => {
    const workspaces = all.filter((w) => w.archived_at == null);
    const archived = all.filter((w) => w.archived_at != null);
    return { workspaces, archived, all: [...workspaces, ...archived], loading, reload };
  }, [all, loading, reload]);

  return (
    <WorkspaceListContext.Provider value={value}>{children}</WorkspaceListContext.Provider>
  );
}

export function useWorkspaceList(): WorkspaceListState {
  const ctx = React.useContext(WorkspaceListContext);
  if (!ctx) throw new Error('useWorkspaceList must be used within a WorkspaceListProvider');
  return ctx;
}
