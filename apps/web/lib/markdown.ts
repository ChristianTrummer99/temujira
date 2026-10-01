import type { Root as HastRoot } from 'hast';
import type { Link, PhrasingContent, Root, Text } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified, type Plugin } from 'unified';
import type { Parent } from 'unist';
import { SKIP, visit } from 'unist-util-visit';
import { taskKeyBody } from './format';

export interface MarkdownOptions {
  mentionUsers?: readonly { id: string; name: string }[];
  workspaceKeys?: string[];
}

/** Apply app-specific links to prose, never to Markdown source or link destinations. */
function linkifyText(value: string, options: MarkdownOptions): Array<Text | Link> {
  const matches: Array<{ from: number; to: number; url: string }> = [];
  const body = taskKeyBody(options.workspaceKeys ?? []);
  if (body) {
    const pattern = new RegExp(`(?<![\\w-])(${body})(?![\\w-])`, 'g');
    for (const match of value.matchAll(pattern)) {
      matches.push({ from: match.index, to: match.index + match[0].length, url: `#task:${match[0]}` });
    }
  }

  // Keep the existing longest-name-prefix rule, including names with spaces.
  const users = [...(options.mentionUsers ?? [])].sort((a, b) => b.name.length - a.name.length);
  const pattern = /(?<![\w-])@([A-Za-z0-9_.' -]{1,64})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const token = match[1].toLowerCase();
    const user = users.find((u) => token.startsWith(u.name.toLowerCase()));
    if (!user) continue;
    const to = match.index + 1 + user.name.length;
    matches.push({ from: match.index, to, url: `#mention:${user.id}` });
    pattern.lastIndex = to;
  }

  const result: Array<Text | Link> = [];
  let cursor = 0;
  for (const match of matches.sort((a, b) => a.from - b.from || b.to - a.to)) {
    if (match.from < cursor) continue;
    if (match.from > cursor) result.push({ type: 'text', value: value.slice(cursor, match.from) });
    result.push({
      type: 'link',
      url: match.url,
      children: [{ type: 'text', value: value.slice(match.from, match.to) }],
    });
    cursor = match.to;
  }
  if (cursor < value.length || result.length === 0) {
    result.push({ type: 'text', value: value.slice(cursor) });
  }
  return result;
}

/** Preserve the composer's underline convention without enabling arbitrary raw HTML. */
function inlineMarkup(parent: Parent): void {
  for (let i = 0; i < parent.children.length; i++) {
    let node = parent.children[i];
    if (node.type === 'html') {
      const value = (node as { value?: string }).value ?? '';
      if (/^<br\s*\/?\s*>$/i.test(value)) {
        node = parent.children[i] = { type: 'break' };
      } else if (/^<u>$/i.test(value)) {
        let depth = 1;
        for (let j = i + 1; j < parent.children.length; j++) {
          const sibling = parent.children[j];
          if (sibling.type !== 'html') continue;
          const tag = (sibling as { value?: string }).value;
          if (tag?.toLowerCase() === '<u>') depth++;
          if (tag?.toLowerCase() === '</u>') depth--;
          if (depth !== 0) continue;
          const underline: PhrasingContent = {
            type: 'emphasis',
            data: { hName: 'u' },
            children: parent.children.slice(i + 1, j) as PhrasingContent[],
          };
          parent.children.splice(i, j - i + 1, underline);
          node = underline;
          break;
        }
      }
    }
    if ('children' in node) inlineMarkup(node as Parent);
  }
}

/** Shared by web react-markdown and the native renderer. Code is opaque to this plugin. */
export const remarkTemujira: Plugin<[MarkdownOptions?], Root> = (options = {}) => (tree) => {
  inlineMarkup(tree);
  visit(tree, (node, index, parent) => {
    if (['link', 'linkReference', 'image', 'imageReference', 'code', 'inlineCode', 'html', 'definition'].includes(node.type)) {
      return SKIP;
    }
    if (node.type !== 'text' || !parent || index === undefined) return;
    const replacements = linkifyText(node.value, options);
    parent.children.splice(index, 1, ...replacements);
    return [SKIP, index + replacements.length];
  });
};

/** Same URL policy on both platforms; encoded entities have already been parsed. */
export function safeMarkdownUrl(url: string): string {
  const clean = url.replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(clean)?.[1];
  return !scheme || /^(https?|mailto|tel|irc|ircs|xmpp)$/i.test(scheme) ? url : '';
}

/** Native uses the same CommonMark + GFM parser as react-markdown, without any DOM. */
export function parseMarkdown(source: string, options: MarkdownOptions = {}): HastRoot {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkTemujira, options)
    .use(remarkRehype);
  return processor.runSync(processor.parse(source)) as HastRoot;
}
