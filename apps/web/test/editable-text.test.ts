import { describe, expect, it } from 'vitest';
import { editableText } from '../lib/editable-text';

// Minimal DOM fixtures captured from Chromium multiline paste. The reader only needs
// nodeType/tagName/childNodes/textContent, so these tests don't need a browser environment.
const text = (value: string) => ({ nodeType: 3, textContent: value, childNodes: [] }) as unknown as Node;
const element = (tagName: string, ...childNodes: Node[]) => ({ nodeType: 1, tagName, childNodes }) as unknown as Node;

describe('Markdown composer source preservation', () => {
  it('keeps blank lines and table row separators from browser block markup', () => {
    const dom = element('DIV', text('# Heading'), element('DIV', element('BR')),
      element('DIV', text('| Part | Count |')), element('DIV', text('| --- | ---: |')),
      element('DIV', text('| Bolt | 12 |')), element('DIV', element('BR')));
    expect(editableText(dom)).toBe('# Heading\n\n| Part | Count |\n| --- | ---: |\n| Bolt | 12 |\n');
  });
  it('keeps literal Markdown markers, indentation and fenced-code whitespace', () => {
    const dom = element('DIV', text('```text\n  indented\n```\n\n'),
      element('SPAN', text('**')), element('SPAN', text('bold')), element('SPAN', text('**')));
    expect(editableText(dom)).toBe('```text\n  indented\n```\n\n**bold**');
  });
  it('ignores the empty-editor placeholder but preserves a real inline break', () => {
    expect(editableText(element('DIV', element('BR')))).toBe('');
    expect(editableText(element('DIV', text('a'), element('BR'), text('b')))).toBe('a\nb');
  });
});
