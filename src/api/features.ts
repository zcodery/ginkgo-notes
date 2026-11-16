import { api, authHeaders, getToken } from './client'

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

export async function fetchServerInfo(): Promise<{ version: string; mail: boolean }> {
  const res = await fetch('/api/version', { cache: 'no-store' })
  const data = await res.json()
  return { version: String(data.version ?? ''), mail: !!data.mail }
}

export async function fetchServerVersion(): Promise<string> {
  return (await fetchServerInfo()).version
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
/* ---------------- 好友 ---------------- */

export interface FriendInfo {
  friendshipId: string
  id: string
  username: string
  name: string
  avatar: string | null
  since: number
}

export interface FriendRequestInfo {
  id: string
  from?: { id: string; username: string; name: string; avatar: string | null }
  to?: { id: string; username: string; name: string; avatar: string | null }
  message: string | null
  createdAt: number
  outgoing: boolean
}

export interface UserSearchItem {
  id: string
  username: string
  name: string
  avatar: string | null
  relation: 'pending' | 'accepted' | 'rejected' | 'blocked' | null
}

export const listFriends = () => api<FriendInfo[]>('GET', '/friends')
export const searchUsers = (q: string) => api<UserSearchItem[]>('GET', `/friends/search?q=${encodeURIComponent(q)}`)
export const listFriendRequests = () => api<FriendRequestInfo[]>('GET', '/friends/requests')
export const listSentFriendRequests = () => api<FriendRequestInfo[]>('GET', '/friends/requests/sent')
export const sendFriendRequest = (username: string, message?: string) =>
  api('POST', '/friends/requests', { username, message })
export const acceptFriendRequest = (id: string) => api('POST', `/friends/requests/${id}/accept`)
export const declineFriendRequest = (id: string) => api('POST', `/friends/requests/${id}/decline`)
export const removeFriend = (id: string) => api('DELETE', `/friends/${id}`)
export const blockFriend = (id: string) => api('POST', `/friends/${id}/block`)

/* ---------------- 空间 / 组织 / 成员 ---------------- */

export type BackendRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'guest'

export interface SpaceInfo {
  id: string
  type: 'personal' | 'team' | 'public'
  name: string
  ownerUserId: string | null
  role: BackendRole
  memberCount: number
  createdAt: number
}

export interface OrgNodeInfo {
  id: string
  parentId: string | null
  type: 'department' | 'team'
  name: string
  path: string
  depth: number
  sort: number
  leadUserId: string | null
  memberCount: number
}

export interface SpaceMemberInfo {
  id: string
  username: string
  name: string
  avatar: string | null
  role: string
  orgNodeId: string
  status: string
  joinedAt: number
}

export interface SpaceInviteInfo {
  id: string
  spaceId: string
  spaceName: string
  role: string
  orgNodeId: string
  from: { id: string; username: string; name: string; avatar: string | null }
  createdAt: number
}

export const listSpaces = () => api<SpaceInfo[]>('GET', '/spaces')
export const createSpace = (name: string) => api<SpaceInfo>('POST', '/spaces', { name })
export const getSpace = (id: string) => api<SpaceInfo>('GET', `/spaces/${id}`)
export const renameSpace = (id: string, name: string) => api<SpaceInfo>('PATCH', `/spaces/${id}`, { name })
export const getSpaceOrg = (id: string) =>
  api<{ nodes: OrgNodeInfo[]; members: SpaceMemberInfo[] }>('GET', `/spaces/${id}/org`)
export const createOrgNode = (spaceId: string, body: { parentId?: string | null; type: string; name: string }) =>
  api<OrgNodeInfo>('POST', `/spaces/${spaceId}/org/nodes`, body)
export const updateOrgNode = (
  spaceId: string,
  nodeId: string,
  body: Partial<{ parentId: string | null; name: string }>,
) => api('PATCH', `/spaces/${spaceId}/org/nodes/${nodeId}`, body)
export const deleteOrgNode = (spaceId: string, nodeId: string) =>
  api('DELETE', `/spaces/${spaceId}/org/nodes/${nodeId}`)
/** 拖拽移动：换上级 + 指定插到哪个兄弟节点之前（不传 beforeId 表示排到末尾） */
export const moveOrgNode = (
  spaceId: string,
  nodeId: string,
  body: { parentId: string | null; beforeId?: string | null },
) => api('POST', `/spaces/${spaceId}/org/nodes/${nodeId}/move`, body)
export const addSpaceMember = (spaceId: string, body: { username: string; role: string; orgNodeId?: string }) =>
  api('POST', `/spaces/${spaceId}/members`, body)
export const updateSpaceMember = (
  spaceId: string,
  userId: string,
  body: Partial<{ role: string; orgNodeId: string }>,
) => api('PATCH', `/spaces/${spaceId}/members/${userId}`, body)
export const removeSpaceMember = (spaceId: string, userId: string) =>
  api('DELETE', `/spaces/${spaceId}/members/${userId}`)
export const inviteToSpace = (spaceId: string, body: { username: string; role: string; orgNodeId?: string }) =>
  api<{ id: string }>('POST', `/spaces/${spaceId}/invites`, body)
export const listSpaceInvites = (spaceId: string) =>
  api<{ id: string; invitee: SpaceMemberInfo | null; role: string; orgNodeId: string; createdAt: number }[]>(
    'GET',
    `/spaces/${spaceId}/invites`,
  )
export const listMyInvites = () => api<SpaceInviteInfo[]>('GET', '/spaces/invites')
export const acceptInvite = (id: string) => api<{ ok: boolean; spaceId: string }>('POST', `/spaces/invites/${id}/accept`)
export const declineInvite = (id: string) => api('POST', `/spaces/invites/${id}/decline`)

export interface OrgImportResult {
  ok: boolean
  createdNodes: number
  reusedNodes: number
  members: number
  errors: string[]
}

/** CSV：部门路径,用户名,角色；JSON：{ nodes, members } 或嵌套 children */
export const importOrg = (spaceId: string, payload: Record<string, unknown>) =>
  api<OrgImportResult>('POST', `/spaces/${spaceId}/org/import`, payload)

/* ---------------- ACL ---------------- */

export interface AclEntryInfo {
  id: string
  subjectType: 'user' | 'org_node' | 'space'
  subjectId: string
  subjectName: string
  role: BackendRole
  deny: boolean
  inherit: boolean
  createdBy: string | null
  createdAt: number
}

export const getAcl = (type: 'page' | 'database', id: string) =>
  api<{ myRole: BackendRole; entries: AclEntryInfo[] }>('GET', `/acl/${type}/${id}`)
export const putAcl = (
  type: 'page' | 'database',
  id: string,
  body: { subjectType: string; subjectId: string; role?: string; deny?: boolean; inherit?: boolean },
) => api<AclEntryInfo>('PUT', `/acl/${type}/${id}`, body)
export const deleteAcl = (type: 'page' | 'database', id: string, entryId: string) =>
  api('DELETE', `/acl/${type}/${id}/${entryId}`)

/* ---------------- 在线状态 ---------------- */

export interface PresenceUser {
  userId: string
  name: string
  avatar: string | null
  editing: boolean
  tabs: number
}

export interface PresenceState {
  users: PresenceUser[]
  editor: string | null
  total: number
  updatedAt: number
}

export const getPresence = (pageId: string) => api<PresenceState>('GET', `/presence/page/${pageId}`)

export const heartbeatPresence = (pageId: string, connId: string, editing: boolean) =>
  api<PresenceState>('POST', `/presence/page/${pageId}/heartbeat`, { connId, editing })

export const claimEdit = (pageId: string) => api<{ ok: boolean; expiresAt: number }>('POST', `/presence/page/${pageId}/claim-edit`)
export const releaseEdit = (pageId: string) => api('DELETE', `/presence/page/${pageId}/claim-edit`)

/**
 * 订阅文档在线状态（SSE 下行）。
 * EventSource 不支持自定义请求头，这里用 fetch + ReadableStream 复用 Bearer 与空间头。
 */
export function subscribePresence(
  pageId: string,
  onState: (state: PresenceState) => void,
  onHello: (connId: string) => void,
): () => void {
  const controller = new AbortController()
  const decoder = new TextDecoder()

  void (async () => {
    try {
      const res = await fetch(`/api/presence/page/${pageId}/stream`, {
        headers: authHeaders(),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const lines = block.split('\n')
          const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message'
          const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
          if (!data) continue
          try {
            const parsed = JSON.parse(data)
            if (event === 'hello') onHello(String(parsed.connId ?? ''))
            else if (event === 'presence') onState(parsed as PresenceState)
          } catch {
            /* 半截数据，等下一块 */
          }
        }
      }
    } catch {
      /* 中止或网络断开，由调用方重连 */
    }
  })()

  return () => controller.abort()
}
