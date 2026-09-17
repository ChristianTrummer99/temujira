import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { hasScope } from '@/lib/scopes';
import { useRouter } from 'expo-router';
import { KeyRoundIcon, FolderCogIcon, UserIcon, UsersIcon } from 'lucide-react-native';
import { View, Pressable } from 'react-native';

export default function SettingsIndexScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const links = [
    {
      to: '/settings/profile',
      title: 'Profile',
      desc: 'Your name, email, and password',
      icon: UserIcon,
      visible: true,
    },
    {
      to: '/settings/api-keys',
      title: 'API Keys',
      desc: 'Create and revoke keys for the CLI and agents',
      icon: KeyRoundIcon,
      visible: true,
    },
    {
      to: '/settings/users',
      title: 'Users',
      desc: 'Manage teammates, agent accounts, and their access',
      icon: UsersIcon,
      visible: hasScope(user, 'users:manage'),
    },
    {
      to: '/settings/workspaces',
      title: 'Workspaces',
      desc: 'Rename, archive, or unarchive workspaces and their statuses',
      icon: FolderCogIcon,
      visible: hasScope(user, 'workspaces:manage'),
    },
  ].filter((l) => l.visible);

  return (
    <View className="mx-auto w-full max-w-2xl gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Manage your account and this Temujira instance.</CardDescription>
        </CardHeader>
        <CardContent className="gap-2">
          {links.map((link) => (
            <Pressable
              key={link.to}
              className="hover:bg-accent/50 flex-row items-center gap-3 rounded-md px-3 py-3"
              onPress={() => router.push(link.to as never)}>
              <Icon as={link.icon} className="text-muted-foreground size-5" />
              <View className="flex-1">
                <Text className="text-sm font-medium">{link.title}</Text>
                <Text className="text-muted-foreground text-xs">{link.desc}</Text>
              </View>
            </Pressable>
          ))}
        </CardContent>
      </Card>
    </View>
  );
}
