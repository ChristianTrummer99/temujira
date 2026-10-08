import { expect, it } from "vitest";
import { buildProgram } from "../src/index";

it.each([['task', 'TEST-1'], ['workspace', 'TEST']])('requires confirmation for %s deletion before any request', async (group, target) => {
  const program = buildProgram().configureOutput({ writeErr: () => {} });
  await expect(program.parseAsync([group!, 'delete', target!], { from: 'user' })).rejects.toMatchObject({ code: 'commander.missingMandatoryOptionValue' });
});
