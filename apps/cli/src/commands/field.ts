import type { Command } from "commander";
import type { FieldDef } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table } from "../output";
import { isUlid } from "../resolve";

export const COMMAND_ROUTES = {
  "field list": ["fields.list"],
  "field create": ["fields.create"],
  "field update": ["fields.update"],
  "field reorder": ["fields.reorder"],
  "field delete": ["fields.delete"],
} as const satisfies Record<string, readonly RouteId[]>;

const FIELD_TYPES = ["select", "text", "number"] as const;

function fieldTable(items: FieldDef[]): string {
  return table(
    ["ID", "POS", "TYPE", "NAME", "OPTIONS"],
    items.map((f) => [f.id, String(f.position), f.type, f.name, f.options.join(", ")]),
  );
}

export function registerField(program: Command): void {
  const field = program.command("field").description("Manage a workspace's custom fields (select/text/number)");

  field
    .command("list")
    .description("List field definitions ordered by position")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .action(async (opts: { workspace: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listFields(opts.workspace);
      emit(ctx.mode, {
        json: res,
        human: () => fieldTable(res.items),
        quiet: () => res.items.map((f) => f.id).join("\n"),
      });
    });

  field
    .command("create")
    .description("Define a custom field (default type: select)")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .requiredOption("--name <name>", "field name (unique per workspace)")
    .option("--type <type>", `field type: ${FIELD_TYPES.join(" | ")}`, "select")
    .option("--options <options>", 'comma-separated options (required for select), e.g. "low,med,high"')
    .action(async (opts: { workspace: string; name: string; type: string; options?: string }, cmd: Command) => {
      if (!(FIELD_TYPES as readonly string[]).includes(opts.type)) {
        throw new CliError(`unknown type "${opts.type}" — expected one of: ${FIELD_TYPES.join(", ")}`, EXIT_CODES.usage);
      }
      const body: { name: string; type: (typeof FIELD_TYPES)[number]; options?: string[] } = {
        name: opts.name,
        type: opts.type as (typeof FIELD_TYPES)[number],
      };
      if (opts.options !== undefined) body.options = splitOptions(opts.options);
      const ctx = getCtx(cmd);
      const { field: created } = await ctx.client.createField(opts.workspace, body);
      emit(ctx.mode, {
        json: { field: created },
        human: () => fieldTable([created]),
        quiet: () => created.id,
      });
    });

  field
    .command("update")
    .description("Rename a field or replace its option set")
    .argument("<id>", "field id")
    .option("--name <name>", "new name")
    .option("--options <options>", 'replacement options (select only), e.g. "low,med,high"')
    .action(async (id: string, opts: { name?: string; options?: string }, cmd: Command) => {
      if (!isUlid(id)) {
        throw new CliError("field update takes a field id (list fields to find it)", EXIT_CODES.usage);
      }
      if (opts.name === undefined && opts.options === undefined) {
        throw new CliError("nothing to update — pass --name and/or --options", EXIT_CODES.usage);
      }
      const body: { name?: string; options?: string[] } = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.options !== undefined) body.options = splitOptions(opts.options);
      const ctx = getCtx(cmd);
      const { field: updated } = await ctx.client.updateField(id, body);
      emit(ctx.mode, {
        json: { field: updated },
        human: () => fieldTable([updated]),
        quiet: () => updated.id,
      });
    });

  field
    .command("reorder")
    .description("Reorder field definitions: pass the FULL ordered list of all field ids")
    .requiredOption("--workspace <idOrKey>", "workspace id or key")
    .argument("<fieldIds...>", "every field id in the workspace, in the desired order")
    .action(async (fieldIds: string[], opts: { workspace: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.reorderFields(opts.workspace, fieldIds);
      emit(ctx.mode, {
        json: res,
        human: () => fieldTable(res.items),
        quiet: () => res.items.map((f) => f.id).join("\n"),
      });
    });

  field
    .command("delete")
    .description("Delete a field definition and every task's value for it")
    .argument("<id>", "field id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.deleteField(id);
      emit(ctx.mode, {
        json: res,
        human: () => `deleted field ${id}`,
        quiet: () => id,
      });
    });
}

function splitOptions(value: string): string[] {
  return value
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}