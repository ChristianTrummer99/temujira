import { expect, it, vi } from 'vitest';
import { MessageDraftStore } from '../lib/draft-store';

const device = vi.hoisted(() => ({ values: new Map<string, string>(), holdWrite: null as Promise<void> | null }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => device.values.get(key) ?? null,
  setItem: async (key: string, value: string) => { await device.holdWrite; device.values.set(key, value); },
  removeItem: async (key: string) => { device.values.delete(key); },
} }));
import { draftStorage } from '../lib/draft-storage';

it('waits for pending device writes before clearing a posted draft', async () => {
  let finish!: () => void;
  device.holdWrite = new Promise<void>((resolve) => { finish = resolve; });
  const draft = new MessageDraftStore('pending-upload', draftStorage);
  await vi.waitFor(() => expect(draft.getSnapshot().ready).toBe(true));
  draft.update({ body: 'First edit' });
  draft.update({ body: 'Last edit' });
  draft.clear();
  finish();
  expect(await draftStorage.getItem('pending-upload')).toBeNull();
  expect(draft.getSnapshot()).toMatchObject({ hasDraft: false, status: 'saved' });
  device.holdWrite = null;
});

it('keeps another composer’s newer device draft when an older post completes', async () => {
  const first = new MessageDraftStore('shared', draftStorage);
  await vi.waitFor(() => expect(first.getSnapshot().ready).toBe(true));
  first.update({ body: 'Sending this' });
  const second = new MessageDraftStore('shared', draftStorage);
  await vi.waitFor(() => expect(second.getSnapshot().data.body).toBe('Sending this'));
  second.update({ body: 'Keep this newer draft' });
  first.clear();
  expect(JSON.parse((await draftStorage.getItem('shared'))!).data.body).toBe('Keep this newer draft');
});
