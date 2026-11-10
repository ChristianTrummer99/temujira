import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { MAX_LOGO_BYTES, type RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { guessContentType } from "../mime";
import { emit } from "../output";

export const COMMAND_ROUTES = {
  "branding logo upload": ["instance.uploadLogo"],
  "branding logo download": ["instance.getLogo"],
  "branding logo remove": ["instance.deleteLogo"],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerBranding(program: Command) {
  const branding = program.command("branding").description("Change the app branding for the whole installation");
  const logo = branding.command("logo").description("Set, download, or remove the app logo (changes need unrestricted admin credentials)");
  logo.command("upload").description("Set a PNG, JPEG, GIF, or WebP logo (max 2 MB; a square image fits best)")
    .argument("<file>", "image file")
    .action(async (file: string, _opts: object, cmd: Command) => {
      if (fs.statSync(file).size > MAX_LOGO_BYTES) throw new CliError("choose an image smaller than 2 MB", EXIT_CODES.invalid);
      const ctx = getCtx(cmd);
      const result = await ctx.client.uploadInstanceLogo({ data: fs.readFileSync(file), filename: path.basename(file), contentType: guessContentType(file) });
      emit(ctx.mode, { json: result, human: () => `Updated the logo for ${result.instance.display_name}`, quiet: () => result.instance.logo_id ?? undefined });
    });
  logo.command("download").description("Download the app logo")
    .requiredOption("-o, --output <path>", "output file")
    .option("--force", "overwrite an existing file")
    .action(async (opts: { output: string; force?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd, { requireAuth: false });
      const response = await ctx.client.downloadInstanceLogo();
      const data = new Uint8Array(await response.arrayBuffer());
      try { fs.writeFileSync(opts.output, data, { flag: opts.force ? "w" : "wx" }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CliError("output file exists; use --force to replace it", EXIT_CODES.usage);
        throw error;
      }
      emit(ctx.mode, { json: { path: opts.output }, human: () => `Downloaded the logo to ${opts.output}`, quiet: () => opts.output });
    });
  logo.command("remove").description("Remove the logo and show the first letter of the app name")
    .action(async (_opts: object, cmd: Command) => {
      const ctx = getCtx(cmd);
      const result = await ctx.client.deleteInstanceLogo();
      emit(ctx.mode, { json: result, human: () => `Removed the logo for ${result.instance.display_name}`, quiet: () => undefined });
    });
}
