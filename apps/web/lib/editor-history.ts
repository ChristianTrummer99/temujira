export interface EditorSelection { anchor: number; head: number }
export interface EditorSnapshot { text: string; selection: EditorSelection }

const sameSelection = (a: EditorSelection, b: EditorSelection) => a.anchor === b.anchor && a.head === b.head;
const copy = (entry: EditorSnapshot): EditorSnapshot => ({ text: entry.text, selection: { ...entry.selection } });
const GROUPABLE = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward']);

/** Source-level history survives contenteditable decoration and preserves selections.
 * Commands/pastes/IME are separate steps; adjacent typing is grouped into short bursts. */
export class EditorHistory {
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  private current: EditorSnapshot;
  private last: { kind: string; at: number; selection: EditorSelection } | null = null;

  constructor(text: string) { this.current = { text, selection: { anchor: text.length, head: text.length } }; }
  reset(text: string) {
    this.past = []; this.future = []; this.last = null;
    this.current = { text, selection: { anchor: text.length, head: text.length } };
  }
  breakGroup() { this.last = null; }
  record(before: EditorSnapshot, after: EditorSnapshot, kind: string, at = Date.now()) {
    if (before.text !== this.current.text) this.reset(before.text);
    if (before.text === after.text) { this.current = copy(after); return; }
    const merge = GROUPABLE.has(kind) && this.last?.kind === kind && at - this.last.at < 750 &&
      before.selection.anchor === before.selection.head && sameSelection(before.selection, this.last.selection);
    if (!merge) this.past.push(copy(before));
    this.current = copy(after);
    this.future = [];
    this.last = { kind, at, selection: { ...after.selection } };
    // Bound both entry count and retained text for long Markdown messages.
    while (this.past.length > 100 || (this.past.length > 1 && this.past.reduce((n, s) => n + s.text.length, 0) > 2_000_000)) this.past.shift();
  }
  undo(selection: EditorSelection): EditorSnapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push({ text: this.current.text, selection: { ...selection } });
    this.current = copy(previous); this.breakGroup();
    return copy(previous);
  }
  redo(selection: EditorSelection): EditorSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ text: this.current.text, selection: { ...selection } });
    this.current = copy(next); this.breakGroup();
    return copy(next);
  }
}
