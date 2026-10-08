import { Text } from '@/components/ui/text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';

/** Bounded table content with the complete value available on hover, focus, or touch. */
export function TruncatedCell({ value, className, textClassName = '' }: { value: string; className: string; textClassName?: string }) {
  const trigger = React.useRef<React.ComponentRef<typeof TooltipTrigger>>(null);
  return <View className={className}>
    <Tooltip className="min-w-0 max-w-full">
      <TooltipTrigger ref={trigger} asChild onPress={Platform.OS === 'web' ? () => {
        // Radix closes on click after RN's press handler. Open after that event so a
        // touch tap or keyboard activation can reveal the complete cell value too.
        requestAnimationFrame(() => trigger.current?.open());
      } : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel={value} className="min-w-0 max-w-full">
          <Text numberOfLines={1} className={`text-[11px] ${textClassName}`}>{value}</Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent className="max-w-80"><Text selectable className="text-xs">{value}</Text></TooltipContent>
    </Tooltip>
  </View>;
}
