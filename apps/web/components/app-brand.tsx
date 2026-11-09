import { Text } from '@/components/ui/text';
import { View } from 'react-native';

export function AppBrand({ name }: { name: string }) {
  return <View className="min-w-0 flex-1 flex-row items-center gap-2" accessibilityLabel={name}>
    <View className="bg-sidebar-primary h-7 w-7 shrink-0 items-center justify-center rounded-md">
      <Text className="text-sidebar-primary-foreground text-sm font-bold">{Array.from(name)[0]?.toLocaleUpperCase()}</Text>
    </View>
    <Text numberOfLines={1} className="text-sidebar-foreground min-w-0 flex-1 text-base font-semibold tracking-tight">{name}</Text>
  </View>;
}
