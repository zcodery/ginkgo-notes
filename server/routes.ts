import { randomUUID } from 'node:crypto'
import express, { Router, type Request, type Response } from 'express'
import {
  authOf,
  clearFailures,
  createUser,
  findUserById,
  findUserByName,
  isLocked,
  recordFailure,
  requireAdmin,
  requireAuth,
  toPublicUser,
  updateUserPassword,
  updateUserProfile,
  validateCredentials,
  verifyPassword,
  issueToken,
} from './auth.ts'
import {
  PUBLIC_OWNER,
  type Doc,
  type DocTable,
  db,
  deleteDoc,
  getDoc,
  getDocOwner,
  listDocs,
  listRowsOf,
  putDatabase,
  putPage,
  putRow,
  transaction,
} from './db.ts'
import { copyTemplatesToUser } from './templates.ts'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function asDoc(value: unknown, id?: string): Doc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, '数据格式不正确')
  }
  const doc = { ...(value as Record<string, unknown>) }
  if (id !== undefined) doc.id = id
  if (typeof doc.id !== 'string' || !ID_RE.test(doc.id)) throw new HttpError(400, 'id 不合法')
  return doc as Doc
}

function asDocList(value: unknown): Doc[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new HttpError(400, '数据格式不正确')
  return value.map((v) => asDoc(v))
}

function asIdList(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !ID_RE.test(v))) {
    throw new HttpError(400, 'id 列表不合法')
  }
  return value as string[]
}

function param(req: Request, name: string): string {
  const v = req.params[name]
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'id 不合法')
  return v
}

/** 同一个 id 已属于别人时拒绝写入，防止越权覆盖 */
function assertWritable(table: DocTable, id: string, owner: string): void {
  const current = getDocOwner(table, id)
  if (current && current !== owner) throw new HttpError(403, '无权修改该数据')
}

function assertDatabaseOwned(dbId: unknown, owner: string): string {
  if (typeof dbId !== 'string' || !ID_RE.test(dbId)) throw new HttpError(400, 'dbId 不合法')
  if (getDocOwner('databases', dbId) !== owner) throw new HttpError(404, '多维表格不存在')
  return dbId
}

export const api = Router()

api.use(express.json({ limit: '20mb' }))

/* ---------------- 账号 ---------------- */

api.post('/auth/register', (req, res) => {
  const { username, password } = req.body ?? {}
  const invalid = validateCredentials(username, password)
  if (invalid) throw new HttpError(400, invalid)
  if (findUserByName(username)) throw new HttpError(409, '用户名已被占用')
  const row = transaction(() => {
    const created = createUser(username, password)
    copyTemplatesToUser(created.id)
    return created
  })
  res.status(201).json({ token: issueToken(row.id), user: toPublicUser(row) })
})

api.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, '请输入用户名和密码')
  }
  const key = `${req.ip}|${username.toLowerCase()}`
  if (isLocked(key)) throw new HttpError(429, '尝试次数过多，请 10 分钟后再试')
  const row = findUserByName(username)
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordFailure(key)
    throw new HttpError(401, '用户名或密码错误')
  }
  clearFailures(key)
  res.json({ token: issueToken(row.id), user: toPublicUser(row) })
})

api.use(requireAuth)

api.get('/auth/me', (_req, res) => {
  res.json({ user: authOf(res).user })
})

api.post('/auth/password', (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {}
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    throw new HttpError(400, '请填写当前密码和新密码')
  }
  if (newPassword.length < 6 || newPassword.length > 128) {
    throw new HttpError(400, '新密码长度需为 6-128 位')
  }
  const auth = authOf(res)
  const row = findUserById(auth.user.id)
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    throw new HttpError(401, '当前密码不正确')
  }
  updateUserPassword(row.id, newPassword)
  res.json({ ok: true })
})

const AVATAR_MAX = 300_000

api.patch('/auth/profile', (req, res) => {
  const { nickname, avatar } = req.body ?? {}
  const patch: { nickname?: string | null; avatar?: string | null } = {}
  if (nickname !== undefined) {
    if (nickname !== null && typeof nickname !== 'string') throw new HttpError(400, '昵称格式不正确')
    const v = typeof nickname === 'string' ? nickname.trim() : ''
    if (v.length > 32) throw new HttpError(400, '昵称最多 32 个字符')
    patch.nickname = v || null
  }
  if (avatar !== undefined) {
    if (avatar !== null) {
      if (typeof avatar !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(avatar)) {
        throw new HttpError(400, '头像格式不正确')
      }
      if (avatar.length > AVATAR_MAX) throw new HttpError(400, '头像图片过大')
    }
    patch.avatar = avatar
  }
  const id = authOf(res).user.id
  updateUserProfile(id, patch)
  const row = findUserById(id)
  if (!row) throw new HttpError(404, '用户不存在')
  res.json({ user: toPublicUser(row) })
})

/* ---------------- 页面 ---------------- */

api.get('/pages', (_req, res) => {
  res.json(listDocs('pages', authOf(res).owner))
})

api.get('/pages/:id', (req, res) => {
  const page = getDoc('pages', param(req, 'id'), authOf(res).owner)
  if (!page) throw new HttpError(404, '页面不存在')
  res.json(page)
})

api.put('/pages/:id', (req, res) => {
  const { owner } = authOf(res)
  const page = asDoc(req.body, param(req, 'id'))
  assertWritable('pages', page.id, owner)
  putPage(owner, page)
  res.json({ ok: true })
})

api.post('/pages/batch', (req, res) => {
  const { owner } = authOf(res)
  const upsert = asDocList(req.body?.upsert)
  const remove = asIdList(req.body?.remove)
  for (const p of upsert) assertWritable('pages', p.id, owner)
  transaction(() => {
    for (const p of upsert) putPage(owner, p)
    for (const id of remove) deleteDoc('pages', id, owner)
  })
  res.json({ ok: true })
})

api.delete('/pages/:id', (req, res) => {
  deleteDoc('pages', param(req, 'id'), authOf(res).owner)
  res.json({ ok: true })
})

/* ---------------- 多维表格 ---------------- */

api.get('/databases', (_req, res) => {
  res.json(listDocs('databases', authOf(res).owner))
})

api.get('/databases/:id', (req, res) => {
  const database = getDoc('databases', param(req, 'id'), authOf(res).owner)
  if (!database) throw new HttpError(404, '多维表格不存在')
  res.json(database)
})

api.put('/databases/:id', (req, res) => {
  const { owner } = authOf(res)
  const database = asDoc(req.body, param(req, 'id'))
  assertWritable('databases', database.id, owner)
  putDatabase(owner, database)
  res.json({ ok: true })
})

api.delete('/databases/:id', (req, res) => {
  const { owner } = authOf(res)
  const id = param(req, 'id')
  transaction(() => {
    db.prepare('DELETE FROM db_rows WHERE db_id = ? AND owner = ?').run(id, owner)
    deleteDoc('databases', id, owner)
  })
  res.json({ ok: true })
})

api.get('/databases/:id/rows', (req, res) => {
  res.json(listRowsOf(param(req, 'id'), authOf(res).owner))
})

/* ---------------- 多维表格行 ---------------- */

api.get('/rows/:id', (req, res) => {
  const row = getDoc('db_rows', param(req, 'id'), authOf(res).owner)
  if (!row) throw new HttpError(404, '行不存在')
  res.json(row)
})

api.put('/rows/:id', (req, res) => {
  const { owner } = authOf(res)
  const row = asDoc(req.body, param(req, 'id'))
  const dbId = assertDatabaseOwned(row.dbId, owner)
  assertWritable('db_rows', row.id, owner)
  putRow(owner, { ...row, dbId })
  res.json({ ok: true })
})

api.post('/rows/batch', (req, res) => {
  const { owner } = authOf(res)
  const upsert = asDocList(req.body?.upsert)
  const remove = asIdList(req.body?.remove)
  const checked = upsert.map((r) => {
    assertWritable('db_rows', r.id, owner)
    return { ...r, dbId: assertDatabaseOwned(r.dbId, owner) }
  })
  transaction(() => {
    for (const r of checked) putRow(owner, r)
    for (const id of remove) deleteDoc('db_rows', id, owner)
  })
  res.json({ ok: true })
})

api.delete('/rows/:id', (req, res) => {
  deleteDoc('db_rows', param(req, 'id'), authOf(res).owner)
  res.json({ ok: true })
})

/* ---------------- 图片 ---------------- */

interface AssetMetaRow {
  id: string
  owner: string
  name: string
  type: string
  size: number
  created_at: number
}

api.post('/assets', express.raw({ type: () => true, limit: '20mb' }), (req, res) => {
  const { owner } = authOf(res)
  const body = req.body
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, '没有收到文件内容')
  const requested = typeof req.query.id === 'string' ? req.query.id : ''
  if (requested && !ID_RE.test(requested)) throw new HttpError(400, 'id 不合法')
  const id = requested || randomUUID()
  const existing = db.prepare('SELECT owner FROM assets WHERE id = ?').get(id) as
    | { owner: string }
    | undefined
  if (existing && existing.owner !== owner) throw new HttpError(409, '资源 id 冲突')
  const rawName = req.headers['x-asset-name']
  let name = 'image'
  if (typeof rawName === 'string') {
    try {
      name = decodeURIComponent(rawName).slice(0, 200) || 'image'
    } catch {
      /* 保持默认名 */
    }
  }
  const type = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim()
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO assets (id, owner, name, type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, size = excluded.size, data = excluded.data`,
  ).run(id, owner, name, type, body.length, body, createdAt)
  res.status(201).json({ id, name, type, size: body.length, createdAt })
})

api.get('/assets/:id', (req, res) => {
  const { owner, user } = authOf(res)
  const id = param(req, 'id')
  const meta = db
    .prepare('SELECT id, owner, name, type, size, created_at FROM assets WHERE id = ?')
    .get(id) as AssetMetaRow | undefined
  // 公共图片对所有登录用户只读可见（用户副本里的图片仍引用公共图片）
  if (!meta || (meta.owner !== owner && meta.owner !== user.id && meta.owner !== PUBLIC_OWNER)) {
    throw new HttpError(404, '图片不存在')
  }
  const row = db.prepare('SELECT data FROM assets WHERE id = ?').get(id) as { data: Uint8Array }
  res.setHeader('Content-Type', meta.type)
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.send(Buffer.from(row.data))
})

/* ---------------- 管理员：导入公共原稿 ---------------- */

api.post('/admin/import', requireAdmin, (req, res) => {
  const pages = asDocList(req.body?.pages)
  const databases = asDocList(req.body?.databases)
  const rows = asDocList(req.body?.rows)
  const replace = req.body?.replace === true
  transaction(() => {
    if (replace) {
      db.prepare('DELETE FROM db_rows WHERE owner = ?').run(PUBLIC_OWNER)
      db.prepare('DELETE FROM databases WHERE owner = ?').run(PUBLIC_OWNER)
      db.prepare('DELETE FROM pages WHERE owner = ?').run(PUBLIC_OWNER)
    }
    for (const d of databases) {
      assertWritable('databases', d.id, PUBLIC_OWNER)
      putDatabase(PUBLIC_OWNER, d)
    }
    for (const r of rows) {
      assertWritable('db_rows', r.id, PUBLIC_OWNER)
      putRow(PUBLIC_OWNER, { ...r, dbId: assertDatabaseOwned(r.dbId, PUBLIC_OWNER) })
    }
    for (const p of pages) {
      assertWritable('pages', p.id, PUBLIC_OWNER)
      putPage(PUBLIC_OWNER, p)
    }
  })
  res.json({ ok: true, pages: pages.length, databases: databases.length, rows: rows.length })
})

/* ---------------- 错误处理 ---------------- */

api.use((_req: Request, _res: Response) => {
  throw new HttpError(404, '接口不存在')
})

api.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  const status = (err as { status?: number })?.status
  if (status === 413) {
    res.status(413).json({ error: '内容太大' })
    return
  }
  if (status === 400) {
    res.status(400).json({ error: '请求格式不正确' })
    return
  }
  console.error(err)
  res.status(500).json({ error: '服务器出错了' })
})
