import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { UploadInput } from '@temujira/client';
import { PaperclipIcon, XIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, View } from 'react-native';

/** Both comment and reply composers use the same picker. File names can be restored
 * with a draft; the bytes must be selected again after a page/app restart. */
export function ComposerAttachment({ file, filename, label, disabled, onChange }: {
  file: UploadInput | null; filename: string; label: string; disabled?: boolean; onChange: (file: UploadInput | null) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState('');
  async function pick() {
    setError('');
    if (Platform.OS === 'web') { input.current?.click(); return; }
    try {
      const picker = await import('expo-document-picker');
      const result = await picker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        onChange({ uri: asset.uri, filename: asset.name, contentType: asset.mimeType });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not select the file'); }
  }
  return <View className="gap-1.5">
    <View className="flex-row flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} accessibilityLabel={`Attach file to ${label}`} onPress={pick}>
        <Icon as={PaperclipIcon} className="size-3.5" /><Text className="text-xs">{filename ? file ? 'Change file' : 'Select file again' : 'Attach file'}</Text>
      </Button>
      {filename ? <>
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs">{filename}</Text>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled} accessibilityLabel={`Remove ${label} attachment`} onPress={() => onChange(null)}><Icon as={XIcon} className="size-3.5" /></Button>
      </> : null}
    </View>
    {filename && !file ? <Text role="status" className="text-muted-foreground text-xs">Select {filename} again before sending. Drafts save file names, not file contents.</Text> : null}
    {error ? <Text role="alert" className="text-destructive text-xs">{error}</Text> : null}
    {Platform.OS === 'web' ? <input ref={input} aria-label={`${label} attachment`} type="file" disabled={disabled} style={{ display: 'none' }} onChange={(event) => {
      const picked = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (picked) onChange({ data: picked, filename: picked.name, contentType: picked.type });
    }} /> : null}
  </View>;
}
