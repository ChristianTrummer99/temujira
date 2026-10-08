import type { DescriptionEditorProps } from '@/components/description-editor';
import { cn } from '@/lib/utils';
import {
  AtomicCodeMirrorEditor,
  type AtomicCodeMirrorEditorHandle,
} from '@atomic-editor/editor';
import '@atomic-editor/editor/styles.css';
import '@/components/description-editor.css';
import { placeholder } from '@codemirror/view';
import * as React from 'react';

export function WebDescriptionEditor({
  documentId,
  value,
  onChangeText,
  onBlurCommit,
  placeholder: placeholderText,
  className,
  editable = true,
}: DescriptionEditorProps) {
  const handle = React.useRef<AtomicCodeMirrorEditorHandle | null>(null);

  // Captured once at mount (keyed on documentId); a stable reference is required.
  const extensions = React.useMemo(
    () => (placeholderText ? [placeholder(placeholderText)] : []),
    [placeholderText]
  );

  return (
    <div
      className={cn('tmj-description-editor w-full', className)}
      onKeyDownCapture={(event) => {
        const editor = handle.current;
        if (!editable || !editor?.getContentDOM()?.contains(event.target as Node) || event.altKey || (!event.metaKey && !event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && !(key === 'y' && event.ctrlKey)) return;
        event.preventDefault(); event.stopPropagation();
        if (key === 'y' || event.shiftKey) editor.redo(); else editor.undo();
      }}
      onBlur={() => onBlurCommit?.()}>
      <AtomicCodeMirrorEditor
        documentId={documentId}
        markdownSource={value}
        readOnly={!editable}
        onMarkdownChange={onChangeText}
        editorHandleRef={handle}
        extensions={extensions}
        onLinkClick={(url) => {
          if (/^(https?:\/\/|www\.)/i.test(url)) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }}
      />
    </div>
  );
}
