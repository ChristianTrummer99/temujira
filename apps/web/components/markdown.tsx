import { MarkdownContent } from '@/components/markdown-content';
import { splitTaskKey } from '@/lib/format';
import { useWorkspaceKeys } from '@/lib/workspaces';
import type { User } from '@temujira/client';
import { useRouter } from 'expo-router';
import * as React from 'react';

export interface MarkdownProps {
  children: string;
  mentionUsers?: User[];
  onMentionPress?: (user: User) => void;
}

export interface MarkdownContentProps extends MarkdownProps {
  workspaceKeys: string[];
  onTaskPress: (key: string) => void;
}

/** One Markdown contract for comments, replies, inbox entries, descriptions and previews. */
export function Markdown(props: MarkdownProps) {
  const router = useRouter();
  const workspaceKeys = useWorkspaceKeys();
  return (
    <MarkdownContent
      {...props}
      workspaceKeys={workspaceKeys}
      onTaskPress={(key) => {
        const parsed = splitTaskKey(key);
        if (parsed) router.push(`/w/${parsed.workspaceKey}/t/${parsed.number}`);
      }}
    />
  );
}
