import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { HttpError } from "./errors";
import { newId } from "./util";

export interface StoredFile {
  size: number;
  sha256: string;
}

/**
 * Local-disk attachment store. Bytes live at <uploadsDir>/<attachment-ulid> (opaque name —
 * no path traversal, no collisions). Writes go to a temp file first and are renamed into
 * place only after the DB row commits.
 */
export class LocalStorage {
  constructor(
    private uploadsDir: string,
    private maxBytes: number,
  ) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  /**
   * Drain a stream to a temp file, hashing and counting bytes. Aborts mid-stream past
   * maxBytes (throws payload_too_large and removes the temp file).
   */
  async putStream(source: Readable): Promise<{ tmpId: string } & StoredFile> {
    const tmpId = `.tmp-${newId()}`;
    const tmpPath = join(this.uploadsDir, tmpId);
    const hash = createHash("sha256");
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmpPath, { flags: "wx" });
      source.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBytes) {
          source.unpipe(out);
          out.destroy();
          source.resume(); // drain the rest so the request can finish
          reject(new HttpError("payload_too_large", `file exceeds ${this.maxBytes} bytes`));
          return;
        }
        hash.update(chunk);
      });
      source.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      source.on("error", reject);
    }).catch((err) => {
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      } catch {
        // best effort
      }
      throw err;
    });
    return { tmpId, size, sha256: hash.digest("hex") };
  }

  /** Rename a temp upload into place under its attachment id. */
  commit(tmpId: string, attachmentId: string): void {
    renameSync(join(this.uploadsDir, tmpId), join(this.uploadsDir, attachmentId));
  }

  abort(tmpId: string): void {
    try {
      unlinkSync(join(this.uploadsDir, tmpId));
    } catch {
      // already gone
    }
  }

  path(attachmentId: string): string {
    return join(this.uploadsDir, attachmentId);
  }

  exists(attachmentId: string): boolean {
    return existsSync(this.path(attachmentId));
  }

  size(attachmentId: string): number {
    return statSync(this.path(attachmentId)).size;
  }

  stream(attachmentId: string): Readable {
    return createReadStream(this.path(attachmentId));
  }

  delete(attachmentId: string): void {
    try {
      unlinkSync(this.path(attachmentId));
    } catch {
      // best effort: row is already gone; the startup sweep catches leftovers
    }
  }

  /** Remove stale temp files and any file with no corresponding attachment row. */
  sweepOrphans(validIds: Set<string>): number {
    let removed = 0;
    for (const name of readdirSync(this.uploadsDir)) {
      if (name.startsWith(".tmp-") || !validIds.has(name)) {
        try {
          unlinkSync(join(this.uploadsDir, name));
          removed++;
        } catch {
          // best effort
        }
      }
    }
    return removed;
  }
}
