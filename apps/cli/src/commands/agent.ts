import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, kv, table } from "../output";

export const COMMAND_ROUTES = {
  "agent list": ["managedAgents.list"],
  "agent admit": ["managedAgents.admit"],
  "agent remove": ["managedAgents.remove"],
} as const satisfies Record<string, readonly RouteId[]>;

export function registerAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("Manage admitted agent identities for reservations (exclusive assignments)");

  agent
    .command("list")
    .description("List managed agent identities with availability and current reservation")
    .option("--deactivated", "include deactivated identities")
    .action(async (opts: { deactivated?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.listManagedAgents(
        opts.deactivated ? { include_deactivated: true } : {}
      );
      emit(ctx.mode, {
        json: res,
        human: () =>
          table(
            ["USER", "NAME", "AVAILABLE", "RESERVATION", "TICKET", "CONFLICTS"],
            res.items.map((a) => [
              a.user_id,
              a.name,
              a.available ? "yes" : "no",
              a.reservation ? a.reservation.id : "",
              a.reservation?.task_key ?? "",
              a.conflicts.join("; "),
            ])
          ),
        quiet: () => res.items.map((a) => a.user_id).join("\n"),
      });
    });

  agent
    .command("admit")
    .description("Admit an existing agent account to the reservation workflow")
    .argument("<userId>", "agent user id")
    .option("--note <note>", "reconciliation note (existing keys/assignments)")
    .action(async (userId: string, opts: { note?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.admitManagedAgent({
        user_id: userId,
        ...(opts.note ? { note: opts.note } : {}),
      });
      emit(ctx.mode, {
        json: res,
        human: () =>
          [
            `admitted agent ${res.agent.name} (${res.agent.user_id})`,
            kv([
              ["available", res.agent.available ? "yes" : "no"],
              ["reservation", res.agent.reservation?.id ?? "none"],
              ["conflicts", res.agent.conflicts.join("; ") || "none"],
            ]),
          ].join("\n"),
        quiet: () => res.agent.user_id,
      });
    });

  agent
    .command("remove")
    .description("Un-admit an agent identity (requires no active reservation)")
    .argument("<userId>", "agent user id")
    .action(async (userId: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      await ctx.client.removeManagedAgent(userId);
      emit(ctx.mode, {
        json: { ok: true as const, user_id: userId },
        human: () => `un-admitted agent ${userId}`,
        quiet: () => userId,
      });
    });
}
