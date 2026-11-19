/**
 * 后端 API 客户端。
 *
 * - 登录令牌存在 localStorage，随每个请求带上 Authorization
 * - 管理员切到「公共原稿」时带 X-Space: public，后端据此读写公共数据
 * - 401 统一回调 onUnauthorized，由上层把界面切回登录页
 */

const TOKEN_KEY = 'ginkgo-token'

export type Space = 'me' | 'public' | (string & {})

let currentSpace: Space = 'me'
let unauthorizedHandler: (() => void) | null = null

export class ApiError extends Error {
  status: number
  data: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* 隐私模式下写不进去就只在本次会话有效 */
  }
}

export function setApiSpace(space: Space): void {
  currentSpace = space
}

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  const token = getToken()
  if (token) {
    h.Authorization = `Bearer ${token}`
    // 发布环境（workbuddy sites 的分享域名）前面挂着一层鉴权反代，它会把进来的
    // Authorization 换成网关自己的 JWT —— 应用令牌走这个头就永远验不过，表现为
    // 「登录成功、下一个请求就 401」。所以再带一份到自定义头，后端优先读它。
    h['X-Ginkgo-Token'] = token
  }
  // me 表示个人空间（不传头，后端按用户 id 归属）；其余为 public 或团队空间 id
  if (currentSpace !== 'me') h['X-Space'] = currentSpace
  return h
}

/** 供 SSE / 裸 fetch 复用鉴权与空间头 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return headers(extra)
}

async function raise(res: Response): Promise<never> {
  let message = `请求失败（${res.status}）`
  let data: unknown = null
  try {
    data = await res.json()
    if ((data as { error?: string })?.error) message = (data as { error: string }).error
  } catch {
    /* 非 JSON 响应 */
  }
  if (res.status === 401 && getToken()) {
    setToken(null)
    unauthorizedHandler?.()
  }
  throw new ApiError(res.status, message, data)
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: headers(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, '无法连接服务器，请检查后端是否已启动')
  }
  if (!res.ok) return raise(res)
  return (await res.json()) as T
}

/** 404 时返回 undefined，其余错误照常抛出 */
export async function apiMaybe<T>(method: string, path: string): Promise<T | undefined> {
  try {
    return await api<T>(method, path)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined
    throw err
  }
}

export async function apiBlob(path: string): Promise<Blob | undefined> {
  const res = await fetch(`/api${path}`, { headers: headers() })
  if (res.status === 404) return undefined
  if (!res.ok) return raise(res)
  return res.blob()
}

export async function apiUpload<T>(path: string, blob: Blob, name: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: headers({
      'Content-Type': blob.type || 'application/octet-stream',
      'X-Asset-Name': encodeURIComponent(name),
    }),
    body: blob,
  })
  if (!res.ok) return raise(res)
  return (await res.json()) as T
}
