import * as React from 'react';
import { useAuth } from './auth';

export interface InboxState {
  /** Unread conversations across all workspaces (drives the sidebar badge). */
  unread: number;
  /** Changes when a new item arrives or unread/total counts change. */
  version: string;
  refresh: () => Promise<void>;
}

const InboxContext = React.createContext<InboxState | null>(null);

const POLL_MS = 15_000;

/**
 * Keeps the sidebar's unread count fresh. `inbox.list` returns `unread` alongside the page,
 * so a limit=1 request is enough. Errors are swallowed: a stale badge is better than a
 * broken shell.
 */
export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { client, user } = useAuth();
  const [unread, setUnread] = React.useState(0);
  const [version, setVersion] = React.useState('');
  const activeUser = React.useRef(user?.id);
  activeUser.current = user?.id;

  const refresh = React.useCallback(async () => {
    if (!user) return;
    try {
      const res = await client.listInbox({ limit: 1, include_read: true });
      if (activeUser.current !== user.id) return;
      setUnread(res.unread ?? 0);
      const latest = res.items[0];
      setVersion(`${user.id}:${latest?.id ?? ''}:${latest?.source_comment.id ?? ''}:${latest?.source_comment.updated_at ?? ''}:${latest?.parent_comment?.updated_at ?? ''}:${res.unread}:${res.total}`);
    } catch {
      // keep the previous count
    }
  }, [client, user]);

  React.useEffect(() => {
    setUnread(0);
    setVersion('');
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const value = React.useMemo<InboxState>(() => ({ unread, version, refresh }), [unread, version, refresh]);

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export function useInbox(): InboxState {
  const ctx = React.useContext(InboxContext);
  if (!ctx) throw new Error('useInbox must be used within an InboxProvider');
  return ctx;
}
