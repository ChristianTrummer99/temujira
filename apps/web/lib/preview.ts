import type { Attachment, TemujiraClient } from '@temujira/client';
import * as React from 'react';
import { Platform } from 'react-native';
import { useAuth } from './auth';

/**
 * Attachment previews: read-into-memory sibling of download.ts (save-to-disk).
 *
 * Every byte travels through `client.downloadAttachment` so the Bearer header is sent —
 * a bare <img src="/api/v1/attachments/:id/download"> is unauthenticated (see download.ts).
 *
 * Detection only picks a RENDERING PATH; both signals it uses are untrusted:
 * `mime_type` is stored verbatim from the uploader's multipart part header and `filename`'s
 * extension is equally uploader-chosen. So every path must be safe when the signal lies:
 * images decode (never script), PDFs render in a browser viewer that has no page-context
 * script access, and text kinds go through <Text> which escapes. Critically we NEVER build
 * a Blob typed `image/svg+xml` or `text/html`: a blob: URL is same-origin with the app, so
 * an svg-typed blob URL would run its script on the app's origin. SVG previews as source.
 */

export type PreviewKind = 'image' | 'markdown' | 'text' | 'pdf' | 'none';

/**
 * Binary kinds (image, pdf). The server caps uploads at MAX_UPLOAD_MB=50, so this is a
 * preview budget, not an upload limit: bigger files stay downloadable, just not previewable.
 */
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
/** Text kinds are rendered as React children, which is far more expensive per byte. */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

const MARKDOWN_EXTS = new Set(['md', 'markdown']);
const MARKDOWN_MIMES = new Set(['text/markdown', 'text/x-markdown']);
const TEXT_EXTS = new Set(['txt', 'log', 'csv', 'tsv', 'json', 'yml', 'yaml', 'xml', 'svg']);
const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

/** Mirrors the server's own normalization so client and server agree on what's served inline. */
function bareMimeOf(att: Attachment): string {
  return (att.mime_type ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Pure detector. Resolution order matters — first match wins:
 *   1. SVG (by mime OR .svg extension) -> 'text'   [BEFORE image/*, deliberately]
 *   2. image/*                          -> 'image'  (MIME-ONLY)
 *   3. markdown by mime or extension    -> 'markdown'
 *   4. application/pdf                  -> 'pdf'    (MIME-ONLY)
 *   5. text-ish by mime or extension    -> 'text'
 *   6. otherwise                        -> 'none'
 *
 * Image and PDF are MIME-ONLY because they depend on the server serving the real
 * Content-Type (only its inline safelist gets one; everything else is octet-stream) and the
 * Blob inherits that type. Widening those by extension would only mint broken blobs.
 * Markdown/text may use either signal because they are read via res.text(), where headers
 * are irrelevant.
 */
export function previewKind(att: Attachment): PreviewKind {
  const mime = bareMimeOf(att);
  const ext = extensionOf(att.filename);

  // (1) SVG first: the server deliberately excludes it from the inline safelist because
  // uploaded SVG can carry script. We do not undo that — no rasterization, no svg blob.
  if (mime === 'image/svg+xml' || ext === 'svg') return 'text';
  // (2)
  if (mime.startsWith('image/')) return 'image';
  // (3)
  if (MARKDOWN_MIMES.has(mime) || MARKDOWN_EXTS.has(ext)) return 'markdown';
  // (4)
  if (mime === 'application/pdf') return 'pdf';
  // (5) includes text/html — shown as SOURCE, never parsed.
  if (mime.startsWith('text/') || TEXT_MIMES.has(mime) || TEXT_EXTS.has(ext)) return 'text';
  // (6)
  return 'none';
}

export function isPreviewable(att: Attachment): boolean {
  return previewKind(att) !== 'none';
}

/** True when the attachment resolves to 'text' because it is an SVG (caption + no render). */
export function isSvgSource(att: Attachment): boolean {
  return bareMimeOf(att) === 'image/svg+xml' || extensionOf(att.filename) === 'svg';
}

export function previewMaxBytes(kind: PreviewKind): number {
  return kind === 'markdown' || kind === 'text' ? TEXT_PREVIEW_MAX_BYTES : PREVIEW_MAX_BYTES;
}

// ------------------------------------------------------------------ byte cache

type PreviewEntry =
  | { kind: 'url'; url: string; bytes: number }
  | { kind: 'text'; text: string; truncated: boolean; bytes: number };

/**
 * Module-level cache keyed by attachment id. Attachments are immutable by contract — there
 * is no attachments.update route and sha256 is fixed at upload — so entries never go stale
 * except on delete (see evictPreview).
 *
 * The cache OWNS every object URL: they are created only on a cache miss here and revoked
 * only by eviction. Components never revoke on unmount, which (a) stops one unmounting
 * consumer from revoking a URL a concurrent one (thumbnail + open dialog) still displays,
 * and (b) makes reopening the dialog instant. Leakage is bounded by the budget below and
 * ends with the document.
 */
const cache = new Map<string, PreviewEntry>();
const inFlight = new Map<string, Promise<PreviewEntry>>();

const MAX_ENTRIES = 20;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

function cachedBytes(): number {
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  return total;
}

function release(entry: PreviewEntry) {
  if (entry.kind === 'url' && typeof URL !== 'undefined' && URL.revokeObjectURL) {
    URL.revokeObjectURL(entry.url);
  }
}

/** Map preserves insertion order, so the first key is always the oldest entry. */
function evictOverBudget() {
  while (cache.size > 1 && (cache.size > MAX_ENTRIES || cachedBytes() > MAX_CACHE_BYTES)) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    const entry = cache.get(oldest.value);
    cache.delete(oldest.value);
    if (entry) release(entry);
  }
}

export function peekPreview(id: string): PreviewEntry | undefined {
  return cache.get(id);
}

/** Drop a cached preview (and its object URL). Called from both attachment-delete paths. */
export function evictPreview(id: string): void {
  const entry = cache.get(id);
  cache.delete(id);
  inFlight.delete(id);
  if (entry) release(entry);
}

/** Test/debug helper: current cache occupancy. */
export function previewCacheStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: cachedBytes() };
}

export async function fetchPreview(
  client: TemujiraClient,
  att: Attachment
): Promise<PreviewEntry> {
  const hit = cache.get(att.id);
  if (hit) return hit;
  const pending = inFlight.get(att.id);
  if (pending) return pending;

  const kind = previewKind(att);
  const promise = (async (): Promise<PreviewEntry> => {
    const res = await client.downloadAttachment(att.id);
    let entry: PreviewEntry;
    if (kind === 'image' || kind === 'pdf') {
      // The blob keeps the server's Content-Type, which is correct precisely for the
      // types the server safelists inline — the same set this branch handles.
      const blob = await res.blob();
      entry = { kind: 'url', url: URL.createObjectURL(blob), bytes: blob.size };
    } else {
      const raw = await res.text();
      const truncated = raw.length > TEXT_PREVIEW_MAX_BYTES;
      const text = truncated ? raw.slice(0, TEXT_PREVIEW_MAX_BYTES) : raw;
      entry = { kind: 'text', text, truncated, bytes: text.length };
    }
    cache.set(att.id, entry);
    evictOverBudget();
    return entry;
  })();

  inFlight.set(att.id, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(att.id);
  }
}

// ------------------------------------------------------------------ hook

export type PreviewStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'toolarge'
  | 'unsupported';

export interface PreviewState {
  status: PreviewStatus;
  kind: PreviewKind;
  url?: string;
  text?: string;
  truncated?: boolean;
  error?: string;
  retry: () => void;
}

function stateFrom(entry: PreviewEntry, kind: PreviewKind): Omit<PreviewState, 'retry'> {
  return entry.kind === 'url'
    ? { status: 'ready', kind, url: entry.url }
    : { status: 'ready', kind, text: entry.text, truncated: entry.truncated };
}

/**
 * Loads an attachment's preview bytes. Pass `null` to stay idle (that's how callers keep the
 * hook unconditional for non-previewable rows). Uses the generation-counter idiom from
 * use-resource.ts so a stale resolution never writes state after the deps changed.
 */
export function usePreview(att: Attachment | null): PreviewState {
  const { client } = useAuth();
  const [state, setState] = React.useState<Omit<PreviewState, 'retry'>>({
    status: 'idle',
    kind: 'none',
  });
  const [nonce, setNonce] = React.useState(0);
  const generation = React.useRef(0);

  const id = att?.id ?? null;
  const size = att?.size ?? 0;
  const kind = att ? previewKind(att) : 'none';
  const attRef = React.useRef(att);
  attRef.current = att;

  React.useEffect(() => {
    const mine = ++generation.current;
    const current = attRef.current;
    if (!current || !id) {
      setState({ status: 'idle', kind: 'none' });
      return;
    }
    if (Platform.OS !== 'web' || typeof URL === 'undefined') {
      setState({ status: 'unsupported', kind });
      return;
    }
    if (kind === 'none') {
      setState({ status: 'unsupported', kind });
      return;
    }
    if (size > previewMaxBytes(kind)) {
      setState({ status: 'toolarge', kind });
      return;
    }
    const hit = peekPreview(id);
    if (hit) {
      setState(stateFrom(hit, kind));
      return;
    }
    setState({ status: 'loading', kind });
    fetchPreview(client, current)
      .then((entry) => {
        if (mine !== generation.current) return;
        setState(stateFrom(entry, kind));
      })
      .catch((e: unknown) => {
        if (mine !== generation.current) return;
        setState({
          status: 'error',
          kind,
          error: e instanceof Error ? e.message : 'Preview failed',
        });
      });
    return () => {
      // Invalidate anything still in flight for the previous deps.
      generation.current += 1;
    };
  }, [client, id, kind, size, nonce]);

  const retry = React.useCallback(() => {
    if (id) evictPreview(id);
    setNonce((n) => n + 1);
  }, [id]);

  return { ...state, retry };
}
