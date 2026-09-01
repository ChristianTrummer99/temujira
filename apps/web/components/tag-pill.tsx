import { Text } from '@/components/ui/text';
import type { Tag } from '@temujira/client';
import { View } from 'react-native';

/** Tinted-by-tag-color pill. `#rrggbb` + alpha is a valid 8-digit hex on web + RN. */
export function TagPill({ tag, className }: { tag: Tag; className?: string }) {
  return (
    <View
      className={`flex-row items-center gap-1 rounded-full border px-2 py-0.5 ${className ?? ''}`}
      style={{ backgroundColor: `${tag.color}1f`, borderColor: `${tag.color}66` }}>
      <View className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
      <Text className="text-[11px] font-medium" style={{ color: tag.color }} numberOfLines={1}>
        {tag.name}
      </Text>
    </View>
  );
}

/** Up to `max` pills plus a "+n" overflow chip. */
export function TagPills({ tags, max = 3 }: { tags: Tag[]; max?: number }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const overflow = tags.length - shown.length;
  return (
    <View className="flex-row items-center gap-1">
      {shown.map((tag) => (
        <TagPill key={tag.id} tag={tag} />
      ))}
      {overflow > 0 ? (
        <View className="border-border rounded-full border px-1.5 py-0.5">
          <Text className="text-muted-foreground text-[11px]">+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}
