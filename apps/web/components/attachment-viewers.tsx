/* eslint-disable @typescript-eslint/no-explicit-any */
import '@/components/attachment-viewers.css';
import { cn } from '@/lib/utils';
import { listenPreviewInput, previewFrameBridge } from '@/lib/preview-input';
import hljs from 'highlight.js/lib/common';
import * as React from 'react';
import { usePreviewZoom } from './preview-zoom';
export { PreviewZoom } from './preview-zoom';
export { PdfPreview } from './pdf-preview';

/* ------------------------------------------------------------------ image */

/** Image fitting only. All input and zoom controls belong to the shared surface. */
export function ImageViewer({ url, alt }: { url: string; alt: string }) {
  const { width, height, rotation } = usePreviewZoom();
  return <div className="flex items-center justify-center overflow-hidden bg-black/40" style={{ width, height }}>
    <img src={url} alt={alt} draggable={false} className="shrink-0 select-none"
      style={{ width: rotation % 180 ? height : width, height: rotation % 180 ? width : height, objectFit: 'contain', transform: `rotate(${rotation}deg)` }} />
  </div>;
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
 * Uploaded HTML/SVG stays in an opaque-origin sandbox. A nonce allows only the trusted
 * input bridge to run. Uploaded scripts, handlers, frames, forms, and popups stay blocked.
 * Never add allow-same-origin: the preview must not have access to the app or its cookies.
 */
const SANDBOX_CSP =
  "default-src 'none'; script-src-attr 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:;";

function sandboxDoc(source: string, mode: 'html' | 'svg', token: string): string {
  // Parsing is inert. Also remove scripts and automatic navigation before frame loading.
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  parsed.querySelectorAll('script,meta[http-equiv],base').forEach((node) => node.remove());
  const csp = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP} script-src 'nonce-${token}';">`;
  const bridge = `<script nonce="${token}">(${previewFrameBridge.toString()})(${JSON.stringify(token)},${listenPreviewInput.toString()})</script>`;
  const style = mode === 'svg' ? '<style>html,body{margin:0;min-height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style>' : '';
  // The policy and bridge precede ALL uploaded markup, including malformed documents.
  return `<!doctype html><html><head><meta charset="utf-8">${csp}${bridge}${style}</head><body>${parsed.documentElement.outerHTML}</body></html>`;
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
  const token = React.useMemo(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''), [source, mode]);
  const doc = React.useMemo(() => sandboxDoc(source, mode, token), [source, mode, token]);
  const { bindFrame, width, height } = usePreviewZoom();
  const frame = React.useRef<HTMLIFrameElement>(null);
  const cleanup = React.useRef<(() => void) | undefined>(undefined);
  const connect = React.useCallback(() => {
    cleanup.current?.();
    if (frame.current) cleanup.current = bindFrame(frame.current, token);
  }, [bindFrame, token]);
  React.useEffect(() => { connect(); return () => cleanup.current?.(); }, [connect, width, height]);
  return (
    <iframe
      ref={frame}
      onLoad={connect}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      className="block w-full border-0 bg-white"
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
