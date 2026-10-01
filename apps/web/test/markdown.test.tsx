import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownContent } from '../components/markdown-content.web';
import { MarkdownContent as NativeMarkdownContent } from '../components/markdown-content';
import { parseMarkdown, safeMarkdownUrl } from '../lib/markdown';
import type { User } from '@temujira/client';

// The design-system Slot ships Metro-transformed JSX. Exercise the native renderer
// against the real RN-web Text primitive in this Node-only structural test.
vi.mock('@/components/ui/text', async () => ({ Text: (await import('react-native')).Text }));

const options = {
  workspaceKeys: ['ENG'],
  mentionUsers: [{ id: 'user-ada', name: 'Ada Lovelace' }] as User[],
  onTaskPress: () => {},
};
const render = (source: string) => renderToStaticMarkup(<MarkdownContent {...options}>{source}</MarkdownContent>);

describe('Markdown across display surfaces', () => {
  it('renders GFM tables with alignment, escaped pipes and inline formatting', () => {
    const html = render('| Item | Count |\n| :--- | ---: |\n| **Bolt** \\| M6 | `12` |\n| [Spec](https://example.com) | ~~8~~ |');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('text-align:right');
    expect(html).toContain('<strong>Bolt</strong> | M6');
    expect(html).toContain('<code>12</code>');
    expect(html).toContain('<del>8</del>');
    expect(html).toContain('aria-label="Markdown table"');
  });

  it('keeps ordered/nested lists and disabled task-list checkboxes', () => {
    const html = render('3. Third\n4. Fourth\n   - Nested\n\n- [x] Done\n- [ ] Next');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<ul>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain('disabled=""');
  });

  it('supports every heading, quotes, rules, images, reference links and GFM autolinks', () => {
    const html = render('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\n> Quote\n\n---\n\n![Diagram](https://example.com/chart.png)\n\n[Manual][spec]\n\n[spec]: https://example.com/manual\n\nhttps://example.com/plain');
    for (let i = 1; i <= 6; i++) expect(html).toContain(`<h${i}>`);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<hr/>');
    expect(html).toContain('alt="Diagram"');
    expect(html).toContain('href="https://example.com/manual"');
    expect(html).toContain('href="https://example.com/plain"');
  });

  it('preserves code and existing links instead of rewriting Markdown syntax', () => {
    const html = render('ENG-42 @Ada Lovelace\n\n[ENG-42 @Ada Lovelace](https://example.com/ENG-42)\n\n`ENG-42 @Ada Lovelace`\n\n~~~text\nENG-42 @Ada Lovelace\n  preserve indent\n~~~');
    expect(html.match(/class="tmj-markdown-task"/g)).toHaveLength(1);
    expect(html.match(/class="tmj-markdown-mention"/g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/ENG-42"');
    expect(html).toContain('<code>ENG-42 @Ada Lovelace</code>');
    expect(html).toContain('ENG-42 @Ada Lovelace\n  preserve indent\n</code></pre>');
  });

  it('keeps underline support without enabling uploaded HTML or unsafe URLs', () => {
    const html = render('<u>under **bold**</u><br>next\n\n<script>window.bad = true</script>\n\n[x](javascript:alert%281%29)');
    expect(html).toContain('<u>under <strong>bold</strong></u><br/>\nnext');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
    expect(safeMarkdownUrl('java\tscript:alert(1)')).toBe('');
    expect(safeMarkdownUrl('data:text/html,bad')).toBe('');
    expect(safeMarkdownUrl('mailto:reader@example.com')).toBe('mailto:reader@example.com');
  });

  it('renders footnotes with unique ids across comments', () => {
    const source = 'Check this[^note].\n\n[^note]: Supporting detail.';
    const html = renderToStaticMarkup(<>
      <MarkdownContent {...options}>{source}</MarkdownContent>
      <MarkdownContent {...options}>{source}</MarkdownContent>
    </>);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]).filter((id) => id.includes('-fn-'));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(html).toContain('Supporting detail.');
  });

  it('gives native the same GFM table/list/footnote tree and untouched code', () => {
    const tree = JSON.stringify(parseMarkdown('| A | B |\n| - | - |\n| ENG-42 | **yes** |\n\n- [x] Done\n\n```text\nENG-42\n```\n\nNote[^x]\n\n[^x]: Detail', options));
    expect(tree).toContain('"tagName":"table"');
    expect(tree).toContain('"checked":true');
    expect(tree).toContain('"href":"#task:ENG-42"');
    expect(tree).toContain('"tagName":"strong"');
    expect(tree).toContain('dataFootnotes');
    expect(tree).toContain('"value":"ENG-42\\n"');
  });

  it('renders native table cells and numbered lists instead of stripping Markdown', () => {
    const html = renderToStaticMarkup(<NativeMarkdownContent {...options}>{'| Part | Count |\n| --- | --- |\n| **Bolt** | 12 |\n\n3. Third\n4. Fourth'}</NativeMarkdownContent>);
    expect(html).toContain('aria-label="Markdown table"');
    expect(html).toContain('Bolt');
    expect(html).toContain('12');
    expect(html).toContain('3.');
    expect(html).toContain('4.');
    expect(html).not.toContain('| --- |');
  });
});
