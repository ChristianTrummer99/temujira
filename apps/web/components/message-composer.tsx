import { ComposerAttachments } from '@/components/composer-attachments';
import { DraftStatus } from '@/components/draft-status';
import { MarkdownField } from '@/components/markdown-field';
import { MentionInput } from '@/components/mention-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/lib/auth';
import { hasScope } from '@/lib/scopes';
import { useMessageDraft } from '@/lib/use-message-draft';
import { usePendingAttachments } from '@/lib/pending-attachments';
import type { User } from '@temujira/client';
import * as React from 'react';
import { View } from 'react-native';

export function MessageComposer({ taskKey, users, parentId, draft, onPosted, onCancel }: {
  taskKey: string; users: User[]; parentId?: string;
  draft: ReturnType<typeof useMessageDraft>;
  onPosted: () => Promise<void>; onCancel?: () => void;
}) {
  const { client, user } = useAuth();
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState('');
  const data = draft.data;
  const queue = usePendingAttachments(data.attachments, (change) => draft.update((previous) => ({ ...previous, attachments: change(previous.attachments) })));
  const label = parentId ? 'reply' : 'comment';
  const options = data.options.map((v) => v.trim()).filter(Boolean);
  const questionValid = !!parentId || !data.asQuestion || (options.length >= 2 && options.length <= 10);
  const hasContent = !!data.body.trim() || queue.items.length > 0;
  const disabled = posting || !draft.ready;

  async function reload() {
    try { await onPosted(); }
    catch { setError('Message posted. Refresh the ticket to load it.'); }
  }
  async function post() {
    if (disabled || queue.missingFiles || (!data.postedCommentId && (!hasContent || !questionValid))) return;
    setPosting(true); setError('');
    let postedId = data.postedCommentId;
    try {
      if (!postedId) {
        const { comment } = await client.createComment(taskKey, {
          body: data.body.trim() || queue.items.map((item) => item.filename).join('\n'), parent_id: parentId,
          mention_ids: data.mentionIds.length ? data.mentionIds : undefined,
          question_options: !parentId && data.asQuestion ? options : undefined,
        });
        postedId = comment.id;
        // The text now exists on the server. Retain only the attachment retry, so
        // a failed upload or refresh can never post the message a second time.
        if (queue.items.length) draft.update({ body: '', mentionIds: [], asQuestion: false, options: ['', ''], postedCommentId: postedId });
      }
      await queue.uploadAll((file) => client.uploadCommentAttachment(postedId!, file));
      queue.clear(); draft.clear();
      await reload();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Request failed';
      setError(postedId ? `Message posted, but the file upload failed: ${message}` : `Could not post message: ${message}`);
      if (postedId) await reload();
    } finally { setPosting(false); }
  }

  return <View className="border-border bg-card gap-2 rounded-md border p-2.5" testID={`${label}-composer`}>
    {data.postedCommentId ? <Text role="status" className="text-muted-foreground text-sm">Message posted. Retry the attachment to finish.</Text> : <>
      <MarkdownField value={data.body} mentionUsers={users} label={label} onPasteFiles={queue.add} pasteDisabled={disabled || !hasScope(user, 'tasks:write')}>
        <MentionInput value={data.body} onChangeText={(body) => draft.update({ body })}
          onMentionIdsChange={(mentionIds) => draft.update({ mentionIds })} initialMentionIds={data.mentionIds} mentions={users}
          editable={!disabled} autoFocus={!!parentId} placeholder={parentId ? 'Reply…' : 'Write a comment — @ to mention, markdown supported...'} className="min-h-20" />
      </MarkdownField>
      {!parentId && data.asQuestion ? <View className="border-border gap-2 rounded border border-dashed p-2">
        <Text className="text-xs font-medium">Multiple-choice options (2–10)</Text>
        {data.options.map((option, index) => <View key={index} className="flex-row items-center gap-2">
          <Input value={option} editable={!disabled} maxLength={200} placeholder={`Option ${index + 1}`} className="h-8 flex-1"
            onChangeText={(text) => draft.update((previous) => ({ ...previous, options: previous.options.map((v, i) => i === index ? text : v) }))} />
          {data.options.length > 2 ? <Button variant="ghost" size="sm" disabled={disabled} accessibilityLabel={`Remove option ${index + 1}`}
            onPress={() => draft.update((previous) => ({ ...previous, options: previous.options.filter((_, i) => i !== index) }))}><Text>×</Text></Button> : null}
        </View>)}
        {data.options.length < 10 ? <Button variant="outline" size="sm" className="self-start" disabled={disabled} onPress={() => draft.update((previous) => ({ ...previous, options: [...previous.options, ''] }))}><Text>Add option</Text></Button> : null}
      </View> : null}
    </>}
    <ComposerAttachments queue={queue} label={label} disabled={disabled || !hasScope(user, 'tasks:write')} />
    {!data.body.trim() && !data.postedCommentId && queue.items.length ? <Text className="text-muted-foreground text-xs">File names are used as the message if the text is empty.</Text> : null}
    {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : null}
    <View className="flex-row flex-wrap items-center justify-between gap-2">
      {!parentId && !data.postedCommentId ? <Button variant={data.asQuestion ? 'secondary' : 'outline'} size="sm" disabled={disabled} onPress={() => draft.update({ asQuestion: !data.asQuestion })}><Text>{data.asQuestion ? 'Question on' : 'Ask a question'}</Text></Button> : <View />}
      <View className="flex-row gap-2">
        {onCancel ? <Button variant="ghost" size="sm" disabled={posting} onPress={onCancel}><Text>Cancel</Text></Button> : null}
        <Button size="sm" accessibilityLabel={data.postedCommentId ? 'Retry attachment' : parentId ? 'Post reply' : 'Post comment'} onPress={post}
          disabled={disabled || !hasScope(user, 'tasks:write') || queue.missingFiles || (!data.postedCommentId && (!hasContent || !questionValid))}>
          <Text>{posting ? 'Posting...' : data.postedCommentId ? 'Retry attachment' : parentId ? 'Reply' : 'Comment'}</Text>
        </Button>
      </View>
    </View>
    <DraftStatus draft={draft} disabled={posting} discardLabel={data.postedCommentId ? 'Cancel attachment' : 'Discard draft'} onDiscard={() => { queue.clear(); draft.clear(); setError(''); }} />
  </View>;
}
