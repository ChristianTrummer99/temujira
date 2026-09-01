import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, userLine } from "../output";
import { promptHidden } from "../prompt";

export const COMMAND_ROUTES = {
  "me update": ["auth.updateMe"],
} as const satisfies Record<string, readonly RouteId[]>;

interface MeUpdateOpts {
  name?: string;
  password?: boolean;
  currentPassword?: string;
  newPassword?: string;
}

export function registerMe(program: Command): void {
  const me = program.command("me").description("Manage your own account");

  me.command("update")
    .description("Update your name and/or password")
    .option("--name <name>", "new display name")
    .option("--password", "change password (prompts for current and new, hidden echo)")
    .option("--current-password <password>", "current password (non-interactive)")
    .option("--new-password <password>", "new password (non-interactive)")
    .action(async (opts: MeUpdateOpts, cmd: Command) => {
      const ctx = getCtx(cmd);
      let current = opts.currentPassword;
      let next = opts.newPassword;
      if (opts.password) {
        current ??= await promptHidden("Current password: ");
        next ??= await promptHidden("New password: ");
      }
      if (next !== undefined && current === undefined) {
        throw new CliError(
          "--current-password is required to change the password",
          EXIT_CODES.usage,
        );
      }
      if (opts.name === undefined && next === undefined) {
        throw new CliError("nothing to update — pass --name and/or --password", EXIT_CODES.usage);
      }
      const body: { name?: string; current_password?: string; new_password?: string } = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (next !== undefined) {
        body.current_password = current;
        body.new_password = next;
      }
      const { user } = await ctx.client.updateMe(body);
      emit(ctx.mode, {
        json: { user },
        human: () => `updated ${userLine(user)}`,
        quiet: () => user.id,
      });
    });
}
