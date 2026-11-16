import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import type { Response } from 'express'
import { authOf, type AuthLocals } from './auth.ts'
import { assertAccess } from './acl.ts'
import { db, getDoc, type Doc } from './db.ts'
import { HttpError, param } from './http.ts'

/**
 * 文档在线状态与编辑占用。
 *
 * - SSE 下行：连接建立后推送全量在线快照
 * - HTTP 心跳上行：前端每 25s 上报一次，60s 未上报视为离线
 * - 编辑占用：同一文档同一时刻只允许一个写入者，锁 60s 自动过期
 */

interface PresenceEntry {
  connId: string
  userId: string
  name: string
  avatar: string | null
  editing: boolean
  lastSeen: number
}

interface Room {
  entries: Map<string, PresenceEntry>
  clients: Set<Response>
}

const rooms = new Map<string, Room>()
const TTL = 60_000

function roomKey(spaceId: string, pageId: string): string {
  return `${spaceId}:${pageId}`
}

function getRoom(key: string): Room {
  let room = rooms.get(key)
  if (!room) {
    room = { entries: new Map(), clients: new Set() }
    rooms.set(key, room)
  }
  return room
}

function prune(room: Room): void {
  const now = Date.now()
  for (const [connId, e] of room.entries) {
    if (e.lastSeen < now - TTL) room.entries.delete(connId)
  }
}

function publicUserEntry(e: PresenceEntry) {
  return { userId: e.userId, name: e.name, avatar: e.avatar, editing: e.editing }
}

/** 同一用户多窗口合并成一个头像，tabs 表示窗口数 */
function snapshot(room: Room, spaceId: string, pageId: string) {
  prune(room)
  const byUser = new Map<string, { userId: string; name: string; avatar: string | null; editing: boolean; tabs: number }>()
  for (const e of room.entries.values()) {
    const cur = byUser.get(e.userId)
    if (cur) {
      cur.tabs++
      cur.editing ||= e.editing
    } else {
      byUser.set(e.userId, {
        userId: e.userId,
        name: e.name,
        avatar: e.avatar,
        editing: e.editing,
        tabs: 1,
      })
    }
  }
  const lock = db.prepare('SELECT user_id, expires_at FROM doc_locks WHERE page_id = ? AND space_id = ?').get(
    pageId,
    spaceId,
  ) as { user_id: string; expires_at: number } | undefined
  const live = lock && lock.expires_at > Date.now() ? lock : null
  return {
    users: [...byUser.values()],
    editor: live ? live.user_id : null,
    total: byUser.size,
    updatedAt: Date.now(),
  }
}

function broadcast(room: Room, spaceId: string, pageId: string): void {
  const payload = `event: presence\ndata: ${JSON.stringify(snapshot(room, spaceId, pageId))}\n\n`
  for (const client of room.clients) {
    try {
      client.write(payload)
    } catch {
      room.clients.delete(client)
    }
  }
}

function requirePage(auth: AuthLocals, pageId: string): Doc {
  const page = getDoc<Doc>('pages', pageId, auth.spaceId)
  if (!page) throw new HttpError(404, '页面不存在')
  assertAccess(auth, 'page', pageId, 'read')
  return page
}

export const presenceRouter = Router()

presenceRouter.get('/presence/page/:id', (req, res) => {
  const auth = authOf(res)
  const pageId = param(req, 'id')
  requirePage(auth, pageId)
  res.setHeader('Cache-Control', 'no-store')
  res.json(snapshot(getRoom(roomKey(auth.spaceId, pageId)), auth.spaceId, pageId))
})

presenceRouter.post('/presence/page/:id/heartbeat', (req, res) => {
  const auth = authOf(res)
  const pageId = param(req, 'id')
  requirePage(auth, pageId)
  const key = roomKey(auth.spaceId, pageId)
  const room = getRoom(key)
  const connId = typeof req.body?.connId === 'string' ? req.body.connId.slice(0, 64) : ''
  if (!connId) throw new HttpError(400, '缺少连接标识')

  const existing = room.entries.get(connId)
  if (existing && existing.userId !== auth.user.id) throw new HttpError(403, '连接标识已被占用')
  room.entries.set(connId, {
    connId,
    userId: auth.user.id,
    name: auth.user.nickname || auth.user.username,
    avatar: auth.user.avatar,
    editing: req.body?.editing === true,
    lastSeen: Date.now(),
  })

  // 持锁者持续心跳时顺带续租
  if (req.body?.editing === true) {
    const lock = db.prepare('SELECT * FROM doc_locks WHERE page_id = ?').get(pageId) as
      | { user_id: string }
      | undefined
    if (!lock || lock.user_id === auth.user.id) {
      db.prepare(
        `INSERT INTO doc_locks (page_id, space_id, user_id, session_id, expires_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(page_id) DO UPDATE SET expires_at = excluded.expires_at`,
      ).run(pageId, auth.spaceId, auth.user.id, auth.sid ?? connId, Date.now() + TTL)
    }
  }

  broadcast(room, auth.spaceId, pageId)
  res.json(snapshot(room, auth.spaceId, pageId))
})

presenceRouter.get('/presence/page/:id/stream', (req, res) => {
  const auth = authOf(res)
  const pageId = param(req, 'id')
  requirePage(auth, pageId)
  const key = roomKey(auth.spaceId, pageId)
  const room = getRoom(key)
  const connId = randomUUID()

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  room.clients.add(res)
  room.entries.set(connId, {
    connId,
    userId: auth.user.id,
    name: auth.user.nickname || auth.user.username,
    avatar: auth.user.avatar,
    editing: false,
    lastSeen: Date.now(),
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ connId })}\n\n`)
  broadcast(room, auth.spaceId, pageId)

  // SSE 连接本身不携带心跳，但保留条目直到关闭，避免窗口未上报时立刻消失
  const keep = setInterval(() => {
    const entry = room.entries.get(connId)
    if (entry) entry.lastSeen = Date.now()
    try {
      res.write(': ping\n\n')
    } catch {
      /* 连接已断开 */
    }
  }, 25_000)
  keep.unref?.()

  req.on('close', () => {
    clearInterval(keep)
    room.clients.delete(res)
    room.entries.delete(connId)
    broadcast(room, auth.spaceId, pageId)
    if (!room.clients.size && !room.entries.size) rooms.delete(key)
  })
})

presenceRouter.post('/presence/page/:id/claim-edit', (req, res) => {
  const auth = authOf(res)
  const pageId = param(req, 'id')
  requirePage(auth, pageId)
  assertAccess(auth, 'page', pageId, 'write')

  const now = Date.now()
  const lock = db.prepare('SELECT * FROM doc_locks WHERE page_id = ?').get(pageId) as
    | { user_id: string; expires_at: number }
    | undefined
  if (lock && lock.expires_at > now && lock.user_id !== auth.user.id) {
    const holder = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(lock.user_id) as
      | { username: string; nickname: string | null }
      | undefined
    res.status(409).json({
      error: '对方正在编辑这篇文档',
      code: 'edit_locked',
      holder: { id: lock.user_id, name: holder ? holder.nickname || holder.username : '其他成员' },
    })
    return
  }
  db.prepare(
    `INSERT INTO doc_locks (page_id, space_id, user_id, session_id, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(page_id) DO UPDATE SET user_id = excluded.user_id, session_id = excluded.session_id, expires_at = excluded.expires_at`,
  ).run(pageId, auth.spaceId, auth.user.id, auth.sid ?? '', now + TTL)

  const room = getRoom(roomKey(auth.spaceId, pageId))
  for (const e of room.entries.values()) {
    e.editing = e.userId === auth.user.id
  }
  broadcast(room, auth.spaceId, pageId)
  res.json({ ok: true, expiresAt: now + TTL })
})

presenceRouter.delete('/presence/page/:id/claim-edit', (req, res) => {
  const auth = authOf(res)
  const pageId = param(req, 'id')
  db.prepare('DELETE FROM doc_locks WHERE page_id = ? AND user_id = ?').run(pageId, auth.user.id)
  const room = rooms.get(roomKey(auth.spaceId, pageId))
  if (room) {
    for (const e of room.entries.values()) e.editing = false
    broadcast(room, auth.spaceId, pageId)
  }
  res.json({ ok: true })
})

/* 定期清理过期占用，防止异常断开后永久锁死 */
const cleanup = setInterval(() => {
  db.prepare('DELETE FROM doc_locks WHERE expires_at < ?').run(Date.now())
}, 30_000)
cleanup.unref?.()