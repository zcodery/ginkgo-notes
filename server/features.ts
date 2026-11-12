import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { authOf, findUserById, requireAdmin, requireSession } from './auth.ts'
import { db, getUserSetting, setUserSetting } from './db.ts'
import { HttpError, param, str } from './http.ts'
import { notify, type NotificationRow } from './notify.ts'
import { mailEnabled } from './mailer.ts'
import { aiRouter } from './ai.ts'
import { mcpRouter } from './mcp.ts'
import { membersRouter } from './members.ts'
import { shareRouter, sharePublicRouter } from './share.ts'
import { oauthPublicRouter } from './account.ts'
import {
  WEBHOOK_EVENTS,
  createWebhook,
  deliverAndRecord,
  newWebhookSecret,
  type WebhookEvent,
  type WebhookRow,
} from './webhooks.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const APP_VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

/* ================= 无需登录 ================= */

export const publicRouter = Router()

publicRouter.get('/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ version: APP_VERSION, mail: mailEnabled() })
})

publicRouter.use(sharePublicRouter)
publicRouter.use(oauthPublicRouter)

/* ================= 需要登录 ================= */

export const featuresRouter = Router()

featuresRouter.use(shareRouter)
featuresRouter.use(mcpRouter)
featuresRouter.use(aiRouter)
featuresRouter.use(membersRouter)

/* ---------------- 消息通知 ---------------- */

featuresRouter.get('/notifications', (req, res) => {
  const { user } = authOf(res)
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200)
  const items = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(user.id, limit) as unknown as NotificationRow[]
  const unread = (
    db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id) as {
      n: number
    }
  ).n
  res.json({
    unread,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.created_at,
      read: !!n.read_at,
    })),
  })
})

featuresRouter.post('/notifications/read', (req, res) => {
  const { user } = authOf(res)
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((v) => typeof v === 'string') : null
  const now = Date.now()
  if (ids?.length) {
    const stmt = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
    for (const id of ids) stmt.run(now, id as string, user.id)
  } else {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, user.id)
  }
  res.json({ ok: true })
})

featuresRouter.delete('/notifications/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(param(req, 'id'), authOf(res).user.id)
  res.json({ ok: true })
})

featuresRouter.delete('/notifications', (_req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(authOf(res).user.id)
  res.json({ ok: true })
})

/* ---------------- 用户设置：空间信息 / 通知偏好 ---------------- */

const SETTING_KEYS = new Set(['space', 'notify', 'shortcuts'])

featuresRouter.get('/settings/:key', (req, res) => {
  const key = String(req.params.key)
  if (!SETTING_KEYS.has(key)) throw new HttpError(404, '设置项不存在')
  res.json(getUserSetting(authOf(res).user.id, key, null))
})

featuresRouter.put('/settings/:key', requireSession, (req, res) => {
  const key = String(req.params.key)
  if (!SETTING_KEYS.has(key)) throw new HttpError(404, '设置项不存在')
  const value = req.body
  if (JSON.stringify(value ?? null).length > 20_000) throw new HttpError(400, '设置内容过大')
  setUserSetting(authOf(res).user.id, key, value ?? null)
  res.json({ ok: true })
})

/* ---------------- 存储用量 ---------------- */

featuresRouter.get('/storage', (_req, res) => {
  const { owner } = authOf(res)
  const sum = (sql: string) => db.prepare(sql).get(owner) as { n: number; bytes: number | null }
  const assets = sum('SELECT COUNT(*) AS n, SUM(size) AS bytes FROM assets WHERE owner = ?')
  const pages = sum('SELECT COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM pages WHERE owner = ?')
  const dbs = sum('SELECT COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM databases WHERE owner = ?')
  const rows = sum('SELECT COUNT(*) AS n, SUM(LENGTH(data)) AS bytes FROM db_rows WHERE owner = ?')
  const largest = db
    .prepare('SELECT id, name, size, created_at FROM assets WHERE owner = ? ORDER BY size DESC LIMIT 5')
    .all(owner) as { id: string; name: string; size: number; created_at: number }[]
  const out = {
    assets: { count: assets.n, bytes: assets.bytes ?? 0 },
    pages: { count: pages.n, bytes: pages.bytes ?? 0 },
    databases: { count: dbs.n, rows: rows.n, bytes: (dbs.bytes ?? 0) + (rows.bytes ?? 0) },
    largest: largest.map((a) => ({ id: a.id, name: a.name, size: a.size, createdAt: a.created_at })),
  }
  res.json({ ...out, total: out.assets.bytes + out.pages.bytes + out.databases.bytes })
})

/* ---------------- Webhook ---------------- */

function publicHook(h: WebhookRow) {
  return {
    id: h.id,
    url: h.url,
    events: h.events.split(',').filter(Boolean),
    secret: h.secret,
    enabled: !!h.enabled,
    createdAt: h.created_at,
    lastStatus: h.last_status,
    lastError: h.last_error,
    lastAt: h.last_at,
  }
}

function asEvents(v: unknown): WebhookEvent[] {
  const list = Array.isArray(v) ? v.filter((e): e is WebhookEvent => WEBHOOK_EVENTS.includes(e)) : []
  if (!list.length) throw new HttpError(400, '至少选择一个事件')
  return list
}

function asHookUrl(v: unknown): string {
  const url = str(v, '地址', 500)
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new HttpError(400, '地址需以 http:// 或 https:// 开头')
  return url
}

function ownHook(id: string, userId: string): WebhookRow {
  const h = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId) as WebhookRow | undefined
  if (!h) throw new HttpError(404, 'Webhook 不存在')
  return h
}

featuresRouter.get('/webhooks', requireSession, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC')
    .all(authOf(res).user.id) as unknown as WebhookRow[]
  res.json({ events: WEBHOOK_EVENTS, items: rows.map(publicHook) })
})

featuresRouter.post('/webhooks', requireSession, (req, res) => {
  const { user } = authOf(res)
  const count = (db.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE user_id = ?').get(user.id) as { n: number }).n
  if (count >= 20) throw new HttpError(400, 'Webhook 数量已达上限（20 个）')
  res.status(201).json(publicHook(createWebhook(user.id, asHookUrl(req.body?.url), asEvents(req.body?.events))))
})

featuresRouter.patch('/webhooks/:id', requireSession, (req, res) => {
  const h = ownHook(param(req, 'id'), authOf(res).user.id)
  if (req.body?.url !== undefined) h.url = asHookUrl(req.body.url)
  if (req.body?.events !== undefined) h.events = asEvents(req.body.events).join(',')
  if (typeof req.body?.enabled === 'boolean') h.enabled = req.body.enabled ? 1 : 0
  if (req.body?.rotateSecret === true) h.secret = newWebhookSecret()
  db.prepare('UPDATE webhooks SET url = ?, events = ?, enabled = ?, secret = ? WHERE id = ?').run(
    h.url,
    h.events,
    h.enabled,
    h.secret,
    h.id,
  )
  res.json(publicHook(h))
})

featuresRouter.delete('/webhooks/:id', requireSession, (req, res) => {
  db.prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(param(req, 'id'), authOf(res).user.id)
  res.json({ ok: true })
})

featuresRouter.post('/webhooks/:id/test', requireSession, async (req, res) => {
  const h = ownHook(param(req, 'id'), authOf(res).user.id)
  await deliverAndRecord(h, 'ping', { message: '这是一条来自银杏笔记的测试事件' })
  res.json(publicHook(ownHook(h.id, h.user_id)))
})

/* ---------------- 意见反馈 ---------------- */

interface FeedbackRow {
  id: string
  user_id: string
  content: string
  contact: string | null
  created_at: number
  reply: string | null
  replied_at: number | null
}

function publicFeedback(f: FeedbackRow) {
  const u = findUserById(f.user_id)
  return {
    id: f.id,
    content: f.content,
    contact: f.contact,
    createdAt: f.created_at,
    reply: f.reply,
    repliedAt: f.replied_at,
    user: u ? { id: u.id, username: u.username, name: u.nickname || u.username } : null,
  }
}

featuresRouter.get('/feedback', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC')
    .all(authOf(res).user.id) as unknown as FeedbackRow[]
  res.json(rows.map(publicFeedback))
})

featuresRouter.post('/feedback', (req, res) => {
  const { user } = authOf(res)
  const content = str(req.body?.content, '反馈内容', 4000)
  if (content.length < 4) throw new HttpError(400, '请多写几个字描述一下问题')
  const contact = req.body?.contact ? str(req.body.contact, '联系方式', 120) : null
  const row: FeedbackRow = {
    id: randomUUID(),
    user_id: user.id,
    content,
    contact,
    created_at: Date.now(),
    reply: null,
    replied_at: null,
  }
  db.prepare('INSERT INTO feedback (id, user_id, content, contact, created_at) VALUES (?, ?, ?, ?, ?)').run(
    row.id,
    user.id,
    content,
    contact,
    row.created_at,
  )
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all() as { id: string }[]
  for (const a of admins) {
    if (a.id !== user.id) notify(a.id, 'feedback', `收到 ${user.nickname || user.username} 的意见反馈`, content.slice(0, 200))
  }
  res.status(201).json(publicFeedback(row))
})

featuresRouter.get('/admin/feedback', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200').all() as unknown as FeedbackRow[]
  res.json(rows.map(publicFeedback))
})

featuresRouter.post('/admin/feedback/:id/reply', requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM feedback WHERE id = ?').get(param(req, 'id')) as FeedbackRow | undefined
  if (!f) throw new HttpError(404, '反馈不存在')
  const reply = str(req.body?.reply, '回复', 4000)
  if (!reply) throw new HttpError(400, '回复不能为空')
  const now = Date.now()
  db.prepare('UPDATE feedback SET reply = ?, replied_at = ? WHERE id = ?').run(reply, now, f.id)
  notify(f.user_id, 'feedback', '你的意见反馈收到了回复', reply.slice(0, 500))
  res.json(publicFeedback({ ...f, reply, replied_at: now }))
})
