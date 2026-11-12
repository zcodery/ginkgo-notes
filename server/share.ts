import { randomBytes, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authOf, hashPassword, issueTicket, readTicket, verifyPassword } from './auth.ts'
import { PUBLIC_OWNER, db, getDoc, listDocs, listRowsOf, type Doc } from './db.ts'
import { HttpError, ID_RE, param } from './http.ts'
import { notify } from './notify.ts'

interface ShareRow {
  id: string
  token: string
  owner: string
  page_id: string
  password_hash: string | null
  expires_at: number | null
  include_children: number
  created_at: number
  views: number
  last_viewed_at: number | null
}

function publicShare(s: ShareRow, title?: string, icon?: string) {
  return {
    id: s.id,
    token: s.token,
    pageId: s.page_id,
    pageTitle: title ?? '',
    pageIcon: icon ?? '',
    hasPassword: !!s.password_hash,
    expiresAt: s.expires_at,
    includeChildren: !!s.include_children,
    createdAt: s.created_at,
    views: s.views,
    lastViewedAt: s.last_viewed_at,
  }
}

function pageInfo(owner: string, pageId: string) {
  const p = getDoc<Doc>('pages', pageId, owner)
  return p ? { title: String(p.title ?? ''), icon: String(p.icon ?? '') } : null
}

function getShare(id: string, owner: string): ShareRow {
  const s = db.prepare('SELECT * FROM shares WHERE id = ? AND owner = ?').get(id, owner) as ShareRow | undefined
  if (!s) throw new HttpError(404, '分享不存在')
  return s
}

function parseExpiry(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= Date.now()) throw new HttpError(400, '有效期需晚于当前时间')
  return Math.floor(n)
}

function parsePassword(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v !== 'string' || v.length < 4 || v.length > 64) throw new HttpError(400, '访问密码需为 4-64 位')
  return hashPassword(v)
}

/* ---------------- 管理（需登录） ---------------- */

export const shareRouter = Router()

shareRouter.get('/shares', (_req, res) => {
  const { owner } = authOf(res)
  const rows = db.prepare('SELECT * FROM shares WHERE owner = ? ORDER BY created_at DESC').all(owner) as unknown as ShareRow[]
  res.json(
    rows.map((s) => {
      const info = pageInfo(owner, s.page_id)
      return publicShare(s, info?.title, info?.icon)
    }),
  )
})

shareRouter.get('/shares/page/:pageId', (req, res) => {
  const { owner } = authOf(res)
  const s = db.prepare('SELECT * FROM shares WHERE owner = ? AND page_id = ?').get(owner, param(req, 'pageId')) as
    | ShareRow
    | undefined
  res.json(s ? publicShare(s) : null)
})

shareRouter.post('/shares', (req, res) => {
  const { owner } = authOf(res)
  const pageId = req.body?.pageId
  if (typeof pageId !== 'string' || !ID_RE.test(pageId)) throw new HttpError(400, '页面 id 不合法')
  const info = pageInfo(owner, pageId)
  if (!info) throw new HttpError(404, '页面不存在')
  const existing = db.prepare('SELECT * FROM shares WHERE owner = ? AND page_id = ?').get(owner, pageId) as
    | ShareRow
    | undefined
  if (existing) {
    res.json(publicShare(existing, info.title, info.icon))
    return
  }
  const row: ShareRow = {
    id: randomUUID(),
    token: randomBytes(12).toString('base64url'),
    owner,
    page_id: pageId,
    password_hash: parsePassword(req.body?.password) ?? null,
    expires_at: parseExpiry(req.body?.expiresAt),
    include_children: req.body?.includeChildren === false ? 0 : 1,
    created_at: Date.now(),
    views: 0,
    last_viewed_at: null,
  }
  db.prepare(
    `INSERT INTO shares (id, token, owner, page_id, password_hash, expires_at, include_children, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.token, owner, pageId, row.password_hash, row.expires_at, row.include_children, row.created_at)
  res.status(201).json(publicShare(row, info.title, info.icon))
})

shareRouter.patch('/shares/:id', (req, res) => {
  const { owner } = authOf(res)
  const s = getShare(param(req, 'id'), owner)
  const pwd = parsePassword(req.body?.password)
  if (pwd !== undefined) s.password_hash = pwd
  if (req.body?.expiresAt !== undefined) s.expires_at = parseExpiry(req.body.expiresAt)
  if (typeof req.body?.includeChildren === 'boolean') s.include_children = req.body.includeChildren ? 1 : 0
  if (req.body?.regenerate === true) s.token = randomBytes(12).toString('base64url')
  db.prepare('UPDATE shares SET token = ?, password_hash = ?, expires_at = ?, include_children = ? WHERE id = ?').run(
    s.token,
    s.password_hash,
    s.expires_at,
    s.include_children,
    s.id,
  )
  const info = pageInfo(owner, s.page_id)
  res.json(publicShare(s, info?.title, info?.icon))
})

shareRouter.delete('/shares/:id', (req, res) => {
  const { owner } = authOf(res)
  db.prepare('DELETE FROM shares WHERE id = ? AND owner = ?').run(param(req, 'id'), owner)
  res.json({ ok: true })
})

/* ---------------- 公开访问（无需登录） ---------------- */

export const sharePublicRouter = Router()

function liveShare(token: string): ShareRow {
  const s = db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as ShareRow | undefined
  if (!s) throw new HttpError(404, '分享链接不存在或已取消')
  if (s.expires_at && s.expires_at < Date.now()) throw new HttpError(410, '分享链接已过期')
  return s
}

/** 校验访问权限：无密码直接放行；有密码则需要 password 或之前换到的 access 票据 */
function checkAccess(s: ShareRow, password: unknown, access: unknown): string | null {
  if (!s.password_hash) return null
  if (typeof access === 'string') {
    const t = readTicket(access, 'share')
    if (t && t.sid === s.id) return access
  }
  if (typeof password !== 'string' || !verifyPassword(password, s.password_hash)) {
    throw new HttpError(401, password ? '访问密码不正确' : '需要访问密码')
  }
  return issueTicket(s.owner, 'share', 12 * 3600, { sid: s.id })
}

function subtreeIds(pages: Doc[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const p of pages) {
      if (!p.trashed && typeof p.parentId === 'string' && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id)
        changed = true
      }
    }
  }
  return ids
}

const DB_REF_RE = /```ginkgo-db\n([A-Za-z0-9_-]+)\n```/g

function sharedPayload(s: ShareRow, page: Doc, all: Doc[]) {
  const content = String(page.content ?? '')
  const databases: Record<string, { db: Doc; rows: Doc[] }> = {}
  for (const m of content.matchAll(DB_REF_RE)) {
    const id = m[1]!
    const d = getDoc<Doc>('databases', id, s.owner)
    if (d) databases[id] = { db: d, rows: listRowsOf(id, s.owner) }
  }
  const children = s.include_children
    ? all
        .filter((p) => p.parentId === page.id && !p.trashed)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((p) => ({ id: p.id, title: p.title ?? '', icon: p.icon ?? '' }))
    : []
  return {
    page: {
      id: page.id,
      title: page.title ?? '',
      icon: page.icon ?? '',
      cover: page.cover ?? null,
      content,
      updatedAt: page.updatedAt ?? null,
      parentId: page.id === s.page_id ? null : (page.parentId ?? null),
    },
    rootId: s.page_id,
    children,
    databases,
  }
}

sharePublicRouter.post('/public/shares/:token', (req, res) => {
  const s = liveShare(String(req.params.token))
  const access = checkAccess(s, req.body?.password, req.body?.access)
  const all = listDocs<Doc>('pages', s.owner)
  const requested = typeof req.body?.pageId === 'string' ? req.body.pageId : s.page_id
  const allowed = s.include_children ? subtreeIds(all, s.page_id) : new Set([s.page_id])
  if (!allowed.has(requested)) throw new HttpError(404, '页面不在分享范围内')
  const page = all.find((p) => p.id === requested && !p.trashed)
  if (!page) throw new HttpError(404, '页面已被删除')

  if (requested === s.page_id) {
    const first = s.views === 0
    db.prepare('UPDATE shares SET views = views + 1, last_viewed_at = ? WHERE id = ?').run(Date.now(), s.id)
    if (first) notify(s.owner, 'share', `「${page.title || '未命名'}」的分享链接首次被访问`, null, `/${s.page_id}`)
  }
  res.json({ ...sharedPayload(s, page, all), access })
})

sharePublicRouter.get('/public/shares/:token/assets/:id', (req, res) => {
  const s = liveShare(String(req.params.token))
  checkAccess(s, undefined, req.query.k)
  const id = param(req, 'id')
  const meta = db.prepare('SELECT owner, type FROM assets WHERE id = ?').get(id) as
    | { owner: string; type: string }
    | undefined
  if (!meta || (meta.owner !== s.owner && meta.owner !== PUBLIC_OWNER)) throw new HttpError(404, '图片不存在')
  const row = db.prepare('SELECT data FROM assets WHERE id = ?').get(id) as { data: Uint8Array }
  res.setHeader('Content-Type', meta.type)
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.send(Buffer.from(row.data))
})
