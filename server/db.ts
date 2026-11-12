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

  -- 登录会话：一次登录一条，可在「设备管理」里单独退出
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    ip         TEXT,
    ua         TEXT,
    revoked    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- 个人访问令牌：供 MCP / 脚本调用，只存哈希
  CREATE TABLE IF NOT EXISTS api_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'read',
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

  -- 用户级设置（空间名称、AI 配置、通知偏好等），value 为 JSON
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );

  -- 公开分享链接
  CREATE TABLE IF NOT EXISTS shares (
    id               TEXT PRIMARY KEY,
    token            TEXT NOT NULL UNIQUE,
    owner            TEXT NOT NULL,
    page_id          TEXT NOT NULL,
    password_hash    TEXT,
    expires_at       INTEGER,
    include_children INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    views            INTEGER NOT NULL DEFAULT 0,
    last_viewed_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner);

  CREATE TABLE IF NOT EXISTS webhooks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    url         TEXT NOT NULL,
    events      TEXT NOT NULL,
    secret      TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    last_status INTEGER,
    last_error  TEXT,
    last_at     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    created_at INTEGER NOT NULL,
    read_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

  CREATE TABLE IF NOT EXISTS feedback (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    content    TEXT NOT NULL,
    contact    TEXT,
    created_at INTEGER NOT NULL,
    reply      TEXT,
    replied_at INTEGER
  );

  -- 成员协作：把自己的页面（含子页面）授权给其他用户
  CREATE TABLE IF NOT EXISTS page_grants (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    page_id    TEXT NOT NULL,
    grantee_id TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',
    created_at INTEGER NOT NULL,
    UNIQUE (page_id, grantee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_grants_grantee ON page_grants(grantee_id);
  CREATE INDEX IF NOT EXISTS idx_grants_owner ON page_grants(owner);
`)

// 旧库补列：昵称、头像、联系方式、PIN、两步验证、第三方账号
for (const col of [
  'nickname TEXT',
  'avatar TEXT',
  'email TEXT',
  'phone TEXT',
  'pin_hash TEXT',
  'totp_secret TEXT',
  'totp_enabled INTEGER NOT NULL DEFAULT 0',
  'github_id TEXT',
  'github_login TEXT',
]) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col}`)
  } catch {
    /* 列已存在 */
  }
}

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

export function getUserSetting<T>(userId: string, key: string, fallback: T): T {
  const row = db
    .prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setUserSetting(userId: string, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
  ).run(userId, key, JSON.stringify(value))
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
