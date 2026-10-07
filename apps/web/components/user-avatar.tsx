import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { avatarColor } from '@/lib/avatar-color';
import { initialsOf } from '@/lib/format';
import { cn } from '@/lib/utils';

export function UserAvatar({ user, className, textClassName }: {
  user: { id: string; name: string; avatar_id?: string | null };
  className?: string;
  textClassName?: string;
}) {
  const { client } = useAuth();
  return (
    <Avatar alt={user.name} className={className} testID={`avatar-${user.id}`}>
      {user.avatar_id ? (
        <AvatarImage key={user.avatar_id} source={client.userAvatarSource(user.id, user.avatar_id)} resizeMode="cover" />
      ) : null}
      <AvatarFallback style={{ backgroundColor: avatarColor(user.id) }}>
        <Text className={cn('text-xs font-medium text-white', textClassName)}>{initialsOf(user.name)}</Text>
      </AvatarFallback>
    </Avatar>
  );
}
