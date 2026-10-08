import * as React from 'react';
import { useAuth } from './auth';
import { draftStorage } from './draft-storage';
import { draftKey, MessageDraftStore } from './draft-store';

function serverIdentity() {
  const origin = typeof window !== 'undefined' && typeof window.location?.origin === 'string' ? window.location.origin : 'http://localhost';
  try {
    const url = new URL(process.env.EXPO_PUBLIC_API_URL ?? origin, origin);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return origin; }
}

/** Slot contains immutable task/comment IDs, never a reusable human task key. */
export function useMessageDraft(slot: string) {
  const { user } = useAuth();
  const key = user ? draftKey(serverIdentity(), user.id, slot) : null;
  const store = React.useMemo(() => new MessageDraftStore(key, draftStorage), [key]);
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, key, update: store.update, clear: store.clear };
}
