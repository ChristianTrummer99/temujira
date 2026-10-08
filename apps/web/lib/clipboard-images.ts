import type { UploadInput } from '@temujira/client';

let sequence = 0;
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };

/** Read only the paste event payload. Never request general clipboard access or fetch
 * HTML image URLs. Prefer items, then files; browsers often expose the same image in both. */
export function clipboardImages(data: Pick<DataTransfer, 'items' | 'files'>): UploadInput[] {
  const items = Array.from(data.items ?? []).flatMap((item) => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return [];
    const file = item.getAsFile();
    return file ? [{ file, type: file.type || item.type }] : [];
  });
  const images = items.length ? items : Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/')).map((file) => ({ file, type: file.type }));
  return images.map(({ file, type }) => ({
    data: file,
    contentType: type,
    filename: file.name && !/^image(?:\.[a-z0-9]+)?$/i.test(file.name)
      ? file.name : `pasted-image-${Date.now()}-${++sequence}.${extensions[type] ?? 'image'}`,
  }));
}
