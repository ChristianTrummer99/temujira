import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Command } from "commander";
import type { Attachment } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, kv, table, ts } from "../output";
import { guessContentType } from "../mime";

export const COMMAND_ROUTES = {
  "attach upload": ["attachments.uploadToTask", "attachments.uploadToComment"],
  "attach list": ["tasks.get"],
  "attach get": ["attachments.get"],
  "attach download": ["attachments.get", "attachments.download"],
  "attach delete": ["attachments.delete"],
} as const satisfies Record<string, readonly RouteId[]>;

function attachmentKv(a: Attachment): string {
  return kv([
    ["id", a.id],
    ["filename", a.filename],
    ["size", String(a.size)],
    ["type", a.mime_type],
    ["sha256", a.sha256],
    ["task", a.task_id ?? ""],
    ["comment", a.comment_id ?? ""],
    ["uploader", a.uploader_id],
    ["created", ts(a.created_at)],
  ]);
}

export function registerAttach(program: Command): void {
  const attach = program.command("attach").description("Manage file attachments");

  attach
    .command("upload")
    .description("Upload a file to a task or to a comment")
    .option("--task <idOrKey>", "attach to this task")
    .option("--comment <id>", "attach to this comment")
    .argument("<file>", "path of the file to upload")
    .action(async (file: string, opts: { task?: string; comment?: string }, cmd: Command) => {
      if (Boolean(opts.task) === Boolean(opts.comment)) {
        throw new CliError("pass exactly one of --task or --comment", EXIT_CODES.usage);
      }
      const ctx = getCtx(cmd);
      let data: Buffer;
      try {
        data = fs.readFileSync(file);
      } catch (err) {
        throw new CliError(
          `cannot read ${file}: ${(err as NodeJS.ErrnoException).message}`,
          EXIT_CODES.usage,
        );
      }
      const filename = path.basename(file);
      const upload = {
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        filename,
        contentType: guessContentType(filename),
      };
      const res = opts.task
        ? await ctx.client.uploadTaskAttachment(opts.task, upload)
        : await ctx.client.uploadCommentAttachment(opts.comment as string, upload);
      emit(ctx.mode, {
        json: res,
        human: () =>
          `uploaded ${filename} as ${res.attachment.id} (${res.attachment.size} bytes, ${res.attachment.mime_type})`,
        quiet: () => res.attachment.id,
      });
    });

  attach
    .command("list")
    .description("List a task's attachments (composes `task get`)")
    .requiredOption("--task <idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (opts: { task: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { task } = await ctx.client.getTask(opts.task);
      const items = task.attachments ?? [];
      emit(ctx.mode, {
        json: { items },
        human: () =>
          table(
            ["ID", "FILENAME", "SIZE", "TYPE", "SHA256", "CREATED"],
            items.map((a) => [
              a.id,
              a.filename,
              String(a.size),
              a.mime_type,
              a.sha256.slice(0, 12),
              ts(a.created_at),
            ]),
          ),
        quiet: () => items.map((a) => a.id).join("\n"),
      });
    });

  attach
    .command("get")
    .description("Show attachment metadata")
    .argument("<id>", "attachment id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { attachment } = await ctx.client.getAttachment(id);
      emit(ctx.mode, {
        json: { attachment },
        human: () => attachmentKv(attachment),
        quiet: () => attachment.id,
      });
    });

  attach
    .command("download")
    .description("Download an attachment and verify its sha256")
    .argument("<id>", "attachment id")
    .option("-o, --output <path>", "output path (default: original filename in the cwd)")
    .option("--force", "overwrite an existing file")
    .action(async (id: string, opts: { output?: string; force?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const { attachment } = await ctx.client.getAttachment(id);
      const out = opts.output ?? (path.basename(attachment.filename) || attachment.id);
      if (!opts.force && fs.existsSync(out)) {
        throw new CliError(`refusing to overwrite ${out} (pass --force)`, EXIT_CODES.server);
      }
      const res = await ctx.client.downloadAttachment(id);
      if (!res.body) throw new CliError("empty response body", EXIT_CODES.server);
      const hash = createHash("sha256");
      try {
        await pipeline(
          Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
          async function* (source: AsyncIterable<Uint8Array>) {
            for await (const chunk of source) {
              hash.update(chunk);
              yield chunk;
            }
          },
          fs.createWriteStream(out, { flags: opts.force ? "w" : "wx" }),
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          throw new CliError(`refusing to overwrite ${out} (pass --force)`, EXIT_CODES.server);
        }
        throw err;
      }
      const digest = hash.digest("hex");
      if (digest.toLowerCase() !== attachment.sha256.toLowerCase()) {
        throw new CliError(
          `sha256 mismatch for ${out}: expected ${attachment.sha256}, got ${digest} (file kept)`,
          EXIT_CODES.server,
        );
      }
      emit(ctx.mode, {
        json: { attachment, path: out, sha256_verified: true },
        human: () => `downloaded ${out} (${attachment.size} bytes, sha256 verified)`,
        quiet: () => out,
      });
    });

  attach
    .command("delete")
    .description("Delete an attachment and its bytes (uploader or admin)")
    .argument("<id>", "attachment id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.deleteAttachment(id);
      emit(ctx.mode, {
        json: res,
        human: () => `deleted attachment ${id}`,
        quiet: () => id,
      });
    });
}
