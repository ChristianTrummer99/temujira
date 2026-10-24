import { expect, it } from "vitest";
import { buildProgram } from "../src/index";

it("rejects an unknown API-key scope before any request", async () => {
  await expect(
    buildProgram().parseAsync(["apikey", "create", "--name", "x", "--scope", "not-a-scope"], { from: "user" }),
  ).rejects.toThrow(/unknown scope/);
});
