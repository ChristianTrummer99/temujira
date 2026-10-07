import { expect, it } from "vitest";
import { buildProgram } from "../src/index";

it.each(["", " ", "not-an-item-id"])("never treats an invalid explicit inbox ID (%j) as mark-all", async (id) => {
  // No credentials or server are needed: invalid selection must fail before any request.
  await expect(buildProgram().parseAsync(["inbox", "read", id], { from: "user" }))
    .rejects.toThrow("inbox item must be an id");
});
