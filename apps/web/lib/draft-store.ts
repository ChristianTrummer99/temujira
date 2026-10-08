import type { AttachmentDraft } from './pending-attachments';

export interface MessageDraft {
  body: string;
  mentionIds: string[];
  asQuestion: boolean;
  options: string[];
  attachments: AttachmentDraft[];
  replyTo: string | null;
  postedCommentId: string | null;
  open: boolean;
}
export const emptyMessageDraft = (): MessageDraft => ({ body: '', mentionIds: [], asQuestion: false, options: ['', ''], attachments: [], replyTo: null, postedCommentId: null, open: false });

type MaybePromise<T> = T | Promise<T>;
export interface DraftStorage {
  getItem: (key: string) => MaybePromise<string | null>;
  setItem: (key: string, value: string) => MaybePromise<void>;
  removeOwned: (key: string, writer: string, original: string | null) => MaybePromise<void>;
}
export interface DraftSnapshot {
  data: MessageDraft;
  ready: boolean;
  hasDraft: boolean;
  restored: boolean;
  status: 'loading' | 'saving' | 'saved' | 'unavailable';
}

export function draftKey(server: string, userId: string, slot: string): string {
  return `temujira.draft.v1:${[server, userId, slot].map(encodeURIComponent).join(':')}`;
}

function decode(raw: string | null): MessageDraft | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const envelope = JSON.parse(raw);
    const data = envelope?.data;
    if (envelope?.version !== 1 || !data || typeof data.body !== 'string' || data.body.length > 1_000_000 ||
      !Array.isArray(data.mentionIds) || data.mentionIds.length > 1000 || !data.mentionIds.every((id: unknown) => typeof id === 'string') ||
      !Array.isArray(data.options) || data.options.length > 50 || !data.options.every((s: unknown) => typeof s === 'string') ||
      typeof data.asQuestion !== 'boolean' || typeof data.open !== 'boolean' ||
      !(data.replyTo === null || typeof data.replyTo === 'string') ||
      !(data.postedCommentId == null || typeof data.postedCommentId === 'string')) return null;
    // Keep drafts from the original one-file composer readable.
    const attachments = data.attachments ?? (typeof data.attachmentName === 'string' && data.attachmentName ? [{ id: 'legacy-attachment', filename: data.attachmentName }] : []);
    if (!Array.isArray(attachments) || attachments.length > 1000 || !attachments.every((item: AttachmentDraft) => item && typeof item.id === 'string' && typeof item.filename === 'string') || new Set(attachments.map((item: AttachmentDraft) => item.id)).size !== attachments.length) return null;
    return { body: data.body, mentionIds: data.mentionIds, asQuestion: data.asQuestion, options: data.options, attachments: attachments.map(({ id, filename }: AttachmentDraft) => ({ id, filename })), replyTo: data.replyTo, postedCommentId: data.postedCommentId ?? null, open: data.open };
  } catch { return null; }
}

/** Do not clear a newer draft written by another tab/composer while a post was in flight. */
export function ownsDraft(raw: string | null, writer: string, original: string | null): boolean {
  if (raw === original) return true;
  try { return !!raw && JSON.parse(raw)?.writer === writer; } catch { return false; }
}

const hasContent = (d: MessageDraft) => !!(d.body.length || d.mentionIds.length || d.asQuestion || d.options.some(Boolean) || d.attachments.length || d.open || d.postedCommentId);

/** Writes happen on edits, not in a render/unmount effect. Web writes are synchronous,
 * so even an immediate reload retains the last keystroke. Native I/O is queued by key. */
export class MessageDraftStore {
  private listeners = new Set<() => void>();
  private revision = 0;
  private original: string | null = null;
  private writer = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private state: DraftSnapshot = { data: emptyMessageDraft(), ready: false, hasDraft: false, restored: false, status: 'loading' };

  constructor(private key: string | null, private storage: DraftStorage) {
    if (!key) { this.state = { ...this.state, ready: true, status: 'saved' }; return; }
    const restore = (raw: string | null) => {
      this.original = raw;
      if (this.revision) return; // never overwrite edits made before async hydration finished
      const data = decode(raw);
      this.setState({ data: data ?? emptyMessageDraft(), ready: true, hasDraft: !!data && hasContent(data), restored: !!data && hasContent(data), status: 'saved' });
    };
    try {
      const loaded = storage.getItem(key);
      if (loaded instanceof Promise) loaded.then(restore).catch(() => this.setState({ ...this.state, ready: true, status: 'unavailable' }));
      else restore(loaded);
    } catch { this.state = { ...this.state, ready: true, status: 'unavailable' }; }
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private setState(state: DraftSnapshot) { this.state = state; for (const listener of this.listeners) listener(); }

  update = (change: Partial<MessageDraft> | ((draft: MessageDraft) => MessageDraft)) => {
    const data = typeof change === 'function' ? change(this.state.data) : { ...this.state.data, ...change };
    if (JSON.stringify(data) === JSON.stringify(this.state.data)) return;
    this.save(data);
  };
  clear = () => this.save(emptyMessageDraft());

  private save(data: MessageDraft) {
    const revision = ++this.revision;
    const hasDraft = hasContent(data);
    this.setState({ data, ready: true, hasDraft, restored: false, status: 'saving' });
    const complete = (status: DraftSnapshot['status']) => {
      if (revision === this.revision) this.setState({ ...this.state, status });
    };
    if (!this.key) { complete('unavailable'); return; }
    try {
      const operation = hasDraft
        ? this.storage.setItem(this.key, JSON.stringify({ version: 1, writer: this.writer, data }))
        : this.storage.removeOwned(this.key, this.writer, this.original);
      if (operation instanceof Promise) operation.then(() => complete('saved')).catch(() => complete('unavailable'));
      else complete('saved');
    } catch { complete('unavailable'); }
  }
}
