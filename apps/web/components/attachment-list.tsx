import { AttachmentThumb, attachmentIcon } from '@/components/attachment-preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { formatBytes } from '@/lib/format';
import { isPreviewable } from '@/lib/preview';
import type { Attachment } from '@temujira/client';
import { DownloadIcon, SearchIcon, TrashIcon } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

const INLINE_FILE_LIMIT = 5;

type AttachmentListProps = {
  attachments: Attachment[];
  compact?: boolean;
  error?: string | null;
  onPreview: (attachment: Attachment) => void;
  onDownload: (id: string, filename: string) => void | Promise<void>;
  canDelete: (attachment: Attachment) => boolean;
  onDelete: (attachment: Attachment) => void | Promise<void>;
};

/** Keep long file lists compact; the dialog always contains the complete list. */
export function AttachmentList({ attachments, compact = false, error, onPreview, ...actions }: AttachmentListProps) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const openingPreview = React.useRef(false);
  const { height } = useWindowDimensions();
  const query = filter.trim().toLocaleLowerCase();
  const filtered = attachments.filter((attachment) => attachment.filename.toLocaleLowerCase().includes(query));
  const more = attachments.length - INLINE_FILE_LIMIT;

  function onOpenChange(next: boolean) {
    if (next) {
      setFilter('');
      openingPreview.current = false;
    }
    setOpen(next);
  }

  function openFile(attachment: Attachment) {
    if (isPreviewable(attachment)) {
      openingPreview.current = true;
      setOpen(false);
      onPreview(attachment);
    } else {
      void actions.onDownload(attachment.id, attachment.filename);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <View testID="attachment-list" className={compact ? 'mt-1 min-w-0 flex-row flex-wrap gap-1.5' : 'min-w-0 gap-1.5'}>
      {attachments.slice(0, INLINE_FILE_LIMIT).map((attachment) => <AttachmentRow
        key={attachment.id} attachment={attachment} compact={compact} thumbnail={!compact} onOpen={openFile} {...actions} />)}
      {more > 0 ? <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 self-start" accessibilityLabel={`Show all ${attachments.length} files`}>
          <Text className="text-xs">+ {more} more</Text>
        </Button>
      </DialogTrigger> : null}
    </View>
    <DialogContent className="min-h-0 max-w-full gap-3 p-4 sm:max-w-2xl sm:p-6" containerClassName="sm:max-w-2xl"
      style={{ maxHeight: height * 0.85 }}
      onCloseAutoFocus={(event) => { if (openingPreview.current) event.preventDefault(); }}>
      <DialogHeader className="pr-6">
        <DialogTitle>All files</DialogTitle>
        <DialogDescription>{attachments.length} {attachments.length === 1 ? 'file' : 'files'}. Select a file to open it.</DialogDescription>
      </DialogHeader>
      <View className="min-w-0 flex-row items-center gap-2">
        <Icon as={SearchIcon} className="text-muted-foreground size-4 shrink-0" />
        <Input value={filter} onChangeText={setFilter} autoFocus autoCapitalize="none" autoCorrect={false}
          accessibilityLabel="Filter files by name" placeholder="Filter by name..." className="min-w-0 flex-1" />
      </View>
      {query ? <Text role="status" className="text-muted-foreground text-xs">{filtered.length} of {attachments.length} files</Text> : null}
      {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
      <ScrollView className="min-h-0 shrink" style={{ maxHeight: height * 0.6 }} contentContainerClassName="gap-1.5" keyboardShouldPersistTaps="handled">
        {filtered.map((attachment) => <AttachmentRow key={attachment.id} attachment={attachment} onOpen={openFile} {...actions} />)}
        {filtered.length === 0 ? <Text className="text-muted-foreground py-6 text-center text-sm">No files match this name.</Text> : null}
      </ScrollView>
    </DialogContent>
  </Dialog>;
}

function AttachmentRow({ attachment, compact = false, thumbnail = false, onOpen, onDownload, canDelete, onDelete }: {
  attachment: Attachment;
  compact?: boolean;
  thumbnail?: boolean;
  onOpen: (attachment: Attachment) => void;
} & Pick<AttachmentListProps, 'onDownload' | 'canDelete' | 'onDelete'>) {
  return <View testID={`attachment-${attachment.id}`}
    className={`border-border bg-card min-w-0 max-w-full flex-row items-center rounded-md border ${compact ? 'gap-1.5 px-2 py-1' : 'gap-3 p-2.5'}`}>
    <View className="shrink-0">
      {thumbnail ? <AttachmentThumb attachment={attachment} /> : <Icon as={attachmentIcon(attachment)} className="text-muted-foreground size-3.5" />}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={attachment.filename} onPress={() => onOpen(attachment)} className={compact ? 'min-w-0 shrink' : 'min-w-0 flex-1'}>
      <Text numberOfLines={1} className={`${compact ? 'text-xs' : 'text-sm'} underline`}>{attachment.filename}</Text>
    </Pressable>
    <Text className="text-muted-foreground shrink-0 text-xs">{formatBytes(attachment.size)}</Text>
    {!compact ? <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onPress={() => void onDownload(attachment.id, attachment.filename)} accessibilityLabel={`Download ${attachment.filename}`}>
      <Icon as={DownloadIcon} className="text-muted-foreground size-3.5" />
    </Button> : null}
    {canDelete(attachment) ? <Button variant="ghost" size="sm" className={compact ? 'h-5 w-5 p-0' : 'h-7 w-7 p-0'} accessibilityLabel={`Delete ${attachment.filename}`} onPress={() => void onDelete(attachment)}>
      <Icon as={TrashIcon} className={`text-destructive ${compact ? 'size-3' : 'size-3.5'}`} />
    </Button> : null}
  </View>;
}
