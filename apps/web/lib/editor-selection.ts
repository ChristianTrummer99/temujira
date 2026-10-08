import { editableText } from './editable-text';
import type { EditorSelection } from './editor-history';

/** Logical source offsets, including browser-inserted line boundaries. */
export function readEditorSelection(root: HTMLElement): EditorSelection | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const offset = (node: Node, position: number) => {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, position);
    return editableText(range.cloneContents()).length;
  };
  return { anchor: offset(selection.anchorNode, selection.anchorOffset), head: offset(selection.focusNode, selection.focusOffset) };
}

/** After decoration, source characters live in text nodes, including Markdown markers. */
export function restoreEditorSelection(root: HTMLElement, offsets: EditorSelection) {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const point = (offset: number): [Node, number] => {
    let remaining = Math.max(0, Math.min(offset, root.textContent?.length ?? 0));
    const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
    let node: Node | null;
    let last: Node = root;
    while ((node = walker.nextNode())) {
      last = node;
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) return [node, remaining];
      remaining -= length;
    }
    return [last, last === root ? 0 : last.textContent?.length ?? 0];
  };
  const anchor = point(offsets.anchor), head = point(offsets.head);
  selection.setBaseAndExtent(anchor[0], anchor[1], head[0], head[1]);
}
