import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import type { User } from '@temujira/client';
import * as React from 'react';
import { Platform, View } from 'react-native';

export function ProfilePictureEditor({ user, onChanged }: { user: User; onChanged: (user: User) => void }) {
  const { client } = useAuth();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  async function save(file?: File) {
    if (busy) return;
    setError('');
    if (file && file.size > 2 * 1024 * 1024) { setError('Choose a picture smaller than 2 MB.'); return; }
    setBusy(true);
    try {
      const result = file
        ? await client.uploadUserAvatar(user.id, { data: file, filename: file.name, contentType: file.type })
        : await client.deleteUserAvatar(user.id);
      onChanged(result.user);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the picture'); }
    finally { setBusy(false); }
  }
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center gap-4">
        <UserAvatar user={user} className="size-16" textClassName="text-xl" />
        <View className="flex-1 gap-2">
          <Text className="text-sm font-medium">Profile picture</Text>
          {Platform.OS === 'web' ? (
            <View className="flex-row flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy} onPress={() => inputRef.current?.click()}>
                <Text>{busy ? 'Saving...' : user.avatar_id ? 'Change picture' : 'Upload picture'}</Text>
              </Button>
              {user.avatar_id ? <Button variant="ghost" size="sm" disabled={busy} onPress={() => save()}><Text>Remove picture</Text></Button> : null}
            </View>
          ) : <Text className="text-muted-foreground text-sm">Set your picture in the web app.</Text>}
          <Text className="text-muted-foreground text-xs">PNG, JPEG, GIF, or WebP. Up to 2 MB. Without a picture, your initials use a personal color.</Text>
        </View>
      </View>
      {Platform.OS === 'web' ? <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label={`Profile picture for ${user.name}`} style={{ display: 'none' }} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void save(file);
        }} /> : null}
      {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
    </View>
  );
}
