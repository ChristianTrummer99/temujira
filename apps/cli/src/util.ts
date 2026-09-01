import fs from "node:fs";
import { InvalidArgumentError } from "commander";
import { CliError, EXIT_CODES } from "./exit";

/** Read all of stdin as UTF-8. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Read text from a file path, or from stdin when the path is "-". */
export async function textFromFileArg(spec: string): Promise<string> {
  if (spec === "-") return readStdin();
  try {
    return fs.readFileSync(spec, "utf8");
  } catch (err) {
    throw new CliError(
      `cannot read ${spec}: ${(err as NodeJS.ErrnoException).message}`,
      EXIT_CODES.usage,
    );
  }
}

/**
 * Resolve a (--x <inline> | --x-file <path|->) option pair.
 * Returns undefined when neither is given; both at once is a usage error.
 */
export async function resolveTextOption(
  name: string,
  inline: string | undefined,
  file: string | undefined,
): Promise<string | undefined> {
  if (inline !== undefined && file !== undefined) {
    throw new CliError(`use either --${name} or --${name}-file, not both`, EXIT_CODES.usage);
  }
  if (file !== undefined) return textFromFileArg(file);
  return inline;
}

/** Commander accumulator for repeatable options. */
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Commander argParser for non-negative integer options. */
export function nonNegativeInt(label: string): (value: string) => number {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      throw new InvalidArgumentError(`${label} must be a non-negative integer`);
    }
    return n;
  };
}
