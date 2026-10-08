import { describe, expect, it } from 'vitest';
import { draftKey, MessageDraftStore, ownsDraft, type DraftStorage } from '../lib/draft-store';

function memory() {
  const values = new Map<string, string>();
  const storage: DraftStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeOwned: (key, writer, original) => { if (ownsDraft(values.get(key) ?? null, writer, original)) values.delete(key); },
  };
  return { values, storage };
}

describe('message drafts', () => {
  it('writes immediately and restores text, mentions, choices and attachment intent', () => {
    const { storage, values } = memory();
    const draft = new MessageDraftStore('comment', storage);
    expect(values.size).toBe(0); // loading an empty field must not write a blank draft
    draft.update({ body: 'Review @Ada\n\nDetails', mentionIds: ['person-id'], asQuestion: true, options: ['Yes', 'No'], attachmentName: 'review.txt' });
    expect(values.has('comment')).toBe(true);
    const restored = new MessageDraftStore('comment', storage).getSnapshot();
    expect(restored).toMatchObject({ ready: true, restored: true, hasDraft: true, status: 'saved' });
    expect(restored.data).toEqual(draft.getSnapshot().data);
    draft.clear();
    expect(values.has('comment')).toBe(false);
    expect(new MessageDraftStore('comment', storage).getSnapshot().hasDraft).toBe(false);
  });
  it('isolates accounts, servers and immutable task/reply identities', () => {
    const { storage } = memory();
    const key = draftKey('https://one.example.com', 'user-a', 'reply:task-a:root-a');
    new MessageDraftStore(key, storage).update({ body: 'Private draft', replyTo: 'reply-a', open: true });
    for (const other of [draftKey('https://two.example.com', 'user-a', 'reply:task-a:root-a'), draftKey('https://one.example.com', 'user-b', 'reply:task-a:root-a'), draftKey('https://one.example.com', 'user-a', 'reply:task-b:root-a')]) {
      expect(new MessageDraftStore(other, storage).getSnapshot().hasDraft).toBe(false);
    }
    expect(new MessageDraftStore(key, storage).getSnapshot().data).toMatchObject({ body: 'Private draft', replyTo: 'reply-a', open: true });
  });
  it('keeps newer work from another tab when an older composer clears after posting', () => {
    const { storage } = memory();
    const first = new MessageDraftStore('key', storage);
    first.update({ body: 'First message' });
    const second = new MessageDraftStore('key', storage);
    second.update({ body: 'Newer work' });
    first.clear();
    expect(new MessageDraftStore('key', storage).getSnapshot().data.body).toBe('Newer work');
  });
  it('does not replace new input with a late async read', async () => {
    let resolve!: (raw: string | null) => void;
    const { storage, values } = memory();
    new MessageDraftStore('key', storage).update({ body: 'Stored old draft' });
    const old = values.get('key')!;
    const draft = new MessageDraftStore('key', { ...storage, getItem: () => new Promise((done) => { resolve = done; }) });
    draft.update({ body: 'Current input' });
    resolve(old);
    await Promise.resolve();
    expect(draft.getSnapshot().data.body).toBe('Current input');
    expect(draft.getSnapshot().ready).toBe(true);
  });
  it('retains input when storage fails and ignores malformed stored data', () => {
    const { storage, values } = memory();
    values.set('bad', '{broken');
    expect(new MessageDraftStore('bad', storage).getSnapshot().hasDraft).toBe(false);
    const draft = new MessageDraftStore('key', { ...storage, setItem: () => { throw new Error('quota'); } });
    draft.update({ body: 'Keep this in memory' });
    expect(draft.getSnapshot()).toMatchObject({ status: 'unavailable', data: { body: 'Keep this in memory' } });
  });
  it('restores a pending attachment upload without restoring already-posted text', () => {
    const { storage } = memory();
    const draft = new MessageDraftStore('reply', storage);
    draft.update({ body: '', attachmentName: 'proof.txt', postedCommentId: 'posted-comment', replyTo: 'parent', open: true });
    expect(new MessageDraftStore('reply', storage).getSnapshot().data).toMatchObject({ body: '', postedCommentId: 'posted-comment', attachmentName: 'proof.txt', open: true });
  });
});
