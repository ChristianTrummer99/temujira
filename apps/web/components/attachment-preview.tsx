import { Markdown } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { saveAttachment } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { isSvgSource, previewKind, previewMaxBytes, usePreview } from '@/lib/preview';
import type { Attachment, User } from '@temujira/client';
import { DownloadIcon, FileIcon, FileTextIcon, ImageIcon } from 'lucide-react-native';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';

/**
 * Attachment previews. All bytes come from lib/preview.ts (which goes through the API
 * client so auth headers are sent); nothing here ever builds a URL to the download route.
 *
 * Safety invariants, do not relax:
 *  - text kinds (including .svg and text/html) render inside <Text>, which escapes;
 *  - markdown goes through <Markdown> (react-markdown without rehype-raw → no raw HTML);
 *  - only image/* (minus svg) and application/pdf ever become a blob: URL, matching the
 *    server's own inline safelist.
 */

/** The icon a non-image (or not-yet-loaded) attachment shows, chosen by preview kind. */
export function attachmentIcon(att: Attachment) {
  switch (previewKind(att)) {
    case 'image':
      return ImageIcon;
    case 'markdown':
    case 'text':
      return FileTextIcon;
    default:
      return FileIcon;
  }
}

/**
 * Small square thumbnail for image attachments; the kind icon for everything else.
 * Shares the module-level cache with the dialog, so a visible thumbnail means the
 * lightbox opens with zero extra network.
 */
export function AttachmentThumb({
  attachment,
  compact,
}: {
  attachment: Attachment;
  compact?: boolean;
}) {
  const kind = previewKind(attachment);
  const wantsThumb = kind === 'image' && attachment.size <= previewMaxBytes('image');
  // Unconditional hook; `null` keeps it idle for non-image rows (no fetch).
  const preview = usePreview(wantsThumb ? attachment : null);
  const [broken, setBroken] = React.useState(false);
  const box = compact ? 'size-5' : 'size-10';
  const iconSize = compact ? 'size-3.5' : 'size-4';

  if (wantsThumb && preview.status === 'loading') {
    return <Skeleton className={`${box} rounded-md`} />;
  }
  if (wantsThumb && preview.status === 'ready' && preview.url && !broken && Platform.OS === 'web') {
    return (
      <View className={`${box} bg-muted overflow-hidden rounded-md`}>
        <img
          src={preview.url}
          alt={attachment.filename}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </View>
    );
  }
  return <Icon as={attachmentIcon(attachment)} className={`text-muted-foreground ${iconSize}`} />;
}

function MetaRow({ attachment }: { attachment: Attachment }) {
  return (
    <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
      <Text numberOfLines={1} className="text-sm font-medium">
        {attachment.filename}
      </Text>
      <Text className="text-muted-foreground text-xs">{formatBytes(attachment.size)}</Text>
      <Badge variant="outline">
        <Text>{attachment.mime_type || 'application/octet-stream'}</Text>
      </Badge>
      <Text className="text-muted-foreground font-mono text-[11px]">
        {attachment.sha256.slice(0, 12)}
      </Text>
    </View>
  );
}

/**
 * Screen-level lightbox. Mount once and drive it with `attachment` state — same pattern as
 * UserInfoDialog. Passing the screen's `users` lets markdown previews render mention chips.
 */
export function AttachmentPreviewDialog({
  attachment,
  users,
  onClose,
  onMentionPress,
}: {
  attachment: Attachment | null;
  users: User[];
  onClose: () => void;
  onMentionPress?: (u: User) => void;
}) {
  const { client } = useAuth();
  const preview = usePreview(attachment);
  const [error, setError] = React.useState<string | null>(null);
  const [imgBroken, setImgBroken] = React.useState(false);

  React.useEffect(() => {
    setError(null);
    setImgBroken(false);
  }, [attachment?.id]);

  async function download() {
    if (!attachment) return;
    setError(null);
    try {
      await saveAttachment(client, attachment.id, attachment.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  return (
    <Dialog open={!!attachment} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-full sm:max-w-3xl">
        <DialogTitle className="pr-8">
          <Text numberOfLines={1}>{attachment?.filename ?? 'Attachment'}</Text>
        </DialogTitle>

        <View className="min-h-32 justify-center">
          {attachment ? (
            <PreviewBody
              attachment={attachment}
              preview={preview}
              users={users}
              onMentionPress={onMentionPress}
              imgBroken={imgBroken}
              onImgBroken={() => setImgBroken(true)}
            />
          ) : null}
        </View>

        {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

        <DialogFooter className="sm:items-center sm:justify-between">
          {attachment ? <MetaRow attachment={attachment} /> : <View />}
          <View className="flex-row gap-2">
            {preview.status === 'error' ? (
              <Button variant="outline" size="sm" onPress={preview.retry}>
                <Text>Retry</Text>
              </Button>
            ) : null}
            {Platform.OS === 'web' ? (
              <Button size="sm" className="gap-1.5" onPress={download}>
                <Icon as={DownloadIcon} className="text-primary-foreground size-4" />
                <Text>Download</Text>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onPress={onClose}>
              <Text>Close</Text>
            </Button>
          </View>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  attachment,
  preview,
  users,
  onMentionPress,
  imgBroken,
  onImgBroken,
}: {
  attachment: Attachment;
  preview: ReturnType<typeof usePreview>;
  users: User[];
  onMentionPress?: (u: User) => void;
  imgBroken: boolean;
  onImgBroken: () => void;
}) {
  const kind = previewKind(attachment);

  if (preview.status === 'loading' || preview.status === 'idle') {
    return <Skeleton className="h-64 w-full" />;
  }

  if (preview.status === 'unsupported') {
    return (
      <View className="items-center gap-2 py-8">
        <Icon as={attachmentIcon(attachment)} className="text-muted-foreground size-8" />
        <Text className="text-muted-foreground text-sm">
          {Platform.OS === 'web'
            ? 'No preview available for this file type — download it instead.'
            : 'Preview is available on the web app.'}
        </Text>
      </View>
    );
  }

  if (preview.status === 'toolarge') {
    return (
      <View className="items-center gap-2 py-8">
        <Icon as={attachmentIcon(attachment)} className="text-muted-foreground size-8" />
        <Text className="text-muted-foreground text-sm">
          Too large to preview ({formatBytes(attachment.size)} — limit{' '}
          {formatBytes(previewMaxBytes(kind))}). Download it instead.
        </Text>
      </View>
    );
  }

  if (preview.status === 'error') {
    return (
      <View className="items-center gap-2 py-8">
        <Text className="text-destructive text-sm">Preview failed: {preview.error}</Text>
        <Text className="text-muted-foreground text-xs">The file is still downloadable.</Text>
      </View>
    );
  }

  // status === 'ready'
  if (kind === 'image' && preview.url) {
    if (imgBroken || Platform.OS !== 'web') {
      return (
        <View className="items-center gap-2 py-8">
          <Icon as={ImageIcon} className="text-muted-foreground size-8" />
          <Text className="text-muted-foreground text-sm">
            This file could not be decoded as an image — its type may be wrong.
          </Text>
        </View>
      );
    }
    return (
      <View className="bg-muted/40 items-center justify-center rounded-md p-2">
        <img
          src={preview.url}
          alt={attachment.filename}
          onError={onImgBroken}
          style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }}
        />
      </View>
    );
  }

  if (kind === 'pdf' && preview.url && Platform.OS === 'web') {
    return (
      <iframe
        title={attachment.filename}
        src={preview.url}
        style={{ width: '100%', height: '70vh', border: 0 }}
      />
    );
  }

  if (kind === 'markdown' && preview.text != null) {
    return (
      <ScrollView className="max-h-[70vh]" contentContainerClassName="gap-2 p-1">
        {preview.truncated ? (
          <Badge variant="secondary" className="self-start">
            <Text>Truncated at 1 MB</Text>
          </Badge>
        ) : null}
        <Markdown mentionUsers={users} onMentionPress={onMentionPress}>
          {preview.text}
        </Markdown>
      </ScrollView>
    );
  }

  if (kind === 'text' && preview.text != null) {
    return (
      <View className="gap-2">
        {isSvgSource(attachment) ? (
          <Text className="text-muted-foreground text-xs">
            SVG previews as source; download to view rendered.
          </Text>
        ) : null}
        {preview.truncated ? (
          <Badge variant="secondary" className="self-start">
            <Text>Truncated at 1 MB</Text>
          </Badge>
        ) : null}
        <ScrollView className="bg-muted/40 max-h-[70vh] rounded-md" contentContainerClassName="p-3">
          {/* <Text> escapes everything — uploaded HTML/SVG is inert by construction. */}
          <Text className="font-mono text-xs leading-5">{preview.text}</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View className="items-center gap-2 py-8">
      <Icon as={attachmentIcon(attachment)} className="text-muted-foreground size-8" />
      <Text className="text-muted-foreground text-sm">
        No preview available — download it instead.
      </Text>
    </View>
  );
}
