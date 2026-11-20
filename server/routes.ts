import { randomUUID } from 'node:crypto'
import express, { Router, type Request, type Response } from 'express'
import {
  authOf,
  clearFailures,
  createSession,
  createUser,
  findUserById,
  findUserByName,
  hasSessionWithUa,
  isLocked,
  issueTicket,
  readTicket,
  recordFailure,
  requireAdmin,
  requireAuth,
  requireSession,
  revokeOtherSessions,
  toPublicUser,
  updateUserPassword,
  updateUserProfile,
  validateCredentials,
  verifyPassword,
  issueToken,
  type UserRow,
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
  pageVersion,
  putDatabase,
  putPage,
  putPageVersioned,
  putRow,
  transaction,
} from './db.ts'
import { assertAccess, effectiveResourceRole } from './acl.ts'
import { copyTemplatesToUser } from './templates.ts'
import { HttpError, ID_RE, clientIp, param } from './http.ts'
import { describeUa, notify } from './notify.ts'
import { verifyTotp } from './totp.ts'
import { emitPageEvent, pageEventOf } from './webhooks.ts'
import { accountRouter } from './account.ts'
import { featuresRouter, publicRouter } from './features.ts'
import { canSeeAssetsOf } from './members.ts'

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

/** 登录成功：建会话、发令牌；新设备登录时站内提醒 */
export function finishLogin(req: Request, res: Response, row: UserRow, status = 200): void {
  const ua = req.headers['user-agent']
  const known = hasSessionWithUa(row.id, ua)
  const sid = createSession(row.id, clientIp(req), ua)
  if (!known && status === 200) {
    notify(
      row.id,
      'security',
      '新设备登录',
      `${describeUa(ua)}${clientIp(req) ? ` · IP ${clientIp(req)}` : ''}。如果不是你本人操作，请到「设置 → 账号设置 → 设备管理」退出该设备并修改密码。`,
    )
  }
  res.status(status).json({ token: issueToken(row.id, sid), user: toPublicUser(row) })
}

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
  finishLogin(req, res, row, 201)
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
  if (row.totp_enabled && row.totp_secret) {
    res.json({ twoFactor: true, ticket: issueTicket(row.id, '2fa', 300) })
    return
  }
  finishLogin(req, res, row)
})

/** 两步验证第二步：密码通过后拿到的短期票据 + 动态码 */
api.post('/auth/login/2fa', (req, res) => {
  const { ticket, code } = req.body ?? {}
  if (typeof ticket !== 'string' || typeof code !== 'string') throw new HttpError(400, '请输入验证码')
  const data = readTicket(ticket, '2fa')
  if (!data) throw new HttpError(401, '验证已超时，请重新登录')
  const key = `2fa|${data.sub}`
  if (isLocked(key)) throw new HttpError(429, '尝试次数过多，请 10 分钟后再试')
  const row = findUserById(data.sub)
  if (!row?.totp_secret || !verifyTotp(row.totp_secret, code)) {
    recordFailure(key)
    throw new HttpError(401, '验证码不正确')
  }
  clearFailures(key)
  finishLogin(req, res, row)
})

/* 无需登录的公开接口：分享页、版本号、第三方登录回调 */
api.use(publicRouter)

api.use(requireAuth)

api.get('/auth/me', (_req, res) => {
  res.json({ user: authOf(res).user })
})

api.use(accountRouter)

api.post('/auth/password', requireSession, (req, res) => {
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
    throw new HttpError(400, '当前密码不正确')
  }
  updateUserPassword(row.id, newPassword)
  // 改密码后其它设备一律下线
  revokeOtherSessions(row.id, auth.sid)
  notify(row.id, 'security', '登录密码已修改', '其它设备上的登录已全部退出。')
  res.json({ ok: true })
})

const AVATAR_MAX = 300_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9][0-9\- ]{5,19}$/

api.patch('/auth/profile', requireSession, (req, res) => {
  const { nickname, avatar, email, phone } = req.body ?? {}
  const patch: { nickname?: string | null; avatar?: string | null; email?: string | null; phone?: string | null } = {}
  if (email !== undefined) {
    if (email !== null && (typeof email !== 'string' || (email.trim() && !EMAIL_RE.test(email.trim())))) {
      throw new HttpError(400, '邮箱格式不正确')
    }
    patch.email = typeof email === 'string' ? email.trim().slice(0, 120) || null : null
  }
  if (phone !== undefined) {
    if (phone !== null && (typeof phone !== 'string' || (phone.trim() && !PHONE_RE.test(phone.trim())))) {
      throw new HttpError(400, '手机号格式不正确')
    }
    patch.phone = typeof phone === 'string' ? phone.replace(/[\s-]/g, '') || null : null
  }
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
  const auth = authOf(res)
  const all = listDocs<Doc>('pages', auth.owner)
  if (auth.spaceType !== 'team') {
    res.json(all)
    return
  }
  // 团队空间按资源级 ACL 过滤（deny 优先，未授权页面不出现在列表里）
  res.json(all.filter((p) => !!effectiveResourceRole(auth.user.id, auth.spaceId, 'page', String(p.id))))
})

api.get('/pages/:id', (req, res) => {
  const auth = authOf(res)
  const id = param(req, 'id')
  const page = getDoc('pages', id, auth.owner)
  if (!page) throw new HttpError(404, '页面不存在')
  assertAccess(auth, 'page', id, 'read')
  res.json(page)
})

api.put('/pages/:id', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const page = asDoc(req.body, param(req, 'id'))
  const baseVersion = typeof req.body?.baseVersion === 'number' ? req.body.baseVersion : null
  delete page.baseVersion
  assertWritable('pages', page.id, owner)
  assertAccess(auth, 'page', page.id, 'write')
  const before = getDoc<Doc>('pages', page.id, owner)

  // 带基础版本时走原子 CAS；冲突交给前端提示合并
  if (baseVersion !== null && before) {
    if (!putPageVersioned(owner, page, baseVersion)) {
      res.status(409).json({
        error: '文档已被他人修改',
        code: 'version_conflict',
        currentVersion: pageVersion(owner, page.id),
        current: getDoc<Doc>('pages', page.id, owner),
      })
      return
    }
  } else {
    putPage(owner, page)
  }
  emitPageEvent(owner, pageEventOf(before, page), page)
  res.json({ ok: true, version: pageVersion(owner, page.id) })
})

api.post('/pages/batch', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const upsert = asDocList(req.body?.upsert)
  const remove = asIdList(req.body?.remove)
  for (const p of upsert) {
    assertWritable('pages', p.id, owner)
    assertAccess(auth, 'page', p.id, 'write')
  }
  for (const id of remove) assertAccess(auth, 'page', id, 'write')
  const befores = new Map(upsert.map((p) => [p.id, getDoc<Doc>('pages', p.id, owner)]))
  const removed = remove.map((id) => getDoc('pages', id, owner)).filter((p): p is Doc => !!p)
  transaction(() => {
    for (const p of upsert) putPage(owner, p)
    for (const id of remove) deleteDoc('pages', id, owner)
  })
  for (const p of upsert) emitPageEvent(owner, pageEventOf(befores.get(p.id) ?? null, p), p)
  for (const p of removed) emitPageEvent(owner, 'page.deleted', p)
  res.json({ ok: true })
})

api.delete('/pages/:id', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const id = param(req, 'id')
  assertAccess(auth, 'page', id, 'write')
  const before = getDoc('pages', id, owner)
  deleteDoc('pages', id, owner)
  if (before) emitPageEvent(owner, 'page.deleted', before)
  res.json({ ok: true })
})

/* ---------------- 多维表格 ---------------- */

api.get('/databases', (_req, res) => {
  const auth = authOf(res)
  const all = listDocs<Doc>('databases', auth.owner)
  if (auth.spaceType !== 'team') {
    res.json(all)
    return
  }
  res.json(all.filter((d) => !!effectiveResourceRole(auth.user.id, auth.spaceId, 'database', String(d.id))))
})

api.get('/databases/:id', (req, res) => {
  const auth = authOf(res)
  const id = param(req, 'id')
  const database = getDoc('databases', id, auth.owner)
  if (!database) throw new HttpError(404, '多维表格不存在')
  assertAccess(auth, 'database', id, 'read')
  res.json(database)
})

api.put('/databases/:id', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const database = asDoc(req.body, param(req, 'id'))
  assertWritable('databases', database.id, owner)
  assertAccess(auth, 'database', database.id, 'write')
  putDatabase(owner, database)
  res.json({ ok: true })
})

api.delete('/databases/:id', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const id = param(req, 'id')
  assertAccess(auth, 'database', id, 'write')
  transaction(() => {
    db.prepare('DELETE FROM db_rows WHERE db_id = ? AND owner = ?').run(id, owner)
    deleteDoc('databases', id, owner)
  })
  res.json({ ok: true })
})

api.get('/databases/:id/rows', (req, res) => {
  const auth = authOf(res)
  const id = param(req, 'id')
  assertAccess(auth, 'database', id, 'read')
  res.json(listRowsOf(id, auth.owner))
})

/* ---------------- 多维表格行 ---------------- */

api.get('/rows/:id', (req, res) => {
  const auth = authOf(res)
  const row = getDoc('db_rows', param(req, 'id'), auth.owner)
  if (!row) throw new HttpError(404, '行不存在')
  assertAccess(auth, 'database', String(row.dbId), 'read')
  res.json(row)
})

api.put('/rows/:id', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const row = asDoc(req.body, param(req, 'id'))
  const dbId = assertDatabaseOwned(row.dbId, owner)
  assertWritable('db_rows', row.id, owner)
  assertAccess(auth, 'database', dbId, 'write')
  putRow(owner, { ...row, dbId })
  res.json({ ok: true })
})

api.post('/rows/batch', (req, res) => {
  const auth = authOf(res)
  const { owner } = auth
  const upsert = asDocList(req.body?.upsert)
  const remove = asIdList(req.body?.remove)
  const checked = upsert.map((r) => {
    assertWritable('db_rows', r.id, owner)
    const dbId = assertDatabaseOwned(r.dbId, owner)
    assertAccess(auth, 'database', dbId, 'write')
    return { ...r, dbId }
  })
  for (const id of remove) {
    const row = getDoc('db_rows', id, owner)
    if (row) assertAccess(auth, 'database', String(row.dbId), 'write')
  }
  transaction(() => {
    for (const r of checked) putRow(owner, r)
    for (const id of remove) deleteDoc('db_rows', id, owner)
  })
  res.json({ ok: true })
})

api.delete('/rows/:id', (req, res) => {
  const auth = authOf(res)
  const row = getDoc('db_rows', param(req, 'id'), auth.owner)
  if (row) assertAccess(auth, 'database', String(row.dbId), 'write')
  deleteDoc('db_rows', row?.id ?? param(req, 'id'), auth.owner)
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
  // 上传用途：图标会长期留在「上传」列表里供跨页复用；其余按普通图片处理
  // query 与 header 双通道，避免托管网关改写自定义头
  const kind =
    req.query.kind === 'icon' || req.headers['x-asset-kind'] === 'icon' ? 'icon' : 'image'
  const createdAt = Date.now()
  db.prepare(
    `INSERT INTO assets (id, owner, name, type, kind, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, kind = excluded.kind, size = excluded.size, data = excluded.data`,
  ).run(id, owner, name, type, kind, body.length, body, createdAt)
  res.status(201).json({ id, name, type, kind, size: body.length, createdAt })
})

/** 当前用户上传过的资源（图标库用）：按时间倒序，默认只取图标 */
api.get('/assets', (req, res) => {
  const { owner } = authOf(res)
  const kind = req.query.kind === 'icon' ? 'icon' : 'image'
  const raw = Number(req.query.limit ?? 60)
  const limit = Math.min(120, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 60))
  const rows = db
    .prepare(
      'SELECT id, name, type, kind, size, created_at FROM assets WHERE owner = ? AND kind = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(owner, kind, limit) as unknown as (AssetMetaRow & { kind: string })[]
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      kind: r.kind,
      size: r.size,
      createdAt: r.created_at,
    })),
  })
})

api.get('/assets/:id', (req, res) => {
  const { owner, user } = authOf(res)
  const id = param(req, 'id')
  const meta = db
    .prepare('SELECT id, owner, name, type, size, created_at FROM assets WHERE id = ?')
    .get(id) as AssetMetaRow | undefined
  // 公共图片对所有登录用户只读可见（用户副本里的图片仍引用公共图片）；共享页面里的图片对协作双方可见
  if (
    !meta ||
    (meta.owner !== owner &&
      meta.owner !== user.id &&
      meta.owner !== PUBLIC_OWNER &&
      !canSeeAssetsOf(user.id, meta.owner))
  ) {
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

/* ---------------- 分享、集成、AI、通知等 ---------------- */

api.use(featuresRouter)

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
