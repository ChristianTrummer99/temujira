import { AppBrand } from '@/components/app-brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { useInstance } from '@/lib/instance';
import { DEFAULT_INSTANCE_NAME, InstanceNameSchema, MAX_LOGO_BYTES } from '@temujira/shared';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';

export default function BrandingSettingsScreen() {
  const { user, client } = useAuth();
  const { instance, setInstance } = useInstance();
  const logoInput = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savingLogo, setSavingLogo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const name = draft ?? instance.display_name;
  const parsed = InstanceNameSchema.safeParse(name);
  const changed = name.trim() !== instance.display_name;
  const busy = saving || savingLogo;

  async function save() {
    if (busy || !parsed.success || !changed || user?.role !== 'admin') return;
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

  /** Upload a new logo, or remove the logo without a file. The change applies immediately. */
  async function saveLogo(file?: File) {
    if (busy || user?.role !== 'admin') return;
    setError(null);
    setMessage(null);
    if (file && file.size > MAX_LOGO_BYTES) { setError('Choose an image smaller than 2 MB.'); return; }
    setSavingLogo(true);
    try {
      const result = file
        ? await client.uploadInstanceLogo({ data: file, filename: file.name, contentType: file.type })
        : await client.deleteInstanceLogo();
      setInstance(result.instance);
      setMessage(file ? 'Logo saved.' : 'Logo removed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The logo could not be saved.');
    } finally {
      setSavingLogo(false);
    }
  }

  if (user?.role !== 'admin') return <View className="p-6"><Text>Only admins can change the app name and logo.</Text></View>;
  return <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-2xl gap-4 p-6">
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Set the app name and logo for everyone who uses this installation.</CardDescription>
      </CardHeader>
      <CardContent className="gap-5">
        <View className="gap-1.5">
          <Label nativeID="app-name-label">App name</Label>
          <Input aria-labelledby="app-name-label" value={name} maxLength={80} editable={!saving}
            onChangeText={(value) => { setDraft(value); setError(null); setMessage(null); }} onSubmitEditing={() => void save()} />
          <Text className="text-muted-foreground text-xs">Shown in the sidebar, sign-in screen, and browser title. Use 80 characters or less.</Text>
          {!parsed.success ? <Text className="text-destructive text-sm">{parsed.error.issues[0]?.message}</Text> : null}
        </View>
        <View className="gap-1.5">
          <Label nativeID="app-logo-label">Logo</Label>
          {Platform.OS === 'web' ? (
            <View className="flex-row flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onPress={() => logoInput.current?.click()}>
                <Text>{savingLogo ? 'Saving…' : instance.logo_id ? 'Change logo' : 'Upload logo'}</Text>
              </Button>
              {instance.logo_id ? (
                <Button variant="ghost" size="sm" disabled={busy} onPress={() => void saveLogo()}><Text>Remove logo</Text></Button>
              ) : null}
            </View>
          ) : <Text className="text-muted-foreground text-sm">Set the logo in the web app.</Text>}
          <Text className="text-muted-foreground text-xs">
            Replaces the letter icon in the sidebar and the browser tab icon. PNG, JPEG, GIF, or WebP. Up to 2&nbsp;MB.
            A square image fits best. The logo changes immediately for all users.
          </Text>
          {Platform.OS === 'web' ? <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            aria-labelledby="app-logo-label" style={{ display: 'none' }} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void saveLogo(file);
            }} /> : null}
        </View>
        <View className="gap-2">
          <Text className="text-muted-foreground text-xs font-medium">Preview</Text>
          <View className="bg-sidebar border-sidebar-border max-w-full flex-row rounded-lg border p-3">
            <AppBrand name={name.trim() || instance.display_name} logoId={instance.logo_id} />
          </View>
        </View>
        {error ? <Text accessibilityRole="alert" className="text-destructive text-sm">{error}</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite" className="text-sm text-emerald-600">{message}</Text> : null}
      </CardContent>
      <CardFooter className="flex-row flex-wrap gap-2">
        <Button disabled={busy || !parsed.success || !changed} onPress={() => void save()}><Text>{saving ? 'Saving…' : 'Save changes'}</Text></Button>
        <Button variant="ghost" disabled={busy || name === DEFAULT_INSTANCE_NAME} onPress={() => { setDraft(DEFAULT_INSTANCE_NAME); setError(null); setMessage(null); }}>
          <Text>Use default name</Text>
        </Button>
      </CardFooter>
    </Card>
  </ScrollView>;
}
