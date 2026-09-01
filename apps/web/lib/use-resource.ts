import { ApiError } from '@temujira/client';
import * as React from 'react';
import { useAuth } from './auth';

/**
 * A tiny data-fetching primitive. Deliberately NOT react-query: every existing screen
 * already uses the `useEffect` + cancelled-flag idiom, and at this scale (local SQLite,
 * <=200-row lists, "reload after mutation") a 60-line hook is the right size.
 */
export interface Resource<T> {
  /** null until the first success; kept (stale) during a reload so there's no skeleton flash. */
  data: T | null;
  /** In-flight AND nothing to show yet. */
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList
): Resource<T> {
  const { refresh } = useAuth();
  const [data, setData] = React.useState<T | null>(null);
  const [inFlight, setInFlight] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Generation counter: only the newest request may write state.
  const generation = React.useRef(0);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = React.useCallback(async () => {
    const mine = ++generation.current;
    setInFlight(true);
    try {
      const next = await fetcherRef.current();
      if (mine !== generation.current) return;
      setData(next);
      setError(null);
    } catch (e) {
      if (mine !== generation.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setError('Session expired');
        // Clears the session; the (app) layout then redirects to /login.
        void refresh();
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    } finally {
      if (mine === generation.current) setInFlight(false);
    }
  }, [refresh]);

  React.useEffect(() => {
    void run();
    return () => {
      // Invalidate any request still in flight for the previous deps.
      generation.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { data, loading: inFlight && data === null, error, reload: run, setData };
}
