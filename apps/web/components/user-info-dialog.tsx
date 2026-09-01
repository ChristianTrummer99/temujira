import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { initialsOf } from '@/lib/format';
import type { User } from '@temujira/client';
import { View } from 'react-native';

/**
 * Clicking a mention chip opens this. There's no user profile route in v1 and the
 * registry has no per-user page, so a small card is the whole affordance.
 */
export function UserInfoDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  return (
    <Dialog open={!!user} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-full max-w-xs">
        <DialogHeader>
          <DialogTitle>{user?.name ?? ''}</DialogTitle>
        </DialogHeader>
        {user ? (
          <View className="flex-row items-center gap-3">
            <Avatar alt={user.name} className="size-12">
              <AvatarFallback>
                <Text className="text-sm">{initialsOf(user.name)}</Text>
              </AvatarFallback>
            </Avatar>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-muted-foreground text-xs">{user.email}</Text>
              <View className="flex-row gap-1.5">
                <Badge variant="secondary">
                  <Text>{user.role === 'admin' ? 'Admin' : 'Member'}</Text>
                </Badge>
                <Badge variant={user.is_agent ? 'default' : 'outline'}>
                  <Text>{user.is_agent ? 'Agent' : 'Human'}</Text>
                </Badge>
                {user.deactivated_at ? (
                  <Badge variant="destructive">
                    <Text>Deactivated</Text>
                  </Badge>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onPress={onClose}>
            <Text>Close</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
