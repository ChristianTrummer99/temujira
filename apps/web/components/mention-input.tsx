import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { initialsOf } from '@/lib/format';
import type { User } from '@temujira/client';
import * as React from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

/** Mirrors the server's mention token, anchored to the caret. */
const ACTIVE_RE = new RegExp("(^|[\\s(>])@([A-Za-z0-9_.' -]{0,64})$");

interface Pick {
  id: string;
  name: string;
}

function activeMention(
  before: string,
  picks: Pick[]
): { at: number; token: string } | null {
  const m = ACTIVE_RE.exec(before);
  if (!m) return null;
  const token = m[2] ?? '';
  if (token.includes('\n')) return null;
  // The token is greedy (spaces are legal in names) — stop chasing prose.
  if (token.split(' ').length > 3) return null;
  const lower = token.toLowerCase();
  for (const p of picks) {
    const n = p.name.toLowerCase();
    if (lower === n || lower.startsWith(`${n} `)) return null; // already resolved
  }
  return { at: m.index + (m[1] ?? '').length, token };
}

export interface MentionInputProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Resolved user ids for the mentions still present in the text. */
  onMentionIdsChange?: (ids: string[]) => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  autoFocus?: boolean;
  /** Where the suggestion list opens relative to the field. */
  suggestionsPlacement?: 'above' | 'below';
}

/**
 * A Textarea with @-autocomplete.
 *
 * The suggestion list is a plain absolutely-positioned View, not the RNR Popover: the
 * Popover is trigger-anchored and steals focus from the textarea. Rows commit on
 * mousedown (see SuggestionRow) because a plain click blurs the textarea first.
 */
export function MentionInput({
  value,
  onChangeText,
  onMentionIdsChange,
  placeholder,
  className,
  editable = true,
  autoFocus,
  suggestionsPlacement = 'above',
}: MentionInputProps) {
  const { client } = useAuth();
  const inputRef = React.useRef<TextInput | null>(null);
  const [caret, setCaret] = React.useState(0);
  const [picks, setPicks] = React.useState<Pick[]>([]);
  const [results, setResults] = React.useState<User[]>([]);
  const [dismissed, setDismissed] = React.useState(false);

  const active = React.useMemo(
    () => activeMention(value.slice(0, Math.min(caret, value.length)), picks),
    [value, caret, picks]
  );
  const token = active?.token.trim() ?? '';

  // Recompute mention ids from the picks that survive in the text, so deleting a mention
  // stops sending it.
  const idsCb = React.useRef(onMentionIdsChange);
  idsCb.current = onMentionIdsChange;
  React.useEffect(() => {
    const ids = picks.filter((p) => value.includes(`@${p.name}`)).map((p) => p.id);
    idsCb.current?.([...new Set(ids)]);
  }, [value, picks]);

  // Debounced people search for the active token.
  React.useEffect(() => {
    if (!active || token.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { items } = await client.searchUsers({ q: token, limit: 8 });
        if (!cancelled) setResults(items);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, active, token]);

  function insert(user: User) {
    if (!active) return;
    const inserted = `@${user.name} `;
    const next = value.slice(0, active.at) + inserted + value.slice(caret);
    const nextCaret = active.at + inserted.length;
    setPicks((prev) =>
      prev.some((p) => p.id === user.id) ? prev : [...prev, { id: user.id, name: user.name }]
    );
    onChangeText(next);
    setResults([]);
    setCaret(nextCaret);
    // Restore focus + caret after the controlled re-render.
    setTimeout(() => {
      const el = inputRef.current as unknown as
        | { focus?: () => void; setSelectionRange?: (a: number, b: number) => void }
        | null;
      el?.focus?.();
      el?.setSelectionRange?.(nextCaret, nextCaret);
    }, 0);
  }

  const open = !!active && !dismissed && (results.length > 0 || token.length === 0);

  return (
    <View className="relative">
      <Textarea
        ref={inputRef}
        value={value}
        editable={editable}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        onChangeText={(next) => {
          setDismissed(false);
          onChangeText(next);
        }}
        onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
        onKeyPress={(e) => {
          // Escape closes the picker. Enter is never bound — it inserts a newline.
          if ((e.nativeEvent as { key?: string }).key === 'Escape') setDismissed(true);
        }}
      />
      {open ? (
        <View
          className={`border-border bg-popover absolute left-0 z-50 w-72 overflow-hidden rounded-md border shadow-md shadow-black/10 ${
            suggestionsPlacement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}>
          {token.length === 0 ? (
            <View className="px-3 py-2">
              <Text className="text-muted-foreground text-xs">Keep typing to find people…</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 224 }}>
              {results.map((user) => (
                <SuggestionRow key={user.id} user={user} onPick={() => insert(user)} />
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * On web the row is a DOM element with `onMouseDown` + `preventDefault`: a click would
 * otherwise blur the textarea before any press handler runs, and RN Pressable's
 * `onPressIn` does not fire reliably for a mousedown that steals focus from a focused
 * TextInput. preventDefault keeps the caret exactly where it was.
 */
function SuggestionRow({ user, onPick }: { user: User; onPick: () => void }) {
  const inner = (
    <>
      <Avatar alt={user.name} className="size-6">
        <AvatarFallback>
          <Text className="text-[10px]">{initialsOf(user.name)}</Text>
        </AvatarFallback>
      </Avatar>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-sm">
          {user.name}
        </Text>
        <Text numberOfLines={1} className="text-muted-foreground text-xs">
          {user.email}
        </Text>
      </View>
      {user.is_agent ? <Text className="text-muted-foreground text-[10px]">agent</Text> : null}
    </>
  );

  if (Platform.OS === 'web') {
    return (
      <div
        role="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.preventDefault();
          onPick();
        }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          cursor: 'pointer',
        }}
        className="hover:bg-accent">
        {inner}
      </div>
    );
  }

  return (
    <Pressable
      onPressIn={onPick}
      className="active:bg-accent flex-row items-center gap-2 px-2.5 py-2">
      {inner}
    </Pressable>
  );
}
