import {
  AttachmentPreviewDialog,
  AttachmentThumb,
  attachmentIcon,
} from '@/components/attachment-preview';
import { Markdown } from '@/components/markdown';
import { MentionInput } from '@/components/mention-input';
import { TagPill } from '@/components/tag-pill';
import { UserInfoDialog } from '@/components/user-info-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { formatAbsolute, formatBytes, initialsOf, splitTaskKey } from '@/lib/format';
import { evictPreview, isPreviewable } from '@/lib/preview';
import { useResource } from '@/lib/use-resource';
import type {
  Attachment,
  Comment,
  FieldDef,
  QueueEntry,
  Status,
  Tag,
  Task,
  TaskLink,
  User,
} from '@temujira/client';
import { LINK_RELATIONS, TaskKeyPattern, linkRelationLabel } from '@temujira/shared';
import type { LinkRelation } from '@temujira/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArchiveIcon,
  CheckIcon,
  DownloadIcon,
  FileIcon,
  Link2Icon,
  ListChecksIcon,
  ListOrderedIcon,
  Maximize2Icon,
  Minimize2Icon,
  PaperclipIcon,
  PlusIcon,
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
  fields: FieldDef[];
  /** The current user's queue, so the screen knows whether this task is already in it. */
  queue: QueueEntry[];
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
  const [previewAtt, setPreviewAtt] = React.useState<Attachment | null>(null);

  const resource = useResource<TaskPageData>(async () => {
    const [taskRes, statusRes, userRes, tagRes, fieldRes, queueRes, commentRes] = await Promise.all([
      client.getTask(idOrKey),
      client.listStatuses(workspaceKey),
      client.listUsers(),
      client.listTags(workspaceKey),
      client.listFields(workspaceKey),
      client.getQueue(),
      client.listComments(idOrKey),
    ]);
    return {
      task: taskRes.task,
      statuses: statusRes.items,
      users: userRes.items,
      tags: tagRes.items,
      fields: fieldRes.items,
      queue: queueRes.items,
      comments: commentRes.items,
    };
  }, [client, idOrKey, workspaceKey]);

  const setTask = React.useCallback(
    (updated: Task) => {
      resource.setData((prev) =>
        prev
          ? {
              ...prev,
              task: {
                ...updated,
                // tasks.update embeds neither links nor attachments; keep what tasks.get
                // gave us so a status/assignee change doesn't blank those sections.
                links: updated.links ?? prev.task.links,
                attachments: updated.attachments ?? prev.task.attachments,
              },
            }
          : prev
      );
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

  const { task, statuses, users, tags, fields, queue, comments } = resource.data;

  const queueEntry = queue.find((e) => e.task.id === task.id) ?? null;

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
            <QueueButton
              task={task}
              entry={queueEntry}
              onChanged={(entry) =>
                resource.setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        queue: entry
                          ? [...prev.queue.filter((e) => e.id !== entry.id), entry]
                          : prev.queue.filter((e) => e.task.id !== task.id),
                      }
                    : prev
                )
              }
            />
            <ArchiveControl task={task} onChanged={setTask} />
          </View>

          <TagEditor task={task} tags={tags} onChanged={setTask} />

          <InlineDescriptionEditor
            task={task}
            users={users}
            onChanged={setTask}
            onMentionPress={setMentionedUser}
          />

          <FieldsSection task={task} fields={fields} onChanged={setTask} />

          <LinksSection task={task} onChanged={setTask} />

          <TaskAttachments
            task={task}
            currentUserId={currentUser?.id ?? ''}
            onChanged={setTask}
            onPreview={setPreviewAtt}
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
            onPreview={setPreviewAtt}
          />
        </ScrollView>
      </View>

      <AttachmentPreviewDialog
        attachment={previewAtt}
        users={users}
        onClose={() => setPreviewAtt(null)}
        onMentionPress={setMentionedUser}
      />
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

/**
 * Adds/removes this task on the current user's personal queue (FR-36..40). State
 * transitions (queued/ready/running/complete) are driven from the Queue screen.
 */
function QueueButton({
  task,
  entry,
  onChanged,
}: {
  task: Task;
  entry: QueueEntry | null;
  onChanged: (entry: QueueEntry | null) => void;
}) {
  const { client } = useAuth();
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function toggle() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      if (entry) {
        await client.removeFromQueue(entry.id);
        onChanged(null);
      } else {
        const { entry: added } = await client.addToQueue(task.key);
        onChanged(added);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update queue');
    } finally {
      setWorking(false);
    }
  }

  return (
    <View className="justify-end gap-0.5">
      <Button variant={entry ? 'secondary' : 'outline'} onPress={toggle} className="h-9 gap-1.5">
        <Icon
          as={ListOrderedIcon}
          className={entry ? 'text-muted-foreground size-4' : 'text-foreground size-4'}
        />
        <Text className="text-sm">
          {entry ? `In queue · ${entry.state}` : working ? 'Adding…' : 'Add to queue'}
        </Text>
      </Button>
      {error ? <Text className="text-destructive max-w-40 text-xs">{error}</Text> : null}
    </View>
  );
}

/** Per-field value editors for a task (FR-32/33). Changes save immediately. */
function FieldsSection({
  task,
  fields,
  onChanged,
}: {
  task: Task;
  fields: FieldDef[];
  onChanged: (t: Task) => void;
}) {
  const { client } = useAuth();
  const [error, setError] = React.useState<string | null>(null);

  async function saveValues(fieldId: string, raw: string) {
    const value = raw.trim();
    setError(null);
    try {
      const { task: updated } = await client.updateTask(task.id, {
        field_values: { ...(task.field_values ?? {}), [fieldId]: value },
      });
      onChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save field');
    }
  }

  if (fields.length === 0) return null;

  return (
    <View className="gap-2">
      <Text className="text-sm font-medium">Custom fields</Text>
      <View className="border-border bg-card gap-3 rounded-md border p-3">
        {fields.map((field) => {
          const current = task.field_values?.[field.id] ?? '';
          if (field.type === 'select') {
            return (
              <SelectEditor
                key={field.id}
                field={field}
                value={current}
                onSave={(v) => saveValues(field.id, v)}
              />
            );
          }
          return (
            <TextEditor key={field.id} field={field} value={current} onSave={(v) => saveValues(field.id, v)} />
          );
        })}
        {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
      </View>
    </View>
  );
}

function SelectEditor({
  field,
  value,
  onSave,
}: {
  field: FieldDef;
  value: string;
  onSave: (v: string) => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const selected: Option | undefined = value ? { value, label: value } : undefined;

  async function onChange(next: Option | undefined) {
    const v = next?.value ?? '';
    if (v === value) return;
    setSaving(true);
    try {
      await onSave(v);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Label>{field.name}</Label>
        {saving ? <Text className="text-muted-foreground text-xs">Saving…</Text> : null}
      </View>
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={`Select ${field.name}`} />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option} value={option} label={option} />
          ))}
          <SelectItem value="" label="— None —" />
        </SelectContent>
      </Select>
    </View>
  );
}

function TextEditor({
  field,
  value,
  onSave,
}: {
  field: FieldDef;
  value: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => setDraft(value), [value]);

  async function save() {
    if (!touched || draft.trim() === value) return;
    setSaving(true);
    try {
      await onSave(draft);
      setTouched(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <Label>{field.name}</Label>
        {saving ? <Text className="text-muted-foreground text-xs">Saving…</Text> : null}
      </View>
      <Input
        value={draft}
        onChangeText={(v) => {
          setDraft(v);
          setTouched(true);
        }}
        onBlur={() => void save()}
        keyboardType={field.type === 'number' ? 'numeric' : 'default'}
        placeholder={field.type === 'number' ? 'Number…' : `${field.name}…`}
      />
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

// ------------------------------------------------------------------ links

/**
 * A task's typed links to other tasks (see docs/plans/task-links.md). Links are pure
 * metadata — no side effects. Relation labels read from this task's viewpoint ("blocks"
 * here shows as "blocked by" on the far task's page).
 */
function LinksSection({ task, onChanged }: { task: Task; onChanged: (t: Task) => void }) {
  const { client } = useAuth();
  const router = useRouter();
  const links = task.links ?? [];
  const workspaceKey = splitTaskKey(task.key)?.workspaceKey ?? '';
  const [error, setError] = React.useState<string | null>(null);
  const [relation, setRelation] = React.useState<LinkRelation>('relates');
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Task[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  // After an outward `absorbs` link to a non-archived task, offer to archive it —
  // explicit composition, never implicit (same rule as `tmj task link ... --archive`).
  const [absorbTarget, setAbsorbTarget] = React.useState<TaskLink['task'] | null>(null);

  // debounce search into the API query (same pattern as the list screen)
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  React.useEffect(() => {
    let alive = true;
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    client
      .listTasks(workspaceKey, { q: debouncedQuery.trim(), limit: 10, sort: 'number' })
      .then((res) => {
        if (!alive) return;
        setResults(res.items.filter((t) => t.id !== task.id));
      })
      .catch(() => {
        if (alive) setResults([]);
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [client, workspaceKey, debouncedQuery, task.id]);

  async function addLink(target: string) {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const { link } = await client.createTaskLink(task.key, {
        type: relation,
        task: target,
      });
      onChanged({ ...task, links: [...links, link] });
      // Outward absorbs → offer explicit archive of the absorbed task.
      if (relation === 'absorbs' && link.task.archived_at == null) setAbsorbTarget(link.task);
      setQuery('');
      setResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link task');
    } finally {
      setWorking(false);
    }
  }

  async function removeLink(link: TaskLink) {
    setError(null);
    try {
      await client.deleteTaskLink(link.id);
      onChanged({ ...task, links: links.filter((l) => l.id !== link.id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unlink');
    }
  }

  function navigate(ref: TaskLink['task']) {
    const split = splitTaskKey(ref.key);
    // Cross-workspace keys carry their own prefix, so this always lands on the right task.
    if (split) router.push(`/w/${split.workspaceKey}/t/${split.number}`);
  }

  const typedKey = query.trim().toUpperCase();

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium">Links</Text>
          {links.length > 0 ? (
            <Badge variant="secondary">
              <Text>{links.length}</Text>
            </Badge>
          ) : null}
        </View>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5">
              <Icon as={Link2Icon} className="text-muted-foreground size-3.5" />
              <Text className="text-sm">Link</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <View className="gap-2">
              <Text className="text-xs font-medium">Link this task to another</Text>
              <Select
                value={{ value: relation, label: linkRelationLabel(relation) }}
                onValueChange={(o) => {
                  if (o?.value) setRelation(o.value as LinkRelation);
                }}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder="Relation" />
                </SelectTrigger>
                <SelectContent>
                  {LINK_RELATIONS.map((r) => (
                    <SelectItem key={r} value={r} label={linkRelationLabel(r)} />
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder="Search, or type a key (e.g. START-2)"
                autoCapitalize="characters"
                className="h-8"
              />
              <View className="max-h-48">
                {searching ? (
                  <Text className="text-muted-foreground p-1 text-xs">Searching…</Text>
                ) : results.length > 0 ? (
                  results.map((t) => (
                    <Pressable
                      key={t.id}
                      disabled={working}
                      onPress={() => addLink(t.key)}
                      accessibilityRole="button"
                      className="hover:bg-accent flex-row items-center gap-2 rounded-md px-2 py-1.5">
                      <View
                        style={{ backgroundColor: t.status.color }}
                        className="h-2 w-2 shrink-0 rounded-full"
                      />
                      <Text className="w-20 shrink-0 font-mono text-xs">{t.key}</Text>
                      <Text numberOfLines={1} className="min-w-0 flex-1 text-xs">
                        {t.title}
                      </Text>
                      {t.archived_at ? (
                        <Text className="text-muted-foreground text-xs">archived</Text>
                      ) : null}
                    </Pressable>
                  ))
                ) : debouncedQuery.trim().length > 0 && TaskKeyPattern.test(typedKey) ? (
                  // Verbatim key row: links the far task by key even when it lives in another
                  // workspace (the search above is workspace-scoped).
                  <Pressable
                    disabled={working}
                    onPress={() => addLink(typedKey)}
                    accessibilityRole="button"
                    className="hover:bg-accent flex-row items-center gap-2 rounded-md px-2 py-1.5">
                    <Icon as={Link2Icon} className="text-muted-foreground size-3.5" />
                    <Text className="font-mono text-xs">{typedKey}</Text>
                    <Text className="text-muted-foreground text-xs">link by key</Text>
                  </Pressable>
                ) : // keep space clear
                null}
              </View>
              {error ? <Text className="text-destructive text-xs">{error}</Text> : null}
              {working ? <Text className="text-muted-foreground text-xs">Linking…</Text> : null}
            </View>
          </PopoverContent>
        </Popover>
      </View>

      {links.length === 0 ? (
        <Text className="text-muted-foreground text-sm">No links yet.</Text>
      ) : (
        <View className="gap-1.5">
          {links.map((link) => (
            <View
              key={link.id}
              className="border-border bg-card flex-row items-center gap-3 rounded-md border p-2.5">
              <Pressable
                onPress={() => navigate(link.task)}
                accessibilityRole="button"
                className={`min-w-0 flex-1 ${link.task.archived_at != null ? 'opacity-55' : ''}`}>
                <View className="flex-row items-center gap-2">
                  <Text className="w-24 shrink-0 text-xs">{linkRelationLabel(link.type)}</Text>
                  <Text
                    numberOfLines={1}
                    className={`w-20 shrink-0 font-mono text-xs ${
                      link.task.archived_at != null ? 'line-through' : ''
                    }`}>
                    {link.task.key}
                  </Text>
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-xs">
                    {link.task.title}
                  </Text>
                  <Badge variant="secondary" className="hidden sm:flex">
                    <View className="flex-row items-center gap-1.5">
                      <View
                        style={{ backgroundColor: link.task.status.color }}
                        className="h-2 w-2 rounded-full"
                      />
                      <Text>{link.task.status.name}</Text>
                    </View>
                  </Badge>
                </View>
              </Pressable>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onPress={() => removeLink(link)}
                accessibilityLabel={`Unlink ${link.task.key}`}>
                <Icon as={TrashIcon} className="text-muted-foreground size-3.5" />
              </Button>
            </View>
          ))}
        </View>
      )}

      {absorbTarget ? (
        <View className="border-border bg-card flex-row items-center gap-2 rounded-md border p-2.5">
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm">
            Absorbed {absorbTarget.key} — archive it?
          </Text>
          <Button
            variant="secondary"
            size="sm"
            className="h-7"
            onPress={async () => {
              setError(null);
              try {
                await client.updateTask(absorbTarget.key, { archived: true });
                onChanged({
                  ...task,
                  links: links.map((l) =>
                    l.task.id === absorbTarget.id
                      ? { ...l, task: { ...l.task, archived_at: Date.now() } }
                      : l
                  ),
                });
                setAbsorbTarget(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to archive');
              }
            }}>
            <Text className="text-xs">Archive</Text>
          </Button>
          <Button variant="ghost" size="sm" className="h-7" onPress={() => setAbsorbTarget(null)}>
            <Text className="text-xs">Dismiss</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function TaskAttachments({
  task,
  currentUserId,
  onChanged,
  onPreview,
}: {
  task: Task;
  currentUserId: string;
  onChanged: (t: Task) => void;
  onPreview: (a: Attachment) => void;
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
              <AttachmentThumb attachment={a} />
              <Pressable
                onPress={() => (isPreviewable(a) ? onPreview(a) : onDownload(a.id, a.filename))}
                className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm underline">
                  {a.filename}
                </Text>
              </Pressable>
              <Text className="text-muted-foreground text-xs">{formatBytes(a.size)}</Text>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onPress={() => onDownload(a.id, a.filename)}
                accessibilityLabel={`Download ${a.filename}`}>
                <Icon as={DownloadIcon} className="text-muted-foreground size-3.5" />
              </Button>
              {canDelete || currentUserId === a.uploader_id ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onPress={async () => {
                    try {
                      await client.deleteAttachment(a.id);
                      evictPreview(a.id);
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
  onPreview,
}: {
  taskKey: string;
  comments: Comment[];
  users: User[];
  currentUserId: string;
  currentUserIsAdmin: boolean;
  onReload: () => Promise<void>;
  onPatch: (c: Comment) => void;
  onMentionPress: (u: User) => void;
  onPreview: (a: Attachment) => void;
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
          onPreview={onPreview}
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
  onPreview,
}: {
  root: Comment;
  taskKey: string;
  users: User[];
  currentUserId: string;
  currentUserIsAdmin: boolean;
  onReload: () => Promise<void>;
  onPatch: (c: Comment) => void;
  onMentionPress: (u: User) => void;
  onPreview: (a: Attachment) => void;
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
        onPreview={onPreview}
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
              onPreview={onPreview}
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
  onPreview,
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
  onPreview: (a: Attachment) => void;
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
                <Icon as={attachmentIcon(a)} className="text-muted-foreground size-3.5" />
                <Pressable
                  onPress={() =>
                    isPreviewable(a) ? onPreview(a) : onDownload(a.id, a.filename)
                  }>
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
                        evictPreview(a.id);
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
