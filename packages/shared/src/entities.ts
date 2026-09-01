import { z } from "zod";

// ---------- scalars ----------

export const UlidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "invalid id");
export const TimestampSchema = z.number().int(); // unix ms
export const WorkspaceKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,5}$/, "key must be 2-6 uppercase chars (A-Z, digits)");
export const TaskKeyPattern = /^[A-Z][A-Z0-9]{1,5}-[0-9]+$/;
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex color like #3b82f6");
export const EmailInputSchema = z.email().max(254).transform((s) => s.toLowerCase());
export const PasswordSchema = z.string().min(8, "password must be at least 8 characters").max(256);
export const NameSchema = z.string().trim().min(1).max(200);
export const TitleSchema = z.string().trim().min(1).max(500);
export const MarkdownBodySchema = z.string().min(1).max(100_000);
export const DescriptionSchema = z.string().max(100_000);

/** Accepts "true"/"1"/"yes" (query strings) or a real boolean. */
export const QueryBoolSchema = z
  .preprocess((v) => {
    if (typeof v === "string") return ["true", "1", "yes"].includes(v.toLowerCase());
    return v;
  }, z.boolean())
  .default(false);

// ---------- entities (API response shapes) ----------

export const RoleSchema = z.enum(["admin", "member"]);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: UlidSchema,
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
  is_agent: z.boolean(),
  deactivated_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type User = z.infer<typeof UserSchema>;

export const ApiKeySchema = z.object({
  id: UlidSchema,
  user_id: UlidSchema,
  name: z.string(),
  token_prefix: z.string(),
  last_used_at: TimestampSchema.nullable(),
  revoked_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const WorkspaceSchema = z.object({
  id: UlidSchema,
  name: z.string(),
  key: z.string(),
  archived_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const StatusSchema = z.object({
  id: UlidSchema,
  workspace_id: UlidSchema,
  name: z.string(),
  color: z.string(),
  position: z.number().int(),
  created_at: TimestampSchema,
});
export type Status = z.infer<typeof StatusSchema>;

export const TagSchema = z.object({
  id: UlidSchema,
  workspace_id: UlidSchema,
  name: z.string(),
  color: z.string(),
  created_at: TimestampSchema,
});
export type Tag = z.infer<typeof TagSchema>;

export const ActivityEventSchema = z.object({
  id: UlidSchema,
  workspace_id: UlidSchema,
  task_id: UlidSchema.nullable(),
  task_key: z.string().nullable(),
  task_title: z.string().nullable(),
  actor_id: UlidSchema,
  actor: UserSchema,
  action: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: TimestampSchema,
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const AttachmentSchema = z.object({
  id: UlidSchema,
  task_id: UlidSchema.nullable(),
  comment_id: UlidSchema.nullable(),
  uploader_id: UlidSchema,
  filename: z.string(),
  mime_type: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  created_at: TimestampSchema,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

// ---------- task links ----------

/**
 * Link types as STORED: one canonical row per link, read as "src <type> dst".
 * The inverse spelling is computed per viewpoint at serialization, never stored, so the
 * two ends of a link can never disagree.
 */
export const LINK_TYPES = ["relates", "blocks", "absorbs"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** Link relations as seen ON THE WIRE, from the viewpoint of the task you asked about. */
export const LINK_RELATIONS = ["relates", "blocks", "blocked_by", "absorbs", "absorbed_by"] as const;
export const LinkRelationSchema = z.enum(LINK_RELATIONS);
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/** Wire relation → the canonical row to store, and whether src/dst swap. */
export const LINK_CANONICAL: Record<LinkRelation, { type: LinkType; flip: boolean }> = {
  relates: { type: "relates", flip: false },
  blocks: { type: "blocks", flip: false },
  blocked_by: { type: "blocks", flip: true },
  absorbs: { type: "absorbs", flip: false },
  absorbed_by: { type: "absorbs", flip: true },
};

/** Stored type → the relation shown on the destination side. */
export const LINK_INVERSE: Record<LinkType, LinkRelation> = {
  relates: "relates",
  blocks: "blocked_by",
  absorbs: "absorbed_by",
};

/** Human label for a relation, e.g. "blocked by". */
export const linkRelationLabel = (r: LinkRelation): string => r.replace(/_/g, " ");

/** A task referenced by ULID or by its human key (e.g. "START-2"). */
export const TaskRefSchema = z
  .string()
  .trim()
  .refine((s) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s) || TaskKeyPattern.test(s), {
    message: "task must be a task id or a key like TEM-42",
  });

/** The far end of a link, carrying its own workspace's key. */
export const LinkedTaskRefSchema = z.object({
  id: UlidSchema,
  key: z.string(),
  workspace_id: UlidSchema,
  title: z.string(),
  status: StatusSchema,
  archived_at: TimestampSchema.nullable(),
});
export type LinkedTaskRef = z.infer<typeof LinkedTaskRefSchema>;

export const TaskLinkSchema = z.object({
  id: UlidSchema,
  /** Relation as seen from the embedding task: "absorbs" on START-1, "absorbed_by" on START-2. */
  type: LinkRelationSchema,
  /** The OTHER endpoint. */
  task: LinkedTaskRefSchema,
  created_by: UlidSchema,
  created_at: TimestampSchema,
});
export type TaskLink = z.infer<typeof TaskLinkSchema>;

export const CreateTaskLinkInputSchema = z.object({
  /** Relation as seen from the task in the URL. */
  type: LinkRelationSchema,
  /** The other task, by ULID or key. */
  task: TaskRefSchema,
});

export const TaskSchema = z.object({
  id: UlidSchema,
  workspace_id: UlidSchema,
  number: z.number().int(),
  /** Human key like "TEM-42" (workspace key + number). */
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status_id: UlidSchema,
  status: StatusSchema,
  assignee_id: UlidSchema.nullable(),
  assignee: UserSchema.nullable(),
  created_by: UlidSchema,
  archived_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  /** Embedded on tasks.get only. */
  attachments: z.array(AttachmentSchema).optional(),
  /** Embedded on tasks.get only; relations are from this task's viewpoint. */
  links: z.array(TaskLinkSchema).optional(),
  /** Embedded tags (always present on list/get). */
  tags: z.array(TagSchema),
});
export type Task = z.infer<typeof TaskSchema>;

export type Comment = {
  id: string;
  task_id: string;
  parent_id: string | null;
  author_id: string;
  author: User;
  body: string;
  question: { options: string[]; answer_option_index: number | null } | null;
  replies: Comment[];
  attachments: Attachment[];
  created_at: number;
  updated_at: number;
};

export const CommentSchema: z.ZodType<Comment> = z.object({
  id: UlidSchema,
  task_id: UlidSchema,
  parent_id: UlidSchema.nullable(),
  author_id: UlidSchema,
  author: UserSchema,
  body: z.string(),
  question: z
    .object({
      options: z.array(z.string()),
      answer_option_index: z.number().int().nullable(),
    })
    .nullable(),
  replies: z.lazy(() => z.array(CommentSchema)),
  attachments: z.array(AttachmentSchema),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export const InboxItemSchema = z.object({
  id: UlidSchema,
  user_id: UlidSchema,
  workspace_id: UlidSchema,
  workspace: WorkspaceSchema,
  task_id: UlidSchema,
  task_key: z.string(),
  task_title: z.string(),
  actor_id: UlidSchema,
  actor: UserSchema,
  kind: z.enum(["mention", "reply"]),
  /** The comment that triggered the inbox entry (the mentioned or reply comment). */
  source_comment: CommentSchema,
  parent_comment: CommentSchema.nullable(),
  read_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

// ---------- request bodies ----------

export const SetupInputSchema = z.object({
  email: EmailInputSchema,
  name: NameSchema,
  password: PasswordSchema,
});

export const LoginInputSchema = z.object({
  email: EmailInputSchema,
  password: z.string().min(1),
});

export const UpdateMeInputSchema = z
  .object({
    name: NameSchema.optional(),
    current_password: z.string().optional(),
    new_password: PasswordSchema.optional(),
  })
  .refine((v) => !v.new_password || !!v.current_password, {
    message: "current_password is required to change password",
  });

export const CreateApiKeyInputSchema = z.object({
  name: NameSchema,
  /** Admin only: mint a key for another user (agent provisioning). */
  user_id: UlidSchema.optional(),
});

export const CreateUserInputSchema = z
  .object({
    email: EmailInputSchema,
    name: NameSchema,
    role: RoleSchema.default("member"),
    is_agent: z.boolean().default(false),
    /** Required for human accounts; forbidden for agent accounts (API-key-only login). */
    password: PasswordSchema.optional(),
  })
  .refine((v) => (v.is_agent ? v.password === undefined : v.password !== undefined), {
    message: "password is required for human accounts and not allowed for agent accounts",
  });

export const UpdateUserInputSchema = z.object({
  name: NameSchema.optional(),
  role: RoleSchema.optional(),
  password: PasswordSchema.optional(),
  reactivate: z.boolean().optional(),
});

export const CreateWorkspaceInputSchema = z.object({
  name: NameSchema,
  key: WorkspaceKeySchema,
});

export const UpdateWorkspaceInputSchema = z.object({
  name: NameSchema.optional(),
  archived: z.boolean().optional(),
});

export const CreateStatusInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: HexColorSchema.default("#6b7280"),
});

export const UpdateStatusInputSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: HexColorSchema.optional(),
});

export const ReorderStatusesInputSchema = z.object({
  /** Complete ordered list of ALL status ids in the workspace. */
  status_ids: z.array(UlidSchema).min(1),
});

export const TagNameSchema = z.string().trim().min(1).max(50);

export const CreateTagInputSchema = z.object({
  name: TagNameSchema,
  color: HexColorSchema.default("#6b7280"),
});

export const UpdateTagInputSchema = z.object({
  name: TagNameSchema.optional(),
  color: HexColorSchema.optional(),
});

export const CreateTaskInputSchema = z.object({
  title: TitleSchema,
  description: DescriptionSchema.default(""),
  /** Defaults to the workspace's first status. */
  status_id: UlidSchema.optional(),
  assignee_id: UlidSchema.nullable().optional(),
  /** Replaces the task's full tag set with this list. */
  tag_ids: z.array(UlidSchema).optional(),
});

export const UpdateTaskInputSchema = z.object({
  title: TitleSchema.optional(),
  description: DescriptionSchema.optional(),
  status_id: UlidSchema.optional(),
  /** null unassigns. */
  assignee_id: UlidSchema.nullable().optional(),
  archived: z.boolean().optional(),
  /** Replaces the task's full tag set with this list. */
  tag_ids: z.array(UlidSchema).optional(),
});

export const CreateCommentInputSchema = z.object({
  body: MarkdownBodySchema,
  /** Reply to this root comment id (one level of depth). */
  parent_id: UlidSchema.optional(),
  /** Pose a multiple-choice question on a root comment. */
  question_options: z.array(z.string().trim().min(1).max(200)).min(2).max(10).optional(),
  /** When replying to a question comment, the 0-based option index chosen. */
  answer_option_index: z.number().int().min(0).optional(),
  /** @-mention user ids to notify (resolved from @tokens by the client). */
  mention_ids: z.array(UlidSchema).optional(),
});

export const UpdateCommentInputSchema = z.object({
  body: MarkdownBodySchema.optional(),
  question_options: z.array(z.string().trim().min(1).max(200)).min(2).max(10).nullable().optional(),
});

export const ListInboxQuerySchema = z.object({
  include_read: QueryBoolSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const UpdateInboxQuerySchema = z.object({
  /** Mark all of the current user's inbox items as read. */
  mark_read: QueryBoolSchema,
});

// ---------- queries ----------

export const ListApiKeysQuerySchema = z.object({
  /** Admin only: list another user's keys. */
  user_id: UlidSchema.optional(),
});

export const ListUsersQuerySchema = z.object({
  include_deactivated: QueryBoolSchema,
});

export const ListWorkspacesQuerySchema = z.object({
  include_archived: QueryBoolSchema,
});

export const DeleteStatusQuerySchema = z.object({
  /** Required when tasks still reference the status. */
  move_to: UlidSchema.optional(),
});

export const TASK_SORT_FIELDS = ["created_at", "updated_at", "number", "title"] as const;

export const TASK_GROUP_FIELDS = ["none", "status", "tag", "assignee"] as const;

export const ListTasksQuerySchema = z.object({
  status_id: UlidSchema.optional(),
  assignee_id: UlidSchema.optional(),
  tag_id: UlidSchema.optional(),
  /** Substring match on title. */
  q: z.string().optional(),
  include_archived: QueryBoolSchema,
  sort: z.enum(TASK_SORT_FIELDS).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /**
   * Presentational hint for the client to group tasks client-side.
   * "status" | "tag" | "assignee" | "none" (default).
   */
  group_by: z.enum(TASK_GROUP_FIELDS).default("none"),
});

export const ListTagsQuerySchema = z.object({});

export const ListActivityQuerySchema = z.object({
  /** Filter to the current user's associated tasks when true (my activity). */
  mine: QueryBoolSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ListMyTasksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const MentionSearchQuerySchema = z.object({
  /** Substring match on name or email; min 1 char. */
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
