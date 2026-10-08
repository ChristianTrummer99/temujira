import { useSyncExternalStore } from 'react';

let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;

/** Refresh data after a top-level resource action without resetting screen UI state. */
export function invalidateResources() {
  revision += 1;
  for (const listener of listeners) listener();
}
export function useResourceRevision() { return useSyncExternalStore(subscribe, snapshot, snapshot); }
