import type { Command } from "commander";
import type { RouteId } from "@temujira/shared";
import { getCtx } from "../context";
import { CliError, EXIT_CODES } from "../exit";
import { printJson } from "../output";
import { collect, readStdin } from "../util";

/**
 * The raw escape hatch (client.request) can reach every registry route — it is
 * the standing parity floor. It is the canonical home of the meta routes, which
 * have no dedicated command.
 */
export const COMMAND_ROUTES = {
  api: ["meta.health", "meta.openapi"],
} as const satisfies Record<string, readonly RouteId[]>;

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"];

export function registerApi(program: Command): void {
  program
    .command("api")
    .description("Raw API escape hatch: call any /api/v1 endpoint (always prints JSON)")
    .argument("<method>", "HTTP method (GET, POST, PATCH, PUT, DELETE)")
    .argument("<path>", "path under /api/v1, e.g. /tasks/TEM-1")
    .option("--body <json>", 'JSON request body ("-" reads stdin)')
    .option("--query <k=v>", "query parameter (repeatable)", collect, [] as string[])
    .action(
      async (
        method: string,
        apiPath: string,
        opts: { body?: string; query: string[] },
        cmd: Command,
      ) => {
        const ctx = getCtx(cmd, { requireAuth: false });
        const m = method.toUpperCase();
        if (!METHODS.includes(m)) {
          throw new CliError(`unsupported HTTP method "${method}"`, EXIT_CODES.usage);
        }
        let body: Record<string, unknown> | undefined;
        if (opts.body !== undefined) {
          const raw = opts.body === "-" ? await readStdin() : opts.body;
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            throw new CliError("--body is not valid JSON", EXIT_CODES.usage);
          }
        }
        const query: Record<string, string> = {};
        for (const pair of opts.query) {
          const eq = pair.indexOf("=");
          if (eq <= 0) {
            throw new CliError(`--query expects k=v, got "${pair}"`, EXIT_CODES.usage);
          }
          query[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
        const p = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
        const result = await ctx.client.request(m, p, { body, query });
        if (result !== undefined) printJson(result);
      },
    );
}
