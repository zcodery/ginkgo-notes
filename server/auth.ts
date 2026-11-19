import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { DATA_DIR, PUBLIC_OWNER, db, ensurePersonalSpace, getSpace } from './db.ts'

export type Role = 'user' | 'admin'

/** 空间内角色，强度：owner > admin > editor > viewer > guest */
export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'guest'

export interface UserRow {
  id: string
  username: string
  password_hash: string
  role: Role
  created_at: number
  nickname?: string | null
  avatar?: string | null
  email?: string | null
  phone?: string | null
  pin_hash?: string | null
  totp_secret?: string | null
  totp_enabled?: number
  github_id?: string | null
  github_login?: string | null
}

export interface PublicUser {
  id: string
  username: string
  role: Role
  createdAt: number
  nickname: string | null
  avatar: string | null
  email: string | null
  phone: string | null
  hasPin: boolean
  twoFactor: boolean
  github: string | null
}

export interface AuthLocals {
  user: PublicUser
  /** 本次请求读写的数据归属：个人空间 id / 团队空间 id / PUBLIC_OWNER */
  owner: string
  /** 空间 id（与 owner 相同，显式命名便于业务校验） */
  spaceId: string
  spaceType: 'personal' | 'team' | 'public'
  /** 当前用户在该空间的有效角色 */
  spaceRole: SpaceRole
  /** 当前登录会话；旧令牌或 API Token 调用时为 null */
  sid: string | null
  /** 通过个人访问令牌调用时的令牌信息 */
  apiToken: { id: string; scope: 'read' | 'write' } | null
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

function loadSecret(): string {
  const env = process.env.JWT_SECRET?.trim()
  if (env) return env

  const file = resolve(DATA_DIR, '.jwt-secret')

  // 容器化部署时 data 目录里的点文件常常不会被带上去（本地开发有、线上没有），
  // 一旦进程不止一个，每个进程都会自己 randomBytes 一份 —— 结果是「登录成功，
  // 下一个请求就 401」，因为 token 是 A 签的、验的是 B。所以密钥优先落进
  // SQLite：库文件随项目一起持久，INSERT OR IGNORE + 回读保证多进程并发启动
  // 时也只会定下一个值。
  const stored = db.prepare("SELECT value FROM app_meta WHERE key = 'jwt_secret'").get() as
    | { value: string }
    | undefined
  if (stored?.value) {
    // 文件与库里不一致时以库为准（库是跨进程共享的那份），顺手把文件纠正过来
    try {
      writeFileSync(file, stored.value, { mode: 0o600 })
    } catch {
      /* 只读盘忽略 */
    }
    return stored.value
  }

  const fromFile = existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
  const secret = fromFile || randomBytes(48).toString('hex')
  db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('jwt_secret', ?)").run(secret)
  const settled = db.prepare("SELECT value FROM app_meta WHERE key = 'jwt_secret'").get() as
    | { value: string }
    | undefined
  const final = settled?.value ?? secret
  if (!fromFile) {
    try {
      writeFileSync(file, final, { mode: 0o600 })
    } catch {
      /* 只读盘忽略：库里有就够了 */
    }
  }
  return final
}

const SECRET = loadSecret()

/* ---------------- 密码 ---------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(expected, actual)
}

/* ---------------- Token（HS256 JWT） ---------------- */

function sign(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('base64url')
}

interface TokenPayload {
  sub: string
  exp: number
  iat?: number
  /** 会话 id */
  sid?: string
  /** 票据类型：缺省为登录令牌；'2fa' 为两步验证中间票据 */
  typ?: string
  [k: string]: unknown
}

function signPayload(data: Record<string, unknown>, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ ...data, iat: now, exp: now + ttlSeconds })).toString(
    'base64url',
  )
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`
}

function readPayload(token: string): TokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts as [string, string, string]
  const expected = Buffer.from(sign(`${header}.${payload}`))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload
    if (!data.sub || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

export function issueToken(userId: string, sid?: string): string {
  return signPayload({ sub: userId, ...(sid ? { sid } : {}) }, TOKEN_TTL_SECONDS)
}

/** 短期票据：两步验证、第三方登录 state 等 */
export function issueTicket(userId: string, typ: string, ttlSeconds: number, extra: Record<string, unknown> = {}): string {
  return signPayload({ sub: userId, typ, ...extra }, ttlSeconds)
}

export function readTicket(token: string, typ: string): TokenPayload | null {
  const data = readPayload(token)
  return data && data.typ === typ ? data : null
}

/* ---------------- 会话 ---------------- */

export interface SessionRow {
  id: string
  user_id: string
  created_at: number
  last_seen: number
  ip: string | null
  ua: string | null
  revoked: number
}

export function createSession(userId: string, ip: string | undefined, ua: string | undefined): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, now, now, ip ?? null, (ua ?? '').slice(0, 300) || null)
  return id
}

export function listSessions(userId: string): SessionRow[] {
  return db
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY last_seen DESC')
    .all(userId) as unknown as SessionRow[]
}

export function revokeSession(userId: string, sid: string): void {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ? AND user_id = ?').run(sid, userId)
}

/** 退出除 keepSid 之外的全部会话（改密码、注销其它设备） */
export function revokeOtherSessions(userId: string, keepSid: string | null): void {
  db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?').run(userId, keepSid ?? '')
}

export function hasSessionWithUa(userId: string, ua: string | undefined): boolean {
  if (!ua) return false
  return !!db.prepare('SELECT 1 FROM sessions WHERE user_id = ? AND ua = ? LIMIT 1').get(userId, ua.slice(0, 300))
}

const lastTouch = new Map<string, number>()

function touchSession(sid: string): void {
  const now = Date.now()
  if ((lastTouch.get(sid) ?? 0) > now - 60_000) return
  lastTouch.set(sid, now)
  db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, sid)
}

/* ---------------- 个人访问令牌 ---------------- */

export interface ApiTokenRow {
  id: string
  user_id: string
  name: string
  token_hash: string
  prefix: string
  scope: 'read' | 'write'
  created_at: number
  last_used_at: number | null
  expires_at: number | null
}

export const API_TOKEN_PREFIX = 'gn_'

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createApiToken(
  userId: string,
  name: string,
  scope: 'read' | 'write',
  expiresAt: number | null,
): { row: ApiTokenRow; token: string } {
  const token = API_TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const row: ApiTokenRow = {
    id: randomUUID(),
    user_id: userId,
    name,
    token_hash: hashApiToken(token),
    prefix: token.slice(0, 10),
    scope,
    created_at: Date.now(),
    last_used_at: null,
    expires_at: expiresAt,
  }
  db.prepare(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scope, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, userId, name, row.token_hash, row.prefix, scope, row.created_at, expiresAt)
  return { row, token }
}

function findApiToken(token: string): ApiTokenRow | null {
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hashApiToken(token)) as
    | ApiTokenRow
    | undefined
  if (!row) return null
  if (row.expires_at && row.expires_at < Date.now()) return null
  const now = Date.now()
  if (!row.last_used_at || row.last_used_at < now - 60_000) {
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now, row.id)
  }
  return row
}

/* ---------------- 用户 ---------------- */

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    nickname: row.nickname ?? null,
    avatar: row.avatar ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    hasPin: !!row.pin_hash,
    twoFactor: !!row.totp_enabled,
    github: row.github_login ?? null,
  }
}

export function findUserById(id: string): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null
}

export function findUserByName(username: string): UserRow | null {
  return (
    (db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined) ??
    null
  )
}

export function createUser(username: string, password: string, role: Role = 'user'): UserRow {
  const row: UserRow = {
    id: randomUUID(),
    username,
    password_hash: hashPassword(password),
    role,
    created_at: Date.now(),
  }
  db.prepare(
    'INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(row.id, row.username, row.password_hash, row.role, row.created_at)
  return row
}

export function updateUserPassword(userId: string, password: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId)
}

const PROFILE_COLUMNS = ['nickname', 'avatar', 'email', 'phone'] as const
type ProfileColumn = (typeof PROFILE_COLUMNS)[number]

export function updateUserProfile(
  userId: string,
  patch: Partial<Record<ProfileColumn, string | null>>,
): void {
  for (const col of PROFILE_COLUMNS) {
    if (patch[col] !== undefined) {
      db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(patch[col] ?? null, userId)
    }
  }
}

export const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,24}$/

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 3-24 位字母、数字、下划线或中文'
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return '密码长度需为 6-128 位'
  }
  return null
}

/* ---------------- 登录失败限流 ---------------- */

const failures = new Map<string, { count: number; until: number }>()
const MAX_FAILURES = 8
const LOCK_MS = 10 * 60 * 1000

export function isLocked(key: string): boolean {
  const f = failures.get(key)
  return !!f && f.count >= MAX_FAILURES && f.until > Date.now()
}

export function recordFailure(key: string): void {
  const f = failures.get(key)
  if (!f || f.until < Date.now()) failures.set(key, { count: 1, until: Date.now() + LOCK_MS })
  else f.count++
}

export function clearFailures(key: string): void {
  failures.delete(key)
}

/* ---------------- 中间件 ---------------- */

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  // 部署环境的鉴权反代会用网关自己的 JWT 覆盖 Authorization（打开分享链接后，
  // 哪怕客户端不发也会收到一个），所以应用令牌同时支持自定义头，且优先它。
  // 本地开发 / MCP 脚本继续走标准 Bearer。
  const custom = req.headers['x-ginkgo-token']
  const token = typeof custom === 'string' && custom ? custom : bearer
  let row: UserRow | null = null
  let sid: string | null = null
  let apiToken: AuthLocals['apiToken'] = null

  if (token.startsWith(API_TOKEN_PREFIX)) {
    const t = findApiToken(token)
    if (t) {
      row = findUserById(t.user_id)
      apiToken = { id: t.id, scope: t.scope }
    }
  } else if (token) {
    const data = readPayload(token)
    if (data && !data.typ) {
      if (data.sid) {
        const s = db.prepare('SELECT user_id, revoked FROM sessions WHERE id = ?').get(data.sid) as
          | { user_id: string; revoked: number }
          | undefined
        if (s && !s.revoked && s.user_id === data.sub) {
          sid = data.sid
          touchSession(sid)
          row = findUserById(data.sub)
        } else if (!s) {
          // 会话记录不存在：典型场景是重新发布时用本地 server/data 快照覆盖线上库，
          // 会话表被整体换掉，线上刚创建的会话随之中落。令牌签名有效且未过期，
          // 说明是本系统签发且没被主动撤销 —— 降级放行并补建会话，避免每次发布
          // 都把用户踢回登录页。
          // 注意：若记录存在但 revoked=1（主动退出 / 改密码踢设备），不会走到这里，
          // row 保持 null → 401，安全语义不变。
          const user = findUserById(data.sub)
          if (user) {
            row = user
            sid = data.sid
            const now = Date.now()
            try {
              db.prepare(
                'INSERT OR IGNORE INTO sessions (id, user_id, created_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?)',
              ).run(
                data.sid,
                data.sub,
                now,
                now,
                req.ip ?? null,
                ((req.headers['user-agent'] as string) ?? '').slice(0, 300) || null,
              )
            } catch {
              /* 补建失败不影响本次放行：下次请求仍会走这个降级分支 */
            }
          }
        }
      } else {
        row = findUserById(data.sub)
      }
    }
  }

  if (!row) {
    res.status(401).json({ error: '登录已失效，请重新登录' })
    return
  }
  // 只读令牌不能写数据；MCP 接口自己按工具区分读写
  if (apiToken?.scope === 'read' && req.method !== 'GET' && req.path !== '/mcp') {
    res.status(403).json({ error: '该访问令牌只有读取权限' })
    return
  }
  const user = toPublicUser(row)

  // 解析本次请求的空间：默认个人空间；X-Space 可指定团队空间或公共原稿
  const rawSpace = req.headers['x-space']
  const wanted = typeof rawSpace === 'string' ? rawSpace.trim() : ''
  let owner: string
  let spaceType: AuthLocals['spaceType']
  let spaceRole: SpaceRole

  if (wanted === 'public') {
    if (user.role !== 'admin') {
      res.status(403).json({ error: '只有管理员可以编辑公共原稿' })
      return
    }
    owner = PUBLIC_OWNER
    spaceType = 'public'
    spaceRole = 'owner'
  } else if (wanted && wanted !== user.id) {
    const space = getSpace(wanted)
    if (!space || space.type !== 'team') {
      res.status(403).json({ error: '空间不存在或不可访问' })
      return
    }
    if (space.owner_user_id === user.id) {
      owner = space.id
      spaceType = 'team'
      spaceRole = 'owner'
    } else {
      const member = db
        .prepare(
          `SELECT role FROM space_members
           WHERE space_id = ? AND user_id = ? AND status = 'active'
           ORDER BY CASE role
             WHEN 'admin' THEN 4 WHEN 'editor' THEN 3 WHEN 'viewer' THEN 2 ELSE 1 END DESC
           LIMIT 1`,
        )
        .get(wanted, user.id) as { role: SpaceRole } | undefined
      if (!member) {
        res.status(403).json({ error: '你不是该空间的成员' })
        return
      }
      owner = space.id
      spaceType = 'team'
      spaceRole = member.role
    }
  } else {
    ensurePersonalSpace(user.id, user.nickname ?? user.username)
    owner = user.id
    spaceType = 'personal'
    spaceRole = 'owner'
  }

  const locals: AuthLocals = { user, owner, spaceId: owner, spaceType, spaceRole, sid, apiToken }
  res.locals.auth = locals
  next()
}

/** 账号安全相关接口只允许网页登录会话调用，不接受 API Token */
export function requireSession(_req: Request, res: Response, next: NextFunction): void {
  const auth = res.locals.auth as AuthLocals | undefined
  if (!auth || auth.apiToken) {
    res.status(403).json({ error: '该操作需要在网页中登录后进行' })
    return
  }
  next()
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const auth = res.locals.auth as AuthLocals | undefined
  if (auth?.user.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' })
    return
  }
  next()
}

export function authOf(res: Response): AuthLocals {
  return res.locals.auth as AuthLocals
}
