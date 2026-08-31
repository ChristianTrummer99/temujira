import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Workspace packages ship as TS source; bundle them into the server build.
  noExternal: [/^@temujira\//],
  onSuccess: "cp -R src/db/migrations dist/migrations",
});
