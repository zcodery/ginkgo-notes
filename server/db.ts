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
  -- 多进程/多副本同时启动时，先到者建表会把库锁住，后来者默认立刻抛
  -- "database is locked" 直接崩在启动阶段；给足等待时间让它排队。
  PRAGMA busy_timeout = 8000;
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

  -- 全局元数据（如 JWT 密钥）：不放 settings 是因为它按用户隔离，
  -- 这里存的是进程级、跨重启/多进程必须一致的东西
  CREATE TABLE IF NOT EXISTS app_meta (
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

  -- ============ 空间与协作域 ============
  -- 空间：personal（id 复用用户 id）/ team / public
  CREATE TABLE IF NOT EXISTS spaces (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL DEFAULT 'team',
    name          TEXT NOT NULL,
    owner_user_id TEXT,
    created_at    INTEGER NOT NULL
  );

  -- 组织节点：path 为物化路径，便于子树查询
  CREATE TABLE IF NOT EXISTS org_nodes (
    id           TEXT PRIMARY KEY,
    space_id     TEXT NOT NULL,
    parent_id    TEXT,
    name         TEXT NOT NULL,
    path         TEXT NOT NULL,
    depth        INTEGER NOT NULL DEFAULT 0,
    sort         INTEGER NOT NULL DEFAULT 0,
    lead_user_id TEXT,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_space ON org_nodes(space_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_org_path ON org_nodes(space_id, path);

  -- 空间成员：一个用户可挂多个节点，有效角色取最高
  CREATE TABLE IF NOT EXISTS space_members (
    space_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    org_node_id TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT 'viewer',
    status      TEXT NOT NULL DEFAULT 'active',
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (space_id, user_id, org_node_id)
  );
  CREATE INDEX IF NOT EXISTS idx_members_user ON space_members(user_id, status);

  -- 统一 ACL：resource_type + resource_id，主体可为 user / org_node / space
  CREATE TABLE IF NOT EXISTS acl_entries (
    id            TEXT PRIMARY KEY,
    space_id      TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    subject_type  TEXT NOT NULL,
    subject_id    TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',
    deny          INTEGER NOT NULL DEFAULT 0,
    inherit       INTEGER NOT NULL DEFAULT 1,
    created_by    TEXT,
    created_at    INTEGER NOT NULL,
    UNIQUE (resource_type, resource_id, subject_type, subject_id)
  );
  CREATE INDEX IF NOT EXISTS idx_acl_resource ON acl_entries(resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_acl_subject ON acl_entries(subject_type, subject_id);

  -- 好友：low/high 归一化，避免双向重复
  CREATE TABLE IF NOT EXISTS friendships (
    id           TEXT PRIMARY KEY,
    user_low     TEXT NOT NULL,
    user_high    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT NOT NULL,
    message      TEXT,
    -- 发起人希望对方进到自己的哪个分组，同意时直接落组
    requester_group_id TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (user_low, user_high)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_low ON friendships(user_low, status);
  CREATE INDEX IF NOT EXISTS idx_friend_high ON friendships(user_high, status);

  -- 好友分组：纯属「我这边的视图」，同一个好友在对方那边可以有完全不同的分组
  CREATE TABLE IF NOT EXISTS friend_groups (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    -- 新好友默认进入的分组；每个 owner 最多一个
    is_default INTEGER NOT NULL DEFAULT 0,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_friend_groups_owner ON friend_groups(owner_id, sort);

  -- 一个好友在自己这边只落在一个分组里（主键是一对 (我, 好友)）
  CREATE TABLE IF NOT EXISTS friend_group_members (
    owner_id       TEXT NOT NULL,
    friend_user_id TEXT NOT NULL,
    group_id       TEXT NOT NULL,
    PRIMARY KEY (owner_id, friend_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_group_members ON friend_group_members(owner_id, group_id);

  -- 空间邀请
  CREATE TABLE IF NOT EXISTS invites (
    id          TEXT PRIMARY KEY,
    space_id    TEXT NOT NULL,
    org_node_id TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT 'viewer',
    invitee_id  TEXT,
    token       TEXT UNIQUE,
    status      TEXT NOT NULL DEFAULT 'pending',
    expires_at  INTEGER,
    created_by  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_invites_space ON invites(space_id, status);
  CREATE INDEX IF NOT EXISTS idx_invites_user ON invites(invitee_id, status);

  -- 编辑占用（soft lock）
  CREATE TABLE IF NOT EXISTS doc_locks (
    page_id    TEXT PRIMARY KEY,
    space_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    session_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
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

// 乐观锁版本：物理表存 JSON，版本必须独立成列才能做原子 CAS
try {
  db.exec('ALTER TABLE pages ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
} catch {
  /* 列已存在 */
}

// 好友分组：默认组 + 加好友时预选的分组
try {
  db.exec('ALTER TABLE friend_groups ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
} catch {
  /* 列已存在 */
}
try {
  db.exec('ALTER TABLE friendships ADD COLUMN requester_group_id TEXT NOT NULL DEFAULT \'\'')
} catch {
  /* 列已存在 */
}

// 组织节点不再区分「部门 / 团队」：老库把这一列删掉（新库建表时就没有）
try {
  db.exec('ALTER TABLE org_nodes DROP COLUMN type')
} catch {
  /* 列不存在或 SQLite 不支持 DROP COLUMN */
}

/* ---------------- 协作域存量迁移（幂等） ---------------- */

db.exec(`
  INSERT OR IGNORE INTO spaces (id, type, name, owner_user_id, created_at)
  SELECT id, 'personal', COALESCE(NULLIF(nickname, ''), username), id, created_at FROM users;

  INSERT OR IGNORE INTO acl_entries
    (id, space_id, resource_type, resource_id, subject_type, subject_id, role, deny, inherit, created_by, created_at)
  SELECT id, owner, 'page', page_id, 'user', grantee_id,
         CASE role WHEN 'editor' THEN 'editor' ELSE 'viewer' END,
         0, 1, owner, created_at
  FROM page_grants;
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
  if (table === 'pages') {
    const rows = db.prepare('SELECT data, version FROM pages WHERE owner = ?').all(owner) as {
      data: string
      version: number
    }[]
    return rows.map((r) => ({ ...(JSON.parse(r.data) as Doc), version: r.version }) as T)
  }
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
  if (table === 'pages') {
    const row = db.prepare('SELECT data, version FROM pages WHERE id = ? AND owner = ?').get(id, owner) as
      | { data: string; version: number }
      | undefined
    return row ? ({ ...(JSON.parse(row.data) as Doc), version: row.version } as T) : null
  }
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ? AND owner = ?`).get(id, owner) as
    | { data: string }
    | undefined
  return row ? (JSON.parse(row.data) as T) : null
}

function updatedAtOf(doc: Doc): number {
  return typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now()
}

export function putPage(owner: string, page: Doc, sourceId: string | null = null): number {
  const current = db.prepare('SELECT version FROM pages WHERE id = ?').get(page.id) as
    | { version: number }
    | undefined
  const version = (current?.version ?? 0) + 1
  const data = JSON.stringify({ ...page, version })
  db.prepare(
    `INSERT INTO pages (id, owner, source_id, data, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, version = excluded.version`,
  ).run(page.id, owner, sourceId, data, updatedAtOf(page), version)
  return version
}

/** 带基础版本的原子写入；版本不匹配返回 false（应转 409） */
export function putPageVersioned(owner: string, page: Doc, baseVersion: number): boolean {
  const nextData = JSON.stringify({ ...page, version: baseVersion + 1 })
  const info = db
    .prepare(
      `UPDATE pages SET data = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND owner = ? AND version = ?`,
    )
    .run(nextData, updatedAtOf(page), page.id, owner, baseVersion)
  return Number(info.changes) > 0
}

export function pageVersion(owner: string, id: string): number | null {
  const row = db.prepare('SELECT version FROM pages WHERE id = ? AND owner = ?').get(id, owner) as
    | { version: number }
    | undefined
  return row?.version ?? null
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
/* ---------------- 空间 ---------------- */

export type SpaceType = 'personal' | 'team' | 'public'

export interface SpaceRow {
  id: string
  type: SpaceType
  name: string
  owner_user_id: string | null
  created_at: number
}

export function getSpace(id: string): SpaceRow | null {
  return (
    (db.prepare('SELECT * FROM spaces WHERE id = ?').get(id) as SpaceRow | undefined) ?? null
  )
}

/** 个人空间 id 直接复用用户 id，保证存量数据 owner=user.id 天然落位 */
export function ensurePersonalSpace(userId: string, name?: string): SpaceRow {
  const existing = getSpace(userId)
  if (existing) return existing
  const row: SpaceRow = {
    id: userId,
    type: 'personal',
    name: name && name.trim() ? name.trim().slice(0, 60) : '个人空间',
    owner_user_id: userId,
    created_at: Date.now(),
  }
  db.prepare('INSERT OR IGNORE INTO spaces (id, type, name, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
    row.id,
    row.type,
    row.name,
    row.owner_user_id,
    row.created_at,
  )
  return getSpace(userId) ?? row
}

/** 当前用户可见的空间：个人空间 + 已加入的团队空间 */
export function listSpacesFor(userId: string): SpaceRow[] {
  ensurePersonalSpace(userId)
  return db
    .prepare(
      `SELECT DISTINCT s.* FROM spaces s
       LEFT JOIN space_members m ON m.space_id = s.id AND m.user_id = ? AND m.status = 'active'
       WHERE s.type = 'personal' AND s.id = ?
          OR (s.type = 'team' AND m.user_id IS NOT NULL)
       ORDER BY s.type = 'personal' DESC, s.created_at`,
    )
    .all(userId, userId) as unknown as SpaceRow[]
}
