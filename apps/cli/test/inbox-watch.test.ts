import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type InboxEvent } from "@temujira/client";
import { readInboxCheckpoint, saveInboxCheckpoint, watchInbox, type WatchOptions } from "../src/inbox-watch";

const event = (cursor: number) => ({ cursor, item: { id: `event-${cursor}` } }) as InboxEvent;
function options(): WatchOptions {
  return { interval: 1, limit: 2, signal: new AbortController().signal, event: vi.fn(async () => {}), checkpoint: vi.fn(async () => {}), warn: vi.fn(), wait: vi.fn(async () => {}) };
}

describe("inbox watcher", () => {
  it("drains every page once, emits events before checkpoints, and resumes after each page", async () => {
    const client = { watchInbox: vi.fn().mockResolvedValueOnce({ items: [event(1), event(2)], cursor: 2, has_more: true })
      .mockResolvedValueOnce({ items: [event(3)], cursor: 8, has_more: false }) };
    const seen: string[] = [];
    await watchInbox(client, { ...options(), after: 0, once: true, event: async (e) => { seen.push(`event:${e.cursor}`); }, checkpoint: async (c) => { seen.push(`cursor:${c}`); } });
    expect(seen).toEqual(["event:1", "event:2", "cursor:2", "event:3", "cursor:8"]);
    expect(client.watchInbox.mock.calls).toEqual([[{ after: 0, limit: 2 }], [{ after: 2, limit: 2 }]]);
  });

  it("does not save a cursor when output fails", async () => {
    const client = { watchInbox: vi.fn().mockResolvedValue({ items: [event(1)], cursor: 1, has_more: false }) };
    const opts = options();
    await expect(watchInbox(client, { ...opts, once: true, event: async () => { throw new Error("output failed"); } })).rejects.toThrow("output failed");
    expect(opts.checkpoint).not.toHaveBeenCalled();
  });

  it("retries temporary network errors but stops on revoked credentials", async () => {
    const client = { watchInbox: vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ items: [event(1)], cursor: 1, has_more: false })
      .mockRejectedValueOnce(new ApiError(401, "unauthorized", "revoked")) };
    const opts = options();
    await expect(watchInbox(client, opts)).rejects.toThrow("revoked");
    expect(opts.event).toHaveBeenCalledOnce();
    expect(opts.warn).toHaveBeenCalledOnce();
    expect(opts.checkpoint).toHaveBeenCalledWith(1);
  });

  it("stops cleanly when cancelled and validates server/user checkpoint binding", async () => {
    const controller = new AbortController();
    const client = { watchInbox: vi.fn().mockResolvedValue({ items: [], cursor: 4, has_more: false }) };
    await watchInbox(client, { ...options(), signal: controller.signal, wait: async () => { controller.abort(); } });
    expect(client.watchInbox).toHaveBeenCalledOnce();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmj-watch-"));
    try {
      const file = path.join(dir, "cursor.json"), identity = { url: "http://server", user_id: "user" };
      saveInboxCheckpoint(file, { ...identity, cursor: 4 });
      expect(readInboxCheckpoint(file, identity)).toBe(4);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(() => readInboxCheckpoint(file, { ...identity, user_id: "other" })).toThrow("another server or identity");
      expect(() => readInboxCheckpoint(file, { ...identity, url: "http://other" })).toThrow("another server or identity");
      fs.writeFileSync(file, "bad");
      expect(() => readInboxCheckpoint(file, identity)).toThrow("invalid inbox cursor file");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
