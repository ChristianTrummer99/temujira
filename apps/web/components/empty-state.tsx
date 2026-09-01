import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="items-center justify-center gap-2 p-12">
      {icon ? <Icon as={icon} className="text-muted-foreground/60 size-8" /> : null}
      <Text className="text-sm font-medium">{title}</Text>
      {description ? (
        <Text className="text-muted-foreground max-w-sm text-center text-sm">{description}</Text>
      ) : null}
      {action ? <View className="pt-1">{action}</View> : null}
    </View>
  );
}
