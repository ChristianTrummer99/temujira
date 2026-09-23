import { Markdown } from '@/components/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { saveAttachment } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { previewKind, previewMaxBytes, usePreview } from '@/lib/preview';
import { cn } from '@/lib/utils';
import type { Attachment, User } from '@temujira/client';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
  Maximize2Icon,
  Minimize2Icon,
} from 'lucide-react-native';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';

/**
 * Attachment previews. All bytes come from lib/preview.ts (which goes through the API
 * client so auth headers are sent); nothing here ever builds a URL to the download route.
 *
 * Safety invariants, do not relax:
 *  - text kinds render through escaped React text (plain <Text>/<pre> children);
 *  - markdown goes through <Markdown> (react-markdown without rehype-raw → no raw HTML);
 *  - html/svg render ONLY inside a sandboxed iframe with scripts disabled;
 *  - only raster image/*, application/pdf and media ever become a blob: URL, matching the
 *    server's own inline safelist (plus media, which is re-typed from metadata).
 */

/** The icon a non-image (or not-yet-loaded) attachment shows, chosen by preview kind. */
export function attachmentIcon(att: Attachment) {
  switch (previewKind(att)) {
    case 'image':
    case 'svg':
      return ImageIcon;
    case 'video':
      return FileVideoIcon;
    case 'audio':
      return FileAudioIcon;
    case 'json':
      return FileJsonIcon;
    case 'csv':
      return FileSpreadsheetIcon;
    case 'code':
    case 'html':
      return FileCodeIcon;
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

type ViewersModule = typeof import('@/components/attachment-viewers');

/**
 * Full-screen-capable lightbox. Mount once and drive it with `attachment` state — same
 * pattern as UserInfoDialog. Passing the screen's `users` lets markdown previews render
 * mention chips; `attachments` + `onNavigate` enable prev/next across a task's files.
 */
export function AttachmentPreviewDialog({
  attachment,
  attachments,
  users,
  onClose,
  onNavigate,
  onMentionPress,
}: {
  attachment: Attachment | null;
  attachments?: Attachment[];
  users: User[];
  onClose: () => void;
  onNavigate?: (att: Attachment) => void;
  onMentionPress?: (u: User) => void;
}) {
  const { client } = useAuth();
  const preview = usePreview(attachment);
  const [viewers, setViewers] = React.useState<ViewersModule | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [htmlMode, setHtmlMode] = React.useState<'rendered' | 'source'>('rendered');
  const shellRef = React.useRef<View | null>(null);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    let mounted = true;
    import('@/components/attachment-viewers')
      .then((mod) => {
        if (mounted) setViewers(mod);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    setError(null);
    setHtmlMode('rendered');
  }, [attachment?.id]);

  const list = React.useMemo(() => {
    if (!attachment) return [] as Attachment[];
    const siblings = attachments ?? [];
    return siblings.some((a) => a.id === attachment.id) ? siblings : [attachment];
  }, [attachment, attachments]);
  const index = attachment ? list.findIndex((a) => a.id === attachment.id) : -1;
  const canNavigate = !!onNavigate && list.length > 1;

  const go = React.useCallback(
    (delta: number) => {
      if (!canNavigate || index < 0) return;
      const next = list[(index + delta + list.length) % list.length];
      if (next) onNavigate?.(next);
    },
    [canNavigate, index, list, onNavigate]
  );

  const toggleFullscreen = React.useCallback(async () => {
    if (Platform.OS !== 'web') return;
    const el = shellRef.current as unknown as HTMLElement | null;
    if (!el || typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (el.requestFullscreen) {
        await el.requestFullscreen();
        return;
      }
    } catch {
      // Fall through to the in-app expansion below.
    }
    setExpanded((v) => !v);
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Leave browser fullscreen when the dialog closes.
  React.useEffect(() => {
    if (!attachment && Platform.OS === 'web' && typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [attachment]);

  React.useEffect(() => {
    if (!attachment || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachment, go, toggleFullscreen]);

  async function download() {
    if (!attachment) return;
    setError(null);
    try {
      await saveAttachment(client, attachment.id, attachment.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  function openInNewTab() {
    if (preview.url && typeof window !== 'undefined') {
      window.open(preview.url, '_blank', 'noopener,noreferrer');
    }
  }

  const kind = attachment ? previewKind(attachment) : 'none';
  const isFull = isFullscreen || expanded;
  const contentSize = Platform.select({
    web: isFull
      ? 'h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none rounded-none border-0'
      : 'h-[88vh] w-full max-w-none rounded-lg',
    default: 'h-[88vh] w-full sm:max-w-3xl',
  });
  const containerSize = Platform.select({
    web: isFull ? 'max-w-none sm:max-w-none' : 'max-w-[1280px] sm:max-w-[1280px]',
    default: undefined,
  });

  return (
    <Dialog open={!!attachment} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        className={cn('flex flex-col gap-0 overflow-hidden p-0', contentSize)}
        containerClassName={containerSize}>
        <View ref={shellRef} className="bg-background flex h-full w-full flex-col">
          {/* header */}
          <View className="border-border flex-row items-center gap-3 border-b px-4 py-2.5 pr-14">
            <Icon
              as={attachmentIcon(attachment ?? ({ filename: '' } as Attachment))}
              className="text-muted-foreground size-4 shrink-0"
            />
            <View className="min-w-0 flex-1">
              <DialogTitle className="text-sm font-medium">
                <Text numberOfLines={1} className="text-sm font-medium">
                  {attachment?.filename ?? 'Attachment'}
                </Text>
              </DialogTitle>
              {attachment ? (
                <Text numberOfLines={1} className="text-muted-foreground text-xs">
                  {formatBytes(attachment.size)} · {attachment.mime_type || 'application/octet-stream'} ·{' '}
                  {attachment.sha256.slice(0, 12)}
                </Text>
              ) : null}
            </View>

            {attachment && (kind === 'html' || kind === 'svg') ? (
              <View className="border-border flex-row overflow-hidden rounded-md border">
                {(['rendered', 'source'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setHtmlMode(mode)}
                    className={cn(
                      'px-2 py-1 text-xs capitalize',
                      htmlMode === mode
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}>
                    {mode}
                  </button>
                ))}
              </View>
            ) : null}

            {attachment && preview.url ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                accessibilityLabel="Open in new tab"
                onPress={openInNewTab}>
                <Icon as={ExternalLinkIcon} className="text-muted-foreground size-4" />
              </Button>
            ) : null}
            {attachment && Platform.OS === 'web' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                accessibilityLabel="Download"
                onPress={download}>
                <Icon as={DownloadIcon} className="text-muted-foreground size-4" />
              </Button>
            ) : null}
            {attachment && Platform.OS === 'web' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                accessibilityLabel={isFull ? 'Exit full screen' : 'Full screen'}
                onPress={() => void toggleFullscreen()}>
                <Icon
                  as={isFull ? Minimize2Icon : Maximize2Icon}
                  className="text-muted-foreground size-4"
                />
              </Button>
            ) : null}
          </View>

          {/* body */}
          <View className="bg-muted/20 min-h-0 flex-1">
            {attachment ? (
              <PreviewBody
                attachment={attachment}
                preview={preview}
                viewers={viewers}
                users={users}
                htmlMode={htmlMode}
                onMentionPress={onMentionPress}
              />
            ) : null}
          </View>

          {/* footer */}
          <View className="border-border flex-row items-center justify-between gap-3 border-t px-4 py-2">
            <View className="flex-row items-center gap-2">
              {canNavigate ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    accessibilityLabel="Previous file"
                    onPress={() => go(-1)}>
                    <Icon as={ChevronLeftIcon} className="size-3.5" />
                    <Text className="text-xs">Prev</Text>
                  </Button>
                  <Text className="text-muted-foreground text-xs tabular-nums">
                    {index + 1} / {list.length}
                  </Text>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    accessibilityLabel="Next file"
                    onPress={() => go(1)}>
                    <Text className="text-xs">Next</Text>
                    <Icon as={ChevronRightIcon} className="size-3.5" />
                  </Button>
                </>
              ) : (
                <Text className="text-muted-foreground text-xs">Arrow keys navigate · F full screen</Text>
              )}
            </View>
            <View className="flex-row items-center gap-2">
              {preview.truncated ? (
                <Badge variant="secondary">
                  <Text>Truncated at 1 MB</Text>
                </Badge>
              ) : null}
              {preview.status === 'error' ? (
                <Button variant="outline" size="sm" className="h-7" onPress={preview.retry}>
                  <Text className="text-xs">Retry</Text>
                </Button>
              ) : null}
              {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
            </View>
          </View>
        </View>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  attachment,
  preview,
  viewers,
  users,
  htmlMode,
  onMentionPress,
}: {
  attachment: Attachment;
  preview: ReturnType<typeof usePreview>;
  viewers: ViewersModule | null;
  users: User[];
  htmlMode: 'rendered' | 'source';
  onMentionPress?: (u: User) => void;
}) {
  const kind = previewKind(attachment);

  if (preview.status === 'loading' || preview.status === 'idle') {
    return <Skeleton className="h-full w-full" />;
  }

  if (preview.status === 'unsupported') {
    return (
      <Placeholder
        attachment={attachment}
        text={
          Platform.OS === 'web'
            ? 'No preview available for this file type — download it instead.'
            : 'Preview is available on the web app.'
        }
      />
    );
  }

  if (preview.status === 'toolarge') {
    return (
      <Placeholder
        attachment={attachment}
        text={`Too large to preview (${formatBytes(attachment.size)} — limit ${formatBytes(
          previewMaxBytes(kind)
        )}). Download it instead.`}
      />
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

  if (Platform.OS !== 'web' || !viewers) {
    return <Placeholder attachment={attachment} text="Preview is available on the web app." />;
  }

  switch (kind) {
    case 'image':
      return preview.url ? (
        <viewers.ImageViewer url={preview.url} alt={attachment.filename} />
      ) : null;
    case 'pdf':
      return preview.url ? (
        <iframe
          title={attachment.filename}
          src={preview.url}
          className="h-full w-full border-0 bg-white"
        />
      ) : null;
    case 'video':
      return preview.url ? (
        <viewers.VideoViewer url={preview.url} filename={attachment.filename} />
      ) : null;
    case 'audio':
      return preview.url ? (
        <viewers.AudioViewer url={preview.url} filename={attachment.filename} />
      ) : null;
    case 'svg':
      return htmlMode === 'rendered' && preview.text != null ? (
        <viewers.SandboxedFrame source={preview.text} mode="svg" title={attachment.filename} />
      ) : (
        <viewers.TextViewer text={preview.text ?? ''} />
      );
    case 'html':
      return htmlMode === 'rendered' && preview.text != null ? (
        <viewers.SandboxedFrame source={preview.text} mode="html" title={attachment.filename} />
      ) : (
        <viewers.CodeViewer text={preview.text ?? ''} language="xml" />
      );
    case 'json':
      return <viewers.JsonViewer text={preview.text ?? ''} />;
    case 'csv':
      return <viewers.CsvViewer text={preview.text ?? ''} filename={attachment.filename} />;
    case 'code':
      return (
        <viewers.CodeViewer
          text={preview.text ?? ''}
          language={viewers.languageForFilename(attachment.filename)}
        />
      );
    case 'markdown':
      return preview.text != null ? (
        <ScrollView className="h-full" contentContainerClassName="gap-2 p-4">
          <Markdown mentionUsers={users} onMentionPress={onMentionPress}>
            {preview.text}
          </Markdown>
        </ScrollView>
      ) : null;
    case 'text':
      return <viewers.TextViewer text={preview.text ?? ''} />;
    default:
      return (
        <Placeholder attachment={attachment} text="No preview available — download it instead." />
      );
  }
}

function Placeholder({ attachment, text }: { attachment: Attachment; text: string }) {
  return (
    <View className="h-full items-center justify-center gap-2 p-8">
      <Icon as={attachmentIcon(attachment)} className="text-muted-foreground size-8" />
      <Text className="text-muted-foreground text-center text-sm">{text}</Text>
    </View>
  );
}
