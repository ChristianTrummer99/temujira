import type { Command } from "commander";
import type { Tag } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table, ts } from "../output";

export const COMMAND_ROUTES = {
  "tag list": ["tags.list"],
  "tag create": ["tags.create"],
  "tag update": ["tags.update"],
  "tag delete": ["tags.delete"],
} as const satisfies Record<string, readonly RouteId[]>;

function tagTable(items: Tag[]): string {
  return table(
    ["ID", "NAME", "COLOR", "CREATED"],
    items.map((t) => [t.id, t.name, t.color, ts(t.created_at)]),
  );
}

export function registerTag(program: Command): void {
  const tag = program.command("tag").description("Manage a workspace's tags (writes are admin-only)");

  tag
    .command("list")
    .description("List a workspace's tags")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .action(async (opts: { workspace: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listTags(opts.workspace);
      emit(ctx.mode, {
        json: res,
        human: () => tagTable(res.items),
        quiet: () => res.items.map((t) => t.id).join("\n"),
      });
    });

  tag
    .command("create")
    .description("Create a tag (admin; a non-admin key exits 3)")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .requiredOption("--name <name>", "tag name")
    .option("--color <#hex>", "hex color like #3b82f6")
    .action(async (opts: { workspace: string; name: string; color?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { tag: created } = await ctx.client.createTag(opts.workspace, {
        name: opts.name,
        ...(opts.color ? { color: opts.color } : {}),
      });
      emit(ctx.mode, {
        json: { tag: created },
        human: () => tagTable([created]),
        quiet: () => created.id,
      });
    });

  tag
    .command("update")
    .description("Rename or recolor a tag (admin)")
    .argument("<id>", "tag id")
    .option("--name <name>", "new name")
    .option("--color <#hex>", "new hex color")
    .action(async (id: string, opts: { name?: string; color?: string }, cmd: Command) => {
      if (opts.name === undefined && opts.color === undefined) {
        throw new CliError("nothing to update — pass --name and/or --color", EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      const { tag: updated } = await ctx.client.updateTag(id, {
        ...(opts.name !== undefined ? { name: opts.name } : {}),
        ...(opts.color !== undefined ? { color: opts.color } : {}),
      });
      emit(ctx.mode, {
        json: { tag: updated },
        human: () => tagTable([updated]),
        quiet: () => updated.id,
      });
    });

  tag
    .command("delete")
    .description("Delete a tag and unlink it from every task (admin)")
    .argument("<id>", "tag id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.deleteTag(id);
      emit(ctx.mode, {
        json: res,
        human: () => `deleted tag ${id}`,
        quiet: () => id,
      });
    });
}
