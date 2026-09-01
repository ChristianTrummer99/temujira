/** Small builtin extension → content-type map for uploads. */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  mp4: "video/mp4",
  mov: "video/quicktime",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  ts: "text/typescript",
};

const FALLBACK = "application/octet-stream";

/** Guess a content type from the file extension (case-insensitive); fallback octet-stream. */
export function guessContentType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return FALLBACK;
  const ext = filename.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? FALLBACK;
}
