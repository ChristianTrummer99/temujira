import { Markdown } from '@/components/markdown';
import { MentionInput } from '@/components/mention-input';
import { TagPill } from '@/components/tag-pill';
import { UserInfoDialog } from '@/components/user-info-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type Option,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import { saveAttachment } from '@/lib/download';
import { formatAbsolute, formatBytes, initialsOf } from '@/lib/format';
import { useResource } from '@/lib/use-resource';
import type { Comment, Status, Tag, Task, User } from '@temujira/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArchiveIcon,
  CheckIcon,
  FileIcon,
  ListChecksIcon,
  Maximize2Icon,
  Minimize2Icon,
  PaperclipIcon,
  ReplyIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';

interface TaskPageData {
  task: Task;
  statuses: Status[];
  users: User[];
  tags: Tag[];
  comments: Comment[];
}

export default function TaskDetailScreen() {
  const { key, num } = useLocalSearchParams<{ key: string; num: string }>();
  const workspaceKey = (key ?? '').toUpperCase();
  const taskNum = num ?? '';
  const idOrKey = `${workspaceKey}-${taskNum}`;
  const { client, user: currentUser } = useAuth();
  const router = useRouter();

  const [expanded, setExpanded] = React.useState(false);
  const [mentionedUser, setMentionedUser] = React.useState<User | null>(null);

  const resource = useResource<TaskPageData>(async () => {
    const [taskRes, statusRes, userRes, tagRes, commentRes] = await Promise.all([
      client.getTask(idOrKey),
      client.listStatuses(workspaceKey),
      client.listUsers(),
      client.listTags(workspaceKey),
      client.listComments(idOrKey),
    ]);
    return {
      task: taskRes.task,
      statuses: statusRes.items,
      users: userRes.items,
      tags: tagRes.items,
      comments: commentRes.items,
    };
  }, [client, idOrKey, workspaceKey]);

  const setTask = React.useCallback(
    (updated: Task) => {
      resource.setData((prev) => (prev ? { ...prev, task: updated } : prev));
    },
    [resource]
  );

  // Structural comment changes (create/reply/answer/delete) run server side effects —
  // mentions, inbox rows, activity — so we always reload the thread instead of patching.
  const reloadComments = React.useCallback(async () => {
    const { items } = await client.listComments(idOrKey);
    resource.setData((prev) => (prev ? { ...prev, comments: items } : prev));
  }, [client, idOrKey, resource]);

  const patchComment = React.useCallback(
    (updated: Comment) => {
      resource.setData((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.map((c) =>
                c.id === updated.id
                  ? { ...updated, replies: updated.replies?.length ? updated.replies : c.replies }
                  : { ...c, replies: c.replies.map((r) => (r.id === updated.id ? updated : r)) }
              ),
            }
          : prev
      );
    },
    [resource]
  );

  function close() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/w/${workspaceKey}`);
    }
  }

  if (resource.loading) {
    return (
      <View className="bg-background absolute inset-0">
        <View className="gap-4 p-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full" />
        </View>
      </View>
    );
  }

  if (resource.error || !resource.data) {
    return (
      <View className="bg-background absolute inset-0 items-center justify-center gap-3 p-12">
        <Text className="text-destructive text-sm">{resource.error ?? 'Task not found'}</Text>
        <View className="flex-row gap-2">
          <Button variant="outline" size="sm" onPress={() => resource.reload()}>
            <Text>Retry</Text>
          </Button>
          <Button variant="ghost" size="sm" onPress={close}>
            <Text>Close</Text>
          </Button>
        </View>
      </View>
    );
  }

  const { task, statuses, users, tags, comments } = resource.data;

  return (
    <View className="absolute inset-0 flex-row bg-black/30">
      {/* clickable region — dimmed list still visible behind the tray */}
      <Pressable
        onPress={close}
        className={expanded ? 'hidden' : 'flex-1'}
        accessibilityRole="button"
      />

      {/* the tray / drawer */}
      <View
        className={`border-border bg-background h-full flex-col overflow-hidden border-l ${
          expanded ? 'w-full' : 'w-[560px]'
        }`}
        style={Platform.OS === 'web' ? { boxShadow: '0 0 40px rgba(0,0,0,0.2)' } : undefined}>
        {/* tray header: breadcrumb identity + controls */}
        <View className="border-border flex-row items-center justify-between border-b px-4 py-2.5">
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-muted-foreground font-mono text-xs">{task.key}</Text>
              <Badge variant="secondary">
                <Text>{task.status.name}</Text>
              </Badge>
            </View>
          </View>
          <View className="flex-row items-center gap-1">
            {expanded ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onPress={() => setExpanded(false)}
                accessibilityLabel="Collapse tray">
                <Icon as={Minimize2Icon} className="text-muted-foreground size-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onPress={() => setExpanded(true)}
                accessibilityLabel="Expand tray">
                <Icon as={Maximize2Icon} className="text-muted-foreground size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onPress={close}
              accessibilityLabel="Close tray">
              <Icon as={XIcon} className="text-muted-foreground size-4" />
            </Button>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName={`${expanded ? 'mx-auto w-full max-w-3xl' : ''} gap-6 p-5`}>
          <InlineTitleEditor task={task} onChanged={setTask} />

          <View className="flex-row flex-wrap gap-6">
            <StatusPicker task={task} statuses={statuses} onChanged={setTask} />
            <AssigneePicker task={task} users={users} onChanged={setTask} />
            <ArchiveControl task={task} onChanged={setTask} />
          </View>

          <TagEditor task={task} tags={tags} onChanged={setTask} />

          <InlineDescriptionEditor
            task={task}
            users={users}
            onChanged={setTask}
            onMentionPress={setMentionedUser}
          />

          <TaskAttachments
            task={task}
            currentUserId={currentUser?.id ?? ''}
            onChanged={setTask}
          />

          <Separator />

          <CommentsSection
            taskKey={idOrKey}
            comments={comments}
            users={users}
            currentUserId={currentUser?.id ?? ''}
            currentUserIsAdmin={currentUser?.role === 'admin'}
            onReload={reloadComments}
            onPatch={patchComment}
            onMentionPress={setMentionedUser}
          />
        </ScrollView>
      </View>

      <UserInfoDialog user={mentionedUser} onClose={() => setMentionedUser(null)} />
    </View>
  );
}

function InlineTitleEditor({ task, onChanged }: { task: Task; onChanged: (t: Task) => void }) {
  const { client } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (saving || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { task: updated } = await client.updateTask(task.id, { title: title.trim() });
      onChanged(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save title');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-1.5">
      <Text className="text-muted-foreground font-mono text-xs">{task.key}</Text>
      {editing ? (
        <View className="gap-2">
          <Textarea value={title} onChangeText={setTitle} className="min-h-16 text-base" autoFocus />
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" size="sm" onPress={() => setEditing(false)}>
              <Text>Cancel</Text>
            </Button>
            <Button size="sm" onPress={save} disabled={saving || !title.trim()}>
              <Text>{saving ? 'Saving...' : 'Save'}</Text>
            </Button>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button">
          <Text variant="h3">{task.title}</Text>
        </Pressable>
      )}
    </View>
  );
}

function StatusPicker({
  task,
  statuses,
  onChanged,
}: {
  task: Task;
  statuses: Status[];
  onChanged: (t: Task) => void;
}) {
  const { client } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const value: Option = { value: task.status_id, label: task.status.name };

  async function onChange(next: Option) {
    if (!next?.value || next.value === task.status_id) return;
    try {
      const { task: updated } = await client.updateTask(task.id, { status_id: next.value });
      onChanged(updated);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change status');
    }
  }

  return (
    <View className="gap-1.5">
      <Label>Status</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="min-w-40">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((status) => (
            <SelectItem key={status.id} value={status.id} label={status.name} />
          ))}
        </SelectContent>
      </Select>
      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
    </View>
  );
}

function AssigneePicker({
  task,
  users,
  onChanged,
}: {
  task: Task;
  users: User[];
  onChanged: (t: Task) => void;
}) {
  const { client } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const value: Option | undefined = task.assignee
    ? { value: task.assignee.id, label: task.assignee.name }
    : undefined;

  async function onChange(next: Option | undefined) {
    const id = next?.value ? next.value : null;
    if (id === task.assignee_id) return;
    try {
      const { task: updated } = await client.updateTask(task.id, { assignee_id: id });
      onChanged(updated);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change assignee');
    }
  }

  return (
    <View className="gap-1.5">
      <Label>Assignee</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="min-w-40">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="" label="Unassigned" />
          {users.map((user) => (
            <SelectItem key={user.id} value={user.id} label={user.name} />
          ))}
        </SelectContent>
      </Select>
      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
    </View>
  );
}

function ArchiveControl({ task, onChanged }: { task: Task; onChanged: (t: Task) => void }) {
  const { client } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const archived = task.archived_at != null;

  async function toggle() {
    try {
      const { task: updated } = await client.updateTask(task.id, { archived: !archived });
      onChanged(updated);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive');
    }
  }

  return (
    <View className="justify-end">
      <Button variant="ghost" onPress={toggle} className="h-9 gap-1.5">
        <Icon as={ArchiveIcon} className="text-muted-foreground size-4" />
        <Text className="text-muted-foreground text-sm">{archived ? 'Unarchive' : 'Archive'}</Text>
      </Button>
      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
    </View>
  );
}

/** Any member may tag a task; only tag CRUD (in settings) is admin-only. */
function TagEditor({
  task,
  tags,
  onChanged,
}: {
  task: Task;
  tags: Tag[];
  onChanged: (t: Task) => void;
}) {
  const { client } = useAuth();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const selected = new Set(task.tags.map((t) => t.id));

  async function toggle(tagId: string) {
    if (saving) return;
    const next = selected.has(tagId)
      ? task.tags.filter((t) => t.id !== tagId).map((t) => t.id)
      : [...task.tags.map((t) => t.id), tagId];
    setSaving(true);
    setError(null);
    try {
      const { task: updated } = await client.updateTask(task.id, { tag_ids: next });
      onChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update tags');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium">Tags</Text>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5">
              <Icon as={TagIcon} className="text-muted-foreground size-3.5" />
              <Text className="text-sm">Edit</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            {tags.length === 0 ? (
              <Text className="text-muted-foreground p-2 text-xs">
                No tags in this workspace yet. An admin can add them in Settings → Workspaces.
              </Text>
            ) : (
              <View className="gap-0.5">
                {tags.map((tag) => (
                  <Pressable
                    key={tag.id}
                    onPress={() => toggle(tag.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.has(tag.id) }}
                    className="hover:bg-accent flex-row items-center gap-2 rounded-md px-2 py-1.5">
                    <Checkbox checked={selected.has(tag.id)} onCheckedChange={() => toggle(tag.id)} />
                    <TagPill tag={tag} />
                  </Pressable>
                ))}
              </View>
            )}
            {error ? <Text className="text-destructive p-2 text-xs">{error}</Text> : null}
          </PopoverContent>
        </Popover>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {task.tags.length === 0 ? (
          <Text className="text-muted-foreground text-sm">No tags.</Text>
        ) : (
          task.tags.map((tag) => <TagPill key={tag.id} tag={tag} />)
        )}
      </View>
    </View>
  );
}

function InlineDescriptionEditor({
  task,
  users,
  onChanged,
  onMentionPress,
}: {
  task: Task;
  users: User[];
  onChanged: (t: Task) => void;
  onMentionPress: (u: User) => void;
}) {
  const { client } = useAuth();
  const [editing, setEditing] = React.useState(false);
  const [description, setDescription] = React.useState(task.description);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { task: updated } = await client.updateTask(task.id, { description });
      onChanged(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save description');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium">Description</Text>
        {!editing ? (
          <Button variant="ghost" size="sm" className="h-8" onPress={() => setEditing(true)}>
            <Text className="text-sm">Edit</Text>
          </Button>
        ) : null}
      </View>
      <View className="border-border bg-card gap-2 rounded-md border p-3">
        {editing ? (
          <>
            {/* Plain textarea: task update has no mention_ids in the contract, so a
                description mention renders as a link but never notifies. */}
            <Textarea
              value={description}
              onChangeText={setDescription}
              className="min-h-32"
              placeholder="Markdown supported..."
              autoFocus
            />
            {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" size="sm" onPress={() => setEditing(false)}>
                <Text>Cancel</Text>
              </Button>
              <Button size="sm" onPress={save} disabled={saving}>
                <Text>{saving ? 'Saving...' : 'Save'}</Text>
              </Button>
            </View>
          </>
        ) : task.description ? (
          <Pressable onPress={() => setEditing(true)}>
            <Markdown mentionUsers={users} onMentionPress={onMentionPress}>
              {task.description}
            </Markdown>
          </Pressable>
        ) : (
          <Pressable onPress={() => setEditing(true)}>
            <Text className="text-muted-foreground text-sm">No description yet — click to add.</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function TaskAttachments({
  task,
  currentUserId,
  onChanged,
}: {
  task: Task;
  currentUserId: string;
  onChanged: (t: Task) => void;
}) {
  const { client } = useAuth();
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const attachments = task.attachments ?? [];
  const canDelete = currentUserId && task.created_by === currentUserId;

  const file = React.useRef<HTMLInputElement | null>(null);

  async function onUpload(e: React.ChangeEvent) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const { attachment } = await client.uploadTaskAttachment(task.key, {
        data: f,
        filename: f.name,
        contentType: f.type,
      });
      onChanged({ ...task, attachments: [...attachments, attachment] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onDownload(id: string, filename: string) {
    setError(null);
    try {
      await saveAttachment(client, id, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium">Attachments</Text>
          {attachments.length > 0 ? (
            <Badge variant="secondary">
              <Text>{attachments.length}</Text>
            </Badge>
          ) : null}
        </View>
        <label
          htmlFor="task-attach"
          className={uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}>
          <View
            className="border-border bg-background dark:bg-input/30 hover:bg-accent flex h-8 flex-row items-center gap-1 rounded-md px-3 text-sm shadow-sm shadow-black/5"
            style={{ display: 'flex' }}>
            <Icon as={PaperclipIcon} className="text-muted-foreground size-4" />
            <Text className="text-sm">{uploading ? 'Uploading...' : 'Attach file'}</Text>
          </View>
        </label>
        <input
          id="task-attach"
          ref={file}
          type="file"
          className="hidden"
          onChange={onUpload}
          disabled={uploading}
        />
      </View>
      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
      {attachments.length === 0 ? (
        <Text className="text-muted-foreground text-sm">No attachments.</Text>
      ) : (
        <View className="gap-1.5">
          {attachments.map((a) => (
            <View
              key={a.id}
              className="border-border bg-card flex-row items-center gap-3 rounded-md border p-2.5">
              <Icon as={FileIcon} className="text-muted-foreground size-4" />
              <Pressable onPress={() => onDownload(a.id, a.filename)} className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm underline">
                  {a.filename}
                </Text>
              </Pressable>
              <Text className="text-muted-foreground text-xs">{formatBytes(a.size)}</Text>
              {canDelete || currentUserId === a.uploader_id ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onPress={async () => {
                    try {
                      await client.deleteAttachment(a.id);
                      onChanged({
                        ...task,
                        attachments: attachments.filter((x) => x.id !== a.id),
                      });
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Delete failed');
                    }
                  }}>
                  <Icon as={TrashIcon} className="text-destructive size-3.5" />
                </Button>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ comments

function countComments(comments: Comment[]): number {
  return comments.reduce((n, c) => n + 1 + c.replies.length, 0);
}

function CommentsSection({
  taskKey,
  comments,
  users,
  currentUserId,
  currentUserIsAdmin,
  onReload,
  onPatch,
  onMentionPress,
}: {
  taskKey: string;
  comments: Comment[];
  users: User[];
  currentUserId: string;
  currentUserIsAdmin: boolean;
  onReload: () => Promise<void>;
  onPatch: (c: Comment) => void;
  onMentionPress: (u: User) => void;
}) {
  const { client } = useAuth();
  const [body, setBody] = React.useState('');
  const [mentionIds, setMentionIds] = React.useState<string[]>([]);
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingFile, setPendingFile] = React.useState<{ file: File } | null>(null);
  const [asQuestion, setAsQuestion] = React.useState(false);
  const [options, setOptions] = React.useState<string[]>(['', '']);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
  const questionValid = !asQuestion || (trimmedOptions.length >= 2 && trimmedOptions.length <= 10);

  async function onPost() {
    if (!body.trim() || posting || !questionValid) return;
    setPosting(true);
    setError(null);
    try {
      const { comment } = await client.createComment(taskKey, {
        body: body.trim(),
        mention_ids: mentionIds.length > 0 ? mentionIds : undefined,
        question_options: asQuestion ? trimmedOptions : undefined,
      });
      if (pendingFile) {
        try {
          await client.uploadCommentAttachment(comment.id, {
            data: pendingFile.file,
            filename: pendingFile.file.name,
            contentType: pendingFile.file.type,
          });
        } catch (e) {
          setError(
            e instanceof Error
              ? `Comment posted, but file "${pendingFile.file.name}" failed to upload: ${e.message}`
              : `Comment posted, but file "${pendingFile.file.name}" failed to upload.`
          );
        }
      }
      await onReload();
      setBody('');
      setMentionIds([]);
      setPendingFile(null);
      setAsQuestion(false);
      setOptions(['', '']);
      if (fileInput.current) fileInput.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  }

  function onPickFile() {
    const input = fileInput.current;
    if (!input) return;
    const f = input.files?.[0];
    if (!f) return;
    setPendingFile({ file: f });
    setError(null);
    if (input.value) input.value = '';
  }

  return (
    <View className="gap-5">
      <View className="flex-row items-center gap-2">
        <Text className="text-sm font-medium">Comments</Text>
        {comments.length > 0 ? (
          <Badge variant="secondary">
            <Text>{countComments(comments)}</Text>
          </Badge>
        ) : null}
      </View>

      {comments.map((comment) => (
        <CommentThread
          key={comment.id}
          root={comment}
          taskKey={taskKey}
          users={users}
          currentUserId={currentUserId}
          currentUserIsAdmin={currentUserIsAdmin}
          onReload={onReload}
          onPatch={onPatch}
          onMentionPress={onMentionPress}
        />
      ))}

      <View className="gap-2">
        <View className="border-border bg-card gap-2 rounded-md border p-2.5">
          <MentionInput
            value={body}
            onChangeText={setBody}
            onMentionIdsChange={setMentionIds}
            placeholder="Write a comment — @ to mention, markdown supported..."
            className="min-h-20"
          />
          {asQuestion ? (
            <View className="border-border gap-2 rounded-md border border-dashed p-2.5">
              <Text className="text-xs font-medium">Multiple-choice options (2–10)</Text>
              {options.map((option, i) => (
                <View key={i} className="flex-row items-center gap-2">
                  <Input
                    value={option}
                    onChangeText={(v) =>
                      setOptions((prev) => prev.map((o, j) => (j === i ? v : o)))
                    }
                    placeholder={`Option ${i + 1}`}
                    className="h-8 flex-1"
                  />
                  {options.length > 2 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))}>
                      <Icon as={XIcon} className="text-muted-foreground size-3.5" />
                    </Button>
                  ) : null}
                </View>
              ))}
              {options.length < 10 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 self-start"
                  onPress={() => setOptions((prev) => [...prev, ''])}>
                  <Text className="text-xs">Add option</Text>
                </Button>
              ) : null}
            </View>
          ) : null}
          {pendingFile ? (
            <View className="border-border flex-row items-center gap-2 rounded-md border p-2">
              <Icon as={FileIcon} className="text-muted-foreground size-4" />
              <Text numberOfLines={1} className="flex-1 text-sm">
                {pendingFile.file.name}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onPress={() => setPendingFile(null)}>
                <Icon as={XIcon} className="text-muted-foreground size-3.5" />
              </Button>
            </View>
          ) : null}
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-row items-center gap-2">
              <label htmlFor="comment-attach" className="cursor-pointer">
                <View
                  className="border-border bg-background text-foreground hover:bg-accent flex h-8 flex-row items-center gap-1.5 rounded-md border px-3 text-sm shadow-sm shadow-black/5"
                  style={{ display: 'flex' }}>
                  <Icon as={PaperclipIcon} className="text-muted-foreground size-4" />
                  <Text className="text-sm">Attach file</Text>
                </View>
              </label>
              <Button
                variant={asQuestion ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 gap-1.5"
                onPress={() => setAsQuestion((v) => !v)}>
                <Icon as={ListChecksIcon} className="text-muted-foreground size-4" />
                <Text className="text-sm">{asQuestion ? 'Question on' : 'Ask a question'}</Text>
              </Button>
            </View>
            <Button
              disabled={posting || body.trim().length === 0 || !questionValid}
              onPress={onPost}>
              <Text>{posting ? 'Posting...' : 'Comment'}</Text>
            </Button>
          </View>
          {asQuestion && !questionValid ? (
            <Text className="text-muted-foreground text-xs">
              A question needs at least two non-empty options.
            </Text>
          ) : null}
        </View>
        <input id="comment-attach" ref={fileInput} type="file" className="hidden" onChange={onPickFile} />
      </View>
    </View>
  );
}

function CommentThread({
  root,
  taskKey,
  users,
  currentUserId,
  currentUserIsAdmin,
  onReload,
  onPatch,
  onMentionPress,
}: {
  root: Comment;
  taskKey: string;
  users: User[];
  currentUserId: string;
  currentUserIsAdmin: boolean;
  onReload: () => Promise<void>;
  onPatch: (c: Comment) => void;
  onMentionPress: (u: User) => void;
}) {
  const [replyingTo, setReplyingTo] = React.useState<string | null>(null);

  return (
    <View className="gap-3">
      <CommentCard
        comment={root}
        users={users}
        currentUserId={currentUserId}
        currentUserIsAdmin={currentUserIsAdmin}
        onReload={onReload}
        onPatch={onPatch}
        onMentionPress={onMentionPress}
        onReply={() => setReplyingTo(replyingTo === root.id ? null : root.id)}
      />

      {root.question ? (
        <View className="pl-11">
          <QuestionOptions
            question={root.question}
            taskKey={taskKey}
            parentId={root.id}
            onReload={onReload}
          />
        </View>
      ) : null}

      {root.replies.length > 0 ? (
        <View className="border-border ml-4 gap-3 border-l pl-4">
          {root.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              users={users}
              compact
              currentUserId={currentUserId}
              currentUserIsAdmin={currentUserIsAdmin}
              onReload={onReload}
              onPatch={onPatch}
              onMentionPress={onMentionPress}
              // A reply to a reply targets the root (the server coerces anyway).
              onReply={() => setReplyingTo(replyingTo === root.id ? null : root.id)}
            />
          ))}
        </View>
      ) : null}

      {replyingTo === root.id ? (
        <View className="ml-4 pl-4">
          <ReplyComposer
            taskKey={taskKey}
            parentId={root.id}
            onDone={async () => {
              setReplyingTo(null);
              await onReload();
            }}
            onCancel={() => setReplyingTo(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

function QuestionOptions({
  question,
  taskKey,
  parentId,
  onReload,
}: {
  question: NonNullable<Comment['question']>;
  taskKey: string;
  parentId: string;
  onReload: () => Promise<void>;
}) {
  const { client } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const answered = question.answer_option_index != null;

  async function answer(index: number) {
    if (busy || answered) return;
    setBusy(true);
    setError(null);
    try {
      // Answering IS a child reply carrying the chosen index.
      await client.createComment(taskKey, {
        body: question.options[index],
        parent_id: parentId,
        answer_option_index: index,
      });
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to answer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="border-border bg-muted/30 gap-1.5 rounded-md border p-2.5">
      <View className="flex-row items-center gap-1.5">
        <Icon as={ListChecksIcon} className="text-muted-foreground size-3.5" />
        <Text className="text-muted-foreground text-xs font-medium">
          {answered ? 'Answered' : 'Choose an option'}
        </Text>
      </View>
      {question.options.map((option, i) => {
        const chosen = question.answer_option_index === i;
        return (
          <Button
            key={i}
            variant={chosen ? 'default' : 'outline'}
            size="sm"
            disabled={busy || answered}
            className="h-8 justify-start gap-1.5"
            onPress={() => answer(i)}>
            {chosen ? <Icon as={CheckIcon} className="text-primary-foreground size-3.5" /> : null}
            <Text className="text-sm">{option}</Text>
          </Button>
        );
      })}
      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
    </View>
  );
}

function ReplyComposer({
  taskKey,
  parentId,
  onDone,
  onCancel,
}: {
  taskKey: string;
  parentId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { client } = useAuth();
  const [body, setBody] = React.useState('');
  const [mentionIds, setMentionIds] = React.useState<string[]>([]);
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function post() {
    if (posting || !body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await client.createComment(taskKey, {
        body: body.trim(),
        parent_id: parentId,
        mention_ids: mentionIds.length > 0 ? mentionIds : undefined,
      });
      setBody('');
      setMentionIds([]);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reply');
    } finally {
      setPosting(false);
    }
  }

  return (
    <View className="border-border bg-card gap-2 rounded-md border p-2.5">
      <MentionInput
        value={body}
        onChangeText={setBody}
        onMentionIdsChange={setMentionIds}
        placeholder="Reply…"
        className="min-h-16"
        autoFocus
      />
      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button size="sm" onPress={post} disabled={posting || !body.trim()}>
          <Text>{posting ? 'Replying...' : 'Reply'}</Text>
        </Button>
      </View>
    </View>
  );
}

function CommentCard({
  comment,
  users,
  compact,
  currentUserId,
  currentUserIsAdmin,
  onReload,
  onPatch,
  onMentionPress,
  onReply,
}: {
  comment: Comment;
  users: User[];
  compact?: boolean;
  currentUserId: string;
  currentUserIsAdmin: boolean;
  onReload: () => Promise<void>;
  onPatch: (c: Comment) => void;
  onMentionPress: (u: User) => void;
  onReply: () => void;
}) {
  const { client } = useAuth();
  const canModify = currentUserId === comment.author_id || currentUserIsAdmin;
  const [editing, setEditing] = React.useState(false);
  const [editBody, setEditBody] = React.useState(comment.body);
  const [error, setError] = React.useState<string | null>(null);

  async function onSaveEdit() {
    setError(null);
    try {
      const { comment: updated } = await client.updateComment(comment.id, {
        body: editBody.trim(),
      });
      onPatch(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment');
    }
  }

  async function onDelete() {
    setError(null);
    try {
      await client.deleteComment(comment.id);
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete comment');
    }
  }

  async function onDownload(id: string, filename: string) {
    setError(null);
    try {
      await saveAttachment(client, id, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  return (
    <View className="flex-row gap-3">
      <Avatar alt={comment.author.name} className={compact ? 'size-6' : 'size-8'}>
        <AvatarFallback>
          <Text className={compact ? 'text-[10px]' : 'text-xs'}>
            {initialsOf(comment.author.name)}
          </Text>
        </AvatarFallback>
      </Avatar>
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium">{comment.author.name}</Text>
          <Text className="text-muted-foreground text-xs">{formatAbsolute(comment.created_at)}</Text>
          {comment.updated_at !== comment.created_at ? (
            <Text className="text-muted-foreground text-xs">(edited)</Text>
          ) : null}
          <View className="ml-auto flex-row gap-1">
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2" onPress={onReply}>
              <Icon as={ReplyIcon} className="text-muted-foreground size-3" />
              <Text className="text-xs">Reply</Text>
            </Button>
            {canModify ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onPress={() => setEditing((v) => !v)}>
                  <Text className="text-xs">{editing ? 'Cancel' : 'Edit'}</Text>
                </Button>
                <Button variant="ghost" size="sm" className="h-6 px-2" onPress={onDelete}>
                  <Icon as={TrashIcon} className="text-destructive size-3.5" />
                </Button>
              </>
            ) : null}
          </View>
        </View>
        {editing ? (
          <View className="gap-2">
            <Textarea value={editBody} onChangeText={setEditBody} className="min-h-20" />
            <View className="flex-row justify-end">
              <Button size="sm" onPress={onSaveEdit}>
                <Text>Save</Text>
              </Button>
            </View>
          </View>
        ) : (
          <Markdown mentionUsers={users} onMentionPress={onMentionPress}>
            {comment.body}
          </Markdown>
        )}
        {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
        {comment.attachments.length > 0 ? (
          <View className="mt-1 flex-row flex-wrap gap-1.5">
            {comment.attachments.map((a) => (
              <View
                key={a.id}
                className="border-border bg-card flex-row items-center gap-1.5 rounded-md border px-2 py-1">
                <Icon as={FileIcon} className="text-muted-foreground size-3.5" />
                <Pressable onPress={() => onDownload(a.id, a.filename)}>
                  <Text className="text-xs underline">{a.filename}</Text>
                </Pressable>
                <Text className="text-muted-foreground text-xs">{formatBytes(a.size)}</Text>
                {currentUserId === comment.author_id || currentUserIsAdmin ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onPress={async () => {
                      try {
                        await client.deleteAttachment(a.id);
                        onPatch({
                          ...comment,
                          attachments: comment.attachments.filter((x) => x.id !== a.id),
                        });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Delete failed');
                      }
                    }}>
                    <Icon as={TrashIcon} className="text-destructive size-3" />
                  </Button>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
