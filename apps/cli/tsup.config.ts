import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Workspace packages ship as TS source — they must be bundled in.
  noExternal: [/^@temujira\//],
  banner: { js: "#!/usr/bin/env node" },
});
