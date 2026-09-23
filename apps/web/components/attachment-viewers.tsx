/* eslint-disable @typescript-eslint/no-explicit-any */
import '@/components/attachment-viewers.css';
import { cn } from '@/lib/utils';
import hljs from 'highlight.js/lib/common';
import { MaximizeIcon, RotateCwIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react-native';
import * as React from 'react';

/* ------------------------------------------------------------------ image */

/** Raster images: wheel zoom, drag pan, rotate, double-click fit/actual size. */
export function ImageViewer({ url, alt }: { url: string; alt: string }) {
  const [scale, setScale] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const dragState = React.useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const reset = React.useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);
  const zoomBy = React.useCallback((factor: number) => {
    setScale((s) => Math.min(8, Math.max(0.1, s * factor)));
  }, []);

  // React's onWheel is registered passively, so preventDefault() would be ignored.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(8, Math.max(0.1, s * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-') zoomBy(0.8);
      else if (e.key === '0') reset();
      else if (e.key.toLowerCase() === 'r') setRotation((r) => (r + 90) % 360);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset, zoomBy]);

  const pannable = scale > 1 || rotation !== 0;

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black/40"
      style={{ cursor: dragging ? 'grabbing' : pannable ? 'grab' : 'zoom-in' }}
      onPointerDown={(e) => {
        if (!pannable) return;
        dragState.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
        setDragging(true);
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragState.current;
        if (!d) return;
        setOffset({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) });
      }}
      onPointerUp={() => {
        dragState.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        dragState.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => {
        if (pannable || offset.x !== 0 || offset.y !== 0) {
          reset();
          return;
        }
        const img = imgRef.current;
        if (img && img.clientWidth > 0) {
          setScale(Math.min(8, Math.max(1, img.naturalWidth / img.clientWidth)));
        }
      }}>
      <img
        ref={imgRef}
        src={url}
        alt={alt}
        draggable={false}
        className="select-none"
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
          transition: dragging ? 'none' : 'transform 120ms ease-out',
        }}
      />
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-1 text-white shadow-lg">
        <ViewerButton label="Zoom out" onPress={() => zoomBy(0.8)}>
          <ZoomOutIcon size={16} color="#fff" />
        </ViewerButton>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset zoom"
          className="min-w-12 rounded-full px-1 py-0.5 text-center text-xs tabular-nums hover:bg-white/15">
          {Math.round(scale * 100)}%
        </button>
        <ViewerButton label="Zoom in" onPress={() => zoomBy(1.25)}>
          <ZoomInIcon size={16} color="#fff" />
        </ViewerButton>
        <span className="mx-1 h-4 w-px bg-white/25" />
        <ViewerButton label="Rotate 90°" onPress={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCwIcon size={16} color="#fff" />
        </ViewerButton>
        <ViewerButton label="Fit to view" onPress={reset}>
          <MaximizeIcon size={16} color="#fff" />
        </ViewerButton>
      </div>
    </div>
  );
}

function ViewerButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      className="rounded-full p-1.5 hover:bg-white/15">
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ media */

export function VideoViewer({ url, filename }: { url: string; filename: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <MediaError filename={filename} />;
  return (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <video
        src={url}
        controls
        playsInline
        onError={() => setFailed(true)}
        className="max-h-full max-w-full"
      />
    </div>
  );
}

export function AudioViewer({ url, filename }: { url: string; filename: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <MediaError filename={filename} />;
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <audio src={url} controls onError={() => setFailed(true)} className="w-full max-w-xl" />
    </div>
  );
}

function MediaError({ filename }: { filename: string }) {
  return (
    <div className="text-muted-foreground flex h-full w-full items-center justify-center p-8 text-sm">
      This browser could not play {filename}. Download it instead.
    </div>
  );
}

/* ------------------------------------------------------- sandboxed html/svg */

/**
 * Uploaded HTML/SVG renders in an iframe with `sandbox=""` (scripts, forms, popups and
 * same-origin access all disabled) plus a CSP that blocks every active request. Passive
 * resources (images/styles/fonts/media) may still load. Never rendered as page markup.
 */
const SANDBOX_CSP =
  "default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:;";

function sandboxDoc(source: string, mode: 'html' | 'svg'): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`;
  if (mode === 'svg') {
    return `<!doctype html><html><head><meta charset="utf-8">${csp}<style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${source}</body></html>`;
  }
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/<head[^>]*>/i, (m) => `${m}${csp}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${csp}</head><body>${source}</body></html>`;
}

export function SandboxedFrame({
  source,
  mode,
  title,
}: {
  source: string;
  mode: 'html' | 'svg';
  title: string;
}) {
  const doc = React.useMemo(() => sandboxDoc(source, mode), [source, mode]);
  return (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={doc}
      className="h-full w-full border-0 bg-white"
    />
  );
}

/* ------------------------------------------------------------------ code */

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  sql: 'sql',
  css: 'css',
  scss: 'scss',
  less: 'less',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  env: 'bash',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  dart: 'dart',
  vue: 'xml',
  svelte: 'xml',
  astro: 'xml',
  makefile: 'makefile',
  patch: 'diff',
  diff: 'diff',
  json: 'json',
  jsonc: 'json',
  geojson: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
};

/** highlight.js language id for a filename, or undefined when unknown. */
export function languageForFilename(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return undefined;
  if (lower === 'makefile' || lower.endsWith('.mk')) return 'makefile';
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  const lang = EXT_LANG[ext];
  return lang && hljs.getLanguage(lang) ? lang : undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text: string, language?: string): string {
  try {
    return hljs.highlight(text, { language: language ?? 'plaintext' }).value;
  } catch {
    return escapeHtml(text);
  }
}

/** Syntax-highlighted source with a wrap toggle. */
export function CodeViewer({
  text,
  language,
  note,
}: {
  text: string;
  language?: string;
  note?: string;
}) {
  const [wrap, setWrap] = React.useState(true);
  const html = React.useMemo(() => highlight(text, language), [text, language]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-1">
        <span className="text-muted-foreground font-mono text-xs">{language ?? 'text'}</span>
        <button
          type="button"
          onClick={() => setWrap((w) => !w)}
          className="text-muted-foreground hover:text-foreground rounded px-2 py-0.5 text-xs">
          {wrap ? 'No wrap' : 'Wrap'}
        </button>
      </div>
      {note ? (
        <div className="border-border text-muted-foreground border-b px-3 py-1 text-xs">{note}</div>
      ) : null}
      <div className="bg-muted/30 min-h-0 flex-1 overflow-auto">
        <pre
          className={cn(
            'hljs m-0 p-3 text-xs leading-5',
            wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre'
          )}>
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </div>
  );
}

/** JSON: pretty-printed when parseable, raw (highlighted) when not. */
export function JsonViewer({ text }: { text: string }) {
  const pretty = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return null;
    }
  }, [text]);
  return (
    <CodeViewer
      text={pretty ?? text}
      language="json"
      note={pretty === null ? 'Not valid JSON — showing raw source.' : undefined}
    />
  );
}

/* ------------------------------------------------------------------ csv */

/** RFC 4180-ish parser: quotes, escaped quotes, CRLF; no streaming. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const CSV_MAX_ROWS = 2000;
const CSV_MAX_COLS = 100;

export function CsvViewer({ text, filename }: { text: string; filename: string }) {
  const delimiter = /\.tsv$/i.test(filename) ? '\t' : ',';
  const { rows, truncated } = React.useMemo(() => {
    const all = parseDelimited(text, delimiter);
    const cut = all.length > CSV_MAX_ROWS || all.some((r) => r.length > CSV_MAX_COLS);
    return {
      rows: all.slice(0, CSV_MAX_ROWS).map((r) => r.slice(0, CSV_MAX_COLS)),
      truncated: cut,
    };
  }, [text, delimiter]);

  if (rows.length === 0) return <TextViewer text={text} />;
  const [head, ...body] = rows;

  return (
    <div className="bg-background h-full w-full overflow-auto">
      {truncated ? (
        <div className="border-border text-muted-foreground sticky top-0 z-20 border-b bg-background px-3 py-1 text-xs">
          Showing the first {CSV_MAX_ROWS} rows and {CSV_MAX_COLS} columns.
        </div>
      ) : null}
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-background sticky top-0 z-10">
          <tr>
            {head.map((cell, i) => (
              <th
                key={i}
                className="border-border text-foreground border-b px-3 py-1.5 text-left font-medium whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, i) => (
            <tr key={i} className="odd:bg-muted/30">
              {Array.from({ length: Math.max(head.length, row.length) }).map((_, j) => (
                <td
                  key={j}
                  className="border-border/60 text-foreground border-b px-3 py-1 whitespace-nowrap">
                  {row[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ text */

/** Plain text: selectable, escaped by React, wrapping. */
export function TextViewer({ text }: { text: string }) {
  return (
    <div className="bg-muted/30 h-full w-full overflow-auto">
      <pre className="m-0 p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}
