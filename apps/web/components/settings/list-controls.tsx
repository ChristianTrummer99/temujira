import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { View } from 'react-native';

export const IDENTITY_PAGE_SIZE = 50;

export function FilterPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Button variant={selected ? 'default' : 'outline'} size="sm" className="h-7 rounded-full px-2.5 sm:h-7"
    aria-pressed={selected} accessibilityState={{ selected }} onPress={onPress}><Text className="text-[11px]">{label}</Text></Button>;
}

export function ListPagination({ page, total, onPage, kind }: { page: number; total: number; onPage: (page: number) => void; kind: string }) {
  return <View className="flex-row items-center justify-between gap-3 py-2">
    <Text className="text-muted-foreground text-xs">{total ? page * IDENTITY_PAGE_SIZE + 1 : 0}–{Math.min(total, (page + 1) * IDENTITY_PAGE_SIZE)} of {total} {kind}</Text>
    <View className="flex-row gap-2"><Button variant="outline" size="sm" disabled={!page} onPress={() => onPage(page - 1)}><Text>Previous</Text></Button>
      <Button variant="outline" size="sm" disabled={(page + 1) * IDENTITY_PAGE_SIZE >= total} onPress={() => onPage(page + 1)}><Text>Next</Text></Button></View>
  </View>;
}
