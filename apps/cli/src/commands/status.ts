import type { Command } from "commander";
import type { Status } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table } from "../output";

export const COMMAND_ROUTES = {
  "status list": ["statuses.list"],
  "status create": ["statuses.create"],
  "status update": ["statuses.update"],
  "status reorder": ["statuses.reorder"],
  "status delete": ["statuses.delete"],
} as const satisfies Record<string, readonly RouteId[]>;

function statusTable(items: Status[]): string {
  return table(
    ["ID", "POS", "NAME", "COLOR"],
    items.map((s) => [s.id, String(s.position), s.name, s.color]),
  );
}

export function registerStatus(program: Command): void {
  const status = program.command("status").description("Manage a workspace's statuses");

  status
    .command("list")
    .description("List statuses ordered by position")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .action(async (opts: { workspace: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listStatuses(opts.workspace);
      emit(ctx.mode, {
        json: res,
        human: () => statusTable(res.items),
        quiet: () => res.items.map((s) => s.id).join("\n"),
      });
    });

  status
    .command("create")
    .description("Create a status (appended at the end)")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .requiredOption("--name <name>", "status name")
    .option("--color <#hex>", "hex color like #3b82f6")
    .action(async (opts: { workspace: string; name: string; color?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { status: created } = await ctx.client.createStatus(opts.workspace, {
        name: opts.name,
        ...(opts.color ? { color: opts.color } : {}),
      });
      emit(ctx.mode, {
        json: { status: created },
        human: () => statusTable([created]),
        quiet: () => created.id,
      });
    });

  status
    .command("update")
    .description("Rename or recolor a status")
    .argument("<id>", "status id")
    .option("--name <name>", "new name")
    .option("--color <#hex>", "new hex color")
    .action(async (id: string, opts: { name?: string; color?: string }, cmd: Command) => {
      if (opts.name === undefined && opts.color === undefined) {
        throw new CliError("nothing to update — pass --name and/or --color", EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const { status: updated } = await ctx.client.updateStatus(id, {
        ...(opts.name !== undefined ? { name: opts.name } : {}),
        ...(opts.color !== undefined ? { color: opts.color } : {}),
      });
      emit(ctx.mode, {
        json: { status: updated },
        human: () => statusTable([updated]),
        quiet: () => updated.id,
      });
    });

  status
    .command("reorder")
    .description("Reorder statuses: pass the FULL ordered list of all status ids")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .argument("<statusIds...>", "every status id in the workspace, in the desired order")
    .action(async (statusIds: string[], opts: { workspace: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.reorderStatuses(opts.workspace, { status_ids: statusIds });
      emit(ctx.mode, {
        json: res,
        human: () => statusTable(res.items),
        quiet: () => res.items.map((s) => s.id).join("\n"),
      });
    });

  status
    .command("delete")
    .description("Delete a status (--move-to required when tasks still use it)")
    .argument("<id>", "status id")
    .option("--move-to <statusId>", "status to move the referencing tasks to")
    .action(async (id: string, opts: { moveTo?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.deleteStatus(id, opts.moveTo ? { move_to: opts.moveTo } : {});
      emit(ctx.mode, {
        json: res,
        human: () => `deleted status ${id}`,
        quiet: () => id,
      });
    });
}
