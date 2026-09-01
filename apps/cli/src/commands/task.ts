import { Option, type Command } from "commander";
import type { Task } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { TASK_GROUP_FIELDS, TASK_SORT_FIELDS } from "@temujira/shared";
import { getCtx, type Ctx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, indent, kv, table, truncate, ts, userRef } from "../output";
import { isUlid, resolveStatusId, resolveTagId, resolveTagIds, resolveUserId } from "../resolve";
import { collect, nonNegativeInt, resolveTextOption } from "../util";

export const COMMAND_ROUTES = {
  "task list": ["tasks.list", "statuses.list", "users.list", "auth.me", "tags.list"],
  "task mine": ["tasks.mine"],
  "task create": ["tasks.create", "statuses.list", "users.list", "auth.me", "tags.list"],
  "task get": ["tasks.get"],
  "task update": ["tasks.update", "tasks.get", "tags.list"],
  "task move": ["tasks.update", "tasks.get", "statuses.list"],
  "task assign": ["tasks.update", "users.list", "auth.me"],
  "task unassign": ["tasks.update"],
  "task archive": ["tasks.update"],
  "task unarchive": ["tasks.update"],
} as const satisfies Record<string, readonly RouteId[]>;

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

/** Client-side grouping for --group-by (the API only echoes the hint). */
function groupTasks(
  items: Task[],
  by: "status" | "tag" | "assignee",
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
    else {
      const names = tagNames(task);
      if (names.length === 0) push("(untagged)", task);
      else for (const name of names) push(name, task);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function renderTask(task: Task): string {
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
  if (task.description) {
    out += `\n\ndescription:\n${indent(task.description)}`;
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
  search?: string;
  archived?: boolean;
  sort?: (typeof TASK_SORT_FIELDS)[number];
  order?: "asc" | "desc";
  groupBy?: (typeof TASK_GROUP_FIELDS)[number];
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
}

/** Shared emitter for every command that yields a single task. */
function emitTask(ctx: Ctx, task: Task, human?: () => string): void {
  emit(ctx.mode, {
    json: { task },
    human: human ?? (() => renderTask(task)),
    quiet: () => task.id,
  });
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
    .option("--search <q>", "substring match on title")
    .option("--archived", "include archived tasks")
    .addOption(new Option("--sort <field>", "sort field").choices(TASK_SORT_FIELDS))
    .addOption(new Option("--order <dir>", "sort direction").choices(["asc", "desc"]))
    .addOption(
      new Option("--group-by <field>", "group the printed rows").choices(TASK_GROUP_FIELDS),
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
      if (opts.search) query.q = opts.search;
      if (opts.archived) query.include_archived = true;
      if (opts.sort) query.sort = opts.sort;
      if (opts.order) query.order = opts.order;
      if (opts.groupBy) query.group_by = opts.groupBy;
      if (opts.limit !== undefined) query.limit = opts.limit;
      if (opts.offset !== undefined) query.offset = opts.offset;
      const res = await ctx.client.listTasks(opts.workspace, query);
      const groupBy = opts.groupBy && opts.groupBy !== "none" ? opts.groupBy : undefined;
      emit(ctx.mode, {
        json: res,
        human: () => {
          const body = groupBy
            ? groupTasks(res.items, groupBy)
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
      const { task: created } = await ctx.client.createTask(opts.workspace, body);
      emitTask(ctx, created, () => `created ${created.key} (${created.id})  ${truncate(created.title, 60)}`);
    });

  task
    .command("get")
    .description("Show a task (description, status, assignee, attachments)")
    .argument("<idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { task: found } = await ctx.client.getTask(idOrKey);
      emitTask(ctx, found);
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
    .action(
      async (
        idOrKey: string,
        opts: { title?: string; description?: string; descriptionFile?: string; tag: string[] },
        cmd: Command,
      ) => {
        const ctx = getCtx(cmd);
        const description = await resolveTextOption(
          "description",
          opts.description,
          opts.descriptionFile,
        );
        if (opts.title === undefined && description === undefined && opts.tag.length === 0) {
          throw new CliError(
            "nothing to update — pass --title, --description, --description-file, or --tag",
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
}
