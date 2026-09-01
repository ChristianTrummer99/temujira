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
import { useRouter } from 'expo-router';
import { KeyRoundIcon, FolderCogIcon, UserIcon, UsersIcon } from 'lucide-react-native';
import { View, Pressable } from 'react-native';

export default function SettingsIndexScreen() {
  const router = useRouter();

  const links = [
    {
      to: '/settings/profile',
      title: 'Profile',
      desc: 'Your name, email, and password',
      icon: UserIcon,
    },
    {
      to: '/settings/api-keys',
      title: 'API Keys',
      desc: 'Create and revoke keys for the CLI and agents',
      icon: KeyRoundIcon,
    },
    {
      to: '/settings/users',
      title: 'Users',
      desc: 'Manage teammates and agent accounts',
      icon: UsersIcon,
    },
    {
      to: '/settings/workspaces',
      title: 'Workspaces',
      desc: 'Rename, archive, or unarchive workspaces and their statuses',
      icon: FolderCogIcon,
    },
  ];

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
