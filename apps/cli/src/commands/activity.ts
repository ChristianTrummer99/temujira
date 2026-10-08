import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { ACTIVITY_CATEGORY_IDS, type ActivityCategory } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, table, truncate, ts } from "../output";
import { collect, nonNegativeInt } from "../util";
import { CliError, EXIT_CODES } from "../exit";

export const COMMAND_ROUTES = {
  "activity list": ["activity.list", "activity.global", "activity.task"],
} as const satisfies Record<string, readonly RouteId[]>;

interface ActivityListOpts {
  workspace?: string;
  task?: string;
  actor?: string;
  action?: string;
  category: string[];
  mine?: boolean;
  limit?: number;
  offset?: number;
}

export function registerActivity(program: Command): void {
  const activity = program.command("activity").description("Read the permission-filtered global or ticket activity log");

  activity
    .command("list")
    .description("List activity, newest first; global unless scoped by workspace or ticket")
    .option("--workspace <idOrKey>", "workspace id or key")
    .option("--task <idOrKey>", "ticket id or key")
    .option("--actor <userId>", "filter by actor")
    .option("--action <action>", "filter by exact action (e.g. comment.updated)")
    .option("--category <group>", `action group (${ACTIVITY_CATEGORY_IDS.join(", ")}; repeatable)`, collect, [] as string[])
    .option("--mine", "only events on tasks you are associated with")
    .option("--limit <n>", "page size (max 200)", nonNegativeInt("--limit"))
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"))
    .action(async (opts: ActivityListOpts, cmd: Command) => {
      if (opts.category.some((id) => !ACTIVITY_CATEGORY_IDS.includes(id as ActivityCategory))) {
        throw new CliError(`unknown activity category; use ${ACTIVITY_CATEGORY_IDS.join(", ")}`, EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const query: NonNullable<Parameters<typeof ctx.client.listActivity>[1]> = {};
      if (opts.mine) query.mine = true;
      if (opts.category.length) query.categories = [...new Set(opts.category)].join(",");
      if (opts.limit !== undefined) query.limit = opts.limit;
      if (opts.offset !== undefined) query.offset = opts.offset;
      const res = opts.task && !opts.workspace && !opts.actor && !opts.action
        ? await ctx.client.listTaskActivity(opts.task, query)
        : opts.workspace && !opts.task && !opts.actor && !opts.action
          ? await ctx.client.listActivity(opts.workspace, query)
          : await ctx.client.listGlobalActivity({ ...query, workspace: opts.workspace, task: opts.task, actor_id: opts.actor, action: opts.action });
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
