import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import * as React from 'react';
import { Image, View } from 'react-native';

/** App name with the uploaded logo. Without a logo, or if it cannot load, the name initial shows. */
export function AppBrand({ name, logoId }: { name: string; logoId?: string | null }) {
  const { client } = useAuth();
  const [failedLogo, setFailedLogo] = React.useState<string | null>(null);
  return <View className="min-w-0 flex-1 flex-row items-center gap-2" accessibilityLabel={name}>
    {logoId && failedLogo !== logoId ? (
      <Image testID="app-logo" source={client.instanceLogoSource(logoId)} resizeMode="contain"
        className="h-7 w-7 shrink-0 rounded-md" onError={() => setFailedLogo(logoId)} />
    ) : (
      <View className="bg-sidebar-primary h-7 w-7 shrink-0 items-center justify-center rounded-md">
        <Text className="text-sidebar-primary-foreground text-sm font-bold">{Array.from(name)[0]?.toLocaleUpperCase()}</Text>
      </View>
    )}
    <Text numberOfLines={1} className="text-sidebar-foreground min-w-0 flex-1 text-base font-semibold tracking-tight">{name}</Text>
  </View>;
}
