import * as React from 'react';
import { useAuth } from './auth';

export interface InboxState {
  /** Unread inbox items across all workspaces (drives the sidebar badge). */
  unread: number;
  refresh: () => Promise<void>;
}

const InboxContext = React.createContext<InboxState | null>(null);

const POLL_MS = 60_000;

/**
 * Keeps the sidebar's unread count fresh. `inbox.list` returns `unread` alongside the page,
 * so a limit=1 request is enough. Errors are swallowed: a stale badge is better than a
 * broken shell.
 */
export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { client, user } = useAuth();
  const [unread, setUnread] = React.useState(0);

  const refresh = React.useCallback(async () => {
    if (!user) return;
    try {
      const res = await client.listInbox({ limit: 1 });
      setUnread(res.unread ?? 0);
    } catch {
      // keep the previous count
    }
  }, [client, user]);

  React.useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const value = React.useMemo<InboxState>(() => ({ unread, refresh }), [unread, refresh]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxState {
  const ctx = React.useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within an InboxProvider');
  return ctx;
}
