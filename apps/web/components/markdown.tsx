/* eslint-disable @typescript-eslint/no-explicit-any */
import { Text } from '@/components/ui/text';
import { splitTaskKey } from '@/lib/format';
import type { User } from '@temujira/client';
import { TaskKeyPattern } from '@temujira/shared';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';

export interface MarkdownProps {
  children: string;
  /** Candidates for resolving `@Name` tokens. Pass [] where no user list is available. */
  mentionUsers?: User[];
  /** Called when a resolved mention chip is pressed. */
  onMentionPress?: (user: User) => void;
}

/**
 * Renders markdown prose. Web uses react-markdown (full CommonMark); native falls back
 * to a plain-text strip so web ships first and native degrades gracefully.
 *
 * Before rendering we rewrite, OUTSIDE code spans:
 *   TEM-42     -> [TEM-42](#task:TEM-42)
 *   @Ada Lovelace -> [@Ada Lovelace](#mention:<userId>)
 *
 * Fragment hrefs are deliberate: react-markdown's default URL transform drops unknown
 * protocols, so a `mention://` scheme would be stripped. `#…:` survives it.
 */
export function Markdown({ children, mentionUsers, onMentionPress }: MarkdownProps) {
  if (Platform.OS !== 'web') {
    return <Text className="text-sm leading-6">{children.replace(/[*_`#>~]/g, '')}</Text>;
  }
  return (
    <WebMarkdown
      text={children}
      mentionUsers={mentionUsers ?? []}
      onMentionPress={onMentionPress}
    />
  );
}

// ---------------------------------------------------------------- preprocessing

/** Splits into [text, code, text, code, …] so code spans/fences are never rewritten. */
function splitOutsideCode(source: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  const re = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) parts.push({ code: false, text: source.slice(last, m.index) });
    parts.push({ code: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < source.length) parts.push({ code: false, text: source.slice(last) });
  return parts;
}

function linkifyTaskKeys(text: string): string {
  // Reuse the shared pattern, unanchored + globalised.
  const body = TaskKeyPattern.source.replace(/^\^/, '').replace(/\$$/, '');
  const re = new RegExp(`(?<![\\w-])(${body})(?![\\w-])`, 'g');
  return text.replace(re, (key) => `[${key}](#task:${key})`);
}

/**
 * Mirrors the server's mention token regex, then resolves by LONGEST NAME PREFIX: the
 * token is greedy (`@Ada Lovelace and Bob` captures "Ada Lovelace and Bob"), so we take
 * the longest user name that prefixes it and leave the remainder as plain text.
 */
function linkifyMentions(text: string, users: User[]): string {
  if (users.length === 0) return text;
  const re = new RegExp("(?<![\\w-])@([A-Za-z0-9_.' -]{1,64})", 'g');
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1] ?? '';
    let best: User | null = null;
    for (const u of users) {
      if (u.name.length > token.length) continue;
      if (token.slice(0, u.name.length).toLowerCase() !== u.name.toLowerCase()) continue;
      if (!best || u.name.length > best.name.length) best = u;
    }
    out += text.slice(last, m.index);
    if (best) {
      out += `[@${best.name}](#mention:${best.id})`;
      last = m.index + 1 + best.name.length;
      re.lastIndex = last;
    } else {
      out += m[0];
      last = m.index + m[0].length;
    }
  }
  out += text.slice(last);
  return out;
}

function preprocess(source: string, users: User[]): string {
  return splitOutsideCode(source)
    .map((part) => (part.code ? part.text : linkifyMentions(linkifyTaskKeys(part.text), users)))
    .join('');
}

// ---------------------------------------------------------------- web renderer

function WebMarkdown({
  text,
  mentionUsers,
  onMentionPress,
}: {
  text: string;
  mentionUsers: User[];
  onMentionPress?: (user: User) => void;
}) {
  const router = useRouter();
  const [Comp, setComp] = React.useState<any>(null);

  React.useEffect(() => {
    let mounted = true;
    import('react-markdown').then((mod) => {
      if (mounted) setComp(() => mod.default);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const source = React.useMemo(() => preprocess(text, mentionUsers), [text, mentionUsers]);
  const usersById = React.useMemo(() => {
    const map = new Map<string, User>();
    for (const u of mentionUsers) map.set(u.id, u);
    return map;
  }, [mentionUsers]);

  if (!Comp) return <Text className="text-sm leading-6">{text}</Text>;

  const components = {
    a: ({ href, children: c }: any) => {
      const url = typeof href === 'string' ? href : '';

      if (url.startsWith('#mention:')) {
        const user = usersById.get(url.slice('#mention:'.length));
        const style: React.CSSProperties = {
          backgroundColor: 'rgba(59,130,246,0.14)',
          color: '#2563eb',
          borderRadius: 4,
          padding: '0 3px',
          fontWeight: 500,
          cursor: user && onMentionPress ? 'pointer' : 'default',
        };
        if (!user || !onMentionPress) return <span style={style}>{c}</span>;
        return (
          <span
            role="button"
            tabIndex={0}
            style={style}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMentionPress(user);
            }}>
            {c}
          </span>
        );
      }

      if (url.startsWith('#task:')) {
        const parsed = splitTaskKey(url.slice('#task:'.length));
        return (
          <a
            href={parsed ? `/w/${parsed.workspaceKey}/t/${parsed.number}` : '#'}
            style={{ color: '#3b82f6', fontFamily: 'ui-monospace, monospace' }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (parsed) router.push(`/w/${parsed.workspaceKey}/t/${parsed.number}`);
            }}>
            {c}
          </a>
        );
      }

      return (
        <a href={url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>
          {c}
        </a>
      );
    },
    p: ({ children: c }: any) => <Text className="text-sm leading-6">{c}</Text>,
    h1: ({ children: c }: any) => <Text className="text-xl font-bold leading-8">{c}</Text>,
    h2: ({ children: c }: any) => <Text className="text-lg font-bold leading-7">{c}</Text>,
    h3: ({ children: c }: any) => <Text className="text-base font-semibold leading-6">{c}</Text>,
    ul: ({ children: c }: any) => <View style={{ paddingLeft: 16 }}>{c}</View>,
    ol: ({ children: c }: any) => <View style={{ paddingLeft: 16 }}>{c}</View>,
    li: ({ children: c }: any) => <Text className="text-sm leading-6">• {c}</Text>,
    blockquote: ({ children: c }: any) => (
      <View className="border-border my-1 border-l-2 pl-3">{c}</View>
    ),
    // react-markdown v10 dropped the `inline` prop: block code has a language class or a
    // newline (and is always wrapped in <pre>), inline code has neither.
    code: ({ children: c, className }: any) => {
      const raw = React.Children.toArray(c)
        .map((x) => (typeof x === 'string' ? x : ''))
        .join('');
      const isBlock = raw.includes('\n') || /(^|\s)language-/.test(String(className ?? ''));
      if (isBlock) return <Text className="font-mono text-xs leading-5">{c}</Text>;
      return (
        <span
          style={{
            backgroundColor: 'rgba(127,127,127,0.18)',
            borderRadius: 4,
            padding: '0 4px',
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.85em',
          }}>
          {c}
        </span>
      );
    },
    pre: ({ children: c }: any) => <View className="bg-muted my-1 rounded-md p-3">{c}</View>,
  };

  return (
    <View>
      <Comp components={components}>{source}</Comp>
    </View>
  );
}
