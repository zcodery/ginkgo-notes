import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authOf, type AuthLocals, type SpaceRole } from './auth.ts'
import { db, getDoc, getSpace, type Doc } from './db.ts'
import { HttpError, param } from './http.ts'

/**
 * 统一访问控制。
 *
 * 优先级：deny > 资源显式授权 > 组织节点继承 > 空间基线角色。
 * 个人空间只允许所有者与显式被授权者访问；团队空间成员默认继承空间基线。
 */

export type ResourceType = 'page' | 'database'

const ROLE_RANK: Record<SpaceRole, number> = {
  guest: 1,
  viewer: 2,
  editor: 3,
  admin: 4,
  owner: 5,
}

export function roleRank(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as SpaceRole] : 0
}

export interface AclEntryRow {
  id: string
  space_id: string
  resource_type: string
  resource_id: string
  subject_type: 'user' | 'org_node' | 'space'
  subject_id: string
  role: string
  deny: number
  inherit: number
  created_by: string | null
  created_at: number
}

function asResourceType(value: unknown): ResourceType {
  if (value !== 'page' && value !== 'database') throw new HttpError(400, '资源类型不合法')
  return value
}

/* ---------------- 角色计算 ---------------- */

/** 用户在空间内的基线角色（个人空间仅所有者是本空间成员） */
export function effectiveSpaceRole(userId: string, spaceId: string): SpaceRole | null {
  const space = getSpace(spaceId)
  if (!space) return null
  if (space.type === 'personal') return space.owner_user_id === userId ? 'owner' : null
  if (space.type === 'public') return null
  if (space.owner_user_id === userId) return 'owner'
  const rows = db
    .prepare("SELECT role FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'active'")
    .all(spaceId, userId) as { role: string }[]
  let best: SpaceRole | null = null
  for (const r of rows) {
    if (!best || roleRank(r.role) > roleRank(best)) best = r.role as SpaceRole
  }
  return best
}

/** 用户在该空间负责的节点路径（lead_user_id = user） */
export function leadPathsOf(userId: string, spaceId: string): string[] {
  const rows = db
    .prepare('SELECT path FROM org_nodes WHERE space_id = ? AND lead_user_id = ?')
    .all(spaceId, userId) as { path: string }[]
  return rows.map((r) => r.path)
}

/** 节点是否落在某个节点的子树里（含自身） */
function within(ancestorPath: string, nodePath: string): boolean {
  return nodePath.startsWith(ancestorPath)
}

/** 该用户是不是这个节点（或它的某个上级）的负责人 */
export function leadCoversNode(userId: string, spaceId: string, nodeId: string): boolean {
  if (!nodeId) return false
  return !!db
    .prepare(
      `SELECT 1 FROM org_nodes n
       JOIN org_nodes led ON led.space_id = n.space_id AND led.lead_user_id = ?
       WHERE n.id = ? AND n.space_id = ?
         AND substr(n.path, 1, length(led.path)) = led.path
       LIMIT 1`,
    )
    .get(userId, nodeId, spaceId)
}

/** 成员是否在该用户负责的部门里（按成员挂载的节点判断） */
export function leadCoversMember(userId: string, spaceId: string, memberUserId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM space_members m
       JOIN org_nodes n ON n.id = m.org_node_id AND n.space_id = m.space_id
       JOIN org_nodes led ON led.space_id = m.space_id AND led.lead_user_id = ?
       WHERE m.space_id = ? AND m.user_id = ? AND m.status = 'active'
         AND substr(n.path, 1, length(led.path)) = led.path
       LIMIT 1`,
    )
    .get(userId, spaceId, memberUserId)
}

interface OrgContext {
  ids: Set<string>
  paths: string[]
}

function userOrgContext(userId: string, spaceId: string): OrgContext {
  const rows = db
    .prepare("SELECT org_node_id FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'active'")
    .all(spaceId, userId) as { org_node_id: string }[]
  const ids = new Set<string>()
  const paths: string[] = []
  for (const r of rows) {
    if (!r.org_node_id) continue
    ids.add(r.org_node_id)
    const node = db.prepare('SELECT path FROM org_nodes WHERE id = ? AND space_id = ?').get(r.org_node_id, spaceId) as
      | { path: string }
      | undefined
    if (node) paths.push(node.path)
  }
  return { ids, paths }
}

/** 组织主体是否覆盖该用户：直接挂载，或条目节点是用户节点的祖先 */
function orgCovers(entryNodeId: string, ctx: OrgContext, spaceId: string): boolean {
  if (ctx.ids.has(entryNodeId)) return true
  const node = db.prepare('SELECT path FROM org_nodes WHERE id = ? AND space_id = ?').get(entryNodeId, spaceId) as
    | { path: string }
    | undefined
  if (!node) return false
  return ctx.paths.some((p) => p.startsWith(node.path))
}

/** 页面自身及祖先链（近 → 远），用于 ACL 继承 */
function pageChain(spaceId: string, pageId: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur: string | null = pageId
  while (cur && out.length < 64 && !seen.has(cur)) {
    seen.add(cur)
    out.push(cur)
    const page: Doc | null = getDoc<Doc>('pages', cur, spaceId)
    const parent: unknown = page?.parentId
    cur = typeof parent === 'string' ? parent : null
  }
  return out
}

/**
 * 这份文档是不是「本部门的文档」：授权给了负责范围里的某个部门，或某个部门成员。
 * 只认非 deny 的显式授权——没被授权过的文档还是按空间基线走。
 */
function resourceInLeadScope(
  spaceId: string,
  resourceType: ResourceType,
  resourceId: string,
  ledPaths: string[],
): boolean {
  const chain = resourceType === 'page' ? pageChain(spaceId, resourceId) : [resourceId]
  for (const rid of chain) {
    const entries = db
      .prepare(
        'SELECT subject_type, subject_id FROM acl_entries WHERE space_id = ? AND resource_type = ? AND resource_id = ? AND deny = 0',
      )
      .all(spaceId, resourceType, rid) as { subject_type: string; subject_id: string }[]
    for (const e of entries) {
      if (e.subject_type === 'org_node') {
        const node = db.prepare('SELECT path FROM org_nodes WHERE id = ? AND space_id = ?').get(e.subject_id, spaceId) as
          | { path: string }
          | undefined
        if (node && ledPaths.some((p) => within(p, node.path))) return true
      } else if (e.subject_type === 'user') {
        const member = db
          .prepare(
            `SELECT n.path FROM space_members m
             JOIN org_nodes n ON n.id = m.org_node_id AND n.space_id = m.space_id
             WHERE m.space_id = ? AND m.user_id = ? AND m.status = 'active'`,
          )
          .get(spaceId, e.subject_id) as { path: string } | undefined
        if (member && ledPaths.some((p) => within(p, member.path))) return true
      }
    }
  }
  return false
}

export function effectiveResourceRole(
  userId: string,
  spaceId: string,
  resourceType: ResourceType,
  resourceId: string,
): SpaceRole | null {
  const space = getSpace(spaceId)
  if (!space) return null
  if (space.type === 'public') return null
  if (space.type === 'personal' && space.owner_user_id === userId) return 'owner'

  const base = effectiveSpaceRole(userId, spaceId)
  if (space.type === 'team' && !base) {
    // 非成员只能通过显式 ACL 访问（访客）
  }
  const ctx: OrgContext =
    space.type === 'team' ? userOrgContext(userId, spaceId) : { ids: new Set(), paths: [] }
  // 负责人视同挂在自己负责的节点上：该节点（及其上级）的授权同样覆盖到他
  const ledPaths = space.type === 'team' ? leadPathsOf(userId, spaceId) : []
  if (ledPaths.length) ctx.paths.push(...ledPaths)

  const chain = resourceType === 'page' ? pageChain(spaceId, resourceId) : [resourceId]
  let best: SpaceRole | null = null

  for (let i = 0; i < chain.length; i++) {
    const entries = db
      .prepare('SELECT * FROM acl_entries WHERE space_id = ? AND resource_type = ? AND resource_id = ?')
      .all(spaceId, resourceType, chain[i]) as unknown as AclEntryRow[]
    for (const e of entries) {
      if (i > 0 && !e.inherit) continue
      const matched =
        (e.subject_type === 'user' && e.subject_id === userId) ||
        (e.subject_type === 'org_node' && orgCovers(e.subject_id, ctx, spaceId)) ||
        (e.subject_type === 'space' && e.subject_id === spaceId)
      if (!matched) continue
      if (e.deny) return null
      if (!best || roleRank(e.role) > roleRank(best)) best = e.role as SpaceRole
    }
  }

  // 授权给「我负责的部门」的文档：负责人拥有完全控制（可编辑、可改授权）
  if (base && base !== 'guest' && ledPaths.length && resourceInLeadScope(spaceId, resourceType, resourceId, ledPaths)) {
    return 'admin'
  }

  if (best) return best
  if (!base) return null
  if (base === 'guest') return null
  // 空间所有者/管理员保留其管理角色，不能降到 editor
  if (base === 'owner' || base === 'admin') return base
  // 空间基线：editor 及以上可写，viewer 只读
  return roleRank(base) >= ROLE_RANK.editor ? 'editor' : 'viewer'
}

export function assertAccess(
  auth: AuthLocals,
  resourceType: ResourceType,
  resourceId: string,
  need: 'read' | 'write',
): SpaceRole {
  if (auth.spaceType === 'public') {
    if (auth.user.role !== 'admin') throw new HttpError(403, '无权访问')
    return 'owner'
  }
  const role = effectiveResourceRole(auth.user.id, auth.spaceId, resourceType, resourceId)
  if (!role) throw new HttpError(404, resourceType === 'page' ? '页面不存在或无权访问' : '资源不存在或无权访问')
  if (need === 'write' && roleRank(role) < ROLE_RANK.editor) throw new HttpError(403, '你只有查看权限')
  return role
}

/* ---------------- 好友判定（供个人空间分享） ---------------- */

export function areFriends(a: string, b: string): boolean {
  const [low, high] = a < b ? [a, b] : [b, a]
  const row = db
    .prepare("SELECT 1 FROM friendships WHERE user_low = ? AND user_high = ? AND status = 'accepted' LIMIT 1")
    .get(low, high)
  return !!row
}

/** 两人是否同属至少一个团队空间（个人笔记可分享给同团队成员） */
export function sharesTeam(a: string, b: string): boolean {
  if (a === b) return false
  return !!db
    .prepare(
      `SELECT 1 FROM space_members m1
       JOIN space_members m2 ON m2.space_id = m1.space_id
       JOIN spaces s ON s.id = m1.space_id
       WHERE m1.user_id = ? AND m2.user_id = ?
         AND m1.status = 'active' AND m2.status = 'active' AND s.type = 'team'
       LIMIT 1`,
    )
    .get(a, b)
}

/* ---------------- ACL 接口 ---------------- */

export const aclRouter = Router()

function subjectName(type: string, id: string): string {
  if (type === 'user') {
    const u = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(id) as
      | { username: string; nickname: string | null }
      | undefined
    return u ? u.nickname || u.username : '已注销用户'
  }
  if (type === 'org_node') {
    const n = db.prepare('SELECT name FROM org_nodes WHERE id = ?').get(id) as { name: string } | undefined
    return n?.name ?? '已删除节点'
  }
  const s = getSpace(id)
  return s?.name ?? '空间'
}

function publicEntry(e: AclEntryRow) {
  return {
    id: e.id,
    subjectType: e.subject_type,
    subjectId: e.subject_id,
    subjectName: subjectName(e.subject_type, e.subject_id),
    role: e.role as SpaceRole,
    deny: !!e.deny,
    inherit: !!e.inherit,
    createdBy: e.created_by,
    createdAt: e.created_at,
  }
}

aclRouter.get('/acl/:type/:id', (req, res) => {
  const auth = authOf(res)
  const type = asResourceType(req.params.type)
  const id = param(req, 'id')
  const myRole = effectiveResourceRole(auth.user.id, auth.spaceId, type, id)
  if (!myRole) throw new HttpError(404, '资源不存在或无权访问')
  const rows = db
    .prepare(
      'SELECT * FROM acl_entries WHERE space_id = ? AND resource_type = ? AND resource_id = ? ORDER BY created_at',
    )
    .all(auth.spaceId, type, id) as unknown as AclEntryRow[]
  res.json({ myRole, entries: rows.map(publicEntry) })
})

aclRouter.put('/acl/:type/:id', (req, res) => {
  const auth = authOf(res)
  const type = asResourceType(req.params.type)
  const id = param(req, 'id')
  const myRole = effectiveResourceRole(auth.user.id, auth.spaceId, type, id)
  if (!myRole) throw new HttpError(404, '资源不存在或无权访问')
  if (roleRank(myRole) < ROLE_RANK.admin) throw new HttpError(403, '需要管理权限')

  const subjectType = req.body?.subjectType
  if (subjectType !== 'user' && subjectType !== 'org_node' && subjectType !== 'space') {
    throw new HttpError(400, '授权主体不合法')
  }
  const subjectId = typeof req.body?.subjectId === 'string' ? req.body.subjectId : ''
  if (!subjectId) throw new HttpError(400, '授权主体不能为空')

  const role = req.body?.role === 'editor' ? 'editor' : req.body?.role === 'admin' ? 'admin' : 'viewer'
  if (roleRank(role) > roleRank(myRole)) throw new HttpError(403, '不能授予高于自己的权限')

  const space = getSpace(auth.spaceId)
  if (!space) throw new HttpError(404, '空间不存在')

  if (subjectType === 'user') {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(subjectId) as { id: string } | undefined
    if (!target) throw new HttpError(404, '用户不存在')
    if (target.id === auth.user.id) throw new HttpError(400, '不能给自己授权')
    if (space.type === 'personal' && !areFriends(auth.user.id, target.id)) {
      throw new HttpError(403, '个人空间只能分享给好友')
    }
    if (space.type === 'team') {
      const member = db
        .prepare("SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'active'")
        .get(space.id, target.id)
      if (!member) throw new HttpError(400, '对方不是空间成员，请先邀请加入')
    }
  }

  if (subjectType === 'org_node') {
    if (space.type !== 'team') throw new HttpError(400, '个人空间不支持按部门授权')
    const node = db.prepare('SELECT space_id FROM org_nodes WHERE id = ?').get(subjectId) as
      | { space_id: string }
      | undefined
    if (!node || node.space_id !== space.id) throw new HttpError(404, '组织节点不存在')
  }

  if (subjectType === 'space' && subjectId !== space.id) throw new HttpError(400, '空间主体不合法')

  const deny = req.body?.deny === true ? 1 : 0
  const inherit = req.body?.inherit === false ? 0 : 1
  const existing = db
    .prepare(
      'SELECT * FROM acl_entries WHERE resource_type = ? AND resource_id = ? AND subject_type = ? AND subject_id = ?',
    )
    .get(type, id, subjectType, subjectId) as AclEntryRow | undefined

  if (existing) {
    db.prepare('UPDATE acl_entries SET role = ?, deny = ?, inherit = ? WHERE id = ?').run(
      role,
      deny,
      inherit,
      existing.id,
    )
    res.json(publicEntry({ ...existing, role, deny, inherit }))
    return
  }
  const row: AclEntryRow = {
    id: randomUUID(),
    space_id: space.id,
    resource_type: type,
    resource_id: id,
    subject_type: subjectType,
    subject_id: subjectId,
    role,
    deny,
    inherit,
    created_by: auth.user.id,
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
  res.status(201).json(publicEntry(row))
})

aclRouter.delete('/acl/:type/:id/:entryId', (req, res) => {
  const auth = authOf(res)
  const type = asResourceType(req.params.type)
  const id = param(req, 'id')
  const entryId = param(req, 'entryId')
  const myRole = effectiveResourceRole(auth.user.id, auth.spaceId, type, id)
  if (!myRole) throw new HttpError(404, '资源不存在或无权访问')
  const entry = db.prepare('SELECT * FROM acl_entries WHERE id = ? AND resource_id = ?').get(entryId, id) as
    | AclEntryRow
    | undefined
  if (!entry) throw new HttpError(404, '授权不存在')
  const isOwner = roleRank(myRole) >= ROLE_RANK.admin
  const isSelf = entry.subject_type === 'user' && entry.subject_id === auth.user.id
  if (!isOwner && !isSelf) throw new HttpError(403, '无权撤销该授权')
  db.prepare('DELETE FROM acl_entries WHERE id = ?').run(entry.id)
  res.json({ ok: true })
})