/**
 * Browser contenteditable inserts block elements for pasted newlines. textContent loses
 * them; innerText double-counts empty <div><br></div> lines. Read the editable's logical
 * lines instead, preserving Markdown whitespace and empty lines exactly.
 */
export function editableText(root: Node): string {
  const isBlock = (node: Node) => node.nodeType === 1 && /^(DIV|P|LI)$/.test((node as Element).tagName);
  function read(node: Node, placeholder = false): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType === 1 && (node as Element).tagName === 'BR') return '\n';
    const children = Array.from(node.childNodes);
    if (placeholder && children.length === 1 && (children[0] as Element).tagName === 'BR') return '';
    let value = '';
    let previousBlock = false;
    for (const [index, child] of children.entries()) {
      const block = isBlock(child);
      if (index > 0 && (block || previousBlock)) value += '\n';
      value += read(child, block);
      previousBlock = block;
    }
    return value;
  }
  return read(root, true);
}
