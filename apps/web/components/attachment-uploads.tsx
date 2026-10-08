import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { attachmentDraft } from '@/lib/pending-attachments';
import type { Attachment, UploadInput } from '@temujira/client';
import * as React from 'react';
import { View } from 'react-native';

interface UploadJob { id: string; file: UploadInput; error: string | null }

/** Existing parents can accept pasted images immediately. Keep failed bytes for Retry. */
export function useAttachmentUploads(upload: (file: UploadInput) => Promise<{ attachment: Attachment }>, onUploaded: (attachment: Attachment) => void) {
  const [items, setItems] = React.useState<UploadJob[]>([]);
  const running = React.useRef(new Set<string>());
  async function send(item: UploadJob) {
    if (running.current.has(item.id)) return;
    running.current.add(item.id);
    setItems((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, error: null } : entry));
    let attachment: Attachment;
    try {
      ({ attachment } = await upload(item.file));
    } catch (e) {
      setItems((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, error: e instanceof Error ? e.message : 'Upload failed' } : entry));
      running.current.delete(item.id);
      return;
    }
    running.current.delete(item.id);
    setItems((previous) => previous.filter((entry) => entry.id !== item.id));
    onUploaded(attachment);
  }
  function add(files: UploadInput[]) {
    const added = files.map((file) => ({ id: attachmentDraft(file).id, file, error: null }));
    setItems((previous) => [...previous, ...added]);
    for (const item of added) void send(item);
  }
  return { items, add, retry: (item: UploadJob) => void send(item), remove: (id: string) => setItems((previous) => previous.filter((item) => item.id !== id)) };
}

export function AttachmentUploads({ uploads }: { uploads: ReturnType<typeof useAttachmentUploads> }) {
  if (!uploads.items.length) return null;
  return <View className="gap-2">{uploads.items.map((item) => <View key={item.id} className="border-border gap-1 rounded border p-2" testID={`attachment-upload-${item.id}`}>
    <Text numberOfLines={1} className="text-xs">{item.file.filename}</Text>
    {item.error ? <>
      <Text role="alert" className="text-destructive text-xs">Could not upload file: {item.error}</Text>
      <View className="flex-row gap-2">
        <Button variant="outline" size="sm" onPress={() => uploads.retry(item)} accessibilityLabel={`Retry upload ${item.file.filename}`}><Text>Retry</Text></Button>
        <Button variant="ghost" size="sm" onPress={() => uploads.remove(item.id)} accessibilityLabel={`Remove failed upload ${item.file.filename}`}><Text>Remove</Text></Button>
      </View>
    </> : <Text role="status" className="text-muted-foreground text-xs">Uploading…</Text>}
  </View>)}</View>;
}
