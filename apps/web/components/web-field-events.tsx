import { clipboardImages } from '@/lib/clipboard-images';
import type { UploadInput } from '@temujira/client';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

/** Web-only capture wrapper for Markdown fields. It runs before CodeMirror or the
 * contenteditable editor handles the event, so image paste and Cmd/Ctrl+Enter never
 * become inline text or a newline. */
export function WebFieldEvents({ children, onFiles, filesDisabled, onSubmit, submitDisabled }: {
  children: ReactNode;
  onFiles?: (files: UploadInput[]) => void;
  filesDisabled?: boolean;
  onSubmit?: () => void;
  submitDisabled?: boolean;
}) {
  if (Platform.OS !== 'web' || (!onFiles && !onSubmit)) return <>{children}</>;
  return <div
    style={{ display: 'contents' }}
    onPasteCapture={onFiles ? (event) => {
      const images = clipboardImages(event.clipboardData);
      if (!images.length) return;
      event.preventDefault(); event.stopPropagation();
      if (!filesDisabled) onFiles(images);
    } : undefined}
    onKeyDownCapture={onSubmit ? (event) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.nativeEvent.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (!submitDisabled) onSubmit();
    } : undefined}
  >{children}</div>;
}
