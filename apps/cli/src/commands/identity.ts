import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, kv, table, ts } from "../output";

export const COMMAND_ROUTES = {
  "identity acquire": ["identitySessions.acquire"],
  "identity release": ["identitySessions.release"],
  "identity get": ["identitySessions.get"],
  "identity list": ["identitySessions.list"],
  "identity current": ["identitySessions.current"],
} as const satisfies Record<string, readonly RouteId[]>;

const SESSION_COLUMNS = ["ID", "IDENTITY", "KEY", "STATUS", "ACQUIRED", "RELEASED", "RELEASED_BY"];

export function registerIdentity(program: Command): void {
  const identity = program
    .command("identity")
    .description(
      "Acquire and release exclusive identity sessions (one active key per exclusive identity)"
    );

  identity
    .command("acquire")
    .description("Acquire an exclusive identity; the session key is shown exactly once")
    .argument("<userId>", "agent user id (exclusive identity)")
    .action(async (userId: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.acquireIdentitySession(userId);
      emit(ctx.mode, {
        json: res,
        human: () =>
          [
            `acquired identity session ${res.session.id}`,
            kv([
              ["identity", res.session.user_id],
              ["key", res.session.api_key_id],
              ["status", res.session.status],
            ]),
            "",
            `  ${res.token}`,
            "",
            "this session key is shown only once and is the only key that may use this",
            "identity while the session is active; release it with",
            `  tmj identity release ${res.session.user_id}`,
          ].join("\n"),
        quiet: () => res.session.id,
      });
    });

  identity
    .command("release")
    .description("Release the identity's active session (the worker's own key, or a manager)")
    .argument("<userId>", "agent user id (exclusive identity)")
    .option("--reason <reason>", "recorded reason (useful for management recovery)")
    .action(async (userId: string, opts: { reason?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.releaseIdentitySession(userId, {
        ...(opts.reason ? { reason: opts.reason } : {}),
      });
      emit(ctx.mode, {
        json: res,
        human: () =>
          [
            `released identity session ${res.session.id}`,
            kv([
              ["identity", res.session.user_id],
              ["key_revoked", res.session.api_key_id],
              ["released", ts(res.session.released_at)],
              ["reason", res.session.release_reason ?? "—"],
            ]),
          ].join("\n"),
        quiet: () => res.session.id,
      });
    });

  identity
    .command("get")
    .description("Show an identity's active session (or none)")
    .argument("<userId>", "agent user id")
    .action(async (userId: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.getIdentitySession(userId);
      emit(ctx.mode, {
        json: res,
        human: () =>
          res.session
            ? kv([
                ["session", res.session.id],
                ["identity", res.session.user_id],
                ["key", res.session.api_key_id],
                ["acquired", ts(res.session.created_at)],
                ["by", res.session.created_by],
              ])
            : "no active session",
        quiet: () => res.session?.id ?? "",
      });
    });

  identity
    .command("list")
    .description("List all active identity sessions")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listIdentitySessions();
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            SESSION_COLUMNS,
            res.items.map((s) => [
              s.id,
              s.user_id,
              s.api_key_id,
              s.status,
              ts(s.created_at),
              ts(s.released_at),
              s.released_by ?? "",
            ])
          ),
        quiet: () => res.items.map((s) => s.id).join("\n"),
      });
    });

  identity
    .command("current")
    .description("Identify the caller's own identity session (worker self-check)")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.currentIdentitySession();
      emit(ctx.mode, {
        json: res,
        human: () =>
          res.session
            ? kv([
                ["identity", `${res.user.name} (${res.user.id})`],
                ["session", res.session.id],
                ["acquired", ts(res.session.created_at)],
              ])
            : `${res.user.name} (${res.user.id}) holds no identity session`,
        quiet: () => res.session?.id ?? "",
      });
    });
}
