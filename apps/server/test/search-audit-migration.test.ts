import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app';

it('upgrades an existing populated database without losing history or attachments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmj-search-upgrade-'));
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(join(dir, 'temujira.db'));
    const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
    sqlite.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    // Existing deployment through 0007, before the search/audit expansion.
    for (const migration of migrations.slice(0, 8)) {
      for (const sql of migration.sql) sqlite.exec(sql);
      sqlite.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(migration.hash, migration.folderMillis);
    }
    sqlite.exec(`
      INSERT INTO users(id,email,name,role,created_at,updated_at) VALUES ('u','reader@example.com','Reader','admin',1,1);
      INSERT INTO workspaces(id,name,key,created_at,updated_at) VALUES ('w','Upgrade','UPG',1,1);
      INSERT INTO statuses(id,workspace_id,name,color,position,created_at) VALUES ('s','w','Backlog','#000000',0,1);
      INSERT INTO tasks(id,workspace_id,number,title,description,status_id,created_by,created_at,updated_at) VALUES ('t','w',1,'Historical task','legacy description','s','u',1,1);
      INSERT INTO comments(id,task_id,author_id,body,created_at,updated_at) VALUES ('c','t','u','legacy discussion',1,1);
      INSERT INTO attachments(id,comment_id,uploader_id,filename,mime_type,size,sha256,created_at) VALUES ('a','c','u','legacy.txt','text/plain',14,'hash',1);
      INSERT INTO activity_events(id,workspace_id,task_id,actor_id,action,metadata,created_at) VALUES ('e','w','t','u','task.created','{"retained":true}',1);
      INSERT INTO tasks(id,workspace_id,number,title,status_id,created_by,created_at,updated_at) VALUES ('recent','w',2,'Recent task','s','u',2,2);
      INSERT INTO queue_entries(id,user_id,task_id,position,state,added_by,created_at,updated_at) VALUES ('q','u','t',3,'running','u',1,1);
      INSERT INTO inbox_items(id,user_id,workspace_id,task_id,actor_id,kind,source_comment_id,created_at) VALUES ('i','u','w','t','u','mention','c',1);
    `);
    mkdirSync(join(dir, 'uploads'));
    writeFileSync(join(dir, 'uploads', 'a'), 'legacy content');
    sqlite.close();
    sqlite = undefined;
    const app = await buildApp({ dataDir: dir, maxUploadMb: 5, cookieSecure: false, devOrigins: [], version: 'test' });
    sqlite = app.ctx.sqlite;
    expect(sqlite.prepare('SELECT action,metadata,visibility FROM activity_events WHERE id=?').get('e')).toEqual({ action: 'task.created', metadata: '{"retained":true}', visibility: 'workspace' });
    expect(sqlite.prepare('SELECT search_text FROM attachments WHERE id=?').get('a')).toEqual({ search_text: 'legacy content' });
    expect(sqlite.prepare("SELECT count(*) n FROM search_fts WHERE search_fts MATCH 'legacy'").get()).toEqual({ n: 3 });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(app.ctx.storage.exists('a')).toBe(true);
    expect(sqlite.prepare('SELECT id,position FROM tasks ORDER BY position').all()).toEqual([{ id: 'recent', position: 0 }, { id: 't', position: 1 }]);
    expect(sqlite.prepare('SELECT id,position,state FROM queue_entries').all()).toEqual([{ id: 'q', position: 3, state: 'running' }]);
    expect(sqlite.prepare('SELECT sequence,inbox_id FROM inbox_events').all()).toEqual([{ sequence: 1, inbox_id: 'i' }]);
    expect((await app.app.request('/api/v1/queue')).status).toBe(404);
  } finally {
    sqlite?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
