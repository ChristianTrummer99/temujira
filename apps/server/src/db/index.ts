import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const HERE = dirname(fileURLToPath(import.meta.url));

function findMigrationsDir(): string {
  const candidates = [
    join(HERE, "migrations"), // dev/test: src/db/migrations; docker: dist/migrations (copied at build)
    join(HERE, "db", "migrations"), // bundled dist/index.js sitting next to dist/db/migrations
    join(process.cwd(), "src", "db", "migrations"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "meta", "_journal.json"))) return c;
  }
  throw new Error(`could not locate drizzle migrations dir; tried: ${candidates.join(", ")}`);
}

function pendingMigrations(sqlite: Database.Database, migrationsDir: string): number {
  const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  let applied = 0;
  try {
    const row = sqlite.prepare(`SELECT count(*) AS c FROM "__drizzle_migrations"`).get() as { c: number };
    applied = row.c;
  } catch {
    applied = 0;
  }
  return Math.max(0, journal.entries.length - applied);
}

function backupBeforeMigrate(sqlite: Database.Database, dbPath: string): void {
  const backupPath = `${dbPath}.pre-migration-${Date.now()}.bak`;
  sqlite.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  // Keep only the 3 newest backups.
  const dir = dirname(dbPath);
  const backups = readdirSync(dir)
    .filter((f) => f.includes(".pre-migration-") && f.endsWith(".bak"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const old of backups.slice(3)) unlinkSync(old);
}

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  dbPath: string;
}

export function createDb(dataDir: string): DbHandle {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
  const dbPath = join(dataDir, "temujira.db");
  const existed = existsSync(dbPath);

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");

  const migrationsDir = findMigrationsDir();
  if (existed && pendingMigrations(sqlite, migrationsDir) > 0) {
    backupBeforeMigrate(sqlite, dbPath);
  }
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsDir });
  return { db, sqlite, dbPath };
}
