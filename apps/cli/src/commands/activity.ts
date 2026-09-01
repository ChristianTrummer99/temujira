import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, table, truncate, ts } from "../output";
import { nonNegativeInt } from "../util";

export const COMMAND_ROUTES = {
  "activity list": ["activity.list"],
} as const satisfies Record<string, readonly RouteId[]>;

interface ActivityListOpts {
  workspace: string;
  mine?: boolean;
  limit?: number;
  offset?: number;
}

export function registerActivity(program: Command): void {
  const activity = program.command("activity").description("Read a workspace's action feed");

  activity
    .command("list")
    .description("List workspace activity, newest first")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .option("--mine", "only events on tasks you are associated with")
    .option("--limit <n>", "page size (max 200)", nonNegativeInt("--limit"))
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"))
    .action(async (opts: ActivityListOpts, cmd: Command) => {
      const ctx = getCtx(cmd);
      const query: NonNullable<Parameters<typeof ctx.client.listActivity>[1]> = {};
      if (opts.mine) query.mine = true;
      if (opts.limit !== undefined) query.limit = opts.limit;
      if (opts.offset !== undefined) query.offset = opts.offset;
      const res = await ctx.client.listActivity(opts.workspace, query);
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["WHEN", "ACTOR", "ACTION", "TASK", "TITLE"],
            res.items.map((e) => [
              ts(e.created_at),
              e.actor.name,
              e.action,
              e.task_key ?? "",
              truncate(e.task_title ?? "", 60),
            ]),
          ),
        quiet: () => res.items.map((e) => e.id).join("\n"),
      });
    });
}
