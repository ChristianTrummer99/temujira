import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, table, truncate, ts } from "../output";
import { nonNegativeInt } from "../util";

export const COMMAND_ROUTES = {
  "inbox list": ["inbox.list"],
  "inbox read": ["inbox.update"],
} as const satisfies Record<string, readonly RouteId[]>;

/** One-line excerpt of a markdown comment body (newlines collapsed). */
function excerpt(body: string): string {
  return truncate(body.replace(/\s+/g, " ").trim(), 80);
}

export function registerInbox(program: Command): void {
  const inbox = program
    .command("inbox")
    .description("Your cross-workspace inbox of mentions and replies");

  inbox
    .command("list")
    .description("List inbox items, newest first (unread only unless --all)")
    .option("--all", "include items you have already read")
    .option("--limit <n>", "page size (max 200)", nonNegativeInt("--limit"))
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"))
    .action(
      async (opts: { all?: boolean; limit?: number; offset?: number }, cmd: Command) => {
        const ctx = getCtx(cmd);
        const query: NonNullable<Parameters<typeof ctx.client.listInbox>[0]> = {};
        if (opts.all) query.include_read = true;
        if (opts.limit !== undefined) query.limit = opts.limit;
        if (opts.offset !== undefined) query.offset = opts.offset;
        const res = await ctx.client.listInbox(query);
        emit(ctx.mode, {
          json: res,
          human: () => {
            const body = table(
              ["NEW", "KIND", "WS", "TASK", "TITLE", "ACTOR", "WHEN", "COMMENT"],
              res.items.map((i) => [
                i.read_at ? "" : "●",
                i.kind,
                i.workspace.key,
                i.task_key,
                truncate(i.task_title, 40),
                i.actor.name,
                ts(i.created_at),
                excerpt(i.source_comment.body),
              ]),
            );
            const notes = [`${res.unread} unread`];
            if (res.total > res.items.length) {
              notes.push(
                `showing ${res.offset + 1}-${res.offset + res.items.length} of ${res.total}`,
              );
            }
            return `${body}\n(${notes.join(", ")})`;
          },
          quiet: () => res.items.map((i) => i.id).join("\n"),
        });
      },
    );

  inbox
    .command("read")
    .description("Mark every inbox item as read")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.markInboxRead({ mark_read: true });
      emit(ctx.mode, {
        json: res,
        human: () => `marked ${res.updated} inbox item${res.updated === 1 ? "" : "s"} read`,
        quiet: () => undefined,
      });
    });
}
