import { Text } from '@/components/ui/text';
import type { Status, Tag } from '@temujira/client';
import { View } from 'react-native';

/** Tinted-by-tag-color pill. `#rrggbb` + alpha is a valid 8-digit hex on web + RN. */
export function TagPill({ tag, className }: { tag: Tag; className?: string }) {
  return <ColorLabel item={tag} className={className} rounded="rounded-full" />;
}

export function StatusPill({ status }: { status: Status }) {
  return <ColorLabel item={status} rounded="rounded" />;
}

function ColorLabel({ item, className, rounded }: { item: { name: string; color: string }; className?: string; rounded: string }) {
  return (
    <View
      className={`min-w-0 shrink flex-row items-center gap-1 ${rounded} border px-2 py-0.5 ${className ?? ''}`}
      style={{ backgroundColor: `${item.color}1f`, borderColor: `${item.color}66` }}>
      <View className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
      <Text className="min-w-0 shrink text-[11px] font-medium" style={{ color: item.color }} numberOfLines={1}>
        {item.name}
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
