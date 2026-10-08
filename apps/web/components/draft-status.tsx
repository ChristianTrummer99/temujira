import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { DraftSnapshot } from '@/lib/draft-store';
import { View } from 'react-native';

export function DraftStatus({ draft, onDiscard, disabled, discardLabel = 'Discard draft' }: { draft: DraftSnapshot; onDiscard: () => void; disabled?: boolean; discardLabel?: string }) {
  if (!draft.hasDraft && draft.status !== 'unavailable') return null;
  return <View className="flex-row flex-wrap items-center justify-between gap-2">
    <Text role="status" className="text-muted-foreground text-xs">
      {draft.status === 'unavailable' ? 'Draft could not be saved on this device.' : draft.status === 'saving' ? 'Saving draft…' : draft.restored ? 'Draft restored from this device.' : 'Draft saved on this device.'}
    </Text>
    {draft.hasDraft ? <Button variant="ghost" size="sm" className="h-6 px-1" disabled={disabled} onPress={onDiscard}><Text className="text-muted-foreground text-xs">{discardLabel}</Text></Button> : null}
  </View>;
}
