import { api, getToken } from './client'

/* ---------------- 账号安全 ---------------- */

export interface SessionInfo {
  id: string
  device: string
  ip: string | null
  createdAt: number
  lastSeen: number
  current: boolean
}

export const listSessions = () => api<SessionInfo[]>('GET', '/auth/sessions')
export const revokeSession = (id: string) => api('DELETE', `/auth/sessions/${id}`)
export const revokeOtherSessions = () => api('POST', '/auth/sessions/revoke-others')

export const setupTwoFactor = () => api<{ secret: string; uri: string }>('POST', '/auth/2fa/setup')
export const enableTwoFactor = (code: string) => api<{ user: unknown }>('POST', '/auth/2fa/enable', { code })
export const disableTwoFactor = (password: string) => api<{ user: unknown }>('POST', '/auth/2fa/disable', { password })

export const setPin = (pin: string, password: string) => api<{ user: unknown }>('PUT', '/auth/pin', { pin, password })
export const removePin = (password: string) => api<{ user: unknown }>('DELETE', '/auth/pin', { password })
export const verifyPin = (pin: string) => api('POST', '/auth/pin/verify', { pin })

export const deleteAccount = (password: string, confirm: string) =>
  api('DELETE', '/auth/account', { password, confirm })

export const authProviders = () => api<{ github: boolean }>('GET', '/auth/providers')
export const bindGithub = () => api<{ url: string }>('POST', '/auth/github/bind')
export const unbindGithub = () => api<{ user: unknown }>('DELETE', '/auth/github')

/* ---------------- 个人访问令牌 ---------------- */

export interface ApiTokenInfo {
  id: string
  name: string
  prefix: string
  scope: 'read' | 'write'
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
  token?: string
}

export const listTokens = () => api<ApiTokenInfo[]>('GET', '/tokens')
export const createToken = (name: string, scope: 'read' | 'write', expiresInDays: number) =>
  api<ApiTokenInfo>('POST', '/tokens', { name, scope, expiresInDays })
export const deleteToken = (id: string) => api('DELETE', `/tokens/${id}`)

/* ---------------- Webhook ---------------- */

export interface WebhookInfo {
  id: string
  url: string
  events: string[]
  secret: string
  enabled: boolean
  createdAt: number
  lastStatus: number | null
  lastError: string | null
  lastAt: number | null
}

export const listWebhooks = () => api<{ events: string[]; items: WebhookInfo[] }>('GET', '/webhooks')
export const createWebhook = (url: string, events: string[]) => api<WebhookInfo>('POST', '/webhooks', { url, events })
export const updateWebhook = (id: string, patch: Partial<{ url: string; events: string[]; enabled: boolean; rotateSecret: boolean }>) =>
  api<WebhookInfo>('PATCH', `/webhooks/${id}`, patch)
export const deleteWebhook = (id: string) => api('DELETE', `/webhooks/${id}`)
export const testWebhook = (id: string) => api<WebhookInfo>('POST', `/webhooks/${id}/test`)

/* ---------------- 公开分享 ---------------- */

export interface ShareInfo {
  id: string
  token: string
  pageId: string
  pageTitle: string
  pageIcon: string
  hasPassword: boolean
  expiresAt: number | null
  includeChildren: boolean
  createdAt: number
  views: number
  lastViewedAt: number | null
}

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`
export const listShares = () => api<ShareInfo[]>('GET', '/shares')
export const shareOfPage = (pageId: string) => api<ShareInfo | null>('GET', `/shares/page/${pageId}`)
export const createShare = (pageId: string) => api<ShareInfo>('POST', '/shares', { pageId })
export const updateShare = (
  id: string,
  patch: Partial<{ password: string | null; expiresAt: number | null; includeChildren: boolean; regenerate: boolean }>,
) => api<ShareInfo>('PATCH', `/shares/${id}`, patch)
export const deleteShare = (id: string) => api('DELETE', `/shares/${id}`)

export interface PublicSharePayload {
  page: {
    id: string
    title: string
    icon: string
    cover: string | null
    content: string
    updatedAt: number | null
    parentId: string | null
  }
  rootId: string
  children: { id: string; title: string; icon: string }[]
  databases: Record<string, { db: import('@/types').Database; rows: import('@/types').DbRow[] }>
  access: string | null
}

/** 公开分享页不带登录令牌，单独发请求 */
export async function readPublicShare(
  token: string,
  body: { password?: string; access?: string | null; pageId?: string },
): Promise<PublicSharePayload> {
  const res = await fetch(`/api/public/shares/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error ?? `请求失败（${res.status}）`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  return data as PublicSharePayload
}

/* ---------------- 成员协作 ---------------- */

export interface GrantInfo {
  id: string
  pageId: string
  pageTitle: string
  pageIcon: string
  role: 'viewer' | 'editor'
  createdAt: number
  grantee: { id: string; username: string; name: string; avatar: string | null }
}

export interface SharedPageItem {
  id: string
  title: string
  icon: string
  parentId: string | null
  order: number
  updatedAt: number
  role: 'viewer' | 'editor'
  rootId: string
}

export interface SharedRoot {
  grantId: string
  pageId: string
  role: 'viewer' | 'editor'
  ownerName: string
  ownerId: string
}

export const listGrants = (pageId?: string) =>
  api<GrantInfo[]>('GET', `/grants${pageId ? `?pageId=${encodeURIComponent(pageId)}` : ''}`)
export const createGrant = (pageId: string, username: string, role: 'viewer' | 'editor') =>
  api<GrantInfo>('POST', '/grants', { pageId, username, role })
export const updateGrant = (id: string, role: 'viewer' | 'editor') => api<GrantInfo>('PATCH', `/grants/${id}`, { role })
export const deleteGrant = (id: string) => api('DELETE', `/grants/${id}`)
export const listSharedWithMe = () => api<{ roots: SharedRoot[]; pages: SharedPageItem[] }>('GET', '/shared')
export const getSharedPage = (id: string) =>
  api<{ page: import('@/types').Page; role: 'viewer' | 'editor'; ownerName: string; rootId: string }>(
    'GET',
    `/shared/pages/${id}`,
  )
export const saveSharedPage = (id: string, patch: { title?: string; content?: string; excerpt?: string; icon?: string }) =>
  api('PUT', `/shared/pages/${id}`, patch)

/* ---------------- 通知 ---------------- */

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  createdAt: number
  read: boolean
}

export const listNotifications = () => api<{ unread: number; items: NotificationItem[] }>('GET', '/notifications?limit=100')
export const markNotificationsRead = (ids?: string[]) => api('POST', '/notifications/read', ids ? { ids } : {})
export const deleteNotification = (id: string) => api('DELETE', `/notifications/${id}`)
export const clearNotifications = () => api('DELETE', '/notifications')

/* ---------------- 用户设置 / 存储 ---------------- */

export const getUserSetting = <T>(key: 'space' | 'notify' | 'shortcuts') => api<T | null>('GET', `/settings/${key}`)
export const putUserSetting = (key: 'space' | 'notify' | 'shortcuts', value: unknown) =>
  api('PUT', `/settings/${key}`, value)

export interface StorageInfo {
  assets: { count: number; bytes: number }
  pages: { count: number; bytes: number }
  databases: { count: number; rows: number; bytes: number }
  largest: { id: string; name: string; size: number; createdAt: number }[]
  total: number
}

export const getStorage = () => api<StorageInfo>('GET', '/storage')

/* ---------------- AI ---------------- */

export interface AiConfigInfo {
  baseUrl: string
  model: string
  hasKey: boolean
  keyHint: string
  source: 'user' | 'server' | 'none'
  serverAvailable: boolean
}

export const getAiConfig = () => api<AiConfigInfo>('GET', '/ai/config')
export const saveAiConfig = (patch: Partial<{ baseUrl: string; apiKey: string; model: string }>) =>
  api('PUT', '/ai/config', patch)

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 流式调用：每收到一段文本回调一次，返回完整结果；可用 signal 中止 */
export async function streamChat(
  messages: ChatMessage[],
  onDelta: (text: string, full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const token = getToken()
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, stream: true }),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.error ?? `AI 请求失败（${res.status}）`)
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) {
          full += delta
          onDelta(delta, full)
        }
      } catch {
        /* 半截 JSON，等下一块 */
      }
    }
  }
  return full
}

/* ---------------- 反馈 / 版本 ---------------- */

export interface FeedbackInfo {
  id: string
  content: string
  contact: string | null
  createdAt: number
  reply: string | null
  repliedAt: number | null
  user: { id: string; username: string; name: string } | null
}

export const listMyFeedback = () => api<FeedbackInfo[]>('GET', '/feedback')
export const sendFeedback = (content: string, contact: string) => api<FeedbackInfo>('POST', '/feedback', { content, contact })
export const listAllFeedback = () => api<FeedbackInfo[]>('GET', '/admin/feedback')
export const replyFeedback = (id: string, reply: string) => api<FeedbackInfo>('POST', `/admin/feedback/${id}/reply`, { reply })

export async function fetchServerVersion(): Promise<string> {
  const res = await fetch('/api/version', { cache: 'no-store' })
  const data = await res.json()
  return String(data.version ?? '')
}

/* ---------------- 工具 ---------------- */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function errorText(e: unknown, fallback = '操作失败'): string {
  return e instanceof Error ? e.message : fallback
}
