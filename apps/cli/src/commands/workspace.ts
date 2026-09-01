import type { Command } from "commander";
import type { Workspace } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, kv, table, ts } from "../output";

export const COMMAND_ROUTES = {
  "workspace list": ["workspaces.list"],
  "workspace create": ["workspaces.create"],
  "workspace get": ["workspaces.get"],
  "workspace update": ["workspaces.update"],
  "workspace archive": ["workspaces.update"],
  "workspace unarchive": ["workspaces.update"],
} as const satisfies Record<string, readonly RouteId[]>;

function workspaceKv(ws: Workspace): string {
  return kv([
    ["id", ws.id],
    ["key", ws.key],
    ["name", ws.name],
    ["archived", ws.archived_at ? ts(ws.archived_at) : "no"],
    ["created", ts(ws.created_at)],
    ["updated", ts(ws.updated_at)],
  ]);
}

export function registerWorkspace(program: Command): void {
  const workspace = program.command("workspace").description("Manage workspaces");

  workspace
    .command("list")
    .description("List workspaces")
    .option("--archived", "include archived workspaces")
    .action(async (opts: { archived?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listWorkspaces(opts.archived ? { include_archived: true } : {});
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["ID", "KEY", "NAME", "ARCHIVED", "CREATED"],
            res.items.map((w) => [w.id, w.key, w.name, ts(w.archived_at), ts(w.created_at)]),
          ),
        quiet: () => res.items.map((w) => w.id).join("\n"),
      });
    });

  workspace
    .command("create")
    .description("Create a workspace (seeds Backlog / In Progress / Done)")
    .requiredOption("--name <name>", "workspace name")
    .requiredOption("--key <KEY>", "workspace key, 2-6 uppercase chars (e.g. TEM)")
    .action(async (opts: { name: string; key: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { workspace: ws } = await ctx.client.createWorkspace({
        name: opts.name,
        key: opts.key,
      });
      emit(ctx.mode, {
        json: { workspace: ws },
        human: () => workspaceKv(ws),
        quiet: () => ws.id,
      });
    });

  workspace
    .command("get")
    .description("Show one workspace")
    .argument("<idOrKey>", "workspace id or key (e.g. TEM)")
    .action(async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { workspace: ws } = await ctx.client.getWorkspace(idOrKey);
      emit(ctx.mode, {
        json: { workspace: ws },
        human: () => workspaceKv(ws),
        quiet: () => ws.id,
      });
    });

  workspace
    .command("update")
    .description("Rename a workspace")
    .argument("<idOrKey>", "workspace id or key")
    .option("--name <name>", "new workspace name")
    .action(async (idOrKey: string, opts: { name?: string }, cmd: Command) => {
      if (opts.name === undefined) {
        throw new CliError("nothing to update — pass --name", EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const { workspace: ws } = await ctx.client.updateWorkspace(idOrKey, { name: opts.name });
      emit(ctx.mode, {
        json: { workspace: ws },
        human: () => workspaceKv(ws),
        quiet: () => ws.id,
      });
    });

  const setArchived = (archived: boolean) =>
    async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { workspace: ws } = await ctx.client.updateWorkspace(idOrKey, { archived });
      emit(ctx.mode, {
        json: { workspace: ws },
        human: () => `${archived ? "archived" : "unarchived"} ${ws.key} (${ws.id})`,
        quiet: () => ws.id,
      });
    };

  workspace
    .command("archive")
    .description("Archive a workspace")
    .argument("<idOrKey>", "workspace id or key")
    .action(setArchived(true));

  workspace
    .command("unarchive")
    .description("Unarchive a workspace")
    .argument("<idOrKey>", "workspace id or key")
    .action(setArchived(false));
}
