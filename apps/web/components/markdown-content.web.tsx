import type { MarkdownContentProps } from './markdown';
import { remarkTemujira, safeMarkdownUrl } from '@/lib/markdown';
import { splitTaskKey } from '@/lib/format';
import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './markdown.css';

export function MarkdownContent({
  children,
  mentionUsers = [],
  workspaceKeys,
  onMentionPress,
  onTaskPress,
}: MarkdownContentProps) {
  // Footnote ids must not collide when several comments use the same reference name.
  const id = React.useId().replace(/[^a-z0-9_-]/gi, '');
  const usersById = React.useMemo(() => new Map(mentionUsers.map((u) => [u.id, u])), [mentionUsers]);
  const components: Components = {
    h2: ({ node: _node, id: headingId, ...props }) => (
      <h2 {...props} id={headingId === 'footnote-label' ? `md-${id}-footnote-label` : headingId} />
    ),
    table: ({ children: content }) => (
      <div className="tmj-markdown-table" role="region" aria-label="Markdown table" tabIndex={0}>
        <table>{content}</table>
      </div>
    ),
    a: ({ href = '', children: content, node: _node, ...props }) => {
      if (href.startsWith('#mention:')) {
        const user = usersById.get(href.slice('#mention:'.length));
        return user && onMentionPress ? (
          <button
            type="button"
            className="tmj-markdown-mention"
            onClick={(e) => {
              e.stopPropagation();
              onMentionPress(user);
            }}>
            {content}
          </button>
        ) : <span className="tmj-markdown-mention">{content}</span>;
      }
      if (href.startsWith('#task:')) {
        const key = href.slice('#task:'.length);
        const task = splitTaskKey(key);
        return (
          <a
            className="tmj-markdown-task"
            href={task ? `/w/${task.workspaceKey}/t/${task.number}` : undefined}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (task) onTaskPress(key);
            }}>
            {content}
          </a>
        );
      }
      const local = href.startsWith('#');
      return (
        <a
          {...props}
          aria-describedby={props['aria-describedby'] === 'footnote-label' ? `md-${id}-footnote-label` : props['aria-describedby']}
          href={href || undefined}
          target={local ? undefined : '_blank'}
          rel={local ? undefined : 'noopener noreferrer'}
          onClick={(e) => e.stopPropagation()}>
          {content}
        </a>
      );
    },
    img: ({ node: _node, alt = '', ...props }) => <img {...props} alt={alt} loading="lazy" />,
  };

  return (
    <div className="tmj-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkTemujira, { mentionUsers, workspaceKeys }]]}
        remarkRehypeOptions={{ clobberPrefix: `md-${id}-` }}
        urlTransform={safeMarkdownUrl}
        skipHtml
        components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
