import { Option, type Command } from "commander";
import { SEARCH_TYPES, type RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, table } from "../output";
import { nonNegativeInt } from "../util";

export const COMMAND_ROUTES = { search: ["search.query"] } as const satisfies Record<string, readonly RouteId[]>;

export function registerSearch(program: Command): void {
  program.command("search")
    .description("Search accessible tasks, comments, attachment filenames and supported text contents")
    .argument("<query>", "keywords (prefix matching) or quoted phrases")
    .option("--workspace <idOrKey>", "limit to a workspace; default is global")
    .addOption(new Option("--type <type>", "result type").choices([...SEARCH_TYPES]).default("all"))
    .option("--archived", "include archived tasks and workspaces")
    .option("--limit <n>", "page size (max 100)", nonNegativeInt("--limit"))
    .option("--offset <n>", "page offset", nonNegativeInt("--offset"))
    .action(async (q: string, opts: { workspace?: string; type: "all" | "task" | "comment" | "attachment"; archived?: boolean; limit?: number; offset?: number }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.search({ q, workspace: opts.workspace, type: opts.type, include_archived: opts.archived, limit: opts.limit, offset: opts.offset });
      emit(ctx.mode, {
        json: res,
        human: () => table(["TYPE", "TASK", "ID", "TITLE", "MATCH"], res.items.map((r) => [r.type, r.task_key, r.id, r.title, r.snippet.replace(/\s+/g, " ")])),
        quiet: () => res.items.map((r) => r.id).join("\n"),
      });
    });
}
