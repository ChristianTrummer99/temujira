import type { Command } from "commander";
import type { QueueEntry, QueueState } from "@temujira/client";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { emit, table, truncate } from "../output";
import { isUlid } from "../resolve";

export const COMMAND_ROUTES = {
  "queue list": ["queue.get"],
  "queue next": ["queue.next"],
  "queue add": ["queue.add"],
  "queue start": ["queue.setState", "queue.get"],
  "queue ready": ["queue.setState", "queue.get"],
  "queue pause": ["queue.setState", "queue.get"],
  "queue complete": ["queue.remove", "queue.get"],
  "queue remove": ["queue.remove", "queue.get"],
  "queue reorder": ["queue.reorder"],
} as const satisfies Record<string, readonly RouteId[]>;

const STATE_LABEL: Record<QueueState, string> = {
  running: "running",
  ready: "ready",
  queued: "queued",
};

function queueTable(items: QueueEntry[]): string {
  return table(
    ["POS", "STATE", "BLOCKED", "TASK", "TITLE"],
    items.map((e) => [
      String(e.position),
      STATE_LABEL[e.state],
      e.blocked ? "yes" : "",
      e.task.key,
      truncate(e.task.title, 60),
    ]),
  );
}

/**
 * Resolve a queue-entry spec (entry id, task id, or task key) against the user's queue.
 * The whole queue comes from one GET; miss → exit 4.
 */

export function registerQueue(program: Command): void {
  const queue = program.command("queue").description("Your ordered work queue (queued → ready → running)");

  queue
    .command("list")
    .description("Show your queue in order")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.getQueue();
      emit(ctx.mode, {
        json: res,
        human: () => queueTable(res.items),
        quiet: () => res.items.map((e) => e.id).join("\n"),
      });
    });

  queue
    .command("next")
    .description("The one to do next: running > ready > queued (or \"queue is empty\")")
    .action(async (_opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.queueNext();
      emit(ctx.mode, {
        json: res,
        human: () =>
          res.entry
            ? `next: ${res.entry.task.key} [${STATE_LABEL[res.entry.state]}]${res.entry.blocked ? " (blocked)" : ""}  ${truncate(res.entry.task.title, 60)}`
            : "queue is empty",
        quiet: () => res.entry?.id ?? "",
      });
    });

  queue
    .command("add")
    .description("Append a task to your queue")
    .argument("<idOrKey>", "task id or key (e.g. TEM-42)")
    .action(async (idOrKey: string, _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.addToQueue(idOrKey);
      emit(ctx.mode, {
        json: res,
        human: () => `queued ${res.entry.task.key} at position ${res.entry.position}`,
        quiet: () => res.entry.id,
      });
    });

  queue
    .command("start")
    .description('Mark an entry as "running now"')
    .argument("<entryIdOrTaskKey>", "queue entry id, task id, or task key")
    .action(async (spec: string, _opts: Record<string, never>, cmd: Command) => {
      await setStateCmd(cmd, spec, "running");
    });

  queue
    .command("ready")
    .description('Mark an entry as "ready to start"')
    .argument("<entryIdOrTaskKey>", "queue entry id, task id, or task key")
    .action(async (spec: string, _opts: Record<string, never>, cmd: Command) => {
      await setStateCmd(cmd, spec, "ready");
    });

  queue
    .command("pause")
    .description('Mark an entry back to "queued" (not started)')
    .argument("<entryIdOrTaskKey>", "queue entry id, task id, or task key")
    .action(async (spec: string, _opts: Record<string, never>, cmd: Command) => {
      await setStateCmd(cmd, spec, "queued");
    });

  queue
    .command("complete")
    .description("Complete an entry: remove it from your queue (queue is metadata — status is untouched)")
    .argument("<entryIdOrTaskKey>", "queue entry id, task id, or task key")
    .action(async (spec: string, _opts: Record<string, never>, cmd: Command) => {
      await removeCmd(cmd, spec, "completed");
    });

  queue
    .command("remove")
    .description("Remove an entry from your queue (alias of complete)")
    .argument("<entryIdOrTaskKey>", "queue entry id, task id, or task key")
    .action(async (spec: string, _opts: Record<string, never>, cmd: Command) => {
      await removeCmd(cmd, spec, "removed");
    });

  queue
    .command("reorder")
    .description("Reorder your queue: pass the FULL ordered list of all entry ids")
    .argument("<entryIds...>", "every queue entry id, in the desired order")
    .action(async (entryIds: string[], _opts: Record<string, never>, cmd: Command) => {
      const ctx = getCtx(cmd);
      const res = await ctx.client.reorderQueue(entryIds);
      emit(ctx.mode, {
        json: res,
        human: () => queueTable(res.items),
        quiet: () => res.items.map((e) => e.id).join("\n"),
      });
    });
}

async function setStateCmd(cmd: Command, spec: string, state: QueueState): Promise<void> {
  const ctx = getCtx(cmd);
  const found = await ctx.client.getQueue().then((res) => res.items.find((e) => matchesEntry(e, spec)));
  if (!found) {
    throw new CliError(`no queue entry matches "${spec}" — see \`tmj queue list\``, EXIT_CODES.notFound);
  }
  const res = await ctx.client.setQueueState(found.id, state);
  emit(ctx.mode, {
    json: res,
    human: () => `${res.entry.task.key} → ${STATE_LABEL[res.entry.state]}`,
    quiet: () => res.entry.id,
  });
}

async function removeCmd(cmd: Command, spec: string, verb: string): Promise<void> {
  const ctx = getCtx(cmd);
  const found = await ctx.client.getQueue().then((res) => res.items.find((e) => matchesEntry(e, spec)));
  if (!found) {
    throw new CliError(`no queue entry matches "${spec}" — see \`tmj queue list\``, EXIT_CODES.notFound);
  }
  const res = await ctx.client.removeFromQueue(found.id);
  emit(ctx.mode, {
    json: res,
    human: () => `${found.task.key} ${verb}`,
    quiet: () => found.id,
  });
}

function matchesEntry(entry: QueueEntry, spec: string): boolean {
  if (isUlid(spec)) return entry.id === spec || entry.task.id === spec;
  return entry.task.key.toLowerCase() === spec.trim().toLowerCase();
}