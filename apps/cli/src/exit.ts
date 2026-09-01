import { ApiError } from "@temujira/client";

/**
 * tmj exit codes:
 *   0  success
 *   1  network error / 5xx / local failure (e.g. checksum mismatch)
 *   2  usage error (bad flags or arguments)
 *   3  auth: 401/403 from the API, or no credentials configured
 *   4  not found: 404, or a client-side resolver miss (email / status name)
 *   5  invalid request / conflict: 400, 409, 413, 429
 */
export const EXIT_CODES = {
  ok: 0,
  server: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  invalid: 5,
} as const;

/** CLI-level failure carrying its own exit code (defaults to 1). */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number = EXIT_CODES.server,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Map an HTTP status from the API to a tmj exit code. */
export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT_CODES.auth;
  if (status === 404) return EXIT_CODES.notFound;
  if (status === 400 || status === 409 || status === 413 || status === 429) {
    return EXIT_CODES.invalid;
  }
  // 5xx and anything unexpected.
  return EXIT_CODES.server;
}

/** Map any thrown error to a tmj exit code (network errors land on 1). */
export function exitCodeForError(err: unknown): number {
  if (err instanceof ApiError) return exitCodeForStatus(err.status);
  if (err instanceof CliError) return err.exitCode;
  return EXIT_CODES.server;
}
