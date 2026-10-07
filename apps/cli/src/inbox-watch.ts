import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError, type InboxEvent, type TemujiraClient } from "@temujira/client";
import { writePrivateJson } from "./config";
import { CliError, EXIT_CODES } from "./exit";

export interface InboxCheckpoint { url: string; user_id: string; cursor: number }
export function readInboxCheckpoint(file: string, identity: Omit<InboxCheckpoint, "cursor">): number | undefined {
  if (!fs.existsSync(file)) return undefined;
  let value: InboxCheckpoint;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new CliError("invalid inbox cursor file", EXIT_CODES.usage); }
  if (!value || value.url !== identity.url || value.user_id !== identity.user_id) {
    throw new CliError("inbox cursor file belongs to another server or identity", EXIT_CODES.usage);
  }
  if (!Number.isSafeInteger(value.cursor) || value.cursor < 0) throw new CliError("invalid inbox cursor", EXIT_CODES.usage);
  return value.cursor;
}

export interface WatchOptions {
  after?: number;
  once?: boolean;
  interval: number;
  limit: number;
  signal: AbortSignal;
  event: (event: InboxEvent) => Promise<void>;
  checkpoint: (cursor: number) => Promise<void>;
  warn: (message: string) => void;
  wait?: (ms: number) => Promise<void>;
}

/** Page forward, including read notifications. Advance only after stdout has accepted them. */
export async function watchInbox(client: Pick<TemujiraClient, "watchInbox">, opts: WatchOptions): Promise<void> {
  let cursor = opts.after;
  let failures = 0;
  const wait = opts.wait ?? ((ms: number) => delay(ms, undefined, { signal: opts.signal }));
  try {
    while (!opts.signal.aborted) {
      let page: Awaited<ReturnType<TemujiraClient["watchInbox"]>>;
      try {
        page = await client.watchInbox({ after: cursor, limit: opts.limit });
        failures = 0;
      } catch (e) {
        if (opts.signal.aborted) return;
        if (opts.once || (e instanceof ApiError && e.status < 500 && e.status !== 429)) throw e;
        const ms = Math.min(60_000, opts.interval * 1000 * 2 ** Math.min(failures++, 6));
        opts.warn(`Inbox request failed. Retry in ${ms / 1000} seconds.`);
        await wait(ms);
        continue;
      }
      for (const event of page.items) {
        if (opts.signal.aborted) return; // last saved page may replay; no event is skipped
        await opts.event(event);
      }
      if (page.cursor !== cursor || opts.once) await opts.checkpoint(page.cursor);
      cursor = page.cursor;
      if (page.has_more) continue;
      if (opts.once) return;
      await wait(opts.interval * 1000);
    }
  } catch (e) {
    if (!opts.signal.aborted) throw e;
  }
}

export function saveInboxCheckpoint(file: string, checkpoint: InboxCheckpoint) {
  writePrivateJson(file, checkpoint);
}
