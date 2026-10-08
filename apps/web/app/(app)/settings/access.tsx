import UsersPanel from '@/components/settings/users-panel';
import ApiKeysPanel from '@/components/settings/api-keys-panel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import * as React from 'react';

export default function IdentityAccessScreen() {
  const { tab, owner } = useLocalSearchParams<{ tab?: string; owner?: string }>();
  const router = useRouter();
  const active = tab === 'keys' ? 'keys' : 'users';
  const id = React.useId();
  return <View className="min-h-0 flex-1">
    <View className="border-border border-b px-3 py-3"><Text className="text-sm font-semibold">Users &amp; API keys</Text></View>
    <Tabs value={active} onValueChange={(next) => router.setParams({ tab: next })} className="min-h-0 flex-1">
      <TabsList className="mx-3 mt-3 self-start">
        <TabsTrigger value="users" nativeID={`${id}-users-tab`} aria-controls={`${id}-users-panel`}><Text>Users</Text></TabsTrigger>
        <TabsTrigger value="keys" nativeID={`${id}-keys-tab`} aria-controls={`${id}-keys-panel`}><Text>API keys</Text></TabsTrigger>
      </TabsList>
      {/* Keep both panels mounted so tab changes preserve searches and filters.
          The primitive's web Content currently ignores forceMount. */}
      <View role="tabpanel" nativeID={`${id}-users-panel`} aria-labelledby={`${id}-users-tab`} className="min-h-0 flex-1" style={active === 'users' ? undefined : { display: 'none' }}>
        <UsersPanel onShowKeys={(id) => router.setParams({ tab: 'keys', owner: id })} />
      </View>
      <View role="tabpanel" nativeID={`${id}-keys-panel`} aria-labelledby={`${id}-keys-tab`} className="min-h-0 flex-1" style={active === 'keys' ? undefined : { display: 'none' }}>
        <ApiKeysPanel userId={owner} onClearUser={() => router.setParams({ owner: undefined })} />
      </View>
    </Tabs>
  </View>;
}
