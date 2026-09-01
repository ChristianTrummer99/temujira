import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { ROUTE_IDS } from "@temujira/shared";
import { ROUTE_METHOD_MAP, TemujiraClient } from "@temujira/client";
import { buildProgram } from "../src/index";
import { COMMAND_ROUTE_MAP } from "../src/parity";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

describe("CLI ⇔ API parity", () => {
  it("every registry route is reachable from at least one CLI command", () => {
    const covered = new Set(Object.values(COMMAND_ROUTE_MAP).flat());
    const missing = ROUTE_IDS.filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  it("every claimed route id exists in the registry", () => {
    const known = new Set<string>(ROUTE_IDS);
    for (const [command, ids] of Object.entries(COMMAND_ROUTE_MAP)) {
      for (const id of ids) {
        expect(known.has(id), `"${command}" claims unknown route ${id}`).toBe(true);
      }
    }
  });

  it("the client has a ROUTE_METHOD_MAP entry and a real method for every route", () => {
    for (const id of ROUTE_IDS) {
      const method = ROUTE_METHOD_MAP[id];
      expect(method, `no ROUTE_METHOD_MAP entry for ${id}`).toBeTruthy();
      expect(
        typeof TemujiraClient.prototype[method],
        `client method "${String(method)}" missing for ${id}`,
      ).toBe("function");
    }
  });

  it("COMMAND_ROUTE_MAP keys match the registered CLI commands exactly", () => {
    const program = buildProgram();
    const names = new Set<string>();
    const visit = (cmd: Command, prefix: string[]): void => {
      const subs = cmd.commands as readonly Command[];
      if (subs.length === 0) {
        names.add(prefix.join(" "));
        return;
      }
      for (const sub of subs) visit(sub, [...prefix, sub.name()]);
    };
    for (const sub of program.commands as readonly Command[]) visit(sub, [sub.name()]);
    expect([...names].sort()).toEqual(Object.keys(COMMAND_ROUTE_MAP).sort());
  });

  it("the client is the only transport: no raw fetch calls in src", () => {
    const needle = ["fe", "tch("].join(""); // avoid matching this test file's own text
    const offenders = walk(SRC_DIR).filter((file) =>
      fs.readFileSync(file, "utf8").includes(needle),
    );
    expect(offenders).toEqual([]);
  });
});
