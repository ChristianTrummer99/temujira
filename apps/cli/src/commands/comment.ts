import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table, truncate, ts } from "../output";
import { resolveTextOption } from "../util";

export const COMMAND_ROUTES = {
  "comment list": ["comments.list"],
  "comment add": ["comments.create"],
  "comment update": ["comments.update"],
  "comment delete": ["comments.delete"],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerComment(program: Command): void {
  const comment = program.command("comment").description("Manage task comments");

  comment
    .command("list")
    .description("List a task's comments chronologically")
    .requiredOption("--task <idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (opts: { task: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listComments(opts.task);
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["ID", "AUTHOR", "CREATED", "ATTACH", "BODY"],
            res.items.map((c) => [
              c.id,
              c.author.name,
              ts(c.created_at),
              c.attachments.length > 0 ? String(c.attachments.length) : "",
              truncate(c.body, 60),
            ]),
          ),
        quiet: () => res.items.map((c) => c.id).join("\n"),
      });
    });

  comment
    .command("add")
    .description("Add a markdown comment to a task")
    .requiredOption("--task <idOrKey>", "task id or key")
    .option("--body <markdown>", "comment body (markdown)")
    .option("--body-file <path>", 'read the body from a file ("-" = stdin)')
    .action(async (opts: { task: string; body?: string; bodyFile?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const body = await resolveTextOption("body", opts.body, opts.bodyFile);
      if (body === undefined) {
        throw new CliError("pass --body or --body-file", EXIT_CODES.usage);
      }
      const { comment: created } = await ctx.client.createComment(opts.task, { body });
      emit(ctx.mode, {
        json: { comment: created },
        human: () => `added comment ${created.id} to ${opts.task}`,
        quiet: () => created.id,
      });
    });

  comment
    .command("update")
    .description("Edit a comment (author or admin)")
    .argument("<id>", "comment id")
    .requiredOption("--body <markdown>", "new comment body (markdown)")
    .action(async (id: string, opts: { body: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { comment: updated } = await ctx.client.updateComment(id, { body: opts.body });
      emit(ctx.mode, {
        json: { comment: updated },
        human: () => `updated comment ${updated.id}`,
        quiet: () => updated.id,
      });
    });

  comment
    .command("delete")
    .description("Delete a comment and its attachments (author or admin)")
    .argument("<id>", "comment id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.deleteComment(id);
      emit(ctx.mode, {
        json: res,
        human: () => `deleted comment ${id}`,
        quiet: () => id,
      });
    });
}
