import { Option, type Command } from "commander";
import { TemujiraClient } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, table, truncate, ts } from "../output";
import { nonNegativeInt } from "../util";
import { CliError, EXIT_CODES } from "../exit";
import { isUlid } from "../resolve";
import { readInboxCheckpoint, saveInboxCheckpoint, watchInbox } from "../inbox-watch";

export const COMMAND_ROUTES = {
  "inbox list": ["inbox.list"],
  "inbox read": ["inbox.update", "inbox.markRead"],
  "inbox watch": ["inbox.watch", "auth.me"],
} as const satisfies Record<string, readonly RouteId[]>;

/** One-line excerpt of a markdown comment body (newlines collapsed). */
function excerpt(body: string): string {
  return truncate(body.replace(/\s+/g, " ").trim(), 80);
}

export function registerInbox(program: Command): void {
  const inbox = program
    .command("inbox")
    .description("Your cross-workspace inbox of mentions and replies");

  inbox.command("watch")
    .description("Poll new notifications; starts now, does not mark read. --json emits NDJSON")
    .addOption(new Option("--after <cursor>", "resume after a cursor; 0 replays retained events").argParser(nonNegativeInt("--after")).conflicts("cursorFile"))
    .option("--cursor-file <path>", "save/resume a cursor bound to the current server and user")
    .option("--once", "drain one poll, including every page, then exit")
    .option("--interval <seconds>", "poll interval (1–300 seconds)", nonNegativeInt("--interval"), 5)
    .option("--limit <n>", "events per page (1–200)", nonNegativeInt("--limit"), 100)
    .action(async (opts: { after?: number; cursorFile?: string; once?: boolean; interval: number; limit: number }, cmd: Command) => {
      if (opts.interval < 1 || opts.interval > 300 || opts.limit < 1 || opts.limit > 200 || (opts.after !== undefined && !Number.isSafeInteger(opts.after))) {
        throw new CliError("use interval 1–300, limit 1–200, and a safe integer cursor", EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
      const write = (text: string) => new Promise<void>((resolve, reject) => process.stdout.write(`${text}\n`, (error) => error ? reject(error) : resolve()));
      try {
        const client = new TemujiraClient({ baseUrl: ctx.url, token: ctx.settings.apiKey,
          signal: controller.signal, timeoutMs: 30_000,
        });
        const { user } = await client.me();
        const identity = { url: ctx.url.replace(/\/+$/, ""), user_id: user.id };
        const after = opts.cursorFile ? readInboxCheckpoint(opts.cursorFile, identity) : opts.after;
        await watchInbox(client, { ...opts, after, signal: controller.signal,
          event: async (event) => {
            if (ctx.mode === "json") await write(JSON.stringify({ type: "notification", ...event }));
            else if (ctx.mode === "quiet") await write(event.item.id);
            else await write(`${event.item.task_key} · ${event.item.kind} · ${event.item.actor.name}: ${excerpt(event.item.source_comment.body)}`);
          },
          checkpoint: async (cursor) => {
            if (ctx.mode === "json") await write(JSON.stringify({ type: "checkpoint", cursor }));
            if (opts.cursorFile) saveInboxCheckpoint(opts.cursorFile, { ...identity, cursor });
          },
          warn: (message) => process.stderr.write(`${message}\n`),
        });
      } catch (e) { if (!controller.signal.aborted) throw e; }
      finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
    });

  inbox
    .command("list")
    .description("List inbox conversations, newest first (unread only unless --all)")
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
              ["ID", "NEW", "KIND", "WS", "TASK", "TITLE", "ACTOR", "WHEN", "COMMENT"],
              res.items.map((i) => [
                i.id,
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
            const notes = [`${res.unread} unread conversations`];
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
    .description("Mark a conversation read; omit the id to mark all accessible conversations read")
    .argument("[itemId]", "inbox item id from `inbox list`, not a comment id")
    .action(async (itemId: string | undefined, _opts: Record<string, never>, cmd: Command) => {
      if (itemId !== undefined && !isUlid(itemId)) {
        throw new CliError("inbox item must be an id from `tmj inbox list`", EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const res = itemId !== undefined ? await ctx.client.markInboxItemRead(itemId) : await ctx.client.markInboxRead({ mark_read: true });
      emit(ctx.mode, {
        json: res,
        human: () => `marked ${res.updated} conversation${res.updated === 1 ? "" : "s"} read`,
        quiet: () => undefined,
      });
    });
}
