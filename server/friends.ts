import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authOf, findUserById, findUserByName } from './auth.ts'
import { db, transaction } from './db.ts'
import { HttpError, param, str } from './http.ts'
import { notify } from './notify.ts'

/**
 * 好友关系。
 *
 * 好友本身不产生任何文档权限，只是「允许被分享」的白名单；
 * 真正的访问权仍由 acl_entries 授予。
 */

interface FriendRow {
  id: string
  user_low: string
  user_high: string
  status: 'pending' | 'accepted' | 'rejected' | 'blocked'
  requested_by: string
  message: string | null
  requester_group_id: string
  created_at: number
  updated_at: number
}

const REQUEST_COOLDOWN = 7 * 24 * 3600 * 1000

export const friendsRouter = Router()

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function findPair(a: string, b: string): FriendRow | null {
  const [low, high] = pair(a, b)
  return (
    (db.prepare('SELECT * FROM friendships WHERE user_low = ? AND user_high = ?').get(low, high) as
      | FriendRow
      | undefined) ?? null
  )
}

function otherOf(row: FriendRow, me: string): string {
  return row.user_low === me ? row.user_high : row.user_low
}

function publicFriend(userId: string) {
  const u = findUserById(userId)
  return {
    id: userId,
    username: u?.username ?? '',
    name: u ? u.nickname || u.username : '已注销用户',
    avatar: u?.avatar ?? null,
  }
}

/**
 * 加好友时的分组选择：'__none__' 是显式「未分组」，空串表示没选（落默认组）。
 * 分组后来被删掉时退回该用户的默认组，避免同意申请直接报错。
 */
const NONE_GROUP = '__none__'
function chosenGroup(ownerId: string, raw: string, fallback = true): string {
  if (raw === NONE_GROUP) return ''
  if (raw) {
    const exists = db.prepare('SELECT 1 FROM friend_groups WHERE id = ? AND owner_id = ?').get(raw, ownerId)
    if (exists) return raw
  }
  return fallback ? defaultGroupId(ownerId) : ''
}

/* ---------------- 好友列表 ---------------- */

friendsRouter.get('/friends', (_req, res) => {
  const { user } = authOf(res)
  const rows = db
    .prepare(
      `SELECT * FROM friendships
       WHERE status = 'accepted' AND (user_low = ? OR user_high = ?)
       ORDER BY updated_at DESC`,
    )
    .all(user.id, user.id) as unknown as FriendRow[]
  // 分组是我这边的一套视图，跟 friendships 的两端无关，单独查一次拼上
  const grouped = new Map(
    (
      db
        .prepare('SELECT friend_user_id, group_id FROM friend_group_members WHERE owner_id = ?')
        .all(user.id) as { friend_user_id: string; group_id: string }[]
    ).map((r) => [r.friend_user_id, r.group_id]),
  )
  res.json(
    rows.map((r) => {
      const other = otherOf(r, user.id)
      return {
        friendshipId: r.id,
        ...publicFriend(other),
        since: r.updated_at,
        groupId: grouped.get(other) ?? null,
      }
    }),
  )
})

/* ---------------- 好友分组 ---------------- */

interface FriendGroupRow {
  id: string
  owner_id: string
  name: string
  is_default: number
  sort: number
  created_at: number
}

function myGroups(ownerId: string): FriendGroupRow[] {
  return db
    .prepare('SELECT * FROM friend_groups WHERE owner_id = ? ORDER BY sort, created_at')
    .all(ownerId) as unknown as FriendGroupRow[]
}

function requireGroup(ownerId: string, id: string): FriendGroupRow {
  const row = db.prepare('SELECT * FROM friend_groups WHERE id = ? AND owner_id = ?').get(id, ownerId) as
    | FriendGroupRow
    | undefined
  if (!row) throw new HttpError(404, '分组不存在')
  return row
}

function groupCount(ownerId: string, groupId: string): number {
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM friend_group_members WHERE owner_id = ? AND group_id = ?')
    .get(ownerId, groupId) as { n: number }
  return r.n
}

/**
 * 新好友的默认落点：只有显式设为默认的组才算；取消默认后新加的人落未分组（空串）。
 * 不要退回「第一个组」——那会让「取消默认」形同虚设。
 */
function defaultGroupId(ownerId: string): string {
  const row = db
    .prepare('SELECT id FROM friend_groups WHERE owner_id = ? AND is_default = 1 LIMIT 1')
    .get(ownerId) as { id: string } | undefined
  return row?.id ?? ''
}

/** 删/迁走默认组后接任的第一个组；与「显式默认」分开，避免取消默认又被补一个回来 */
function firstGroupId(ownerId: string): string {
  const row = db
    .prepare('SELECT id FROM friend_groups WHERE owner_id = ? ORDER BY sort, created_at LIMIT 1')
    .get(ownerId) as { id: string } | undefined
  return row?.id ?? ''
}

/** 把好友放进分组；空串表示不分组 */
function assignGroup(ownerId: string, friendId: string, raw: unknown) {
  const groupId = typeof raw === 'string' && raw ? raw : ''
  if (groupId) requireGroup(ownerId, groupId)
  if (groupId) {
    db.prepare(
      'INSERT OR REPLACE INTO friend_group_members (owner_id, friend_user_id, group_id) VALUES (?, ?, ?)',
    ).run(ownerId, friendId, groupId)
  } else {
    db.prepare('DELETE FROM friend_group_members WHERE owner_id = ? AND friend_user_id = ?').run(
      ownerId,
      friendId,
    )
  }
  return groupId || null
}

/** 设为默认组：先清掉同 owner 的其他默认标记 */
function makeDefault(ownerId: string, groupId: string) {
  db.prepare('UPDATE friend_groups SET is_default = 0 WHERE owner_id = ?').run(ownerId)
  db.prepare('UPDATE friend_groups SET is_default = 1 WHERE id = ? AND owner_id = ?').run(groupId, ownerId)
}

friendsRouter.get('/friends/groups', (_req, res) => {
  const { user } = authOf(res)
  const counts = new Map(
    (
      db
        .prepare('SELECT group_id, COUNT(*) AS n FROM friend_group_members WHERE owner_id = ? GROUP BY group_id')
        .all(user.id) as { group_id: string; n: number }[]
    ).map((r) => [r.group_id, r.n]),
  )
  res.json(
    myGroups(user.id).map((g) => ({
      id: g.id,
      name: g.name,
      sort: g.sort,
      isDefault: !!g.is_default,
      count: counts.get(g.id) ?? 0,
    })),
  )
})

friendsRouter.post('/friends/groups', (req, res) => {
  const { user } = authOf(res)
  const name = str(req.body?.name, '分组名称', 20)
  if (!name) throw new HttpError(400, '请填写分组名称')
  if (db.prepare('SELECT 1 FROM friend_groups WHERE owner_id = ? AND name = ?').get(user.id, name)) {
    throw new HttpError(409, '已经有同名分组了')
  }
  // 「未分组」改名为正式分组时，把原来落单的人一起带过来
  const friendIds = Array.isArray(req.body?.friendIds)
    ? req.body.friendIds.filter((v: unknown): v is string => typeof v === 'string')
    : []
  for (const fid of friendIds) {
    const f = findPair(user.id, fid)
    if (!f || f.status !== 'accepted') throw new HttpError(400, '要移入的好友不存在')
  }
  const max = db
    .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM friend_groups WHERE owner_id = ?')
    .get(user.id) as { m: number }
  // 第一个分组自动成为默认组；此后再建组不抢默认
  const isDefault = myGroups(user.id).length ? 0 : 1
  const row: FriendGroupRow = {
    id: randomUUID(),
    owner_id: user.id,
    name,
    is_default: isDefault,
    sort: max.m + 1,
    created_at: Date.now(),
  }
  transaction(() => {
    db.prepare(
      'INSERT INTO friend_groups (id, owner_id, name, is_default, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.owner_id, row.name, row.is_default, row.sort, row.created_at)
    for (const fid of friendIds) assignGroup(user.id, fid, row.id)
  })
  res.status(201).json({
    id: row.id,
    name: row.name,
    sort: row.sort,
    isDefault: !!row.is_default,
    count: friendIds.length,
  })
})

friendsRouter.patch('/friends/groups/:id', (req, res) => {
  const { user } = authOf(res)
  const group = requireGroup(user.id, param(req, 'id'))
  const body = req.body ?? {}
  const hasName = body.name !== undefined
  const name = hasName ? str(body.name, '分组名称', 20) : group.name
  if (hasName && !name) throw new HttpError(400, '请填写分组名称')
  if (name !== group.name) {
    const dup = db
      .prepare('SELECT 1 FROM friend_groups WHERE owner_id = ? AND name = ? AND id != ?')
      .get(user.id, name, group.id)
    if (dup) throw new HttpError(409, '已经有同名分组了')
  }
  transaction(() => {
    if (hasName) db.prepare('UPDATE friend_groups SET name = ? WHERE id = ?').run(name, group.id)
    // 设为默认：清掉其他组的默认标记；取消默认就真的不设默认，新加好友落未分组
    if (body.isDefault === true) {
      makeDefault(user.id, group.id)
    } else if (body.isDefault === false && group.is_default) {
      db.prepare('UPDATE friend_groups SET is_default = 0 WHERE id = ?').run(group.id)
    }
  })
  res.json({ ok: true })
})

/**
 * 一键把整组人迁到另一个组。源组清空后可单独删除，避免「删组掉人」的误操作。
 */
friendsRouter.post('/friends/groups/:id/merge', (req, res) => {
  const { user } = authOf(res)
  const from = requireGroup(user.id, param(req, 'id'))
  const targetId = str(req.body?.targetGroupId, '目标分组', 60)
  if (!targetId) throw new HttpError(400, '请选择目标分组')
  if (targetId === from.id) throw new HttpError(400, '目标分组不能是原分组')
  // 目标是「未分组」时不校验分组存在：把成员记录删掉即等于移回未分组
  const toNone = targetId === NONE_GROUP
  const target = toNone ? null : requireGroup(user.id, targetId)
  const moved = groupCount(user.id, from.id)
  transaction(() => {
    if (toNone) {
      db.prepare('DELETE FROM friend_group_members WHERE owner_id = ? AND group_id = ?').run(
        user.id,
        from.id,
      )
    } else {
      db.prepare('UPDATE friend_group_members SET group_id = ? WHERE owner_id = ? AND group_id = ?').run(
        target!.id,
        user.id,
        from.id,
      )
    }
    db.prepare('DELETE FROM friend_groups WHERE id = ?').run(from.id)
    if (from.is_default) {
      if (toNone) {
        // 迁到未分组：剩下的组接任默认，但不额外制造默认（没有就落未分组）
        const next = firstGroupId(user.id)
        if (next) makeDefault(user.id, next)
      } else {
        makeDefault(user.id, target!.id)
      }
    }
  })
  res.json({ ok: true, moved, targetGroupId: target ? target.id : NONE_GROUP })
})

/** 只允许删空组：有人的组必须先迁走，避免好友悄悄回落到「未分组」 */
friendsRouter.delete('/friends/groups/:id', (req, res) => {
  const { user } = authOf(res)
  const group = requireGroup(user.id, param(req, 'id'))
  const n = groupCount(user.id, group.id)
  if (n) throw new HttpError(409, `「${group.name}」里还有 ${n} 位好友，请先把他们移到其他分组`)
  transaction(() => {
    db.prepare('DELETE FROM friend_groups WHERE id = ?').run(group.id)
    if (group.is_default) {
      const next = firstGroupId(user.id)
      if (next) makeDefault(user.id, next)
    }
  })
  res.json({ ok: true })
})

/** 把某个好友挪到分组；`groupId` 传 null / 空串表示移回未分组 */
friendsRouter.put('/friends/:id/group', (req, res) => {
  const { user } = authOf(res)
  const friendId = param(req, 'id')
  const row = findPair(user.id, friendId)
  if (!row || row.status !== 'accepted') throw new HttpError(404, '好友关系不存在')
  const groupId = assignGroup(user.id, friendId, req.body?.groupId)
  res.json({ ok: true, groupId })
})

/* ---------------- 搜索用户 ---------------- */

friendsRouter.get('/friends/search', (req, res) => {
  const { user } = authOf(res)
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : ''
  if (q.length < 1) {
    res.json([])
    return
  }
  const like = `%${q.replace(/[%_]/g, '')}%`
  const rows = db
    .prepare(
      `SELECT id, username, nickname, avatar FROM users
       WHERE id != ? AND (username LIKE ? OR COALESCE(nickname, '') LIKE ?)
       ORDER BY username LIMIT 10`,
    )
    .all(user.id, like, like) as { id: string; username: string; nickname: string | null; avatar: string | null }[]
  res.json(
    rows.map((u) => ({
      ...publicFriend(u.id),
      relation: findPair(user.id, u.id)?.status ?? null,
    })),
  )
})

/* ---------------- 申请 ---------------- */

friendsRouter.get('/friends/requests', (_req, res) => {
  const { user } = authOf(res)
  const rows = db
    .prepare(
      `SELECT * FROM friendships
       WHERE status = 'pending' AND (user_low = ? OR user_high = ?) AND requested_by != ?
       ORDER BY created_at DESC`,
    )
    .all(user.id, user.id, user.id) as unknown as FriendRow[]
  res.json(
    rows.map((r) => ({
      id: r.id,
      from: publicFriend(otherOf(r, user.id)),
      message: r.message,
      createdAt: r.created_at,
      outgoing: false,
    })),
  )
})

friendsRouter.get('/friends/requests/sent', (_req, res) => {
  const { user } = authOf(res)
  const rows = db
    .prepare(
      `SELECT * FROM friendships
       WHERE status = 'pending' AND requested_by = ? AND (user_low = ? OR user_high = ?)
       ORDER BY created_at DESC`,
    )
    .all(user.id, user.id, user.id) as unknown as FriendRow[]
  res.json(
    rows.map((r) => ({
      id: r.id,
      to: publicFriend(otherOf(r, user.id)),
      message: r.message,
      createdAt: r.created_at,
      outgoing: true,
    })),
  )
})

friendsRouter.post('/friends/requests', (req, res) => {
  const { user } = authOf(res)
  const username = str(req.body?.username, '用户名', 120)
  const message = req.body?.message ? str(req.body.message, '验证消息', 200) : null
  // 申请里记下「我希望对方进哪个分组」，同意时两边各自落组
  const body = req.body ?? {}
  const explicit = Object.prototype.hasOwnProperty.call(body, 'groupId')
  const rawGroup = typeof body.groupId === 'string' ? body.groupId : ''
  const wantGroup = explicit ? rawGroup || NONE_GROUP : ''
  if (wantGroup && wantGroup !== NONE_GROUP) requireGroup(user.id, wantGroup)
  const target = findUserByName(username)
  if (!target) throw new HttpError(404, '找不到该用户')
  if (target.id === user.id) throw new HttpError(400, '不能添加自己为好友')

  const existing = findPair(user.id, target.id)
  if (existing) {
    if (existing.status === 'accepted') throw new HttpError(409, '你们已经是好友')
    if (existing.status === 'blocked') {
      if (existing.requested_by === target.id) throw new HttpError(403, '对方已拒绝与你建立联系')
      throw new HttpError(409, '已拉黑该用户，请先解除拉黑')
    }
    if (existing.status === 'pending') {
      if (existing.requested_by === user.id) throw new HttpError(409, '已发送过申请，请等待对方处理')
      // 对方先申请过：互相申请直接成为好友
      const now = Date.now()
      transaction(() => {
        db.prepare(
          "UPDATE friendships SET status = 'accepted', requester_group_id = ?, updated_at = ? WHERE id = ?",
        ).run(wantGroup, now, existing.id)
        assignGroup(user.id, target.id, chosenGroup(user.id, wantGroup))
        assignGroup(target.id, user.id, chosenGroup(target.id, ''))
      })
      notify(target.id, 'friend', `${user.nickname || user.username} 通过了你的好友申请`, null, '/friends')
      res.json({ id: existing.id, status: 'accepted', friend: publicFriend(target.id) })
      return
    }
    if (existing.status === 'rejected' && existing.updated_at > Date.now() - REQUEST_COOLDOWN) {
      throw new HttpError(429, '对方刚拒绝过，请 7 天后再试')
    }
    const now = Date.now()
    db.prepare(
      "UPDATE friendships SET status = 'pending', requested_by = ?, message = ?, requester_group_id = ?, updated_at = ? WHERE id = ?",
    ).run(user.id, message, wantGroup, now, existing.id)
    notify(target.id, 'friend', `${user.nickname || user.username} 请求添加你为好友`, message, '/friends')
    res.json({ id: existing.id, status: 'pending', friend: publicFriend(target.id) })
    return
  }

  const [low, high] = pair(user.id, target.id)
  const now = Date.now()
  const row: FriendRow = {
    id: randomUUID(),
    user_low: low,
    user_high: high,
    status: 'pending',
    requested_by: user.id,
    message,
    requester_group_id: wantGroup,
    created_at: now,
    updated_at: now,
  }
  db.prepare(
    `INSERT INTO friendships (id, user_low, user_high, status, requested_by, message, requester_group_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.user_low,
    row.user_high,
    row.status,
    row.requested_by,
    row.message,
    row.requester_group_id,
    row.created_at,
    row.updated_at,
  )
  notify(target.id, 'friend', `${user.nickname || user.username} 请求添加你为好友`, message, '/friends')
  res.status(201).json({ id: row.id, status: 'pending', friend: publicFriend(target.id) })
})

function actionableRequest(id: string, userId: string): FriendRow {
  const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id) as FriendRow | undefined
  if (!row || row.status !== 'pending') throw new HttpError(404, '申请不存在或已处理')
  if (row.requested_by === userId) throw new HttpError(400, '不能处理自己发出的申请')
  if (row.user_low !== userId && row.user_high !== userId) throw new HttpError(404, '申请不存在')
  return row
}

friendsRouter.post('/friends/requests/:id/accept', (req, res) => {
  const { user } = authOf(res)
  const row = actionableRequest(param(req, 'id'), user.id)
  const now = Date.now()
  const body = req.body ?? {}
  const explicit = Object.prototype.hasOwnProperty.call(body, 'groupId')
  // 同意人这边没选就按自己的默认组来，不继承申请人的选择（两边的分组互不相干）
  const raw = explicit
    ? typeof body.groupId === 'string' && body.groupId
      ? body.groupId
      : NONE_GROUP
    : ''
  // 同意时顺带新建分组：整段放进同一个事务里 —— 同意成功才建组，
  // 校验失败 / 事务回滚时组也不会被留下（避免「建了组却没同意」的空组）。
  const newGroupName = typeof body.newGroupName === 'string' ? body.newGroupName.trim() : ''
  if (newGroupName && newGroupName.length > 20) throw new HttpError(400, '分组名称最多 20 个字')
  if (newGroupName && db.prepare('SELECT 1 FROM friend_groups WHERE owner_id = ? AND name = ?').get(user.id, newGroupName)) {
    throw new HttpError(409, '已经有同名分组了')
  }
  // 同意时自己也选一次分组；没选就用默认组，申请人那边用它申请时选的分组
  let mine = chosenGroup(user.id, raw, true)
  const theirs = chosenGroup(row.requested_by, row.requester_group_id, true)
  transaction(() => {
    if (newGroupName) {
      const max = db
        .prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM friend_groups WHERE owner_id = ?')
        .get(user.id) as { m: number }
      const isDefault = myGroups(user.id).length ? 0 : 1
      const groupId = randomUUID()
      db.prepare(
        'INSERT INTO friend_groups (id, owner_id, name, is_default, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(groupId, user.id, newGroupName, isDefault, max.m + 1, now)
      mine = groupId
    }
    db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, row.id)
    assignGroup(user.id, row.requested_by, mine)
    assignGroup(row.requested_by, user.id, theirs)
  })
  notify(
    row.requested_by,
    'friend',
    `${user.nickname || user.username} 通过了你的好友申请`,
    null,
    '/friends',
  )
  res.json({ ok: true })
})

friendsRouter.post('/friends/requests/:id/decline', (req, res) => {
  const { user } = authOf(res)
  const row = actionableRequest(param(req, 'id'), user.id)
  db.prepare("UPDATE friendships SET status = 'rejected', updated_at = ? WHERE id = ?").run(Date.now(), row.id)
  res.json({ ok: true })
})

/* ---------------- 解除 / 拉黑 ---------------- */

friendsRouter.delete('/friends/:id', (req, res) => {
  const { user } = authOf(res)
  const row = findPair(user.id, param(req, 'id'))
  if (row && row.status === 'accepted') {
    db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id)
    // 我这边的分组记录一起清掉，免得以后重新加好友时莫名回到旧分组
    db.prepare('DELETE FROM friend_group_members WHERE owner_id = ? AND friend_user_id = ?').run(
      user.id,
      otherOf(row, user.id),
    )
    notify(otherOf(row, user.id), 'friend', `${user.nickname || user.username} 解除了好友关系`, null, '/friends')
  }
  res.json({ ok: true })
})

friendsRouter.post('/friends/:id/block', (req, res) => {
  const { user } = authOf(res)
  const targetId = param(req, 'id')
  if (targetId === user.id) throw new HttpError(400, '不能拉黑自己')
  if (!findUserById(targetId)) throw new HttpError(404, '用户不存在')
  const now = Date.now()
  db.prepare('DELETE FROM friend_group_members WHERE owner_id = ? AND friend_user_id = ?').run(user.id, targetId)
  const existing = findPair(user.id, targetId)
  if (existing) {
    db.prepare("UPDATE friendships SET status = 'blocked', requested_by = ?, updated_at = ? WHERE id = ?").run(
      user.id,
      now,
      existing.id,
    )
    res.json({ ok: true })
    return
  }
  const [low, high] = pair(user.id, targetId)
  db.prepare(
    `INSERT INTO friendships (id, user_low, user_high, status, requested_by, message, created_at, updated_at)
     VALUES (?, ?, ?, 'blocked', ?, NULL, ?, ?)`,
  ).run(randomUUID(), low, high, user.id, now, now)
  res.json({ ok: true })
})