import { Markdown } from '@/components/markdown';
import { AttachmentPaste } from '@/components/attachment-paste';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { UploadInput, User } from '@temujira/client';
import * as React from 'react';
import { View } from 'react-native';

/** Shared preview for Markdown inputs; keep the editor mounted to preserve drafts/caret. */
export function MarkdownField({
  value,
  mentionUsers,
  children,
  label = 'Markdown',
  onPasteFiles,
  pasteDisabled,
}: {
  value: string;
  mentionUsers?: User[];
  children: React.ReactNode;
  label?: string;
  onPasteFiles?: (files: UploadInput[]) => void;
  pasteDisabled?: boolean;
}) {
  const [preview, setPreview] = React.useState(false);
  return (
    <View className="min-w-0 gap-2">
      <View className="flex-row items-center gap-1">
        <Button
          size="sm"
          variant={preview ? 'ghost' : 'secondary'}
          className="h-7 px-2"
          accessibilityLabel={`Write ${label}`}
          accessibilityState={{ selected: !preview }}
          onPress={() => setPreview(false)}>
          <Text className="text-xs">Write</Text>
        </Button>
        <Button
          size="sm"
          variant={preview ? 'secondary' : 'ghost'}
          className="h-7 px-2"
          accessibilityLabel={`Preview ${label}`}
          accessibilityState={{ selected: preview }}
          onPress={() => setPreview(true)}>
          <Text className="text-xs">Preview</Text>
        </Button>
      </View>
      <View style={preview ? { display: 'none' } : undefined}><AttachmentPaste onFiles={onPasteFiles} disabled={pasteDisabled}>{children}</AttachmentPaste></View>
      {preview ? (
        <View className="border-border min-h-20 min-w-0 rounded-md border p-3">
          {value.trim() ? (
            <Markdown mentionUsers={mentionUsers}>{value}</Markdown>
          ) : (
            <Text className="text-muted-foreground text-sm">Nothing to preview yet.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
