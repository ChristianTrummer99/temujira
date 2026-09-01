import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table, truncate, ts } from "../output";
import { isUlid } from "../resolve";
import { resolveTextOption } from "../util";

export const COMMAND_ROUTES = {
  "comment list": ["comments.list"],
  "comment add": ["comments.create", "users.search"],
  "comment update": ["comments.update"],
  "comment delete": ["comments.delete"],
} as const satisfies Record<string, readonly RouteId[]>;

/**
 * Resolve --mention specs to user ids: ULIDs pass through; anything else is matched
 * case-insensitively against name or email via users.search (miss → exit 4).
 */
async function resolveMentionIds(
  client: ReturnType<typeof getCtx>["client"],
  specs: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const spec of specs) {
    if (isUlid(spec)) {
      ids.push(spec);
      continue;
    }
    const needle = spec.replace(/^@/, "");
    const { items } = await client.searchUsers({ q: needle, limit: 50 });
    const lower = needle.toLowerCase();
    const match =
      items.find((u) => u.name.toLowerCase() === lower || u.email.toLowerCase() === lower) ??
      (items.length === 1 ? items[0] : undefined);
    if (!match) {
      throw new CliError(
        items.length > 1
          ? `"${spec}" matches ${items.length} users; use an exact name, email, or id`
          : `no user matching "${spec}"`,
        EXIT_CODES.notFound,
      );
    }
    ids.push(match.id);
  }
  return [...new Set(ids)];
}

export function registerComment(program: Command): void {
  const comment = program.command("comment").description("Manage task comments");

  comment
    .command("list")
    .description("List a task's comments chronologically")
    .requiredOption("--task <idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (opts: { task: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listComments(opts.task);
      // comments.list returns roots only, with one level of replies nested inside.
      const flatten = (items: typeof res.items): Array<{ c: (typeof res.items)[number]; depth: number }> =>
        items.flatMap((c) => [{ c, depth: 0 }, ...(c.replies ?? []).map((r) => ({ c: r, depth: 1 }))]);
      const rows = flatten(res.items);
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["ID", "AUTHOR", "CREATED", "ATTACH", "BODY"],
            rows.map(({ c, depth }) => {
              const question = c.question
                ? ` [question: ${c.question.options
                    .map((o, i) => (i === c.question?.answer_option_index ? `*${o}*` : o))
                    .join(" | ")}]`
                : "";
              return [
                c.id,
                c.author.name,
                ts(c.created_at),
                c.attachments.length > 0 ? String(c.attachments.length) : "",
                `${depth > 0 ? "  ↳ " : ""}${truncate(c.body, 60)}${question}`,
              ];
            }),
          ),
        quiet: () => rows.map(({ c }) => c.id).join("\n"),
      });
    });

  comment
    .command("add")
    .description("Add a markdown comment, reply, question, or answer to a task")
    .requiredOption("--task <idOrKey>", "task id or key")
    .option("--body <markdown>", "comment body (markdown)")
    .option("--body-file <path>", 'read the body from a file ("-" = stdin)')
    .option("--reply-to <commentId>", "reply to a comment (replies to a reply target its root)")
    .option(
      "--question <option>",
      "multiple-choice option (repeat 2-10 times; root comments only)",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option("--answer <index>", "0-based option index chosen from the parent question (with --reply-to)")
    .option(
      "--mention <idOrNameOrEmail>",
      "@-mention a user (repeatable); notifies them in their inbox",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .action(
      async (
        opts: {
          task: string;
          body?: string;
          bodyFile?: string;
          replyTo?: string;
          question?: string[];
          answer?: string;
          mention?: string[];
        },
        cmd: Command,
      ) => {
        const ctx = getCtx(cmd);
        const body = await resolveTextOption("body", opts.body, opts.bodyFile);
        if (body === undefined) {
          throw new CliError("pass --body or --body-file", EXIT_CODES.usage);
        }
        if (opts.question && opts.replyTo) {
          throw new CliError("--question is only allowed on a root comment (drop --reply-to)", EXIT_CODES.usage);
        }
        if (opts.question && opts.question.length < 2) {
          throw new CliError("--question must be given at least twice (2-10 options)", EXIT_CODES.usage);
        }
        if (opts.answer !== undefined && !opts.replyTo) {
          throw new CliError("--answer requires --reply-to <question comment id>", EXIT_CODES.usage);
        }
        let answerIndex: number | undefined;
        if (opts.answer !== undefined) {
          answerIndex = Number(opts.answer);
          if (!Number.isInteger(answerIndex) || answerIndex < 0) {
            throw new CliError("--answer must be a non-negative integer option index", EXIT_CODES.usage);
          }
        }
        const mentionIds = opts.mention?.length ? await resolveMentionIds(ctx.client, opts.mention) : undefined;
        const { comment: created } = await ctx.client.createComment(opts.task, {
          body,
          ...(opts.replyTo ? { parent_id: opts.replyTo } : {}),
          ...(opts.question ? { question_options: opts.question } : {}),
          ...(answerIndex !== undefined ? { answer_option_index: answerIndex } : {}),
          ...(mentionIds ? { mention_ids: mentionIds } : {}),
        });
        emit(ctx.mode, {
          json: { comment: created },
          human: () =>
            created.parent_id
              ? `added reply ${created.id} to comment ${created.parent_id}`
              : `added comment ${created.id} to ${opts.task}`,
          quiet: () => created.id,
        });
      },
    );

  comment
    .command("update")
    .description("Edit a comment's body or its multiple-choice question (author or admin)")
    .argument("<id>", "comment id")
    .option("--body <markdown>", "new comment body (markdown)")
    .option(
      "--question <option>",
      "replace the question options (repeat 2-10 times)",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option("--clear-question", "remove the multiple-choice question from this comment")
    .action(
      async (
        id: string,
        opts: { body?: string; question?: string[]; clearQuestion?: boolean },
        cmd: Command,
      ) => {
      const ctx = getCtx(cmd);
      if (opts.question && opts.clearQuestion) {
        throw new CliError("pass either --question or --clear-question, not both", EXIT_CODES.usage);
      }
      if (opts.body === undefined && !opts.question && !opts.clearQuestion) {
        throw new CliError("pass --body, --question, or --clear-question", EXIT_CODES.usage);
      }
      if (opts.question && opts.question.length < 2) {
        throw new CliError("--question must be given at least twice (2-10 options)", EXIT_CODES.usage);
      }
      const { comment: updated } = await ctx.client.updateComment(id, {
        ...(opts.body !== undefined ? { body: opts.body } : {}),
        ...(opts.question ? { question_options: opts.question } : {}),
        ...(opts.clearQuestion ? { question_options: null } : {}),
      });
      emit(ctx.mode, {
        json: { comment: updated },
        human: () => `updated comment ${updated.id}`,
        quiet: () => updated.id,
      });
      },
    );

  comment
    .command("delete")
    .description("Delete a comment and its attachments (author or admin)")
    .argument("<id>", "comment id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.deleteComment(id);
      emit(ctx.mode, {
        json: res,
        human: () => `deleted comment ${id}`,
        quiet: () => id,
      });
    });
}
