import { Text } from '@/components/ui/text';
import { parseMarkdown, safeMarkdownUrl } from '@/lib/markdown';
import type { Element, RootContent } from 'hast';
import * as React from 'react';
import { Image, Linking, Pressable, ScrollView, Text as InlineText, View } from 'react-native';
import type { MarkdownContentProps } from './markdown';

function isElement(node: RootContent): node is Element {
  return node.type === 'element';
}

function textOf(node: RootContent): string {
  return node.type === 'text' ? node.value : isElement(node) ? node.children.map(textOf).join('') : '';
}

/** Native rendering uses the same parsed Markdown as web, including GFM tables. */
export function MarkdownContent({
  children,
  mentionUsers = [],
  workspaceKeys,
  onMentionPress,
  onTaskPress,
}: MarkdownContentProps) {
  const tree = React.useMemo(
    () => parseMarkdown(children, { mentionUsers, workspaceKeys }),
    [children, mentionUsers, workspaceKeys]
  );
  const [width, setWidth] = React.useState(320);

  function openLink(url: string) {
    if (url.startsWith('#task:')) onTaskPress(url.slice('#task:'.length));
    else if (url.startsWith('#mention:')) {
      const user = mentionUsers.find((u) => u.id === url.slice('#mention:'.length));
      if (user) onMentionPress?.(user);
    } else if (safeMarkdownUrl(url) && !url.startsWith('#')) {
      void Linking.openURL(url).catch(() => {});
    }
  }

  function inline(nodes: RootContent[]): React.ReactNode[] {
    return nodes.map((node, i) => {
      if (node.type === 'text') return node.value;
      if (!isElement(node)) return null;
      const content = inline(node.children);
      switch (node.tagName) {
        case 'br': return '\n';
        case 'strong': return <InlineText key={i} style={{ fontWeight: '700' }}>{content}</InlineText>;
        case 'em': return <InlineText key={i} style={{ fontStyle: 'italic' }}>{content}</InlineText>;
        case 'del': return <InlineText key={i} style={{ textDecorationLine: 'line-through' }}>{content}</InlineText>;
        case 'u': return <InlineText key={i} style={{ textDecorationLine: 'underline' }}>{content}</InlineText>;
        case 'code': return <InlineText key={i} className="bg-muted font-mono text-xs">{content}</InlineText>;
        case 'sup': return <InlineText key={i} style={{ fontSize: 10 }}>{content}</InlineText>;
        case 'input': return null; // Task-list markers are rendered beside the item below.
        case 'a': {
          const url = safeMarkdownUrl(String(node.properties.href ?? ''));
          const mention = url.startsWith('#mention:');
          return (
            <InlineText
              key={i}
              accessibilityRole="link"
              onPress={url ? () => openLink(url) : undefined}
              style={{
                color: '#3b82f6',
                textDecorationLine: mention ? 'none' : 'underline',
                backgroundColor: mention ? 'rgba(59,130,246,0.14)' : undefined,
              }}>
              {content}
            </InlineText>
          );
        }
        default: return <InlineText key={i}>{content}</InlineText>;
      }
    });
  }

  function paragraph(nodes: RootContent[], key: React.Key) {
    // Images are native block views, never nested inside a native Text element.
    const parts: React.ReactNode[] = [];
    let text: RootContent[] = [];
    function flush() {
      if (!text.length) return;
      parts.push(<Text key={parts.length} className="text-sm leading-6" selectable>{inline(text)}</Text>);
      text = [];
    }
    for (const node of nodes) {
      const image = isElement(node) && node.tagName === 'img' ? node
        : isElement(node) && node.tagName === 'a' && node.children.length === 1 &&
          isElement(node.children[0]) && node.children[0].tagName === 'img' ? node.children[0] : null;
      if (image) {
        flush();
        const content = <MarkdownImage src={String(image.properties.src ?? '')} alt={String(image.properties.alt ?? '')} />;
        parts.push(isElement(node) && node.tagName === 'a' ? (
          <Pressable key={parts.length} onPress={() => openLink(String(node.properties.href ?? ''))}>{content}</Pressable>
        ) : <View key={parts.length}>{content}</View>);
      } else text.push(node);
    }
    flush();
    return <View key={key} className="min-w-0 gap-2">{parts}</View>;
  }

  function blocks(nodes: RootContent[]): React.ReactNode[] {
    return nodes.map((node, i) => {
      if (node.type === 'text') return node.value.trim() ? paragraph([node], i) : null;
      if (!isElement(node)) return null;
      switch (node.tagName) {
        case 'p': return paragraph(node.children, i);
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
          const size = node.tagName === 'h1' ? 'text-xl font-bold leading-8'
            : node.tagName === 'h2' ? 'text-lg font-bold leading-7' : 'text-base font-semibold leading-6';
          return <Text key={i} accessibilityRole="header" className={size} selectable>{inline(node.children)}</Text>;
        }
        case 'pre':
          return (
            <ScrollView key={i} horizontal className="bg-muted rounded-md" contentContainerStyle={{ padding: 12 }}>
              <Text className="font-mono text-xs leading-5" selectable>{textOf(node)}</Text>
            </ScrollView>
          );
        case 'blockquote':
          return <View key={i} className="border-border gap-2 border-l-2 pl-3">{blocks(node.children)}</View>;
        case 'hr': return <View key={i} className="border-border border-t" />;
        case 'ul': case 'ol': {
          const start = Number(node.properties.start ?? 1);
          const items = node.children.filter(isElement).filter((n) => n.tagName === 'li');
          return (
            <View key={i} className="gap-1">
              {items.map((item, j) => {
                const input = item.children.flatMap((child) =>
                  isElement(child) && child.tagName === 'p' ? child.children : [child]
                ).find((child) => isElement(child) && child.tagName === 'input') as Element | undefined;
                return (
                  <View key={j} className="flex-row items-start gap-2">
                    <Text
                      className="min-w-5 text-right text-sm leading-6"
                      accessibilityRole={input ? 'checkbox' : undefined}
                      accessibilityState={input ? { checked: !!input.properties.checked, disabled: true } : undefined}>
                      {input ? (input.properties.checked ? '☑' : '☐') : node.tagName === 'ol' ? `${start + j}.` : '•'}
                    </Text>
                    <View className="min-w-0 flex-1 gap-2">{listItem(item)}</View>
                  </View>
                );
              })}
            </View>
          );
        }
        case 'table': {
          const rows = node.children.filter(isElement).flatMap((section) =>
            section.tagName === 'tr' ? [section] : section.children.filter(isElement).filter((n) => n.tagName === 'tr')
          );
          const columns = Math.max(1, ...rows.map((row) => row.children.filter(isElement).length));
          const cellWidth = Math.max(144, Math.floor(width / columns));
          return (
            <ScrollView key={i} horizontal accessibilityLabel="Markdown table" className="max-w-full">
              <View className="border-border border-l border-t">
                {rows.map((row, j) => (
                  <View key={j} className="flex-row">
                    {row.children.filter(isElement).map((cell, k) => {
                      const align = cell.properties.align;
                      return (
                        <View
                          key={k}
                          style={{ width: cellWidth }}
                          className={`border-border border-b border-r p-3 ${cell.tagName === 'th' ? 'bg-muted' : ''}`}>
                          <Text
                            selectable
                            className={`text-sm leading-6 ${cell.tagName === 'th' ? 'font-semibold' : ''}`}
                            style={{ textAlign: align === 'center' || align === 'right' ? align : 'left' }}>
                            {inline(cell.children)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        case 'img': return paragraph([node], i);
        default: return <View key={i} className="min-w-0 gap-2">{blocks(node.children)}</View>;
      }
    });
  }

  function listItem(item: Element) {
    const result: React.ReactNode[] = [];
    let run: RootContent[] = [];
    for (const node of item.children) {
      if (isElement(node) && ['p', 'ul', 'ol', 'pre', 'blockquote'].includes(node.tagName)) {
        if (run.length) result.push(paragraph(run, `text-${result.length}`));
        run = [];
        result.push(<View key={`block-${result.length}`} className="gap-2">{blocks([node])}</View>);
      } else run.push(node);
    }
    if (run.length) result.push(paragraph(run, `text-${result.length}`));
    return result;
  }

  return (
    <View className="w-full min-w-0 gap-3" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {blocks(tree.children)}
    </View>
  );
}

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = React.useState(16 / 9);
  const [failed, setFailed] = React.useState(false);
  const url = safeMarkdownUrl(src);
  React.useEffect(() => {
    let active = true;
    setFailed(false);
    if (url) Image.getSize(url, (w, h) => { if (active && h) setRatio(w / h); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url]);
  return url && !failed ? (
    <Image source={{ uri: url }} accessibilityLabel={alt} resizeMode="contain" style={{ width: '100%', aspectRatio: ratio }} />
  ) : <Text className="text-muted-foreground text-sm">{alt || 'Image unavailable'}</Text>;
}
