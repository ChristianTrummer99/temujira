import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { EllipsisIcon } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';

/** Fixed slot: hover/focus only changes opacity, never the neighboring columns. */
export function RowMenu({ label, children, className = '', hover = true }: {
  label: string; children: React.ReactNode; className?: string; hover?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return <View className={`w-7 shrink-0 ${className}`}>
    <DropdownMenu onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" accessibilityLabel={label} className={`h-7 w-7 p-0 sm:h-7 ${hover && !open ? 'row-action' : ''}`}>
          <Icon as={EllipsisIcon} className="text-muted-foreground size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">{children}</DropdownMenuContent>
    </DropdownMenu>
  </View>;
}
