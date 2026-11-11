import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = resolve(process.env.GINKGO_DATA_DIR ?? resolve(here, 'data'))
mkdirSync(DATA_DIR, { recursive: true })

/** 公共原稿的归属标记；用户数据的归属是用户 id（UUID），两者不会冲突 */
export const PUBLIC_OWNER = 'public'

export const db = new DatabaseSync(resolve(DATA_DIR, 'ginkgo.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pages (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    source_id  TEXT,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pages_owner ON pages(owner);

  CREATE TABLE IF NOT EXISTS databases (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_databases_owner ON databases(owner);

  CREATE TABLE IF NOT EXISTS db_rows (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    db_id      TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_db_rows_db ON db_rows(db_id);

  CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

let txDepth = 0

/** 可嵌套：只有最外层真正 BEGIN / COMMIT */
export function transaction<T>(fn: () => T): T {
  if (txDepth > 0) {
    txDepth++
    try {
      return fn()
    } finally {
      txDepth--
    }
  }
  db.exec('BEGIN')
  txDepth = 1
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  } finally {
    txDepth = 0
  }
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/* ---------------- 文档表（pages / databases / db_rows）通用读写 ---------------- */

export type DocTable = 'pages' | 'databases' | 'db_rows'

export type Doc = { id: string; [k: string]: unknown }

export function listDocs<T = Doc>(table: DocTable, owner: string): T[] {
  const rows = db.prepare(`SELECT data FROM ${table} WHERE owner = ?`).all(owner) as {
    data: string
  }[]
  return rows.map((r) => JSON.parse(r.data) as T)
}

export function getDocOwner(table: DocTable, id: string): string | null {
  const row = db.prepare(`SELECT owner FROM ${table} WHERE id = ?`).get(id) as
    | { owner: string }
    | undefined
  return row?.owner ?? null
}

export function getDoc<T = Doc>(table: DocTable, id: string, owner: string): T | null {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ? AND owner = ?`).get(id, owner) as
    | { data: string }
    | undefined
  return row ? (JSON.parse(row.data) as T) : null
}

function updatedAtOf(doc: Doc): number {
  return typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now()
}

export function putPage(owner: string, page: Doc, sourceId: string | null = null): void {
  db.prepare(
    `INSERT INTO pages (id, owner, source_id, data, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(page.id, owner, sourceId, JSON.stringify(page), updatedAtOf(page))
}

export function putDatabase(owner: string, database: Doc): void {
  db.prepare(
    `INSERT INTO databases (id, owner, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(database.id, owner, JSON.stringify(database), updatedAtOf(database))
}

export function putRow(owner: string, row: Doc & { dbId: string }): void {
  db.prepare(
    `INSERT INTO db_rows (id, owner, db_id, data, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET db_id = excluded.db_id, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(row.id, owner, row.dbId, JSON.stringify(row), updatedAtOf(row))
}

export function deleteDoc(table: DocTable, id: string, owner: string): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ? AND owner = ?`).run(id, owner)
}

export function listRowsOf(dbId: string, owner: string): Doc[] {
  const rows = db
    .prepare('SELECT data FROM db_rows WHERE db_id = ? AND owner = ?')
    .all(dbId, owner) as { data: string }[]
  return rows.map((r) => JSON.parse(r.data) as Doc)
}
