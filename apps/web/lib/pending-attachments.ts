import type { UploadInput } from '@temujira/client';
import * as React from 'react';

export interface AttachmentDraft { id: string; filename: string }
let sequence = 0;
export const attachmentDraft = (file: UploadInput): AttachmentDraft => ({ id: `${Date.now().toString(36)}-${++sequence}`, filename: file.filename });

/** Metadata may be saved with a draft. File bytes/URIs live only in this composer. */
export function usePendingAttachments(items: AttachmentDraft[], update: (change: (items: AttachmentDraft[]) => AttachmentDraft[]) => void) {
  const files = React.useRef(new Map<string, UploadInput>());
  const [, refresh] = React.useReducer((n) => n + 1, 0);
  function add(inputs: UploadInput[]) {
    const next = inputs.map((file) => { const item = attachmentDraft(file); files.current.set(item.id, file); return item; });
    update((previous) => [...previous, ...next]);
  }
  function replace(id: string, file: UploadInput) {
    files.current.set(id, file);
    update((previous) => previous.map((item) => item.id === id ? { ...item, filename: file.filename } : item));
    refresh(); // selecting the same filename can still supply new bytes
  }
  function remove(id: string) { files.current.delete(id); update((previous) => previous.filter((item) => item.id !== id)); }
  function clear() { files.current.clear(); update(() => []); }
  async function uploadAll(upload: (file: UploadInput) => Promise<unknown>) {
    for (const item of items) {
      const file = files.current.get(item.id);
      if (!file) throw new Error(`Select ${item.filename} again before sending.`);
      await upload(file);
      remove(item.id); // persist each success; retry only files still pending
    }
  }
  return { items: items.map((item) => ({ ...item, file: files.current.get(item.id) })), add, replace, remove, clear, uploadAll,
    missingFiles: items.some((item) => !files.current.has(item.id)) };
}
export type PendingAttachments = ReturnType<typeof usePendingAttachments>;
