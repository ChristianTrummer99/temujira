import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { UploadInput } from '@temujira/client';
import type { PendingAttachments } from '@/lib/pending-attachments';
import { PaperclipIcon, XIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, View } from 'react-native';

/** Both comment and reply composers use the same picker. File names can be restored
 * with a draft; the bytes must be selected again after a page/app restart. */
export function ComposerAttachments({ queue, label, disabled }: {
  queue: PendingAttachments; label: string; disabled?: boolean;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const replacing = React.useRef<string | undefined>(undefined);
  const [error, setError] = React.useState('');
  function selected(files: UploadInput[], id?: string) {
    if (id && files[0]) queue.replace(id, files[0]); else queue.add(files);
  }
  async function pick(id?: string) {
    setError('');
    if (Platform.OS === 'web') {
      replacing.current = id;
      if (input.current) { input.current.multiple = !id; input.current.click(); }
      return;
    }
    try {
      const picker = await import('expo-document-picker');
      const result = await picker.getDocumentAsync({ copyToCacheDirectory: true, multiple: !id });
      if (!result.canceled) selected(result.assets.map((asset) => ({ uri: asset.uri, filename: asset.name, contentType: asset.mimeType })), id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not select the file'); }
  }
  return <View className="gap-1.5">
    <View className="flex-row flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} accessibilityLabel={`Attach file to ${label}`} onPress={() => void pick()}>
        <Icon as={PaperclipIcon} className="size-3.5" /><Text className="text-xs">Attach file</Text>
      </Button>
      {Platform.OS === 'web' ? <Text className="text-muted-foreground text-xs">Or paste an image into the text field.</Text> : null}
    </View>
    {queue.items.map((item) => <View key={item.id} testID={`pending-attachment-${item.id}`} className="border-border gap-1 rounded border p-2">
      <View className="flex-row items-center gap-2">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs">{item.filename}</Text>
        <Button variant="ghost" size="sm" className="h-6 px-1" disabled={disabled} accessibilityLabel={`Select ${item.filename} again`} onPress={() => void pick(item.id)}><Text className="text-xs">{item.file ? 'Change' : 'Select file again'}</Text></Button>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled} accessibilityLabel={`Remove ${label} attachment ${item.filename}`} onPress={() => queue.remove(item.id)}><Icon as={XIcon} className="size-3.5" /></Button>
      </View>
      {!item.file ? <Text role="status" className="text-muted-foreground text-xs">Select {item.filename} again before sending. Drafts save file names, not file contents.</Text> : null}
    </View>)}
    {error ? <Text role="alert" className="text-destructive text-xs">{error}</Text> : null}
    {Platform.OS === 'web' ? <input ref={input} aria-label={`${label} attachment`} type="file" disabled={disabled} style={{ display: 'none' }} onChange={(event) => {
      const picked = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
      selected(picked.map((file) => ({ data: file, filename: file.name, contentType: file.type })), replacing.current);
    }} /> : null}
  </View>;
}
