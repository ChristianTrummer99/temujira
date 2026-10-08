import { describe, expect, it } from 'vitest';
import { clipboardImages } from '../lib/clipboard-images';

function clipboard(files: File[], items = true): Pick<DataTransfer, 'items' | 'files'> {
  return {
    files: files as unknown as FileList,
    items: (items ? files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })) : []) as unknown as DataTransferItemList,
  };
}

describe('clipboard image attachments', () => {
  it('extracts multiple images once when both clipboard APIs expose the same files', async () => {
    const png = new File(['png bytes'], 'screen.png', { type: 'image/png' });
    const jpeg = new File(['jpeg bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const result = clipboardImages(clipboard([png, jpeg, new File(['text'], 'note.txt', { type: 'text/plain' })]));
    expect(result).toHaveLength(2);
    expect(result).toEqual([{ data: png, filename: 'screen.png', contentType: 'image/png' }, { data: jpeg, filename: 'photo.jpg', contentType: 'image/jpeg' }]);
    expect(await ('data' in result[0] ? (result[0].data as Blob).text() : '')).toBe('png bytes');
  });
  it('supports files-only payloads and supplies distinct names for screenshots', () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const first = clipboardImages(clipboard([file], false))[0];
    const next = clipboardImages(clipboard([file], false))[0];
    expect(first.filename).toMatch(/^pasted-image-.*\.png$/);
    expect(next.filename).not.toBe(first.filename);
  });
  it('leaves ordinary text, links and HTML alone and skips inaccessible files', () => {
    const input = { ...clipboard([]), items: [{ kind: 'string', type: 'text/html' }, { kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png', getAsFile: () => null }] as unknown as DataTransferItemList };
    expect(clipboardImages(input)).toEqual([]);
  });
});
