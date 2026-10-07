import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { guessContentType } from "../mime";
import { emit } from "../output";
import { resolveUserId } from "../resolve";

export const COMMAND_ROUTES = {
  "user avatar upload": ["avatars.upload", "auth.me", "users.list"],
  "user avatar download": ["avatars.get", "auth.me", "users.list"],
  "user avatar remove": ["avatars.delete", "auth.me", "users.list"],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerAvatar(user: Command) {
  const avatar = user.command("avatar").description("Set, download, or remove a profile picture");
  avatar.command("upload").description("Set a PNG, JPEG, GIF, or WebP picture (max 2 MB)")
    .argument("<file>", "picture file")
    .option("--user <idOrEmailOrMe>", "target user (default: me; other users need users:manage)", "me")
    .action(async (file: string, opts: { user: string }, cmd: Command) => {
      if (fs.statSync(file).size > 2 * 1024 * 1024) throw new CliError("choose a picture smaller than 2 MB", EXIT_CODES.invalid);
      const ctx = getCtx(cmd);
      const id = await resolveUserId(ctx.client, opts.user);
      const result = await ctx.client.uploadUserAvatar(id, { data: fs.readFileSync(file), filename: path.basename(file), contentType: guessContentType(file) });
      emit(ctx.mode, { json: result, human: () => `Updated picture for ${result.user.name}`, quiet: () => result.user.avatar_id ?? undefined });
    });
  avatar.command("download").description("Download a user's profile picture")
    .option("--user <idOrEmailOrMe>", "user id, email, or me", "me")
    .requiredOption("-o, --output <path>", "output file")
    .option("--force", "overwrite an existing file")
    .action(async (opts: { user: string; output: string; force?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const id = await resolveUserId(ctx.client, opts.user);
      const response = await ctx.client.downloadUserAvatar(id);
      const data = new Uint8Array(await response.arrayBuffer());
      try { fs.writeFileSync(opts.output, data, { flag: opts.force ? "w" : "wx", mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CliError("output file exists; use --force to replace it", EXIT_CODES.usage);
        throw error;
      }
      emit(ctx.mode, { json: { user_id: id, path: opts.output }, human: () => `Downloaded picture to ${opts.output}`, quiet: () => opts.output });
    });
  avatar.command("remove").description("Remove the picture and use colored initials")
    .option("--user <idOrEmailOrMe>", "target user (default: me; other users need users:manage)", "me")
    .action(async (opts: { user: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const id = await resolveUserId(ctx.client, opts.user);
      const result = await ctx.client.deleteUserAvatar(id);
      emit(ctx.mode, { json: result, human: () => `Removed picture for ${result.user.name}`, quiet: () => id });
    });
}
