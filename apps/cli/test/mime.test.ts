import { describe, expect, it } from "vitest";
import { guessContentType } from "../src/mime";

describe("guessContentType", () => {
  it.each([
    ["a.png", "image/png"],
    ["photo.JPG", "image/jpeg"],
    ["b.jpeg", "image/jpeg"],
    ["anim.gif", "image/gif"],
    ["pic.webp", "image/webp"],
    ["logo.svg", "image/svg+xml"],
    ["doc.pdf", "application/pdf"],
    ["notes.txt", "text/plain"],
    ["README.md", "text/markdown"],
    ["data.json", "application/json"],
    ["rows.csv", "text/csv"],
    ["bundle.zip", "application/zip"],
    ["dump.gz", "application/gzip"],
    ["arch.tar", "application/x-tar"],
    ["clip.mp4", "video/mp4"],
    ["clip.mov", "video/quicktime"],
    ["page.html", "text/html"],
    ["style.css", "text/css"],
    ["app.js", "text/javascript"],
    ["app.ts", "text/typescript"],
  ])("%s → %s", (filename, expected) => {
    expect(guessContentType(filename)).toBe(expected);
  });

  it("uses the last extension for compound names", () => {
    expect(guessContentType("logs.tar.gz")).toBe("application/gzip");
  });

  it("falls back to application/octet-stream", () => {
    expect(guessContentType("binary")).toBe("application/octet-stream");
    expect(guessContentType("weird.xyz")).toBe("application/octet-stream");
    expect(guessContentType(".bashrc")).toBe("application/octet-stream");
    expect(guessContentType("trailingdot.")).toBe("application/octet-stream");
  });
});
