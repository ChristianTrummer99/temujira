import AsyncStorage from '@react-native-async-storage/async-storage';
import { ownsDraft, type DraftStorage } from './draft-store';

// Serialize operations per key, including compare-and-remove. A late save must not
// recreate a draft after a successful submission cleared it.
const pending = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, next);
  void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => {});
  return next;
}

export const draftStorage: DraftStorage = {
  getItem: (key) => enqueue(key, () => AsyncStorage.getItem(key)),
  setItem: (key, value) => enqueue(key, () => AsyncStorage.setItem(key, value)),
  removeOwned: (key, writer, original) => enqueue(key, async () => {
    if (ownsDraft(await AsyncStorage.getItem(key), writer, original)) await AsyncStorage.removeItem(key);
  }),
};
