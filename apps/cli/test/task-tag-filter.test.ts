import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TemujiraClient } from "@temujira/client";
import { registerTask } from "../src/commands/task";

const client = vi.hoisted(() => ({ listTags: vi.fn(), listTasks: vi.fn() }));
vi.mock("../src/context", () => ({ getCtx: () => ({ client, mode: "json" }) }));
vi.mock("../src/output", async (original) => ({ ...await original<typeof import("../src/output")>(), emit: vi.fn() }));
const a = "01ARZ3NDEKTSV4RRFFQ69G5FAV", b = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const run = (args: string[]) => {
  const program = new Command().exitOverride();
  registerTask(program);
  return program.parseAsync(["task", "list", "--workspace", "ENG", ...args], { from: "user" });
};

beforeEach(() => {
  vi.clearAllMocks();
  client.listTags.mockResolvedValue({ items: [{ id: a, name: "Backend" }, { id: b, name: "Urgent" }] });
  client.listTasks.mockResolvedValue({ items: [], total: 0 });
});

describe("CLI multi-tag filtering", () => {
  it("resolves repeated names once and defaults to all tags", async () => {
    await run(["--tag", "backend", "--tag", "Urgent", "--tag", "Backend"]);
    expect(client.listTags).toHaveBeenCalledTimes(1);
    expect(client.listTasks).toHaveBeenCalledWith("ENG", { tag_ids: `${a},${b}`, tag_match: "all" });
  });

  it("accepts any-tag matching and passes ids without a lookup", async () => {
    await run(["--tag", a, "--tag", b, "--tag-match", "any"]);
    expect(client.listTags).not.toHaveBeenCalled();
    expect(client.listTasks).toHaveBeenCalledWith("ENG", { tag_ids: `${a},${b}`, tag_match: "any" });
  });

  it("does not filter when no tags are supplied", async () => {
    await run([]);
    expect(client.listTasks).toHaveBeenCalledWith("ENG", {});
  });

  it("serializes multi-tag filters through the API client", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    const api = new TemujiraClient({ baseUrl: "https://example.test", fetch });
    await api.listTasks("ENG", { tag_ids: `${a},${b}`, tag_match: "any", offset: 100 });
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.searchParams.get("tag_ids")).toBe(`${a},${b}`);
    expect(url.searchParams.get("tag_match")).toBe("any");
    expect(url.searchParams.get("offset")).toBe("100");
  });
});
