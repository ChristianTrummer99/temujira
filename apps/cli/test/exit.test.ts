import { describe, expect, it } from "vitest";
import { ApiError } from "@temujira/client";
import { CliError, EXIT_CODES, exitCodeForError, exitCodeForStatus } from "../src/exit";

describe("exit code mapping", () => {
  it.each([
    [500, 1],
    [502, 1],
    [503, 1],
    [401, 3],
    [403, 3],
    [404, 4],
    [400, 5],
    [409, 5],
    [413, 5],
    [429, 5],
    [418, 1], // anything unexpected → 1
  ])("HTTP %i → exit %i", (status, code) => {
    expect(exitCodeForStatus(status)).toBe(code);
  });

  it("maps ApiError by its status", () => {
    expect(exitCodeForError(new ApiError(401, "unauthorized", "no"))).toBe(EXIT_CODES.auth);
    expect(exitCodeForError(new ApiError(403, "forbidden", "no"))).toBe(EXIT_CODES.auth);
    expect(exitCodeForError(new ApiError(404, "not_found", "nope"))).toBe(EXIT_CODES.notFound);
    expect(exitCodeForError(new ApiError(409, "conflict", "busy"))).toBe(EXIT_CODES.invalid);
    expect(exitCodeForError(new ApiError(429, "rate_limited", "slow down"))).toBe(
      EXIT_CODES.invalid,
    );
    expect(exitCodeForError(new ApiError(500, "server_error", "boom"))).toBe(EXIT_CODES.server);
  });

  it("maps CliError to its own exit code", () => {
    expect(exitCodeForError(new CliError("bad flag", 2))).toBe(EXIT_CODES.usage);
    expect(exitCodeForError(new CliError("miss", 4))).toBe(EXIT_CODES.notFound);
    expect(exitCodeForError(new CliError("checksum mismatch"))).toBe(EXIT_CODES.server);
  });

  it("maps network errors (plain TypeError from the fetch layer) to 1", () => {
    expect(exitCodeForError(new TypeError("fetch failed"))).toBe(EXIT_CODES.server);
    expect(exitCodeForError(new Error("socket hang up"))).toBe(EXIT_CODES.server);
  });
});
