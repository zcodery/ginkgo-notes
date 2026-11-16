import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authOf, createUser, findUserById, findUserByName, updateUserProfile, type SpaceRole } from './auth.ts'
import { effectiveSpaceRole, roleRank } from './acl.ts'
import { db, getSpace, listSpacesFor, transaction, type SpaceRow } from './db.ts'
import { HttpError, param, str } from './http.ts'
import { notify } from './notify.ts'

/**
 * 团队空间：组织树、成员与角色、邀请。
 *
 * 角色继承：成员挂在某个 org_node 上，条目授权到该节点时整棵子树生效。
 */

export const spacesRouter = Router()

const ASSIGNABLE = new Set<SpaceRole>(['admin', 'editor', 'viewer', 'guest'])

interface OrgNodeRow {
  id: string
  space_id: string
  parent_id: string | null
  name: string
  path: string
  depth: number
  sort: number
  lead_user_id: string | null
  created_at: number
}

interface MemberRow {
  space_id: string
  user_id: string
  org_node_id: string
  role: string
  status: string
  joined_at: number
}

interface InviteRow {
  id: string
  space_id: string
  org_node_id: string
  role: string
  invitee_id: string | null
  token: string | null
  status: string
  expires_at: number | null
  created_by: string
  created_at: number
}

function publicUser(userId: string) {
  const u = findUserById(userId)
  return {
    id: userId,
    username: u?.username ?? '',
    name: u ? u.nickname || u.username : '已注销用户',
    avatar: u?.avatar ?? null,
  }
}

function publicSpace(space: SpaceRow, role: SpaceRole) {
  const memberCount = (
    db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM space_members WHERE space_id = ? AND status = 'active'").get(
      space.id,
    ) as { n: number }
  ).n
  return {
    id: space.id,
    type: space.type,
    name: space.name,
    ownerUserId: space.owner_user_id,
    role,
    memberCount,
    createdAt: space.created_at,
  }
}

function requireSpace(id: string): SpaceRow {
  const space = getSpace(id)
  if (!space) throw new HttpError(404, '空间不存在')
  return space
}

/** 需要空间管理权限（owner / admin） */
function requireAdmin(spaceId: string, userId: string): SpaceRole {
  const role = effectiveSpaceRole(userId, spaceId)
  if (!role) throw new HttpError(404, '空间不存在或无权访问')
  if (roleRank(role) < roleRank('admin')) throw new HttpError(403, '需要团队管理权限')
  return role
}

function requireMember(spaceId: string, userId: string): SpaceRole {
  const role = effectiveSpaceRole(userId, spaceId)
  if (!role) throw new HttpError(404, '空间不存在或无权访问')
  return role
}

/* ---------------- 空间 ---------------- */

spacesRouter.get('/spaces', (_req, res) => {
  const { user } = authOf(res)
  const rows = listSpacesFor(user.id)
  res.json(
    rows.map((s) => publicSpace(s, effectiveSpaceRole(user.id, s.id) ?? 'viewer')),
  )
})

spacesRouter.post('/spaces', (req, res) => {
  const { user } = authOf(res)
  const name = str(req.body?.name, '团队名称', 60)
  if (!name) throw new HttpError(400, '请填写团队名称')
  const now = Date.now()
  const space: SpaceRow = {
    id: `sp_${randomUUID()}`,
    type: 'team',
    name,
    owner_user_id: user.id,
    created_at: now,
  }
  const rootId = randomUUID()
  transaction(() => {
    db.prepare('INSERT INTO spaces (id, type, name, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      space.id,
      space.type,
      space.name,
      space.owner_user_id,
      space.created_at,
    )
    db.prepare(
      `INSERT INTO org_nodes (id, space_id, parent_id, name, path, depth, sort, lead_user_id, created_at)
       VALUES (?, ?, NULL, '全员', ?, 0, 1, ?, ?)`,
    ).run(rootId, space.id, `/${rootId}/`, user.id, now)
    db.prepare(
      "INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at) VALUES (?, ?, ?, 'owner', 'active', ?)",
    ).run(space.id, user.id, rootId, now)
  })
  res.status(201).json(publicSpace(space, 'owner'))
})

/* 注意：/spaces/invites 必须先于 /spaces/:id 注册 */

spacesRouter.get('/spaces/invites', (req, res) => {
  const { user } = authOf(res)
  const rows = db
    .prepare("SELECT * FROM invites WHERE invitee_id = ? AND status = 'pending' ORDER BY created_at DESC")
    .all(user.id) as unknown as InviteRow[]
  res.json(
    rows
      .filter((i) => !i.expires_at || i.expires_at > Date.now())
      .map((i) => {
        const space = getSpace(i.space_id)
        return {
          id: i.id,
          spaceId: i.space_id,
          spaceName: space?.name ?? '已解散团队',
          role: i.role,
          orgNodeId: i.org_node_id,
          from: publicUser(i.created_by),
          createdAt: i.created_at,
        }
      }),
  )
})

spacesRouter.post('/spaces/invites/:id/accept', (req, res) => {
  const { user } = authOf(res)
  const inv = db.prepare('SELECT * FROM invites WHERE id = ?').get(param(req, 'id')) as InviteRow | undefined
  if (!inv || inv.status !== 'pending') throw new HttpError(404, '邀请不存在或已处理')
  if (inv.invitee_id !== user.id) throw new HttpError(403, '这不是给你的邀请')
  if (inv.expires_at && inv.expires_at < Date.now()) throw new HttpError(410, '邀请已过期')
  const now = Date.now()
  transaction(() => {
    db.prepare(
      `INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at)
       VALUES (?, ?, ?, ?, 'active', ?)
       ON CONFLICT(space_id, user_id, org_node_id) DO UPDATE SET role = excluded.role, status = 'active'`,
    ).run(inv.space_id, user.id, inv.org_node_id, inv.role, now)
    db.prepare("UPDATE invites SET status = 'accepted' WHERE id = ?").run(inv.id)
  })
  const space = getSpace(inv.space_id)
  notify(inv.created_by, 'member', `${user.nickname || user.username} 加入了「${space?.name ?? '团队'}」`, null, '/teams')
  res.json({ ok: true, spaceId: inv.space_id })
})

spacesRouter.post('/spaces/invites/:id/decline', (req, res) => {
  const { user } = authOf(res)
  const inv = db.prepare('SELECT * FROM invites WHERE id = ?').get(param(req, 'id')) as InviteRow | undefined
  if (!inv || inv.status !== 'pending') throw new HttpError(404, '邀请不存在或已处理')
  if (inv.invitee_id !== user.id) throw new HttpError(403, '这不是给你的邀请')
  db.prepare("UPDATE invites SET status = 'declined' WHERE id = ?").run(inv.id)
  res.json({ ok: true })
})

spacesRouter.get('/spaces/:id', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  res.json(publicSpace(space, requireMember(space.id, user.id)))
})

spacesRouter.patch('/spaces/:id', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireAdmin(space.id, user.id)
  if (req.body?.name !== undefined) {
    const name = str(req.body.name, '团队名称', 60)
    if (!name) throw new HttpError(400, '请填写团队名称')
    db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(name, space.id)
    space.name = name
  }
  res.json(publicSpace(space, requireMember(space.id, user.id)))
})

/* ---------------- 组织树 ---------------- */

spacesRouter.get('/spaces/:id/org', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireMember(space.id, user.id)
  const nodes = db
    .prepare('SELECT * FROM org_nodes WHERE space_id = ? ORDER BY depth, sort, created_at')
    .all(space.id) as unknown as OrgNodeRow[]
  const members = db
    .prepare("SELECT * FROM space_members WHERE space_id = ? AND status = 'active' ORDER BY joined_at")
    .all(space.id) as unknown as MemberRow[]
  const counts = new Map<string, number>()
  // 没挂节点的成员视为「全员」（根节点）成员，否则树上永远显示 0 人，但右侧列表里却有人
  const rootNodeId = nodes.find((n) => !n.parent_id)?.id ?? ''
  for (const m of members) {
    const key = m.org_node_id || rootNodeId
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  res.json({
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parent_id,
      name: n.name,
      path: n.path,
      depth: n.depth,
      sort: n.sort,
      leadUserId: n.lead_user_id,
      memberCount: counts.get(n.id) ?? 0,
    })),
    members: members.map((m) => ({
      ...publicUser(m.user_id),
      role: m.role,
      orgNodeId: m.org_node_id,
      status: m.status,
      joinedAt: m.joined_at,
    })),
  })
})

function nodePath(parentId: string | null, nodeId: string): { path: string; depth: number } {
  if (!parentId) return { path: `/${nodeId}/`, depth: 0 }
  const parent = db.prepare('SELECT path, depth FROM org_nodes WHERE id = ?').get(parentId) as
    | { path: string; depth: number }
    | undefined
  if (!parent) throw new HttpError(404, '上级节点不存在')
  return { path: `${parent.path}${nodeId}/`, depth: parent.depth + 1 }
}

spacesRouter.post('/spaces/:id/org/nodes', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireAdmin(space.id, user.id)
  const name = str(req.body?.name, '节点名称', 40)
  if (!name) throw new HttpError(400, '请填写节点名称')
  const parentId = typeof req.body?.parentId === 'string' && req.body.parentId ? req.body.parentId : null
  if (parentId) {
    const parent = db.prepare('SELECT space_id FROM org_nodes WHERE id = ?').get(parentId) as
      | { space_id: string }
      | undefined
    if (!parent || parent.space_id !== space.id) throw new HttpError(404, '上级节点不存在')
  }
  const id = randomUUID()
  const { path, depth } = nodePath(parentId, id)
  const sort = (
    db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM org_nodes WHERE space_id = ? AND parent_id IS ?').get(
      space.id,
      parentId,
    ) as { m: number }
  ).m + 1
  db.prepare(
    `INSERT INTO org_nodes (id, space_id, parent_id, name, path, depth, sort, lead_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(id, space.id, parentId, name, path, depth, sort, Date.now())
  res.status(201).json({ id, parentId, name, path, depth, sort, memberCount: 0 })
})

spacesRouter.patch('/spaces/:id/org/nodes/:nodeId', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireAdmin(space.id, user.id)
  const node = db.prepare('SELECT * FROM org_nodes WHERE id = ? AND space_id = ?').get(
    param(req, 'nodeId'),
    space.id,
  ) as OrgNodeRow | undefined
  if (!node) throw new HttpError(404, '组织节点不存在')

  let nextParent = node.parent_id
  if (req.body?.parentId !== undefined) {
    nextParent = typeof req.body.parentId === 'string' && req.body.parentId ? req.body.parentId : null
    if (nextParent) {
      const target = db.prepare('SELECT * FROM org_nodes WHERE id = ? AND space_id = ?').get(nextParent, space.id) as
        | OrgNodeRow
        | undefined
      if (!target) throw new HttpError(404, '目标节点不存在')
      // 不能移动到自身或自身子树
      if (target.path.startsWith(node.path)) throw new HttpError(400, '不能移动到自身或下级节点')
    }
  }
  const name = req.body?.name !== undefined ? str(req.body.name, '节点名称', 40) : node.name
  if (!name) throw new HttpError(400, '请填写节点名称')

  if (nextParent !== node.parent_id) {
    const { path, depth } = nodePath(nextParent, node.id)
    transaction(() => {
      db.prepare('UPDATE org_nodes SET parent_id = ?, path = ?, depth = ?, name = ? WHERE id = ?').run(
        nextParent,
        path,
        depth,
        name,
        node.id,
      )
      const descendants = db
        .prepare('SELECT id, path, depth FROM org_nodes WHERE space_id = ? AND path LIKE ? AND id != ?')
        .all(space.id, `${node.path}%`, node.id) as { id: string; path: string; depth: number }[]
      for (const d of descendants) {
        db.prepare('UPDATE org_nodes SET path = ?, depth = ? WHERE id = ?').run(
          path + d.path.slice(node.path.length),
          depth + (d.depth - node.depth),
          d.id,
        )
      }
    })
  } else if (name !== node.name) {
    db.prepare('UPDATE org_nodes SET name = ? WHERE id = ?').run(name, node.id)
  }
  res.json({ ok: true })
})

/**
 * 拖拽移动节点：改上级 + 决定在同级里的插入位置。
 * 只传 parentId 会排到末尾；传 beforeId 则插到那个兄弟节点之前（同级的上下换位也走这里）。
 */
spacesRouter.post('/spaces/:id/org/nodes/:nodeId/move', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireAdmin(space.id, user.id)
  const node = db.prepare('SELECT * FROM org_nodes WHERE id = ? AND space_id = ?').get(
    param(req, 'nodeId'),
    space.id,
  ) as OrgNodeRow | undefined
  if (!node) throw new HttpError(404, '组织节点不存在')

  const nextParent =
    typeof req.body?.parentId === 'string' && req.body.parentId ? String(req.body.parentId) : null
  if (nextParent) {
    const target = db.prepare('SELECT * FROM org_nodes WHERE id = ? AND space_id = ?').get(nextParent, space.id) as
      | OrgNodeRow
      | undefined
    if (!target) throw new HttpError(404, '目标节点不存在')
    // 不能挂到自己或自己的下级上
    if (target.path.startsWith(node.path)) throw new HttpError(400, '不能移动到自身或下级节点')
  }
  const beforeId =
    typeof req.body?.beforeId === 'string' && req.body.beforeId ? String(req.body.beforeId) : null
  if (beforeId === node.id) throw new HttpError(400, '不能移动到自身位置')

  const { path, depth } = nodePath(nextParent, node.id)

  transaction(() => {
    if (nextParent !== node.parent_id) {
      db.prepare('UPDATE org_nodes SET parent_id = ?, path = ?, depth = ? WHERE id = ?').run(
        nextParent,
        path,
        depth,
        node.id,
      )
      const descendants = db
        .prepare('SELECT id, path, depth FROM org_nodes WHERE space_id = ? AND path LIKE ? AND id != ?')
        .all(space.id, `${node.path}%`, node.id) as { id: string; path: string; depth: number }[]
      for (const d of descendants) {
        db.prepare('UPDATE org_nodes SET path = ?, depth = ? WHERE id = ?').run(
          path + d.path.slice(node.path.length),
          depth + (d.depth - node.depth),
          d.id,
        )
      }
    }

    // 目标父节点下的兄弟（不含自己），按当前顺序重排后整体写回 sort
    const siblings = db
      .prepare('SELECT id FROM org_nodes WHERE space_id = ? AND parent_id IS ? AND id != ? ORDER BY sort, created_at')
      .all(space.id, nextParent, node.id) as { id: string }[]
    let index = siblings.length
    if (beforeId) {
      const at = siblings.findIndex((s) => s.id === beforeId)
      if (at >= 0) index = at
    }
    siblings.splice(index, 0, { id: node.id })
    siblings.forEach((s, i) => {
      db.prepare('UPDATE org_nodes SET sort = ? WHERE id = ?').run(i + 1, s.id)
    })
  })
  res.json({ ok: true })
})

spacesRouter.delete('/spaces/:id/org/nodes/:nodeId', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireAdmin(space.id, user.id)
  const node = db.prepare('SELECT * FROM org_nodes WHERE id = ? AND space_id = ?').get(
    param(req, 'nodeId'),
    space.id,
  ) as OrgNodeRow | undefined
  if (!node) throw new HttpError(404, '组织节点不存在')
  const child = db.prepare('SELECT 1 FROM org_nodes WHERE space_id = ? AND parent_id = ? LIMIT 1').get(
    space.id,
    node.id,
  )
  if (child) throw new HttpError(400, '请先删除或移动下级部门')
  transaction(() => {
    // 成员与授权迁移到上级节点，避免出现悬空授权
    db.prepare('UPDATE space_members SET org_node_id = ? WHERE space_id = ? AND org_node_id = ?').run(
      node.parent_id ?? '',
      space.id,
      node.id,
    )
    db.prepare('DELETE FROM acl_entries WHERE space_id = ? AND subject_type = ? AND subject_id = ?').run(
      space.id,
      'org_node',
      node.id,
    )
    db.prepare('DELETE FROM org_nodes WHERE id = ?').run(node.id)
  })
  res.json({ ok: true })
})

/* ---------------- 组织架构批量导入 ---------------- */

interface ImportResult {
  createdNodes: number
  reusedNodes: number
  members: number
  errors: string[]
}

/** 简单 CSV 行解析：支持双引号包裹与转义 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function splitPath(value: string): string[] {
  return value
    .split(/[/\\>＞]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
}

spacesRouter.post('/spaces/:id/org/import', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  const actor = requireAdmin(space.id, user.id)

  const payload = (req.body ?? {}) as Record<string, unknown>
  const result: ImportResult = { createdNodes: 0, reusedNodes: 0, members: 0, errors: [] }
  const now = Date.now()

  // 根节点：优先复用空间里已有的 depth=0 节点
  let root = db
    .prepare('SELECT * FROM org_nodes WHERE space_id = ? ORDER BY depth, created_at LIMIT 1')
    .get(space.id) as OrgNodeRow | undefined
  if (!root) {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO org_nodes (id, space_id, parent_id, name, path, depth, sort, lead_user_id, created_at)
       VALUES (?, ?, NULL, '全员', ?, 0, 1, ?, ?)`,
    ).run(id, space.id, `/${id}/`, user.id, now)
    root = db.prepare('SELECT * FROM org_nodes WHERE id = ?').get(id) as unknown as OrgNodeRow
  }

  function nextSort(parentId: string): number {
    const row = db
      .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM org_nodes WHERE space_id = ? AND parent_id IS ?')
      .get(space.id, parentId) as { m: number }
    return row.m + 1
  }

  function createNode(parentId: string, name: string): string {
    const existing = db
      .prepare('SELECT id FROM org_nodes WHERE space_id = ? AND parent_id = ? AND name = ?')
      .get(space.id, parentId, name) as { id: string } | undefined
    if (existing) {
      result.reusedNodes++
      return existing.id
    }
    const id = randomUUID()
    const { path, depth } = nodePath(parentId, id)
    db.prepare(
      `INSERT INTO org_nodes (id, space_id, parent_id, name, path, depth, sort, lead_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(id, space.id, parentId, name.slice(0, 40), path, depth, nextSort(parentId), now)
    result.createdNodes++
    return id
  }

  function addMember(username: string, nodeId: string, role: string): void {
    if (!username) return
    const target = findUserByName(username)
    if (!target) {
      result.errors.push(`找不到用户：${username}`)
      return
    }
    if (target.id === space.owner_user_id) return
    const next = ASSIGNABLE.has(role as SpaceRole) ? (role as SpaceRole) : 'viewer'
    if (roleRank(next) > roleRank(actor)) {
      result.errors.push(`${username} 的角色超出你的权限`)
      return
    }
    const existing = db
      .prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?')
      .get(space.id, target.id)
    // 导入语义是「覆盖成员归属」，先清掉旧节点避免一人多挂
    db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(space.id, target.id)
    db.prepare(
      `INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).run(space.id, target.id, nodeId, next, now)
    if (!existing) result.members++
  }

  transaction(() => {
    const format = String(payload.format ?? 'csv')
    if (format === 'csv') {
      const text = typeof payload.text === 'string' ? payload.text : ''
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
      const pathToNode = new Map<string, string>([['', root!.id]])
      const ensurePath = (parts: string[]): string => {
        let parentId = root!.id
        let acc = ''
        for (const part of parts) {
          acc = acc ? `${acc}/${part}` : part
          const hit = pathToNode.get(acc)
          if (hit) {
            parentId = hit
            continue
          }
          parentId = createNode(parentId, part)
          pathToNode.set(acc, parentId)
        }
        return parentId
      }

      let first = true
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        const cols = splitCsvLine(line)
        if (first) {
          first = false
          const head = cols.join(' ').toLowerCase()
          if (/部门|路径|path|name|dept/.test(head)) continue
        }
        const pathText = cols[0] ?? ''
        if (!pathText) continue
        const parts = splitPath(pathText)
        if (!parts.length) continue
        const nodeId = ensurePath(parts)
        addMember(cols[1] ?? '', nodeId, cols[2] ?? 'viewer')
      }
    } else {
      const keyToNode = new Map<string, string>([['', root!.id]])

      // 扁平节点：key/parentKey，父节点可乱序
      const flat = Array.isArray(payload.nodes) ? (payload.nodes as Record<string, unknown>[]) : []
      let pending = flat
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const next: Record<string, unknown>[] = []
        for (const n of pending) {
          const name = typeof n.name === 'string' ? n.name.trim() : ''
          if (!name) continue
          const parentKey = n.parentKey ?? n.parent ?? ''
          if (parentKey && !keyToNode.has(String(parentKey))) {
            next.push(n)
            continue
          }
          const parentId = parentKey ? keyToNode.get(String(parentKey))! : root!.id
          const id = createNode(parentId, name)
          keyToNode.set(String(n.key ?? n.id ?? name), id)
        }
        pending = next
      }
      if (pending.length) result.errors.push(`${pending.length} 个节点找不到上级，已跳过`)

      // 嵌套 children：公司组织树导出常见格式
      const walk = (node: Record<string, unknown>, parentId: string, fallbackKey: string) => {
        const name = typeof node.name === 'string' ? node.name.trim() : ''
        if (!name) return
        const id = createNode(parentId, name)
        const key = String(node.key ?? node.id ?? fallbackKey)
        keyToNode.set(key, id)
        const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
        for (const child of children) walk(child, id, `${key}/${typeof child.name === 'string' ? child.name : ''}`)
      }
      for (const [i, node] of flat.entries()) {
        if (node.parentKey !== undefined || node.parent !== undefined || node.key !== undefined) continue
        if (Array.isArray(node.children)) {
          walk(node, root!.id, String(node.key ?? node.name ?? i))
        }
      }

      const members = Array.isArray(payload.members) ? (payload.members as Record<string, unknown>[]) : []
      for (const m of members) {
        const username = String(m.username ?? m.user ?? '').trim()
        const nodeKey = String(m.nodeKey ?? m.node ?? '')
        addMember(username, keyToNode.get(nodeKey) ?? root!.id, String(m.role ?? 'viewer'))
      }
    }
  })

  res.json({ ok: true, ...result })
})

/* ---------------- 成员 ---------------- */

spacesRouter.get('/spaces/:id/members', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireMember(space.id, user.id)
  const rows = db
    .prepare("SELECT * FROM space_members WHERE space_id = ? AND status = 'active' ORDER BY joined_at")
    .all(space.id) as unknown as MemberRow[]
  res.json(
    rows.map((m) => ({
      ...publicUser(m.user_id),
      role: m.role,
      orgNodeId: m.org_node_id,
      status: m.status,
      joinedAt: m.joined_at,
    })),
  )
})

function assertAssignable(actor: SpaceRole, role: unknown): SpaceRole {
  const next = ASSIGNABLE.has(role as SpaceRole) ? (role as SpaceRole) : 'viewer'
  if (roleRank(next) > roleRank(actor)) throw new HttpError(403, '不能授予高于自己的角色')
  return next
}

function orgNodeOf(spaceId: string, value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const node = db.prepare('SELECT space_id FROM org_nodes WHERE id = ?').get(value) as
    | { space_id: string }
    | undefined
  if (!node || node.space_id !== spaceId) throw new HttpError(404, '组织节点不存在')
  return value
}

spacesRouter.post('/spaces/:id/members', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  const actor = requireAdmin(space.id, user.id)
  const username = str(req.body?.username, '用户名', 120)
  const target = findUserByName(username)
  if (!target) throw new HttpError(404, '找不到该用户')
  if (target.id === space.owner_user_id) throw new HttpError(409, '对方已是团队所有者')
  const role = assertAssignable(actor, req.body?.role)
  const orgNodeId = orgNodeOf(space.id, req.body?.orgNodeId)
  db.prepare(
    `INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at)
     VALUES (?, ?, ?, ?, 'active', ?)
     ON CONFLICT(space_id, user_id, org_node_id) DO UPDATE SET role = excluded.role, status = 'active'`,
  ).run(space.id, target.id, orgNodeId, role, Date.now())
  notify(target.id, 'member', `${user.nickname || user.username} 邀请你加入「${space.name}」`, `角色：${role}`, '/teams')
  res.status(201).json({ ...publicUser(target.id), role, orgNodeId })
})

/**
 * 代注册成员：人事或部门负责人直接建号并挂到组织节点。
 *
 * 约定账号 = 手机号、初始密码 = 手机号；手机号已存在时不重复建号，
 * 直接把该账号加入团队（相当于免邀请直接入组）。
 */
spacesRouter.post('/spaces/:id/members/register', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  const actor = requireAdmin(space.id, user.id)
  const phone = str(req.body?.phone, '手机号', 20).replace(/[\s-]/g, '')
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new HttpError(400, '请填写 11 位手机号')
  const name = req.body?.name === undefined ? '' : str(req.body.name, '姓名', 24)
  const role = assertAssignable(actor, req.body?.role)
  const orgNodeId = orgNodeOf(space.id, req.body?.orgNodeId)

  let target = findUserByName(phone)
  let created = false
  if (target) {
    if (target.id === space.owner_user_id) throw new HttpError(409, '该手机号是团队所有者')
    const member = db
      .prepare("SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'active'")
      .get(space.id, target.id)
    if (member) throw new HttpError(409, '该手机号已是团队成员')
  } else {
    // 用户名规则允许纯数字，手机号本身就能当账号；密码按约定也用手机号
    target = createUser(phone, phone)
    updateUserProfile(target.id, { phone, nickname: name || null })
    created = true
  }

  db.prepare(
    `INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at)
     VALUES (?, ?, ?, ?, 'active', ?)
     ON CONFLICT(space_id, user_id, org_node_id) DO UPDATE SET role = excluded.role, status = 'active'`,
  ).run(space.id, target.id, orgNodeId, role, Date.now())

  res.status(201).json({ ...publicUser(target.id), role, orgNodeId, created })
})

spacesRouter.patch('/spaces/:id/members/:userId', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  const actor = requireAdmin(space.id, user.id)
  const targetId = param(req, 'userId')
  if (targetId === space.owner_user_id) throw new HttpError(400, '不能修改团队所有者')
  const existing = db
    .prepare('SELECT * FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(space.id, targetId) as MemberRow | undefined
  if (!existing) throw new HttpError(404, '成员不存在')
  // 只改部门时保留原角色，避免误降级
  const role =
    req.body?.role === undefined
      ? (existing.role as SpaceRole)
      : assertAssignable(actor, req.body.role)
  const orgNodeId =
    req.body?.orgNodeId !== undefined ? orgNodeOf(space.id, req.body.orgNodeId) : undefined
  if (orgNodeId !== undefined && orgNodeId !== existing.org_node_id) {
    db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(space.id, targetId)
    db.prepare(
      "INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at) VALUES (?, ?, ?, ?, 'active', ?)",
    ).run(space.id, targetId, orgNodeId, role, existing.joined_at)
  } else {
    db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?').run(role, space.id, targetId)
  }
  res.json({ ok: true, role })
})

spacesRouter.delete('/spaces/:id/members/:userId', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  const actor = requireAdmin(space.id, user.id)
  const targetId = param(req, 'userId')
  if (targetId === space.owner_user_id) throw new HttpError(400, '不能移除团队所有者')
  if (targetId === user.id && roleRank(actor) < roleRank('owner')) {
    throw new HttpError(400, '请让团队所有者移除你')
  }
  transaction(() => {
    db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(space.id, targetId)
    db.prepare('DELETE FROM acl_entries WHERE space_id = ? AND subject_type = ? AND subject_id = ?').run(
      space.id,
      'user',
      targetId,
    )
    db.prepare("UPDATE invites SET status = 'revoked' WHERE space_id = ? AND invitee_id = ? AND status = 'pending'").run(
      space.id,
      targetId,
    )
  })
  res.json({ ok: true })
})

/* ---------------- 邀请 ---------------- */

spacesRouter.get('/spaces/:id/invites', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  requireAdmin(space.id, user.id)
  const rows = db
    .prepare("SELECT * FROM invites WHERE space_id = ? AND status = 'pending' ORDER BY created_at DESC")
    .all(space.id) as unknown as InviteRow[]
  res.json(
    rows.map((i) => ({
      id: i.id,
      invitee: i.invitee_id ? publicUser(i.invitee_id) : null,
      role: i.role,
      orgNodeId: i.org_node_id,
      expiresAt: i.expires_at,
      createdAt: i.created_at,
    })),
  )
})

spacesRouter.post('/spaces/:id/invites', (req, res) => {
  const { user } = authOf(res)
  const space = requireSpace(param(req, 'id'))
  const actor = requireAdmin(space.id, user.id)
  const username = str(req.body?.username, '用户名', 120)
  const target = findUserByName(username)
  if (!target) throw new HttpError(404, '找不到该用户')
  const member = db
    .prepare("SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ? AND status = 'active'")
    .get(space.id, target.id)
  if (member) throw new HttpError(409, '对方已是团队成员')
  const role = assertAssignable(actor, req.body?.role)
  const orgNodeId = orgNodeOf(space.id, req.body?.orgNodeId)
  const existing = db
    .prepare("SELECT * FROM invites WHERE space_id = ? AND invitee_id = ? AND status = 'pending'")
    .get(space.id, target.id) as InviteRow | undefined
  const now = Date.now()
  if (existing) {
    db.prepare('UPDATE invites SET role = ?, org_node_id = ?, created_by = ? WHERE id = ?').run(
      role,
      orgNodeId,
      user.id,
      existing.id,
    )
    notify(target.id, 'member', `${user.nickname || user.username} 再次邀请你加入「${space.name}」`, null, '/teams')
    res.json({ id: existing.id })
    return
  }
  const row: InviteRow = {
    id: randomUUID(),
    space_id: space.id,
    org_node_id: orgNodeId,
    role,
    invitee_id: target.id,
    token: null,
    status: 'pending',
    expires_at: null,
    created_by: user.id,
    created_at: now,
  }
  db.prepare(
    `INSERT INTO invites (id, space_id, org_node_id, role, invitee_id, token, status, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?)`,
  ).run(row.id, row.space_id, row.org_node_id, row.role, row.invitee_id, row.created_by, row.created_at)
  notify(target.id, 'member', `${user.nickname || user.username} 邀请你加入「${space.name}」`, `角色：${role}`, '/teams')
  res.status(201).json({ id: row.id })
})