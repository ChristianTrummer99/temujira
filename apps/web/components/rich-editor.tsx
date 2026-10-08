/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAuth } from '@/lib/auth';
import { editableText } from '@/lib/editable-text';
import { EditorHistory, type EditorSelection, type EditorSnapshot } from '@/lib/editor-history';
import { readEditorSelection, restoreEditorSelection } from '@/lib/editor-selection';
import { splitTaskKey, taskKeyBody } from '@/lib/format';
import { UserAvatar } from '@/components/user-avatar';
import { cn } from '@/lib/utils';
import { useWorkspaceKeys } from '@/lib/workspaces';
import type { User } from '@temujira/client';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Platform, TextInput, View } from 'react-native';

export interface RichDocEditorProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Users to resolve `@Name` mention chips against. */
  mentions?: User[];
  /** Resolved user ids for mentions still present in the text. */
  onMentionIdsChange?: (ids: string[]) => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  autoFocus?: boolean;
  /** Enter submits (single-line field like a title) instead of inserting a newline. */
  singleLine?: boolean;
  /** Called when Enter is pressed in single-line mode. */
  onSubmit?: (text: string) => void;
  /** Where the `@` suggestion list opens. */
  suggestionsPlacement?: 'above' | 'below';
  /** Called on blur with the current value (for auto-saving editors). */
  onBlurCommit?: (text: string) => void;
}

// ------------------------------------------------------------------ decoration
//
// The web editor renders the markdown `value` as live composer markup (Slack-style):
// `**bold**`, `*italic*`, `_italic_`, `<u>underline</u>`, `[label](url)` links and
// bare-URL auto-linkification, plus inline chips for resolved `@Name` mentions and
// `WORKSPACE-12` task keys. Formatting markers are rendered dimmed so caret placement
// stays predictable, and the stored text round-trips through the markdown unchanged.

type InlineSeg =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; idOrKey: string; text: string }
  | { kind: 'task'; idOrKey: string; text: string }
  | { kind: 'bold'; children: InlineSeg[] }
  | { kind: 'italic'; marker?: '*' | '_'; children: InlineSeg[] }
  | { kind: 'underline'; children: InlineSeg[] }
  | { kind: 'link'; url: string; label: string; raw: boolean; start: number; end: number };

const MENTION_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(59,130,246,0.14)',
  color: '#2563eb',
  borderRadius: 4,
  padding: '0 3px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};

const TASK_STYLE: React.CSSProperties = {
  color: '#3b82f6',
  fontFamily: 'ui-monospace, monospace',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const LINK_STYLE: React.CSSProperties = {
  color: '#3b82f6',
  textDecoration: 'underline',
};

const MARKER_STYLE: React.CSSProperties = { color: 'rgba(138,143,163,0.72)' };

/**
 * Task-key anchor that matches only real, active workspace prefixes: `HUM-14` is a chip,
 * a random `MX-100` is not. Empty body means no workspaces are known yet → never match.
 */
function taskAnchorRe(keys: string[]): RegExp {
  const body = taskKeyBody(keys);
  if (body === '') return /(?!x)x/;
  return new RegExp(`^(${body})(?![\\w-])`);
}

const RAW_URL_RE = /^(?:https?:\/\/|www\.)[^\s<>[\]"()]+/i;

/** Same resolution as `markdown.tsx`: longest user name that prefixes the token. */
function resolveMention(nameToken: string, mentions: User[]): User | null {
  let best: User | null = null;
  for (const u of mentions) {
    if (u.name.length > nameToken.length) continue;
    if (nameToken.slice(0, u.name.length).toLowerCase() !== u.name.toLowerCase()) continue;
    if (!best || u.name.length > best.name.length) best = u;
  }
  return best;
}

/** Next single `ch` that isn't part of a doubled pair (`chch`). */
function findSingleMarker(source: string, from: number, ch: string): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] !== ch) continue;
    if (source[j - 1] === ch || source[j + 1] === ch) continue;
    return j;
  }
  return -1;
}

/**
 * Recursive inline parser. Emits nested segments for bold/italic/underline, plus
 * mention chips (longest name prefix), task keys and links. Markers are consumed —
 * children text excludes them — so the DOM never needs to re-read marker characters.
 */
function parseInline(
  source: string,
  from: number,
  to: number,
  mentions: User[],
  ids: Set<string>,
  taskRe: RegExp
): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let i = from;
  while (i < to) {
    // underline <u>…</u>
    if (source.startsWith('<u>', i)) {
      const close = source.indexOf('</u>', i + 3);
      if (close >= 0 && close < to) {
        const children = parseInline(source, i + 3, close, mentions, ids, taskRe);
        segs.push({ kind: 'underline', children });
        i = close + 4;
        continue;
      }
      segs.push({ kind: 'text', text: '<' });
      i += 1;
      continue;
    }
    // bold **…** (try before single *)
    if (source.startsWith('**', i)) {
      const close = source.indexOf('**', i + 2);
      if (close >= 0 && close < to) {
        const children = parseInline(source, i + 2, close, mentions, ids, taskRe);
        segs.push({ kind: 'bold', children });
        i = close + 2;
        continue;
      }
      segs.push({ kind: 'text', text: '*' });
      i += 1;
      continue;
    }
    // italic *…*
    if (source[i] === '*') {
      const close = findSingleMarker(source, i + 1, '*');
      if (close > i && close < to) {
        const children = parseInline(source, i + 1, close, mentions, ids, taskRe);
        segs.push({ kind: 'italic', marker: '*', children });
        i = close + 1;
        continue;
      }
    }
    // italic _…_ (flanking guard so words like foo_bar are left alone)
    if (source[i] === '_') {
      const prevOk = i === from || !/[\w]/.test(source[i - 1]);
      const nextOk = i + 1 < to && !/[\s_]/.test(source[i + 1]);
      if (prevOk && nextOk) {
        const close = findClosingUnderscore(source, i + 1, to);
        if (close > i && close < to) {
          const children = parseInline(source, i + 1, close, mentions, ids, taskRe);
          segs.push({ kind: 'italic', marker: '_', children });
          i = close + 1;
          continue;
        }
      }
    }
    // link [label](url)
    if (source[i] === '[') {
      const m = /^\[([^\]\n]*)\]\(([^()\s]+)\)/.exec(source.slice(i));
      if (m) {
        segs.push({ kind: 'link', url: m[2], label: m[1], raw: false, start: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }
    // mention
    if (source[i] === '@') {
      const m = /^@([A-Za-z0-9_.' -]{1,64})/.exec(source.slice(i));
      if (m) {
        const nameToken = m[1];
        const best = resolveMention(nameToken, mentions);
        if (best) {
          segs.push({ kind: 'mention', idOrKey: best.id, text: `@${best.name}` });
          ids.add(best.id);
          i += 1 + best.name.length;
          continue;
        }
        // Unresolved "@…": keep as plain text so nothing is dropped, but consume the
        // whole token so a lone "@" can't starve the parser.
        segs.push({ kind: 'text', text: source.slice(i, i + 1 + nameToken.length) });
        i += 1 + nameToken.length;
        continue;
      }
    }
    // task key, only at a fresh boundary
    if ((i === from || !/[\w-]/.test(source[i - 1])) && /[A-Z0-9]/.test(source[i]) && source[i] !== '0') {
      const m = taskRe.exec(source.slice(i));
      if (m) {
        const tok = m[1];
        segs.push({ kind: 'task', idOrKey: tok, text: tok });
        i += tok.length;
        continue;
      }
    }
    // bare URL auto-linkify
    if (i === from || /[\s(>]/.test(source[i - 1])) {
      const m = RAW_URL_RE.exec(source.slice(i));
      if (m) {
        const url = m[0].replace(/[.,;:!?]+$/, '');
        if (url) {
          segs.push({ kind: 'link', url, label: url, raw: true, start: i, end: i + url.length });
          i += url.length;
          continue;
        }
      }
    }
    // plain text run
    let j = i;
    while (j < to) {
      const ch = source[j];
      if (ch === '*' || ch === '<' || ch === '[' || ch === '@') break;
      if (ch === '_') {
        const prevOk = j === from || !/[\w]/.test(source[j - 1]);
        if (prevOk) break;
      }
      if ((/[\s(>]/.test(source[j - 1] ?? '')) && (source.startsWith('https://', j) || source.startsWith('http://', j) || source.startsWith('www.', j))) break;
      if ((j === from || !/[\w-]/.test(source[j - 1])) && /[A-Z0-9]/.test(source[j]) && source[j] !== '0' && taskRe.test(source.slice(j))) break;
      j++;
    }
    if (j === i) j = i + 1;
    segs.push({ kind: 'text', text: source.slice(i, j) });
    i = j;
  }
  return segs;
}

function findClosingUnderscore(source: string, from: number, to: number): number {
  for (let j = from; j < to; j++) {
    if (source[j] !== '_') continue;
    if (source[j - 1] === '_') continue;
    if (j === to - 1 || !/[\w]/.test(source[j + 1])) return j;
  }
  return -1;
}

function parseSegments(value: string, mentions: User[], taskRe: RegExp): { segs: InlineSeg[]; ids: string[] } {
  const ids = new Set<string>();
  const segs = parseInline(value, 0, value.length, mentions, ids, taskRe);
  return { segs, ids: [...ids] };
}

/** Reads back the editable div's structure (our styled spans + text nodes). */
function readSegments(el: HTMLElement): { segs: InlineSeg[]; ok: boolean } {
  return readChildren(el.childNodes);
}

function readChildren(nodes: NodeListOf<ChildNode>): { segs: InlineSeg[]; ok: boolean } {
  const segs: InlineSeg[] = [];
  let ok = true;
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      const last = segs[segs.length - 1];
      if (t === '') ok = false;
      else if (last && last.kind === 'text') last.text += t;
      else segs.push({ kind: 'text', text: t });
    } else if (node instanceof HTMLElement) {
      if (node.getAttribute('data-tmj-mk') !== null) continue; // marker text, dropped
      const mention = node.getAttribute('data-tmj-mention');
      if (mention) {
        segs.push({ kind: 'mention', idOrKey: mention, text: node.textContent ?? '' });
        continue;
      }
      const task = node.getAttribute('data-tmj-task');
      if (task) {
        segs.push({ kind: 'task', idOrKey: task, text: node.textContent ?? '' });
        continue;
      }
      if (node.getAttribute('data-tmj-link') !== null || node.getAttribute('data-tmj-rawlink') !== null) {
        segs.push({
          kind: 'link',
          url: node.dataset.url ?? '',
          label: node.textContent ?? '',
          raw: node.hasAttribute('data-tmj-rawlink'),
          start: Number(node.dataset.linkStart ?? 0),
          end: Number(node.dataset.linkEnd ?? 0),
        });
        continue;
      }
      let formatHandled = false;
      for (const kind of ['bold', 'italic', 'underline'] as const) {
        if (node.getAttribute(`data-tmj-${kind}`) === null) continue;
        formatHandled = true;
        const r = readChildren(node.childNodes);
        if (!r.ok) ok = false;
        segs.push({ kind, children: r.segs } as InlineSeg);
        break;
      }
      if (!formatHandled) ok = false;
    } else {
      ok = false;
    }
  }
  return { segs, ok };
}

function sameSegments(a: InlineSeg[], b: InlineSeg[]): boolean {
  if (a.length !== b.length) return false;
  for (let n = 0; n < a.length; n++) {
    const x = a[n];
    const y = b[n];
    if (x.kind !== y.kind) return false;
    switch (x.kind) {
      case 'text':
        if (y.kind !== 'text' || x.text !== y.text) return false;
        break;
      case 'mention':
      case 'task':
        if ((y.kind !== 'mention' && y.kind !== 'task') || x.idOrKey !== y.idOrKey || x.text !== y.text) return false;
        break;
      case 'link':
        if (y.kind !== 'link' || x.url !== y.url || x.label !== y.label || !!x.raw !== !!y.raw || x.start !== y.start || x.end !== y.end) return false;
        break;
      default:
        if (y.kind !== 'bold' && y.kind !== 'italic' && y.kind !== 'underline') return false;
        if (!x.children || !y.children || !sameSegments(x.children, y.children)) return false;
    }
  }
  return true;
}

function markerSpan(doc: Document, text: string): HTMLSpanElement {
  const s = doc.createElement('span');
  s.setAttribute('data-tmj-mk', '');
  s.textContent = text;
  Object.assign(s.style, MARKER_STYLE);
  return s;
}

function appendSegment(parent: HTMLElement, s: InlineSeg) {
  const doc = parent.ownerDocument;
  switch (s.kind) {
    case 'text':
      parent.appendChild(doc.createTextNode(s.text));
      return;
    case 'mention': {
      const span = doc.createElement('span');
      span.setAttribute('data-tmj-mention', s.idOrKey);
      span.textContent = s.text;
      Object.assign(span.style, MENTION_STYLE);
      parent.appendChild(span);
      return;
    }
    case 'task': {
      const span = doc.createElement('span');
      span.setAttribute('data-tmj-task', s.idOrKey);
      span.textContent = s.text;
      Object.assign(span.style, TASK_STYLE);
      parent.appendChild(span);
      return;
    }
    case 'bold':
    case 'italic':
    case 'underline': {
      let open: string;
      let close: string;
      if (s.kind === 'bold') {
        open = '**';
        close = '**';
      } else if (s.kind === 'italic') {
        open = s.marker ?? '*';
        close = open;
      } else {
        open = '<u>';
        close = '</u>';
      }
      parent.appendChild(markerSpan(doc, open));
      const inner = doc.createElement('span');
      inner.setAttribute(`data-tmj-${s.kind}`, '');
      if (s.kind === 'bold') inner.style.fontWeight = '650';
      else if (s.kind === 'italic') inner.style.fontStyle = 'italic';
      else inner.style.textDecoration = 'underline';
      for (const c of s.children) appendSegment(inner, c);
      parent.appendChild(inner);
      parent.appendChild(markerSpan(doc, close));
      return;
    }
    case 'link': {
      const a = doc.createElement('span');
      a.dataset.url = s.url;
      a.textContent = s.label;
      a.dataset.linkStart = String(s.start);
      a.dataset.linkEnd = String(s.end);
      a.tabIndex = 0;
      a.setAttribute('aria-label', `Link: ${s.label}`);
      Object.assign(a.style, LINK_STYLE);
      parent.appendChild(a);
      if (s.raw) a.setAttribute('data-tmj-rawlink', '');
      else {
        a.setAttribute('data-tmj-link', '');
        parent.insertBefore(markerSpan(doc, '['), a);
        parent.appendChild(markerSpan(doc, `](${s.url})`));
      }
      return;
    }
  }
}

function buildDOM(el: HTMLElement, segs: InlineSeg[]) {
  el.textContent = '';
  for (const s of segs) appendSegment(el, s);
}

// ------------------------------------------------------------------ formatting

interface Fmt {
  open: string;
  close: string;
}

/** Marker positions for a set of format markers, in source order with open/close parity. */
function markerPositions(value: string, fmts: Fmt[]): { i: number; isOpen: boolean }[] {
  const out: { i: number; isOpen: boolean; kind: string; parityExpr: boolean }[] = [];
  for (const fmt of fmts) {
    const kindKey = fmt.open === fmt.close ? fmt.open : `${fmt.open}→${fmt.close}`;
    if (fmt.open === fmt.close) {
      const step = fmt.open.length;
      let k = 0;
      while (k < value.length) {
        const idx = value.indexOf(fmt.open, k);
        if (idx < 0) break;
        if (step === 2) {
          out.push({ i: idx, isOpen: false, kind: kindKey, parityExpr: true });
        } else {
          if (value[idx - 1] !== fmt.open && value[idx + 1] !== fmt.open) out.push({ i: idx, isOpen: false, kind: kindKey, parityExpr: true });
        }
        k = idx + step;
      }
    } else {
      let k = 0;
      while (k < value.length) {
        const o = value.indexOf(fmt.open, k);
        const c = value.indexOf(fmt.close, k);
        if (o < 0 && c < 0) break;
        if (o >= 0 && (c < 0 || o < c)) {
          out.push({ i: o, isOpen: true, kind: kindKey, parityExpr: false });
          k = o + fmt.open.length;
        } else if (c >= 0) {
          out.push({ i: c, isOpen: false, kind: kindKey, parityExpr: false });
          k = c + fmt.close.length;
        } else break;
      }
    }
  }
  out.sort((a, b) => a.i - b.i || (a.isOpen ? 1 : 0) - (b.isOpen ? 1 : 0));
  // Open/close parity is per marker kind (so `*` and `_` italics never cross-match);
  // explicit pairs (underline) keep their real polarity.
  const parity = new Map<string, boolean>();
  for (const m of out) {
    if (!m.parityExpr) continue;
    m.isOpen = !(parity.get(m.kind) ?? false);
    parity.set(m.kind, m.isOpen);
  }
  return out;
}

function enclosingPair(value: string, markers: { i: number; isOpen: boolean }[], pos: number): { openAt: number; closeAt: number } | null {
  const stack: number[] = [];
  for (const m of markers) {
    if (m.isOpen) {
      stack.push(m.i);
      continue;
    }
    const o = stack.pop();
    if (o === undefined) continue;
    if (pos >= o && pos <= m.i) return { openAt: o, closeAt: m.i };
  }
  return null;
}

/** Character offsets of the current selection in the editor's plain text. */
function getSelOffsets(el: HTMLElement): { start: number; end: number } | null {
  const selection = readEditorSelection(el);
  return selection ? { start: Math.min(selection.anchor, selection.head), end: Math.max(selection.anchor, selection.head) } : null;
}

/**
 * Toggles an inline format (bold/italic/underline) over the selection or caret by
 * editing the raw markdown text: unwraps when already inside/at the format, wraps
 * otherwise (collapsed caret inserts empty markers so the next typed run is styled).
 */
function toggleInline(
  value: string,
  selStart: number,
  selEnd: number,
  wrap: Fmt,
  detect: Fmt[]
): { value: string; caret: number } | null {
  const markers = markerPositions(value, detect);
  const openLen = wrap.open.length;
  const closeLen = wrap.close.length;
  if (selEnd <= selStart) {
    const pos = Math.min(selStart, value.length);
    const pr = enclosingPair(value, markers, pos);
    if (pr) {
      const next = value.slice(0, pr.openAt) + value.slice(pr.openAt + openLen, pr.closeAt) + value.slice(pr.closeAt + closeLen);
      return { value: next, caret: Math.max(pr.openAt + openLen, pos - openLen) };
    }
    const marker = wrap.open + wrap.close;
    const next = value.slice(0, pos) + marker + value.slice(pos);
    return { value: next, caret: pos + openLen };
  }
  const start = Math.min(selStart, value.length);
  const end = Math.min(selEnd, value.length);
  const pr = enclosingPair(value, markers, start);
  if (pr && pr.closeAt >= end) {
    const next = value.slice(0, pr.openAt) + value.slice(pr.openAt + openLen, pr.closeAt) + value.slice(pr.closeAt + closeLen);
    return { value: next, caret: Math.max(pr.openAt + openLen, end - openLen) };
  }
  const next = value.slice(0, start) + wrap.open + value.slice(start, end) + wrap.close + value.slice(end);
  return { value: next, caret: end + openLen + closeLen };
}

function restoreCaret(el: HTMLElement, offset: number) {
  restoreEditorSelection(el, { anchor: offset, head: offset });
}

/** Mirrors the server's mention token, anchored to the caret. */
function activeToken(
  value: string,
  caret: number,
  mentions: User[]
): { at: number; token: string } | null {
  const before = value.slice(0, Math.min(caret, value.length));
  const m = /(^|[\s(>])@([A-Za-z0-9_.' -]{0,64})$/.exec(before);
  if (!m) return null;
  const token = m[2] ?? '';
  if (token.includes('\n')) return null;
  if (token.split(' ').length > 3) return null;
  const lower = token.toLowerCase();
  for (const p of mentions) {
    const n = p.name.toLowerCase();
    if (lower === n || lower.startsWith(`${n} `)) return null; // already resolved
  }
  return { at: m.index + (m[1] ?? '').length, token };
}

// ------------------------------------------------------------------ web editor

/**
 * Web-only Google-doc-style editor: a plain `contentEditable` div kept structurally
 * pristine by React (it never owns the children), with the caret preserved across the
 * imperative re-decoration pass.
 */
function WebRichEditor({
  value,
  onChangeText,
  mentions = [],
  onMentionIdsChange,
  placeholder,
  className,
  editable = true,
  autoFocus,
  singleLine,
  onSubmit,
  suggestionsPlacement = 'above',
  onBlurCommit,
}: RichDocEditorProps) {
  const { client } = useAuth();
  const router = useRouter();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const valueRef = React.useRef(value);
  const previousProp = React.useRef(value);
  const emittedValues = React.useRef<string[]>([]);
  const [history] = React.useState(() => new EditorHistory(value));
  const selectionRef = React.useRef<EditorSelection>({ anchor: value.length, head: value.length });
  const beforeInput = React.useRef<{ snapshot: EditorSnapshot; kind: string } | null>(null);
  const composing = React.useRef(false);
  const compositionBefore = React.useRef<EditorSnapshot | null>(null);
  const historyInputHandled = React.useRef(false);
  const readyRef = React.useRef(false);
  const lastIdsRef = React.useRef<string[]>([]);
  const workspaceKeys = useWorkspaceKeys();
  const [caret, setCaret] = React.useState(value.length);
  const [focused, setFocused] = React.useState(false);
  const [results, setResults] = React.useState<User[]>([]);
  const [dismissed, setDismissed] = React.useState(false);
  const [hoverLink, setHoverLink] = React.useState<{
    left: number;
    top: number;
    url: string;
    label: string;
    start: number;
    end: number;
    raw: boolean;
    above: boolean;
  } | null>(null);
  const hoverLinkRef = React.useRef<HTMLElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const hideLinkTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveHistoryRef = React.useRef<(redo: boolean) => void>(() => {});

  function cancelLinkHide() {
    if (hideLinkTimer.current) clearTimeout(hideLinkTimer.current);
    hideLinkTimer.current = null;
  }
  function closeLink() {
    cancelLinkHide(); hoverLinkRef.current = null; setHoverLink(null);
  }
  function scheduleLinkHide() {
    cancelLinkHide();
    hideLinkTimer.current = setTimeout(() => {
      if (popoverRef.current?.contains(document.activeElement)) return;
      hoverLinkRef.current = null; setHoverLink(null);
    }, 400);
  }

  const taskRe = React.useMemo(() => taskAnchorRe(workspaceKeys), [workspaceKeys]);

  const active = React.useMemo(() => activeToken(value, caret, mentions), [value, caret, mentions]);
  const token = active?.token.trim() ?? '';
  const open = !!active && !dismissed && (results.length > 0 || token.length === 0);

  React.useEffect(() => {
    const ids = parseSegments(value, mentions, taskRe).ids;
    if (ids.length !== lastIdsRef.current.length || ids.some((id, i) => id !== lastIdsRef.current[i])) {
      lastIdsRef.current = ids;
      onMentionIdsChange?.(ids);
    }
  }, [value, mentions, taskRe, onMentionIdsChange]);

  // Acknowledge controlled-value echoes without overwriting newer input. Only a genuine
  // external value (draft restore, successful submit, document update) resets the source.
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!readyRef.current) {
      buildDOM(el, parseSegments(value, mentions, taskRe).segs);
      readyRef.current = true;
      return;
    }
    let external = false;
    if (previousProp.current !== value) {
      previousProp.current = value;
      const echo = emittedValues.current.lastIndexOf(value);
      if (echo >= 0) emittedValues.current.splice(0, echo + 1);
      else if (value !== valueRef.current) {
        // Title auto-save trims trailing spaces. Do not discard the typing history
        // for that server acknowledgement while the person is still editing.
        const normalizedEcho = el.contains(document.activeElement) && value === valueRef.current.trimEnd();
        if (!normalizedEcho) {
          valueRef.current = value; history.reset(value); emittedValues.current = [];
          selectionRef.current = { anchor: value.length, head: value.length };
          external = true;
        }
      }
    }
    if (composing.current) return;
    const target = parseSegments(valueRef.current, mentions, taskRe);
    const read = readSegments(el);
    if (external || !read.ok || !sameSegments(target.segs, read.segs)) {
      const selection = external ? selectionRef.current : readEditorSelection(el) ?? selectionRef.current;
      closeLink();
      buildDOM(el, target.segs);
      if (el.contains(document.activeElement)) restoreEditorSelection(el, selection);
    }
  }, [value, mentions, taskRe, history]);

  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const capture = (event: InputEvent) => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        historyInputHandled.current = !event.cancelable;
        moveHistoryRef.current(event.inputType === 'historyRedo');
        return;
      }
      beforeInput.current = { snapshot: { text: valueRef.current, selection: readEditorSelection(el) ?? selectionRef.current }, kind: event.inputType };
    };
    el.addEventListener('beforeinput', capture);
    return () => el.removeEventListener('beforeinput', capture);
  }, []);

  React.useEffect(() => {
    const el = rootRef.current;
    if (autoFocus && el) {
      el.focus();
      restoreCaret(el, value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced people search for the active token.
  React.useEffect(() => {
    if (!active || token.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { items } = await client.searchUsers({ q: token, limit: 8 });
        if (!cancelled) setResults(items);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, active, token]);

  // Link and toolbar share hover ownership. Padding bridges the small visual gap;
  // delayed close also covers diagonal pointer movement and keyboard focus.
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const linkSel = 'span[data-tmj-link], span[data-tmj-rawlink]';
    const onOver = (e: MouseEvent | FocusEvent) => {
      const t = e.target as HTMLElement | null;
      const link = t && t.closest ? t.closest<HTMLElement>(linkSel) : null;
      if (!link) return;
      cancelLinkHide();
      if (hoverLinkRef.current === link) return;
      hoverLinkRef.current = link;
      const r = link.getBoundingClientRect();
      const wrap = el.parentElement?.getBoundingClientRect() ?? r;
      let top = 0;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) top = Math.max(top, parent.getBoundingClientRect().top);
      }
      const above = r.top - top >= 42;
      setHoverLink({
        left: Math.max(0, Math.min(r.left - wrap.left, wrap.width - 150)),
        top: (above ? r.top : r.bottom) - wrap.top,
        above,
        url: link.dataset.url ?? '',
        label: link.textContent ?? '',
        start: Number(link.dataset.linkStart ?? 0),
        end: Number(link.dataset.linkEnd ?? 0),
        raw: link.hasAttribute('data-tmj-rawlink'),
      });
    };
    const onOut = (e: MouseEvent | FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && (hoverLinkRef.current?.contains(next) || popoverRef.current?.contains(next))) return;
      scheduleLinkHide();
    };
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !hoverLinkRef.current?.contains(target)) closeLink();
    };
    const onScroll = () => closeLink();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && hoverLinkRef.current && (el.contains(event.target as Node) || popoverRef.current?.contains(event.target as Node))) {
        event.preventDefault(); event.stopPropagation(); closeLink();
      }
    };
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseout', onOut);
    el.addEventListener('focusin', onOver);
    el.addEventListener('focusout', onOut);
    document.addEventListener('pointerdown', onOutside);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      cancelLinkHide();
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseout', onOut);
      el.removeEventListener('focusin', onOver);
      el.removeEventListener('focusout', onOut);
      document.removeEventListener('pointerdown', onOutside);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onEscape, true);
    };
  }, []);

  function publish(next: string) {
    valueRef.current = next;
    emittedValues.current.push(next);
    if (emittedValues.current.length > 100) emittedValues.current.shift();
    onChangeText(next);
  }

  function snapshot(): EditorSnapshot {
    return { text: valueRef.current, selection: rootRef.current ? readEditorSelection(rootRef.current) ?? selectionRef.current : selectionRef.current };
  }

  function renderSource(text: string, selection: EditorSelection, focus = false) {
    const el = rootRef.current;
    if (!el) return;
    closeLink();
    buildDOM(el, parseSegments(text, mentions, taskRe).segs);
    if (focus) el.focus({ preventScroll: true });
    restoreEditorSelection(el, selection);
    selectionRef.current = selection;
    setCaret(selection.head);
  }

  function writeExternal(next: string, caret: number, kind = 'command') {
    const selection = { anchor: caret, head: caret };
    history.record(snapshot(), { text: next, selection }, kind);
    renderSource(next, selection, true);
    beforeInput.current = null;
    publish(next);
  }

  function moveHistory(redo: boolean) {
    if (!editable || composing.current) return;
    const current = snapshot();
    const next = redo ? history.redo(current.selection) : history.undo(current.selection);
    if (!next) return;
    renderSource(next.text, next.selection, true);
    beforeInput.current = null;
    setDismissed(true);
    publish(next.text);
  }
  moveHistoryRef.current = moveHistory;

  function replaceSelection(text: string, kind: string) {
    const current = snapshot();
    const start = Math.min(current.selection.anchor, current.selection.head);
    const end = Math.max(current.selection.anchor, current.selection.head);
    writeExternal(current.text.slice(0, start) + text + current.text.slice(end), start + text.length, kind);
  }

  function applyLinkEdit() {
    const lnk = hoverLink;
    if (!editable || !lnk) return;
    cancelLinkHide();
    const nextUrl = window.prompt('Link URL', lnk.url);
    if (nextUrl === null || nextUrl.trim() === '' || nextUrl.trim() === lnk.url) {
      closeLink();
      return;
    }
    const text = valueRef.current;
    const url = nextUrl.trim();
    const replacement = lnk.raw ? url : `[${lnk.label}](${url})`;
    const next = text.slice(0, lnk.start) + replacement + text.slice(lnk.end);
    writeExternal(next, lnk.start + replacement.length);
    closeLink();
  }

  function removeLink() {
    const lnk = hoverLink;
    if (!editable || !lnk) return;
    const text = valueRef.current;
    const next = lnk.raw
      ? text.slice(0, lnk.start) + text.slice(lnk.end)
      : text.slice(0, lnk.start) + lnk.label + text.slice(lnk.end);
    writeExternal(next, lnk.start + lnk.label.length);
    closeLink();
  }

  function handleInput(event?: React.FormEvent<HTMLDivElement>) {
    const el = rootRef.current;
    if (!el) return;
    if (historyInputHandled.current) {
      historyInputHandled.current = false;
      renderSource(valueRef.current, selectionRef.current);
      return;
    }
    // Pasting or browser input can introduce <br>/<div> line boundaries. textContent
    // drops those boundaries and silently destroys tables/lists/fences. Read rendered
    // plain text once, then normalize back to our flat, decorated text-node structure.
    const text = editableText(el);
    const selection = readEditorSelection(el) ?? { anchor: text.length, head: text.length };
    const before = beforeInput.current?.snapshot ?? { text: valueRef.current, selection: selectionRef.current };
    const kind = beforeInput.current?.kind ?? (event?.nativeEvent as InputEvent | undefined)?.inputType ?? 'input';
    beforeInput.current = null;
    selectionRef.current = selection;
    setCaret(selection.head);
    readyRef.current = true;
    if (!composing.current) {
      history.record(before, { text, selection }, kind);
      const target = parseSegments(text, mentions, taskRe);
      const read = readSegments(el);
      closeLink();
      if (!read.ok || !sameSegments(target.segs, read.segs)) {
        buildDOM(el, target.segs);
        restoreEditorSelection(el, selection);
      }
    }
    setDismissed(false);
    publish(text);
  }

  function insert(user: User) {
    if (!active) return;
    const inserted = `@${user.name} `;
    const source = valueRef.current;
    const next = source.slice(0, active.at) + inserted + source.slice(Math.min(caret, source.length));
    const nextCaret = active.at + inserted.length;
    writeExternal(next, nextCaret, 'mention');
    setResults([]);
    setTimeout(() => {
      rootRef.current?.focus();
    }, 0);
  }

  return (
    <View className="relative">
      <div
        ref={rootRef}
        contentEditable={editable}
        role="textbox"
        aria-multiline={!singleLine}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ''}
        aria-label={placeholder}
        className={cn(
          'text-foreground focus-visible:ring-ring/50 focus-visible:border-ring min-h-16 w-full break-words rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm shadow-black/5 outline-none',
          'whitespace-pre-wrap focus-visible:ring-[3px]',
          editable ? '' : 'opacity-50',
          className
        )}
        onInput={handleInput}
        onPointerDown={() => history.breakGroup()}
        onCompositionStart={() => {
          composing.current = true;
          compositionBefore.current = snapshot();
          history.breakGroup(); closeLink();
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (compositionBefore.current) beforeInput.current = { snapshot: compositionBefore.current, kind: 'composition' };
          compositionBefore.current = null;
          handleInput();
        }}
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          const chip = target?.closest?.('[data-tmj-task]');
          if (!chip) return;
          const tok = chip.getAttribute('data-tmj-task');
          if (!tok) return;
          e.preventDefault();
          e.stopPropagation();
          const parsed = splitTaskKey(tok);
          if (parsed) router.push(`/w/${parsed.workspaceKey}/t/${parsed.number}`);
        }}
        onSelect={() => {
          const selection = rootRef.current ? readEditorSelection(rootRef.current) : null;
          if (selection) {
            selectionRef.current = selection;
            setCaret(selection.head);
          }
        }}
        onKeyDown={(e) => {
          if (composing.current || e.nativeEvent.isComposing) return;
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
            e.preventDefault(); e.stopPropagation();
            moveHistory(key === 'y' || e.shiftKey);
            return;
          }
          if (/^(Arrow|Home|End|Page)/.test(e.key)) history.breakGroup();
          if (e.key === 'Escape') {
            setDismissed(true);
            return;
          }
          const fmtKey = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey ? e.key.toLowerCase() : '';
          if (fmtKey === 'b' || fmtKey === 'i' || fmtKey === 'u') {
            e.preventDefault();
            const el = rootRef.current;
            if (!el || !editable) return;
            const text = valueRef.current;
            const sel = getSelOffsets(el);
            if (!sel) return;
            const wrap: Fmt =
              fmtKey === 'b'
                ? { open: '**', close: '**' }
                : fmtKey === 'i'
                  ? { open: '*', close: '*' }
                  : { open: '<u>', close: '</u>' };
            const detect: Fmt[] =
              fmtKey === 'i'
                ? [{ open: '*', close: '*' }, { open: '_', close: '_' }]
                : [wrap];
            const res = toggleInline(text, sel.start, sel.end, wrap, detect);
            if (res) writeExternal(res.value, res.caret);
            return;
          }
          if (e.key === 'Enter' && singleLine) {
            e.preventDefault();
            const el = rootRef.current;
            el?.blur();
            onSubmit?.(valueRef.current);
            return;
          }
          if (e.key === 'Enter') {
            // Keep the editable flat (no browser <div> blocks) so decoration stays canonical.
            e.preventDefault();
            if (editable) replaceSelection('\n', 'insertLineBreak');
            return;
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          if (!editable) return;
          const el = rootRef.current;
          const text = e.clipboardData.getData('text/plain');
          if (el) {
            const sel = getSelOffsets(el);
            const url = text.trim();
            const full = valueRef.current;
            if (sel && sel.end > sel.start && /^(https?:\/\/|www\.)/i.test(url)) {
              // Paste a URL onto a selection → apply as a link to the highlighted text.
              const label = full.slice(sel.start, sel.end);
              const next = full.slice(0, sel.start) + `[${label}](${url})` + full.slice(sel.end);
              writeExternal(next, sel.start + label.length + url.length + 4, 'paste');
              return;
            }
          }
          replaceSelection(text, 'paste');
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          history.breakGroup();
          setFocused(false);
          onBlurCommit?.(valueRef.current);
        }}
      />
      {value === '' && !focused ? (
        <div
          className="text-muted-foreground pointer-events-none absolute select-none"
          style={{ top: 8, left: 12, fontSize: 14.4 }}>
          {placeholder}
        </div>
      ) : null}
      {open ? (
        <div
          className={`border-border bg-popover absolute left-0 z-50 w-72 overflow-hidden rounded-md border shadow-md shadow-black/10 ${
            suggestionsPlacement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}>
          {token.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[#8a8fa3]">Keep typing to find people…</div>
          ) : (
            <div style={{ maxHeight: 224, overflowY: 'auto' }}>
              {results.map((user) => (
                <div
                  key={user.id}
                  role="button"
                  tabIndex={-1}
                  className="hover:bg-accent"
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    cursor: 'pointer',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(user);
                  }}>
                  <UserAvatar user={user} className="size-6" textClassName="text-[10px]" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="text-sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user.name}
                    </div>
                    <div className="text-[#8a8fa3]" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user.email}
                    </div>
                  </div>
                  {user.is_agent ? (
                    <div className="text-[#8a8fa3]" style={{ fontSize: 10 }}>
                      agent
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {hoverLink && editable ? (
        <div
          ref={popoverRef}
          role="toolbar"
          aria-label="Link actions"
          className="absolute z-[60]"
          style={{ left: hoverLink.left, top: hoverLink.top, transform: hoverLink.above ? 'translateY(-100%)' : undefined,
            paddingBottom: hoverLink.above ? 6 : 0, paddingTop: hoverLink.above ? 0 : 6 }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={cancelLinkHide}
          onMouseLeave={scheduleLinkHide}
          onFocus={cancelLinkHide}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) scheduleLinkHide(); }}>
          <div className="border-border bg-popover flex items-center gap-1 rounded-md border px-1 py-1 shadow-md shadow-black/10">
          <button
            type="button"
            aria-label="Edit link"
            className="text-foreground hover:bg-accent rounded px-2 py-1 text-xs"
            onClick={applyLinkEdit}>
            Edit
          </button>
          <button
            type="button"
            aria-label="Remove link"
            className="text-foreground hover:bg-accent rounded px-2 py-1 text-xs"
            onClick={removeLink}>
            Remove
          </button>
          </div>
        </div>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ native

function NativeEditor({
  value,
  onChangeText,
  placeholder,
  className,
  editable,
  autoFocus,
  singleLine,
  onBlurCommit,
}: RichDocEditorProps) {
  return (
    <TextInput
      value={value}
      multiline={!singleLine}
      onChangeText={onChangeText}
      placeholder={placeholder}
      className={className}
      editable={editable}
      autoFocus={autoFocus}
      onBlur={() => onBlurCommit?.(value)}
    />
  );
}

/** Platform-aware rich editor: contenteditable (web) or plain textarea (native). */
export function RichEditor(props: RichDocEditorProps) {
  if (Platform.OS === 'web') return <WebRichEditor {...props} />;
  return <NativeEditor {...props} />;
}

export { WebRichEditor };
