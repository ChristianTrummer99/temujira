import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import * as React from 'react';
import { View } from 'react-native';

export default function ProfileSettingsScreen() {
  const { user, client, setUser } = useAuth();
  const [name, setName] = React.useState(user?.name ?? '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function saveProfile() {
    if (!name.trim() || savingProfile) return;
    setSavingProfile(true);
    setError(null);
    setMessage(null);
    try {
      const { user: updated } = await client.updateMe({ name: name.trim() });
      setUser(updated);
      setMessage('Profile updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    if (!currentPassword || !newPassword || savingPassword) return;
    setSavingPassword(true);
    setError(null);
    setMessage(null);
    try {
      const { user: updated } = await client.updateMe({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setUser(updated);
      setCurrentPassword('');
      setNewPassword('');
      setMessage('Password changed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <View className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your display name and account details.</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          <View className="gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} placeholder="Ada Lovelace" />
          </View>
          <View className="gap-1.5">
            <Label>Email</Label>
            <Input value={user?.email ?? ''} editable={false} />
            <Text className="text-muted-foreground text-xs">Email cannot be changed.</Text>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 gap-1.5">
              <Label>Role</Label>
              <Input value={user?.role === 'admin' ? 'Admin' : 'Member'} editable={false} />
            </View>
            <View className="flex-1 gap-1.5">
              <Label>Type</Label>
              <Input value={user?.is_agent ? 'Agent' : 'Human'} editable={false} />
            </View>
          </View>
        </CardContent>
        <CardFooter>
          <Button onPress={saveProfile} disabled={savingProfile || !name.trim()}>
            <Text>{savingProfile ? 'Saving...' : 'Save changes'}</Text>
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            {user?.is_agent
              ? 'Agent accounts use API keys and have no password.'
              : 'Enter your current password, then a new one.'}
          </CardDescription>
        </CardHeader>
        {user?.is_agent ? null : (
          <CardContent className="gap-4">
            <View className="gap-1.5">
              <Label>Current password</Label>
              <Input
                secureTextEntry
                autoCapitalize="none"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="••••••••"
              />
            </View>
            <View className="gap-1.5">
              <Label>New password</Label>
              <Input
                secureTextEntry
                autoCapitalize="none"
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="At least 8 characters"
              />
            </View>
            <View className="flex-row justify-end">
              <Button
                onPress={savePassword}
                disabled={savingPassword || !currentPassword || !newPassword}>
                <Text>{savingPassword ? 'Changing...' : 'Change password'}</Text>
              </Button>
            </View>
          </CardContent>
        )}
      </Card>

      {message ? <Text className="text-sm text-emerald-600">{message}</Text> : null}
      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
    </View>
  );
}
