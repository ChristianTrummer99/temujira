import { clipboardImages } from '@/lib/clipboard-images';
import type { UploadInput } from '@temujira/client';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

/** Capture before either CodeMirror or contenteditable processes an image as text/HTML. */
export function AttachmentPaste({ children, onFiles, disabled }: { children: ReactNode; onFiles?: (files: UploadInput[]) => void; disabled?: boolean }) {
  if (Platform.OS !== 'web' || !onFiles) return <>{children}</>;
  return <div style={{ display: 'contents' }} onPasteCapture={(event) => {
    const images = clipboardImages(event.clipboardData);
    if (!images.length) return;
    event.preventDefault(); event.stopPropagation();
    if (!disabled) onFiles(images);
  }}>{children}</div>;
}
