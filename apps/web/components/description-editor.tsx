/* eslint-disable @typescript-eslint/no-explicit-any */
import { RichEditor } from '@/components/rich-editor';
import { cn } from '@/lib/utils';
import type { User } from '@temujira/client';
import * as React from 'react';
import { Platform, View } from 'react-native';

export interface DescriptionEditorProps {
  /** Stable identity for the document (task id). Remote updates must not remount. */
  documentId: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Called when focus leaves the editor (for flushing auto-save). */
  onBlurCommit?: () => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  mentions?: User[];
}

type WebEditorComponent = React.ComponentType<DescriptionEditorProps>;

/**
 * Task description editor. On web this is a CodeMirror 6 live-preview editor
 * (Atomic Editor): markdown renders as you type — headings, lists, quotes,
 * code — and the syntax markers reappear only on the line you're editing,
 * exactly like the comment renderer. Native keeps the existing composer.
 */
export function DescriptionEditor(props: DescriptionEditorProps) {
  const [WebEditor, setWebEditor] = React.useState<WebEditorComponent | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    let mounted = true;
    import('@/components/description-editor-web')
      .then((mod) => {
        if (mounted) setWebEditor(() => mod.WebDescriptionEditor);
      })
      .catch(() => {
        if (mounted) setLoadFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (Platform.OS !== 'web' || loadFailed) {
    return (
      <RichEditor
        value={props.value}
        onChangeText={props.onChangeText}
        onBlurCommit={props.onBlurCommit}
        placeholder={props.placeholder}
        className={props.className}
        editable={props.editable}
        mentions={props.mentions}
      />
    );
  }

  if (!WebEditor) {
    return <View className={cn('w-full', props.className)} />;
  }

  return <WebEditor {...props} />;
}
