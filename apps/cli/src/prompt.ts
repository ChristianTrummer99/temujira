import { CliError, EXIT_CODES } from "./exit";

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const DEL = "\u007f";

/**
 * Prompt for a secret on the terminal with echo disabled (readline-style raw
 * mode on stdin; the prompt itself goes to stderr so stdout stays clean).
 * When stdin is not a TTY this is a usage error (exit 2) — pass the value via
 * a flag instead.
 */
export function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(
        new CliError(
          "cannot prompt for a password: stdin is not a TTY (pass it via a flag)",
          EXIT_CODES.usage,
        ),
      );
      return;
    }
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === CTRL_C || ch === CTRL_D) {
          cleanup();
          process.stderr.write("\n");
          reject(new CliError("aborted", EXIT_CODES.usage));
          return;
        }
        if (ch === DEL || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
