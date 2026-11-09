import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { InstanceSettingsSchema, type InstanceSettings } from '@temujira/shared';
import * as React from 'react';
import { AppState, Platform, View } from 'react-native';
import { useAuth } from './auth';

type InstanceState = { instance: InstanceSettings; setInstance: (value: InstanceSettings) => void };
const InstanceContext = React.createContext<InstanceState | null>(null);

function initialSettings(): InstanceSettings | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  // The server supplies the name in the HTML, before the first app render.
  const parsed = InstanceSettingsSchema.safeParse({ display_name: document.querySelector('meta[name="application-name"]')?.getAttribute('content') });
  return parsed.success ? parsed.data : null;
}

export function InstanceProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const [instance, setCurrent] = React.useState(initialSettings);
  const [error, setError] = React.useState(false);
  const revision = React.useRef(0);
  const setInstance = React.useCallback((value: InstanceSettings) => {
    revision.current += 1;
    setCurrent(value);
    setError(false);
  }, []);
  const refresh = React.useCallback(async () => {
    const request = ++revision.current;
    setError(false);
    try {
      const result = await client.getInstance();
      if (request === revision.current) setCurrent(result.instance);
    } catch {
      if (request === revision.current) setError(true);
    }
  }, [client]);

  React.useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') onFocus(); });
    if (Platform.OS === 'web') window.addEventListener('focus', onFocus);
    return () => {
      revision.current += 1;
      subscription.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !instance) return;
    document.title = instance.display_name;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="application-name"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'application-name';
      document.head.appendChild(meta);
    }
    meta.content = instance.display_name;
  }, [instance]);

  if (!instance) return <View className="bg-background flex-1 items-center justify-center gap-3 p-6">
    <Text className="text-muted-foreground text-sm">{error ? 'App settings could not be loaded.' : 'Loading…'}</Text>
    {error ? <Button variant="outline" onPress={() => void refresh()}><Text>Retry</Text></Button> : null}
  </View>;
  return <InstanceContext.Provider value={{ instance, setInstance }}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceState {
  const value = React.useContext(InstanceContext);
  if (!value) throw new Error('useInstance must be used within an InstanceProvider');
  return value;
}
