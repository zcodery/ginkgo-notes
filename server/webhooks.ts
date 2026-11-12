import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { PUBLIC_OWNER, db, type Doc } from './db.ts'
import { notify } from './notify.ts'

export const WEBHOOK_EVENTS = [
  'page.created',
  'page.updated',
  'page.trashed',
  'page.restored',
  'page.deleted',
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export interface WebhookRow {
  id: string
  user_id: string
  url: string
  events: string
  secret: string
  enabled: number
  created_at: number
  last_status: number | null
  last_error: string | null
  last_at: number | null
}

export function newWebhookSecret(): string {
  return 'whsec_' + randomBytes(18).toString('base64url')
}

export function createWebhook(userId: string, url: string, events: WebhookEvent[]): WebhookRow {
  const row: WebhookRow = {
    id: randomUUID(),
    user_id: userId,
    url,
    events: events.join(','),
    secret: newWebhookSecret(),
    enabled: 1,
    created_at: Date.now(),
    last_status: null,
    last_error: null,
    last_at: null,
  }
  db.prepare(
    'INSERT INTO webhooks (id, user_id, url, events, secret, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, userId, url, row.events, row.secret, 1, row.created_at)
  return row
}

function pageSummary(page: Doc) {
  return {
    id: page.id,
    title: page.title ?? '',
    icon: page.icon ?? '',
    parentId: page.parentId ?? null,
    updatedAt: page.updatedAt ?? Date.now(),
    trashed: !!page.trashed,
  }
}

/** 投递一次，返回 HTTP 状态码；失败时抛错 */
export async function deliver(hook: WebhookRow, event: string, data: unknown): Promise<number> {
  const body = JSON.stringify({ id: randomUUID(), event, createdAt: new Date().toISOString(), data })
  const signature = createHmac('sha256', hook.secret).update(body).digest('hex')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GinkgoNotes-Webhook/1.0',
        'X-Ginkgo-Event': event,
        'X-Ginkgo-Signature': `sha256=${signature}`,
      },
      body,
      signal: ctrl.signal,
    })
    return res.status
  } finally {
    clearTimeout(timer)
  }
}

function record(hook: WebhookRow, status: number | null, error: string | null) {
  db.prepare('UPDATE webhooks SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?').run(
    status,
    error,
    Date.now(),
    hook.id,
  )
  // 由成功变为失败时提醒一次
  if (error && hook.last_error == null) {
    notify(hook.user_id, 'webhook', 'Webhook 投递失败', `${hook.url}\n${error}`)
  }
}

export async function deliverAndRecord(hook: WebhookRow, event: string, data: unknown): Promise<void> {
  try {
    const status = await deliver(hook, event, data)
    record(hook, status, status >= 200 && status < 300 ? null : `HTTP ${status}`)
  } catch (err) {
    record(hook, null, err instanceof Error ? err.message : String(err))
  }
}

/**
 * 页面频繁自动保存，同一页面的 updated 事件 5 秒内只投递最后一次；
 * 其它事件立即投递。
 */
const pending = new Map<string, { timer: NodeJS.Timeout; page: Doc }>()

export function emitPageEvent(owner: string, event: WebhookEvent, page: Doc): void {
  if (owner === PUBLIC_OWNER) return
  const hooks = db
    .prepare('SELECT * FROM webhooks WHERE user_id = ? AND enabled = 1')
    .all(owner) as unknown as WebhookRow[]
  const targets = hooks.filter((h) => h.events.split(',').includes(event))
  if (!targets.length) return

  const fire = (p: Doc) => {
    for (const h of targets) void deliverAndRecord(h, event, { page: pageSummary(p) })
  }
  if (event !== 'page.updated') {
    fire(page)
    return
  }
  const key = `${owner}:${page.id}`
  const prev = pending.get(key)
  if (prev) clearTimeout(prev.timer)
  const timer = setTimeout(() => {
    pending.delete(key)
    fire(page)
  }, 5000)
  pending.set(key, { timer, page })
}

/** 写页面前后对比，推断事件类型 */
export function pageEventOf(before: Doc | null, after: Doc): WebhookEvent {
  if (!before) return 'page.created'
  if (!before.trashed && after.trashed) return 'page.trashed'
  if (before.trashed && !after.trashed) return 'page.restored'
  return 'page.updated'
}
