import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { emit, kv, table, ts } from "../output";

export const COMMAND_ROUTES = {
  "reservation claim": ["reservations.claim"],
  "reservation list": ["reservations.list"],
  "reservation get": ["reservations.get"],
  "reservation lookup": ["reservations.lookup"],
  "reservation current": ["reservations.current"],
  "reservation release": ["reservations.release"],
} as const satisfies Record<string, readonly RouteId[]>;

const RESERVATION_COLUMNS = ["ID", "STATUS", "AGENT", "TICKET", "RUN", "REQUEST", "KEY", "CREATED", "RELEASED"];

export function registerReservation(program: Command): void {
  const reservation = program
    .command("reservation")
    .description("Exclusive agent identity+ticket reservations (leasing) with reservation-bound worker keys");

  reservation
    .command("claim")
    .description("Atomically reserve an agent identity + ticket; the worker key is shown once")
    .requiredOption("--agent <userId>", "managed agent user id")
    .requiredOption("--task <idOrKey>", "task id or display key")
    .requiredOption("--run <reference>", "opaque run reference, e.g. batch-4/run-001")
    .requiredOption("--request-id <id>", "client idempotency key; repeats return the same reservation")
    .option(
      "--adopt-existing-assignment",
      "reconcile a ticket already assigned to this agent without a reservation"
    )
    .action(
      async (
        opts: {
          agent: string;
          task: string;
          run: string;
          requestId: string;
          adoptExistingAssignment?: boolean;
        },
        cmd: Command
      ) => {
        const ctx = getCtx(cmd);
        const res = await ctx.client.claimReservation({
          agent_user_id: opts.agent,
          task: opts.task,
          run_reference: opts.run,
          request_id: opts.requestId,
          ...(opts.adoptExistingAssignment ? { adopt_existing_assignment: true } : {}),
        });
        emit(ctx.mode, {
          json: res,
          human: () => {
            const lines = [
              `${res.replayed ? "existing" : "created"} reservation ${res.reservation.id}`,
              kv([
                ["agent", res.reservation.agent_user_id],
                ["ticket", res.reservation.task_key],
                ["run", res.reservation.run_reference],
                ["request", res.reservation.request_id],
                ["key", res.reservation.api_key_id],
                ["status", res.reservation.status],
              ]),
            ];
            if (res.token) {
              lines.push(
                "",
                `  ${res.token}`,
                "",
                "this worker key is shown only once and is bound to this reservation",
                "if it is lost, release the reservation and claim again"
              );
            } else {
              lines.push(
                "",
                "token not re-revealed (idempotent replay); release and re-claim if it was lost"
              );
            }
            return lines.join("\n");
          },
          quiet: () => res.reservation.id,
        });
      }
    );

  reservation
    .command("list")
    .description("List reservations (filter by agent, ticket, status or request id)")
    .option("--agent <userId>", "filter by agent user id")
    .option("--task <idOrKey>", "filter by task")
    .option("--status <status>", "filter by status: active|released")
    .option("--request-id <id>", "filter by request id")
    .option("--limit <n>", "max results (default 50)")
    .option("--offset <n>", "skip results")
    .action(
      async (
        opts: {
          agent?: string;
          task?: string;
          status?: string;
          requestId?: string;
          limit?: string;
          offset?: string;
        },
        cmd: Command
      ) => {
        const ctx = getCtx(cmd);
        const res = await ctx.client.listReservations({
          ...(opts.agent ? { agent_user_id: opts.agent } : {}),
          ...(opts.task ? { task: opts.task } : {}),
          ...(opts.status ? { status: opts.status as "active" | "released" } : {}),
          ...(opts.requestId ? { request_id: opts.requestId } : {}),
          ...(opts.limit ? { limit: Number(opts.limit) } : {}),
          ...(opts.offset ? { offset: Number(opts.offset) } : {}),
        });
        emit(ctx.mode, {
          json: res,
          human: () =>
            table(
              RESERVATION_COLUMNS,
              res.items.map((r) => [
                r.id,
                r.status,
                r.agent_user_id,
                r.task_key,
                r.run_reference,
                r.request_id,
                r.api_key_id,
                ts(r.created_at),
                ts(r.released_at),
              ])
            ),
          quiet: () => res.items.map((r) => r.id).join("\n"),
        });
      }
    );

  reservation
    .command("get")
    .description("Inspect one reservation (identity, ticket, run reference, key id, lifecycle)")
    .argument("<id>", "reservation id")
    .action(async (id: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.getReservation(id);
      emit(ctx.mode, {
        json: res,
        human: () => kv([
          ["id", res.reservation.id],
          ["status", res.reservation.status],
          ["agent", res.reservation.agent_user_id],
          ["ticket", res.reservation.task_key],
          ["run", res.reservation.run_reference],
          ["request", res.reservation.request_id],
          ["key", res.reservation.api_key_id],
          ["manager", res.reservation.manager_user_id],
          ["created", ts(res.reservation.created_at)],
          ["released", ts(res.reservation.released_at)],
          ["released_by", res.reservation.released_by ?? "—"],
          ["reason", res.reservation.release_reason ?? "—"],
        ]),
        quiet: () => res.reservation.id,
      });
    });

  reservation
    .command("lookup")
    .description("Recover a committed claim by request id (no new ownership is created)")
    .requiredOption("--request-id <id>", "the claim's client request id")
    .action(async (opts: { requestId: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.lookupReservation(opts.requestId);
      emit(ctx.mode, {
        json: res,
        human: () =>
          res.reservation
            ? kv([
                ["id", res.reservation.id],
                ["status", res.reservation.status],
                ["agent", res.reservation.agent_user_id],
                ["ticket", res.reservation.task_key],
                ["run", res.reservation.run_reference],
                ["key", res.reservation.api_key_id],
              ])
            : "no reservation for that request id",
        quiet: () => res.reservation?.id ?? "",
      });
    });

  reservation
    .command("current")
    .description("Identify the caller's credential and reservation (worker self-check)")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.currentReservation();
      emit(ctx.mode, {
        json: res,
        human: () =>
          res.reservation
            ? kv([
                ["user", `${res.user.name} (${res.user.id})`],
                ["reservation", res.reservation.id],
                ["status", res.reservation.status],
                ["ticket", res.task ? `${res.task.key} — ${res.task.title}` : res.reservation.task_key],
                ["run", res.reservation.run_reference],
              ])
            : `${res.user.name} (${res.user.id}) holds no reservation credential`,
        quiet: () => res.reservation?.id ?? "",
      });
    });

  reservation
    .command("release")
    .description("Release a reservation: revoke its key and clear the matching assignment")
    .argument("<id>", "reservation id")
    .option("--reason <reason>", "recorded reason")
    .action(async (id: string, opts: { reason?: string }, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.releaseReservation(id, {
        ...(opts.reason ? { reason: opts.reason } : {}),
      });
      emit(ctx.mode, {
        json: res,
        human: () =>
          [
            `released reservation ${res.reservation.id}`,
            kv([
              ["agent", res.reservation.agent_user_id],
              ["ticket", res.reservation.task_key],
              ["key_revoked", res.reservation.api_key_id],
              ["released", ts(res.reservation.released_at)],
              ["reason", res.reservation.release_reason ?? "—"],
            ]),
          ].join("\n"),
        quiet: () => res.reservation.id,
      });
    });
}
