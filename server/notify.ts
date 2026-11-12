import { randomUUID } from 'node:crypto'
import { PUBLIC_OWNER, db, getUserSetting } from './db.ts'
import { mailEnabled, sendMail } from './mailer.ts'

export type NotificationType =
  | 'security'
  | 'share'
  | 'member'
  | 'feedback'
  | 'webhook'
  | 'system'

export interface NotificationRow {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  created_at: number
  read_at: number | null
}

/** 站内通知；公共空间不是真实用户，直接忽略 */
export function notify(
  userId: string,
  type: NotificationType,
  title: string,
  body: string | null = null,
  link: string | null = null,
): void {
  if (!userId || userId === PUBLIC_OWNER) return
  const prefs = getUserSetting<{ types?: Record<string, boolean>; email?: boolean } | null>(userId, 'notify', null)
  // 安全类通知不可关闭，其它类型按用户偏好过滤
  if (type !== 'security' && prefs?.types?.[type] === false) return
  if (prefs?.email && mailEnabled()) {
    const to = (db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string | null } | undefined)?.email
    if (to) {
      void sendMail(to, title, `${title}\n\n${body ?? ''}${link ? `\n\n${link}` : ''}`).catch((err) =>
        console.warn('[ginkgo] 通知邮件发送失败：', err instanceof Error ? err.message : err),
      )
    }
  }
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(randomUUID(), userId, type, title.slice(0, 200), body?.slice(0, 1000) ?? null, link, Date.now())
  // 每人最多保留 500 条
  db.prepare(
    `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
     (SELECT id FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 500)`,
  ).run(userId, userId)
}

/** 把 UA 粗略识别成「Chrome · Windows」这种可读的设备名 */
export function describeUa(ua: string | null | undefined): string {
  if (!ua) return '未知设备'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Cursor\//.test(ua)
      ? 'Cursor'
      : /Electron\//.test(ua)
        ? 'Electron'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /curl\//i.test(ua)
                ? 'curl'
                : '浏览器'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '未知系统'
  return `${browser} · ${os}`
}
