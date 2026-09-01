import type { TemujiraClient } from '@temujira/client';
import { Platform } from 'react-native';

/**
 * Download an attachment through the API client so the Bearer header is actually sent.
 *
 * A bare `<a href="/api/v1/attachments/:id/download">` is unauthenticated — it 401s on the
 * :8081 dev origin and only works in prod by accident (cookies). Same reason we never render
 * attachment images by URL.
 */
export async function saveAttachment(
  client: TemujiraClient,
  id: string,
  filename: string
): Promise<void> {
  const res = await client.downloadAttachment(id);
  const blob = await res.blob();

  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    // Native has no DOM download; callers surface the error.
    throw new Error('Downloads are only supported on web');
  }

  const url = URL.createObjectURL(blob);
  try {
    const el = document.createElement('a');
    el.href = url;
    el.download = filename || 'download';
    el.rel = 'noopener';
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  } finally {
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
