import { ownsDraft, type DraftStorage } from './draft-store';

export const draftStorage: DraftStorage = {
  getItem: (key) => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => { window.localStorage.setItem(key, value); },
  removeOwned: (key, writer, original) => {
    if (ownsDraft(window.localStorage.getItem(key), writer, original)) window.localStorage.removeItem(key);
  },
};
