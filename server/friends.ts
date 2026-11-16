import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { authOf, findUserById, findUserByName } from './auth.ts'
import { db } from './db.ts'
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
  res.json(
    rows.map((r) => ({
      friendshipId: r.id,
      ...publicFriend(otherOf(r, user.id)),
      since: r.updated_at,
    })),
  )
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
      db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, existing.id)
      notify(target.id, 'friend', `${user.nickname || user.username} 通过了你的好友申请`, null, '/friends')
      res.json({ id: existing.id, status: 'accepted', friend: publicFriend(target.id) })
      return
    }
    if (existing.status === 'rejected' && existing.updated_at > Date.now() - REQUEST_COOLDOWN) {
      throw new HttpError(429, '对方刚拒绝过，请 7 天后再试')
    }
    const now = Date.now()
    db.prepare(
      "UPDATE friendships SET status = 'pending', requested_by = ?, message = ?, updated_at = ? WHERE id = ?",
    ).run(user.id, message, now, existing.id)
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
    created_at: now,
    updated_at: now,
  }
  db.prepare(
    `INSERT INTO friendships (id, user_low, user_high, status, requested_by, message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.user_low, row.user_high, row.status, row.requested_by, row.message, row.created_at, row.updated_at)
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
  db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, row.id)
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