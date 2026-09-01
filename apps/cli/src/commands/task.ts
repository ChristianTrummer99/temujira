import { Option, type Command } from "commander";
import type { Task, TaskLink } from "@temujira/client";
import type { LinkRelation, RouteId } from "@temujira/shared";
import {
  LINK_RELATIONS,
  TASK_GROUP_FIELDS,
  TASK_SORT_FIELDS,
  linkRelationLabel,
} from "@temujira/shared";
import { getCtx, type Ctx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, indent, kv, table, truncate, ts, userRef } from "../output";
import { isUlid, resolveStatusId, resolveTagId, resolveTagIds, resolveUserId } from "../resolve";
import { collect, nonNegativeInt, resolveTextOption } from "../util";

export const COMMAND_ROUTES = {
  "task list": ["tasks.list", "statuses.list", "users.list", "auth.me", "tags.list"],
  "task mine": ["tasks.mine"],
  "task create": ["tasks.create", "statuses.list", "users.list", "auth.me", "tags.list", "fields.list", "workspaces.get"],
  "task get": ["tasks.get", "fields.list"],
  "task update": ["tasks.update", "tasks.get", "tags.list", "fields.list"],
  "task move": ["tasks.update", "tasks.get", "statuses.list"],
  "task assign": ["tasks.update", "users.list", "auth.me"],
  "task unassign": ["tasks.update"],
  "task archive": ["tasks.update"],
  "task unarchive": ["tasks.update"],
  // tasks.update claims the second, explicit call behind `task link --archive`.
  "task link": ["links.create", "tasks.update"],
  "task links": ["tasks.get"],
  "task unlink": ["links.delete", "tasks.get"],
} as const satisfies Record<string, readonly RouteId[]>;

const RELATION_LIST = LINK_RELATIONS.join(", ");

/** Relations whose link means "one of these two tasks was absorbed" (`--archive` territory). */
const ABSORB_RELATIONS: readonly string[] = ["absorbs", "absorbed_by"];

/** Narrow a positional <relation> to a LinkRelation before any API call (miss → exit 2). */
function requireRelation(value: string): LinkRelation {
  if ((LINK_RELATIONS as readonly string[]).includes(value)) return value as LinkRelation;
  throw new CliError(
    `unknown relation "${value}" — expected one of: ${RELATION_LIST}`,
    EXIT_CODES.usage,
  );
}

/** Does this link's far end match the user's <otherIdOrKey>? ULID → id, else key (case-insensitive). */
function linkPointsAt(link: TaskLink, other: string): boolean {
  return isUlid(other)
    ? link.task.id === other
    : link.task.key.toLowerCase() === other.trim().toLowerCase();
}

const TASK_COLUMNS = ["KEY", "STATUS", "ASSIGNEE", "TAGS", "TITLE", "UPDATED"];

function tagNames(task: Task): string[] {
  return (task.tags ?? []).map((t) => t.name);
}

function taskRow(task: Task): string[] {
  return [
    task.key,
    task.status.name,
    task.assignee ? task.assignee.name : "",
    tagNames(task).join(","),
    truncate(task.title, 60),
    ts(task.updated_at),
  ];
}

/** "(showing 1-50 of 213)" — omitted when the page holds everything. */
function pageNote(res: { items: unknown[]; total: number; offset: number }): string {
  return res.total > res.items.length
    ? `\n(showing ${res.offset + 1}-${res.offset + res.items.length} of ${res.total})`
    : "";
}

/**
 * Client-side grouping for --group-by (the API only echoes the hint). A custom select
 * field id groups by task.field_values[<fieldId>]; "(no value)" catches the rest.
 */
function groupTasks(
  items: Task[],
  by: "status" | "tag" | "assignee",
  fieldId?: string,
): Array<[string, Task[]]> {
  const groups = new Map<string, Task[]>();
  const push = (key: string, task: Task): void => {
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  };
  for (const task of items) {
    if (by === "status") push(task.status.name, task);
    else if (by === "assignee") push(task.assignee ? task.assignee.name : "(unassigned)", task);
    else if (fieldId) push((task.field_values ?? {})[fieldId] ?? "(no value)", task);
    else {
      const names = tagNames(task);
      if (names.length === 0) push("(untagged)", task);
      else for (const name of names) push(name, task);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderTask(task: Task, fieldNames?: Map<string, string>): string {
  let out = kv([
    ["key", task.key],
    ["id", task.id],
    ["title", task.title],
    ["status", task.status.name],
    ["assignee", task.assignee ? userRef(task.assignee) : "(unassigned)"],
    ["tags", tagNames(task).join(", ")],
    ["archived", task.archived_at ? ts(task.archived_at) : "no"],
    ["created", ts(task.created_at)],
    ["updated", ts(task.updated_at)],
  ]);
  const fieldValues = task.field_values ?? {};
  if (Object.keys(fieldValues).length > 0) {
    out += `\n\nfields:\n${indent(
      Object.entries(fieldValues)
        .map(([id, v]) => `${fieldNames?.get(id) ?? id}: ${v}`)
        .sort(([a], [b]) => a.localeCompare(b))
        .join("\n"),
    )}`;
  }
  if (task.description) {
    out += `\n\ndescription:\n${indent(task.description)}`;
  }
  const links = task.links ?? [];
  if (links.length > 0) {
    out += `\n\nlinks:\n${indent(
      links
        .map(
          (l) =>
            `${linkRelationLabel(l.type)} ${l.task.key}  [${l.task.status.name}] ${truncate(l.task.title, 60)}`,
        )
        .join("\n"),
    )}`;
  }
  const attachments = task.attachments ?? [];
  if (attachments.length > 0) {
    out += `\n\nattachments:\n${indent(
      table(
        ["ID", "FILENAME", "SIZE", "TYPE"],
        attachments.map((a) => [a.id, a.filename, String(a.size), a.mime_type]),
      ),
    )}`;
  }
  return out;
}

interface TaskListOpts {
  workspace: string;
  status?: string;
  assignee?: string;
  tag?: string;
  fieldId?: string;
  fieldValue?: string;
  search?: string;
  archived?: boolean;
  sort?: (typeof TASK_SORT_FIELDS)[number];
  order?: "asc" | "desc";
  groupBy?: string;
  limit?: number;
  offset?: number;
}

interface TaskCreateOpts {
  workspace: string;
  title: string;
  description?: string;
  descriptionFile?: string;
  status?: string;
  assignee?: string;
  tag: string[];
  field: string[];
}

/** Shared emitter for every command that yields a single task. */
function emitTask(ctx: Ctx, task: Task, human?: () => string): void {
  emit(ctx.mode, {
    json: { task },
    human: human ?? (() => renderTask(task)),
    quiet: () => task.id,
  });
}

/**
 * Resolve custom-field names (id → name) for a task that carries field values, so the
 * detail view shows readable field labels. Skipped when the task has no values.
 */
async function fieldNamesFor(client: Ctx["client"], task: Task): Promise<Map<string, string> | undefined> {
  const values = task.field_values ?? {};
  if (Object.keys(values).length === 0) return undefined;
  const { items } = await client.listFields(task.workspace_id);
  return new Map(items.map((f) => [f.id, f.name]));
}

/**
 * Resolve `--field <nameOrId>=<value>` specs (names need the workspace the task lives
 * in). Returns the wire `field_values` map; unknown name → exit 4.
 */
async function resolveFieldValues(
  client: Ctx["client"],
  workspaceId: string,
  specs: readonly string[],
): Promise<Record<string, string>> {
  const pairs = new Map<string, string>();
  for (const spec of specs) {
    const eq = spec.indexOf("=");
    if (eq <= 0) {
      throw new CliError(`--field expects <nameOrId>=<value>, got "${spec}"`, EXIT_CODES.usage);
    }
    pairs.set(spec.slice(0, eq).trim(), spec.slice(eq + 1));
  }
  const out: Record<string, string> = {};
  const unknown: string[] = [];
  let byName = new Map<string, string>();
  if (![...pairs.keys()].every(isUlid)) {
    const { items } = await client.listFields(workspaceId);
    byName = new Map(items.map((f) => [f.name.trim().toLowerCase(), f.id]));
  }
  for (const [nameOrId, value] of pairs) {
    const id = isUlid(nameOrId) ? nameOrId : byName.get(nameOrId.trim().toLowerCase());
    if (!id) unknown.push(nameOrId);
    else out[id] = value;
  }
  if (unknown.length > 0) {
    throw new CliError(
      `no field named "${unknown[0]}" in this task's workspace`,
      EXIT_CODES.notFound,
    );
  }
  return out;
}

export function registerTask(program: Command): void {
  const task = program.command("task").description("Manage tasks");

  task
    .command("list")
    .description("List tasks in a workspace (filters, search, sort, pagination)")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .option("--status <idOrName>", "filter by status (id or case-insensitive name)")
    .option("--assignee <idOrEmailOrMe>", 'filter by assignee (id, email, or "me")')
    .option("--tag <idOrName>", "filter by tag (id or case-insensitive name)")
    .option("--field-id <fieldId>", "filter by a custom select field (tasks with any value)")
    .option("--field-value <value>", 'with --field-id: filter to this option value')
    .option("--search <q>", "substring match on title")
    .option("--archived", "include archived tasks")
    .addOption(new Option("--sort <field>", "sort field").choices(TASK_SORT_FIELDS))
    .addOption(new Option("--order <dir>", "sort direction").choices(["asc", "desc"]))
    .option(
      "--group-by <key>",
      'group the printed rows: "status" | "tag" | "assignee" | "none" — or a custom select field id',
    )
    .option("--limit <n>", "page size (max 200)", nonNegativeInt("--limit"))
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"))
    .action(async (opts: TaskListOpts, cmd: Command) => {
      const ctx = getCtx(cmd);
      const query: NonNullable<Parameters<typeof ctx.client.listTasks>[1]> = {};
      if (opts.status) {
        query.status_id = await resolveStatusId(ctx.client, opts.workspace, opts.status);
      }
      if (opts.assignee) query.assignee_id = await resolveUserId(ctx.client, opts.assignee);
      if (opts.tag) query.tag_id = await resolveTagId(ctx.client, opts.workspace, opts.tag);
      if (opts.fieldId) {
        query.field_id = opts.fieldId;
        if (!isUlid(opts.fieldId)) {
          throw new CliError("--field-id must be a field id (use `tmj field list`)", EXIT_CODES.usage);
        }
        if (opts.fieldValue) query.field_value = opts.fieldValue;
      }
      if (opts.search) query.q = opts.search;
      if (opts.archived) query.include_archived = true;
      if (opts.sort) query.sort = opts.sort;
      if (opts.order) query.order = opts.order;
      if (opts.groupBy) query.group_by = opts.groupBy;
      if (opts.limit !== undefined) query.limit = opts.limit;
      if (opts.offset !== undefined) query.offset = opts.offset;
      const res = await ctx.client.listTasks(opts.workspace, query);
      const groupFieldId =
        opts.groupBy && opts.groupBy !== "none" && !(TASK_GROUP_FIELDS as readonly string[]).includes(opts.groupBy)
          ? opts.groupBy
          : undefined;
      const groupKey =
        opts.groupBy && opts.groupBy !== "none" && !groupFieldId ? (opts.groupBy as "status" | "tag" | "assignee") : undefined;
      emit(ctx.mode, {
        json: res,
        human: () => {
          const body = groupKey || groupFieldId
            ? groupTasks(res.items, groupKey ?? "tag", groupFieldId)
                .map(
                  ([name, items]) =>
                    `${name} (${items.length})\n${indent(table(TASK_COLUMNS, items.map(taskRow)))}`,
                )
                .join("\n\n")
            : table(TASK_COLUMNS, res.items.map(taskRow));
          return `${body}${pageNote(res)}`;
        },
        quiet: () => res.items.map((t) => t.key).join("\n"),
      });
    });

  task
    .command("mine")
    .description("List your tasks across workspaces (created, assigned, commented, mentioned)")
    .option("--limit <n>", "page size (max 200)", nonNegativeInt("--limit"))
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"))
    .action(async (opts: { limit?: number; offset?: number }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const query: NonNullable<Parameters<typeof ctx.client.listMyTasks>[0]> = {};
      if (opts.limit !== undefined) query.limit = opts.limit;
      if (opts.offset !== undefined) query.offset = opts.offset;
      const res = await ctx.client.listMyTasks(query);
      emit(ctx.mode, {
        json: res,
        human: () => `${table(TASK_COLUMNS, res.items.map(taskRow))}${pageNote(res)}`,
        quiet: () => res.items.map((t) => t.key).join("\n"),
      });
    });

  task
    .command("create")
    .description("Create a task")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .requiredOption("--title <title>", "task title")
    .option("--description <markdown>", "description (markdown)")
    .option("--description-file <path>", 'read the description from a file ("-" = stdin)')
    .option("--status <idOrName>", "initial status (default: first workspace status)")
    .option("--assignee <idOrEmailOrMe>", 'assignee (id, email, or "me")')
    .option(
      "--tag <idOrName>",
      "tag to apply (repeatable; id or case-insensitive name)",
      collect,
      [] as string[],
    )
    .option(
      "--field <nameOrId=value>",
      'set a custom field value (repeatable; "" clears), e.g. --field Priority=high',
      collect,
      [] as string[],
    )
    .action(async (opts: TaskCreateOpts, cmd: Command) => {
      const ctx = getCtx(cmd);
      const description = await resolveTextOption(
        "description",
        opts.description,
        opts.descriptionFile,
      );
      const body: Parameters<typeof ctx.client.createTask>[1] = { title: opts.title };
      if (description !== undefined) body.description = description;
      if (opts.status) {
        body.status_id = await resolveStatusId(ctx.client, opts.workspace, opts.status);
      }
      if (opts.assignee) body.assignee_id = await resolveUserId(ctx.client, opts.assignee);
      if (opts.tag.length > 0) {
        body.tag_ids = await resolveTagIds(ctx.client, opts.workspace, opts.tag);
      }
      if (opts.field.length > 0) {
        const { workspace: current } = await ctx.client.getWorkspace(opts.workspace);
        body.field_values = await resolveFieldValues(ctx.client, current.id, opts.field);
      }
      const { task: created } = await ctx.client.createTask(opts.workspace, body);
      emitTask(ctx, created, () => `created ${created.key} (${created.id})  ${truncate(created.title, 60)}`);
    });

  task
    .command("get")
    .description("Show a task (description, status, assignee, field values, links, attachments)")
    .argument("<idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { task: found } = await ctx.client.getTask(idOrKey);
      const fieldNames = await fieldNamesFor(ctx.client, found);
      emitTask(ctx, found, () => renderTask(found, fieldNames));
    });

  task
    .command("update")
    .description("Edit a task's title, description, and/or tags")
    .argument("<idOrKey>", "task id or key")
    .option("--title <title>", "new title")
    .option("--description <markdown>", "new description (markdown)")
    .option("--description-file <path>", 'read the new description from a file ("-" = stdin)')
    .option(
      "--tag <idOrName>",
      "replace the task's tags with these (repeatable; id or case-insensitive name)",
      collect,
      [] as string[],
    )
    .option(
      "--field <nameOrId=value>",
      'set a custom field value (repeatable; "" clears), e.g. --field Priority=high',
      collect,
      [] as string[],
    )
    .action(
      async (
        idOrKey: string,
        opts: { title?: string; description?: string; descriptionFile?: string; tag: string[]; field: string[] },
        cmd: Command,
      ) => {
        const ctx = getCtx(cmd);
        const description = await resolveTextOption(
          "description",
          opts.description,
          opts.descriptionFile,
        );
        if (
          opts.title === undefined &&
          description === undefined &&
          opts.tag.length === 0 &&
          opts.field.length === 0
        ) {
          throw new CliError(
            "nothing to update — pass --title, --description, --description-file, --tag, or --field",
            EXIT_CODES.usage,
          );
        }
        const body: Parameters<typeof ctx.client.updateTask>[1] = {};
        if (opts.title !== undefined) body.title = opts.title;
        if (description !== undefined) body.description = description;
        if (opts.tag.length > 0) {
          if (opts.tag.every(isUlid)) {
            body.tag_ids = [...opts.tag];
          } else {
            // Tag names need a workspace to resolve in — learn it from the task.
            const { task: current } = await ctx.client.getTask(idOrKey);
            body.tag_ids = await resolveTagIds(ctx.client, current.workspace_id, opts.tag);
          }
        }
        if (opts.field.length > 0) {
          const { task: current } = await ctx.client.getTask(idOrKey);
          body.field_values = await resolveFieldValues(ctx.client, current.workspace_id, opts.field);
        }
        const { task: updated } = await ctx.client.updateTask(idOrKey, body);
        emitTask(ctx, updated, () => `updated ${updated.key}`);
      },
    );

  task
    .command("move")
    .description("Move a task to another status")
    .argument("<idOrKey>", "task id or key")
    .requiredOption("--status <idOrName>", "target status (id or case-insensitive name)")
    .action(async (idOrKey: string, opts: { status: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      let statusId = opts.status;
      if (!isUlid(statusId)) {
        // A status name needs a workspace to resolve in — learn it from the task.
        const { task: current } = await ctx.client.getTask(idOrKey);
        statusId = await resolveStatusId(ctx.client, current.workspace_id, opts.status);
      }
      const { task: moved } = await ctx.client.updateTask(idOrKey, { status_id: statusId });
      emitTask(ctx, moved, () => `${moved.key} → ${moved.status.name}`);
    });

  task
    .command("assign")
    .description("Assign a task to a user")
    .argument("<idOrKey>", "task id or key")
    .requiredOption("--user <idOrEmailOrMe>", 'assignee (id, email, or "me")')
    .action(async (idOrKey: string, opts: { user: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const assigneeId = await resolveUserId(ctx.client, opts.user);
      const { task: assigned } = await ctx.client.updateTask(idOrKey, { assignee_id: assigneeId });
      emitTask(ctx, assigned, () => `${assigned.key} assigned to ${userRef(assigned.assignee)}`);
    });

  task
    .command("unassign")
    .description("Remove a task's assignee")
    .argument("<idOrKey>", "task id or key")
    .action(async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { task: unassigned } = await ctx.client.updateTask(idOrKey, { assignee_id: null });
      emitTask(ctx, unassigned, () => `${unassigned.key} unassigned`);
    });

  const setArchived = (archived: boolean) =>
    async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { task: changed } = await ctx.client.updateTask(idOrKey, { archived });
      emitTask(ctx, changed, () => `${archived ? "archived" : "unarchived"} ${changed.key}`);
    };

  task
    .command("archive")
    .description("Archive a task")
    .argument("<idOrKey>", "task id or key")
    .action(setArchived(true));

  task
    .command("unarchive")
    .description("Unarchive a task")
    .argument("<idOrKey>", "task id or key")
    .action(setArchived(false));

  task
    .command("link")
    .description(`Link a task to another (${RELATION_LIST})`)
    .argument("<idOrKey>", "task id or key (e.g. TEM-42) — the viewpoint of <relation>")
    .argument("<relation>", `relation from that task: ${RELATION_LIST}`)
    .argument("<otherIdOrKey>", "the other task, by id or key (may be in another workspace)")
    .option(
      "--archive",
      "also archive the absorbed task (absorbs/absorbed_by only; a separate, explicit call)",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  tmj task link START-1 absorbs START-2",
        "  tmj task link START-2 absorbed_by START-1     (the same canonical link)",
        "  tmj task link INFRA-3 blocks APP-9            (cross-workspace)",
      ].join("\n"),
    )
    .action(
      async (
        idOrKey: string,
        relationArg: string,
        otherIdOrKey: string,
        opts: { archive?: boolean },
        cmd: Command,
      ) => {
        const relation = requireRelation(relationArg);
        if (opts.archive && !ABSORB_RELATIONS.includes(relation)) {
          throw new CliError(
            `--archive is only valid with absorbs or absorbed_by (got ${relation})`,
            EXIT_CODES.usage,
          );
        }
        const ctx = getCtx(cmd);
        const { link } = await ctx.client.createTaskLink(idOrKey, {
          type: relation,
          task: otherIdOrKey,
        });
        // Archiving is never implicit: a second, explicit call on the absorbed side.
        // For `absorbs` that is the far task; for `absorbed_by` it is the task in the URL.
        const absorbed = opts.archive
          ? (await ctx.client.updateTask(relation === "absorbs" ? link.task.id : idOrKey, {
              archived: true,
            })).task
          : undefined;
        emit(ctx.mode, {
          json: absorbed ? { link, archived_task: absorbed } : { link },
          human: () => {
            const lines = [`linked: ${idOrKey} ${relation} ${link.task.key}`];
            if (absorbed) lines.push(`archived ${absorbed.key}`);
            return lines.join("\n");
          },
          quiet: () => link.id,
        });
      },
    );

  task
    .command("links")
    .description("List a task's links (composes `task get`)")
    .argument("<idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { task: found } = await ctx.client.getTask(idOrKey);
      const items = found.links ?? [];
      emit(ctx.mode, {
        json: { items },
        human: () =>
          table(
            ["ID", "RELATION", "TASK", "STATUS", "TITLE"],
            items.map((l) => [
              l.id,
              linkRelationLabel(l.type),
              l.task.key,
              l.task.status.name,
              truncate(l.task.title, 60),
            ]),
          ),
        quiet: () => items.map((l) => l.id).join("\n"),
      });
    });

  task
    .command("unlink")
    .description("Remove a link (by relation + other task, or by link id)")
    .argument("<idOrKey>", "task id or key (e.g. TEM-42) — the viewpoint of <relation>")
    .argument("[relation]", `relation from that task: ${RELATION_LIST}`)
    .argument("[otherIdOrKey]", "the other task, by id or key")
    .option("--id <linkId>", "delete this link id directly (skips the lookup)")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  tmj task unlink START-1 absorbs START-2",
        "  tmj task unlink START-1 --id 01J...        (no lookup)",
      ].join("\n"),
    )
    .action(
      async (
        idOrKey: string,
        relationArg: string | undefined,
        otherIdOrKey: string | undefined,
        opts: { id?: string },
        cmd: Command,
      ) => {
        if (opts.id && (relationArg !== undefined || otherIdOrKey !== undefined)) {
          throw new CliError(
            "pass either <relation> <otherIdOrKey> or --id, not both",
            EXIT_CODES.usage,
          );
        }
        if (!opts.id && (relationArg === undefined || otherIdOrKey === undefined)) {
          throw new CliError(
            "pass <relation> <otherIdOrKey> (or --id <linkId>) to say which link to remove",
            EXIT_CODES.usage,
          );
        }
        const ctx = getCtx(cmd);
        let linkId = opts.id;
        let human = () => `unlinked link ${linkId}`;
        if (!linkId) {
          const relation = requireRelation(relationArg as string);
          const other = otherIdOrKey as string;
          const { task: found } = await ctx.client.getTask(idOrKey);
          const match = (found.links ?? []).find(
            (l) => l.type === relation && linkPointsAt(l, other),
          );
          if (!match) {
            throw new CliError(
              `no "${relation}" link from ${found.key} to ${other} (see \`tmj task links ${found.key}\`)`,
              EXIT_CODES.notFound,
            );
          }
          linkId = match.id;
          human = () => `unlinked: ${found.key} ${relation} ${match.task.key}`;
        }
        const res = await ctx.client.deleteTaskLink(linkId);
        emit(ctx.mode, {
          json: res,
          human,
          quiet: () => linkId as string,
        });
      },
    );
}
