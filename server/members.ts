import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authOf, findUserById, findUserByName } from './auth.ts'
import { areFriends } from './acl.ts'
import { PUBLIC_OWNER, db, getDoc, listDocs, putPage, type Doc } from './db.ts'
import { HttpError, ID_RE, param } from './http.ts'
import { notify } from './notify.ts'
import { emitPageEvent } from './webhooks.ts'

/**
 * 成员协作：把自己的某个页面（连同子页面）授权给好友。
 * viewer 只读，editor 可修改标题与正文；页面始终归原作者所有。
 *
 * 数据源统一为 acl_entries；对外仍沿用原 /grants 协议，前端无需改动。
 */

export type GrantRole = 'viewer' | 'editor'

interface AclRow {
  id: string
  space_id: string
  resource_type: string
  resource_id: string
  subject_type: string
  subject_id: string
  role: string
  deny: number
  inherit: number
  created_by: string | null
  created_at: number
}

interface GrantRow {
  id: string
  owner: string
  page_id: string
  grantee_id: string
  role: GrantRole
  created_at: number
}

export const membersRouter = Router()

function userName(id: string): string {
  const u = findUserById(id)
  return u ? u.nickname || u.username : '已注销用户'
}

function toGrant(r: AclRow): GrantRow {
  return {
    id: r.id,
    owner: r.space_id,
    page_id: r.resource_id,
    grantee_id: r.subject_id,
    role: r.role === 'editor' ? 'editor' : 'viewer',
    created_at: r.created_at,
  }
}

function grantsOf(owner: string, pageId?: string): GrantRow[] {
  const rows = (
    pageId
      ? db
          .prepare(
            `SELECT * FROM acl_entries
             WHERE space_id = ? AND resource_type = 'page' AND resource_id = ? AND subject_type = 'user' AND deny = 0`,
          )
          .all(owner, pageId)
      : db
          .prepare(
            `SELECT * FROM acl_entries
             WHERE space_id = ? AND resource_type = 'page' AND subject_type = 'user' AND deny = 0
             ORDER BY created_at DESC`,
          )
          .all(owner)
  ) as unknown as AclRow[]
  return rows.map(toGrant)
}

function subtree(pages: Doc[], rootId: string): Doc[] {
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
  return pages.filter((p) => ids.has(p.id) && !p.trashed)
}

function publicGrant(g: GrantRow) {
  const grantee = findUserById(g.grantee_id)
  const page = getDoc<Doc>('pages', g.page_id, g.owner)
  return {
    id: g.id,
    pageId: g.page_id,
    pageTitle: page?.title ?? '',
    pageIcon: page?.icon ?? '',
    role: g.role,
    createdAt: g.created_at,
    grantee: {
      id: g.grantee_id,
      username: grantee?.username ?? '',
      name: grantee ? grantee.nickname || grantee.username : '已注销用户',
      avatar: grantee?.avatar ?? null,
    },
  }
}

/* ---------------- 作者：管理授权 ---------------- */

membersRouter.get('/grants', (req, res) => {
  const { owner } = authOf(res)
  const pageId = typeof req.query.pageId === 'string' ? req.query.pageId : null
  res.json(grantsOf(owner, pageId ?? undefined).map(publicGrant))
})

membersRouter.post('/grants', (req, res) => {
  const { owner, user } = authOf(res)
  if (owner === PUBLIC_OWNER) throw new HttpError(400, '公共原稿不支持邀请成员')
  const pageId = req.body?.pageId
  if (typeof pageId !== 'string' || !ID_RE.test(pageId)) throw new HttpError(400, '页面 id 不合法')
  const page = getDoc<Doc>('pages', pageId, owner)
  if (!page) throw new HttpError(404, '页面不存在')
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
  const target = username ? findUserByName(username) : null
  if (!target) throw new HttpError(404, '找不到该用户名')
  if (target.id === user.id) throw new HttpError(400, '不能邀请自己')
  if (!areFriends(user.id, target.id)) {
    // 同团队但非好友也允许分享个人笔记
    const sameTeam = db
      .prepare(
        `SELECT 1 FROM space_members m1
         JOIN space_members m2 ON m2.space_id = m1.space_id
         JOIN spaces s ON s.id = m1.space_id
         WHERE m1.user_id = ? AND m2.user_id = ?
           AND m1.status = 'active' AND m2.status = 'active' AND s.type = 'team'
         LIMIT 1`,
      )
      .get(user.id, target.id)
    if (!sameTeam) throw new HttpError(403, '只能分享给好友或同团队成员')
  }

  const role: GrantRole = req.body?.role === 'editor' ? 'editor' : 'viewer'
  const existing = db
    .prepare(
      `SELECT * FROM acl_entries
       WHERE resource_type = 'page' AND resource_id = ? AND subject_type = 'user' AND subject_id = ?`,
    )
    .get(pageId, target.id) as AclRow | undefined

  if (existing) {
    db.prepare('UPDATE acl_entries SET role = ?, deny = 0 WHERE id = ?').run(role, existing.id)
    res.json(publicGrant(toGrant({ ...existing, role, deny: 0 })))
    return
  }

  const row: AclRow = {
    id: randomUUID(),
    space_id: owner,
    resource_type: 'page',
    resource_id: pageId,
    subject_type: 'user',
    subject_id: target.id,
    role,
    deny: 0,
    inherit: 1,
    created_by: user.id,
    created_at: Date.now(),
  }
  db.prepare(
    `INSERT INTO acl_entries
      (id, space_id, resource_type, resource_id, subject_type, subject_id, role, deny, inherit, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.space_id,
    row.resource_type,
    row.resource_id,
    row.subject_type,
    row.subject_id,
    row.role,
    row.deny,
    row.inherit,
    row.created_by,
    row.created_at,
  )
  notify(
    target.id,
    'member',
    `${userName(user.id)} 邀请你${role === 'editor' ? '编辑' : '查看'}「${page.title || '未命名'}」`,
    '可以在侧栏「与我共享」中找到它。',
    `/shared/${pageId}`,
  )
  res.status(201).json(publicGrant(toGrant(row)))
})

membersRouter.patch('/grants/:id', (req, res) => {
  const { owner } = authOf(res)
  const role: GrantRole = req.body?.role === 'editor' ? 'editor' : 'viewer'
  const g = db.prepare('SELECT * FROM acl_entries WHERE id = ? AND space_id = ?').get(param(req, 'id'), owner) as
    | AclRow
    | undefined
  if (!g) throw new HttpError(404, '授权不存在')
  db.prepare('UPDATE acl_entries SET role = ? WHERE id = ?').run(role, g.id)
  res.json(publicGrant(toGrant({ ...g, role })))
})

membersRouter.delete('/grants/:id', (req, res) => {
  const { owner, user } = authOf(res)
  // 作者可以撤销；被邀请的人也可以自己退出
  db.prepare('DELETE FROM acl_entries WHERE id = ? AND (space_id = ? OR subject_id = ?)').run(
    param(req, 'id'),
    owner,
    user.id,
  )
  res.json({ ok: true })
})

/* ---------------- 成员：访问共享给我的页面 ---------------- */

function myGrants(userId: string): GrantRow[] {
  const rows = db
    .prepare(
      `SELECT a.* FROM acl_entries a JOIN spaces s ON s.id = a.space_id
       WHERE a.subject_type = 'user' AND a.subject_id = ? AND a.resource_type = 'page'
         AND a.deny = 0 AND s.type = 'personal'
       ORDER BY a.created_at DESC`,
    )
    .all(userId) as unknown as AclRow[]
  return rows.map(toGrant)
}

/** 找到授权覆盖该页面的那条授权（编辑权限优先） */
function grantFor(userId: string, pageId: string): { grant: GrantRow; page: Doc } | null {
  let found: { grant: GrantRow; page: Doc } | null = null
  for (const g of myGrants(userId)) {
    const pages = subtree(listDocs<Doc>('pages', g.owner), g.page_id)
    const page = pages.find((p) => p.id === pageId)
    if (page && (!found || (found.grant.role === 'viewer' && g.role === 'editor'))) found = { grant: g, page }
  }
  return found
}

membersRouter.get('/shared', (_req, res) => {
  const { user } = authOf(res)
  const roots: unknown[] = []
  const pages: unknown[] = []
  const seen = new Set<string>()
  for (const g of myGrants(user.id)) {
    const tree = subtree(listDocs<Doc>('pages', g.owner), g.page_id)
    if (!tree.length) continue
    roots.push({ grantId: g.id, pageId: g.page_id, role: g.role, ownerName: userName(g.owner), ownerId: g.owner })
    for (const p of tree) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      pages.push({
        id: p.id,
        title: p.title ?? '',
        icon: p.icon ?? '',
        parentId: p.id === g.page_id ? null : (p.parentId ?? null),
        order: p.order ?? 0,
        updatedAt: p.updatedAt ?? 0,
        role: g.role,
        rootId: g.page_id,
      })
    }
  }
  res.json({ roots, pages })
})

membersRouter.get('/shared/pages/:id', (req, res) => {
  const { user } = authOf(res)
  const hit = grantFor(user.id, param(req, 'id'))
  if (!hit) throw new HttpError(404, '页面不存在或已取消共享')
  res.json({
    page: hit.page,
    role: hit.grant.role,
    ownerName: userName(hit.grant.owner),
    rootId: hit.grant.page_id,
  })
})

membersRouter.put('/shared/pages/:id', (req, res) => {
  const { user } = authOf(res)
  const hit = grantFor(user.id, param(req, 'id'))
  if (!hit) throw new HttpError(404, '页面不存在或已取消共享')
  if (hit.grant.role !== 'editor') throw new HttpError(403, '你只有查看权限')
  if (hit.page.locked) throw new HttpError(403, '页面已被作者锁定')
  const body = req.body ?? {}
  const next: Doc = { ...hit.page, updatedAt: Date.now() }
  for (const key of ['title', 'content', 'excerpt', 'icon'] as const) {
    if (typeof body[key] === 'string') next[key] = body[key]
  }
  putPage(hit.grant.owner, next)
  emitPageEvent(hit.grant.owner, 'page.updated', next)
  res.json({ ok: true, updatedAt: next.updatedAt })
})

/** 两人之间存在任意方向的有效授权时，可以互相看到对方上传到共享页面里的图片 */
export function canSeeAssetsOf(viewerId: string, assetOwner: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM acl_entries
       WHERE resource_type = 'page' AND deny = 0
         AND ((space_id = ? AND subject_type = 'user' AND subject_id = ?)
           OR (space_id = ? AND subject_type = 'user' AND subject_id = ?))
       LIMIT 1`,
    )
    .get(assetOwner, viewerId, viewerId, assetOwner)
}