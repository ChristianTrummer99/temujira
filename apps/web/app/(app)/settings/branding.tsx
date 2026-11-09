import { AppBrand } from '@/components/app-brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { useInstance } from '@/lib/instance';
import { DEFAULT_INSTANCE_NAME, InstanceNameSchema } from '@temujira/shared';
import * as React from 'react';
import { ScrollView, View } from 'react-native';

export default function BrandingSettingsScreen() {
  const { user, client } = useAuth();
  const { instance, setInstance } = useInstance();
  const [draft, setDraft] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const name = draft ?? instance.display_name;
  const parsed = InstanceNameSchema.safeParse(name);
  const changed = name.trim() !== instance.display_name;

  async function save() {
    if (saving || !parsed.success || !changed || user?.role !== 'admin') return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await client.updateInstance({ display_name: parsed.data });
      setInstance(result.instance);
      setDraft(null);
      setMessage('App name saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The app name could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (user?.role !== 'admin') return <View className="p-6"><Text>Only admins can change the app name.</Text></View>;
  return <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-2xl gap-4 p-6">
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Set the app name for everyone who uses this installation.</CardDescription>
      </CardHeader>
      <CardContent className="gap-5">
        <View className="gap-1.5">
          <Label nativeID="app-name-label">App name</Label>
          <Input aria-labelledby="app-name-label" value={name} maxLength={80} editable={!saving}
            onChangeText={(value) => { setDraft(value); setError(null); setMessage(null); }} onSubmitEditing={() => void save()} />
          <Text className="text-muted-foreground text-xs">Shown in the sidebar, sign-in screen, and browser title. Use 80 characters or less.</Text>
          {!parsed.success ? <Text className="text-destructive text-sm">{parsed.error.issues[0]?.message}</Text> : null}
        </View>
        <View className="gap-2">
          <Text className="text-muted-foreground text-xs font-medium">Preview</Text>
          <View className="bg-sidebar border-sidebar-border max-w-full flex-row rounded-lg border p-3">
            <AppBrand name={name.trim() || instance.display_name} />
          </View>
        </View>
        {error ? <Text accessibilityRole="alert" className="text-destructive text-sm">{error}</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite" className="text-sm text-emerald-600">{message}</Text> : null}
      </CardContent>
      <CardFooter className="flex-row flex-wrap gap-2">
        <Button disabled={saving || !parsed.success || !changed} onPress={() => void save()}><Text>{saving ? 'Saving…' : 'Save changes'}</Text></Button>
        <Button variant="ghost" disabled={saving || name === DEFAULT_INSTANCE_NAME} onPress={() => { setDraft(DEFAULT_INSTANCE_NAME); setError(null); setMessage(null); }}>
          <Text>Use default name</Text>
        </Button>
      </CardFooter>
    </Card>
  </ScrollView>;
}
