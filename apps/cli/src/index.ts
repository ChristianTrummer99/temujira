import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { ApiError } from "@temujira/client";
import { registerActivity } from "./commands/activity";
import { registerApi } from "./commands/api";
import { registerApikey } from "./commands/apikey";
import { registerAttach } from "./commands/attach";
import { registerAuth } from "./commands/auth";
import { registerComment } from "./commands/comment";
import { registerInbox } from "./commands/inbox";
import { registerMe } from "./commands/me";
import { registerSetup } from "./commands/setup";
import { registerStatus } from "./commands/status";
import { registerTag } from "./commands/tag";
import { registerTask } from "./commands/task";
import { registerUser } from "./commands/user";
import { registerWorkspace } from "./commands/workspace";
import { configPath } from "./config";
import { EXIT_CODES, exitCodeForError } from "./exit";

const CONFIG_HELP = `
Configuration (highest wins):
  1. Flags:        --url, --api-key
  2. Environment:  TEMUJIRA_URL, TEMUJIRA_API_KEY
  3. Config file:  ${configPath()}
                   (written by \`tmj setup\` / \`tmj auth login\`; respects
                   XDG_CONFIG_HOME; contents: {"url", "api_key", "api_key_id"})

Output:
  default   human-readable; JSON is auto-enabled when stdout is not a TTY
  --json    raw API response, pretty-printed (2-space)
  --quiet   ids only (task lists print task keys); wins over --json

Exit codes:
  0  success                        3  auth (401/403 or missing credentials)
  1  network error / 5xx            4  not found (404)
  2  usage error                    5  invalid request / conflict (400/409/413/429)
`;

function addGlobalOptions(cmd: Command): void {
  cmd
    .option("--url <url>", "server URL (else TEMUJIRA_URL, else config file)")
    .option("--api-key <key>", "API key (else TEMUJIRA_API_KEY, else config file)")
    .option("--json", "print the raw JSON API response (auto when stdout is not a TTY)")
    .option("--quiet", "print only ids");
}

function leafCommands(cmd: Command): Command[] {
  const subs = cmd.commands as readonly Command[];
  if (subs.length === 0) return [cmd];
  return subs.flatMap((sub) => leafCommands(sub));
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("tmj")
    .description("Temujira — self-hosted project management for humans and AI agents")
    .exitOverride()
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText("after", CONFIG_HELP);
  registerSetup(program);
  registerAuth(program);
  registerMe(program);
  registerApikey(program);
  registerUser(program);
  registerWorkspace(program);
  registerStatus(program);
  registerTag(program);
  registerTask(program);
  registerComment(program);
  registerAttach(program);
  registerActivity(program);
  registerInbox(program);
  registerApi(program);
  addGlobalOptions(program);
  for (const leaf of leafCommands(program)) {
    if (leaf !== program) addGlobalOptions(leaf);
  }
  return program;
}

/** Print the error (stderr) and return the exit code. Exported for tests. */
export function handleError(err: unknown): number {
  if (err instanceof CommanderError) {
    // Commander already printed its message / help text.
    return err.exitCode === 0 ? EXIT_CODES.ok : EXIT_CODES.usage;
  }
  const argv = process.argv.slice(2);
  const quiet = argv.includes("--quiet");
  const jsonMode = !quiet && (argv.includes("--json") || !(process.stdout.isTTY ?? false));
  let message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.cause) {
    const cause = err.cause as { message?: string; code?: string };
    const extra = cause.code ?? cause.message;
    if (extra) message += ` (${extra})`;
  }
  if (jsonMode) {
    const payload =
      err instanceof ApiError
        ? {
            error: {
              code: err.code,
              message: err.message,
              status: err.status,
              ...(err.details === undefined ? {} : { details: err.details }),
            },
          }
        : { error: { message } };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  return exitCodeForError(err);
}

function flush(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write("", () => resolve()));
}

async function main(): Promise<void> {
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(EXIT_CODES.ok);
  });
  const program = buildProgram();
  let code: number = EXIT_CODES.ok;
  // `pnpm dev -- <args>` forwards the literal "--" — drop it when it leads.
  const argv = process.argv.slice();
  if (argv[2] === "--") argv.splice(2, 1);
  try {
    await program.parseAsync(argv);
  } catch (err) {
    code = handleError(err);
  }
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}

const entry = process.argv[1];
let isMain = false;
if (entry) {
  try {
    isMain = import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    isMain = false;
  }
}
if (isMain) void main();
