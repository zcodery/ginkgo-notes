import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { DATA_DIR, PUBLIC_OWNER, db } from './db.ts'

export type Role = 'user' | 'admin'

export interface UserRow {
  id: string
  username: string
  password_hash: string
  role: Role
  created_at: number
  nickname?: string | null
  avatar?: string | null
}

export interface PublicUser {
  id: string
  username: string
  role: Role
  createdAt: number
  nickname: string | null
  avatar: string | null
}

export interface AuthLocals {
  user: PublicUser
  /** 本次请求读写的数据归属：用户 id，或管理员切到公共空间时的 PUBLIC_OWNER */
  owner: string
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30

function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  const file = resolve(DATA_DIR, '.jwt-secret')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const secret = randomBytes(48).toString('hex')
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
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

export function issueToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS }),
  ).toString('base64url')
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`
}

function readToken(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts as [string, string, string]
  const expected = Buffer.from(sign(`${header}.${payload}`))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string
      exp?: number
    }
    if (!data.sub || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null
    return data.sub
  } catch {
    return null
  }
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

export function updateUserProfile(
  userId: string,
  patch: { nickname?: string | null; avatar?: string | null },
): void {
  if (patch.nickname !== undefined) {
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(patch.nickname, userId)
  }
  if (patch.avatar !== undefined) {
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(patch.avatar, userId)
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
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const userId = token ? readToken(token) : null
  const row = userId ? findUserById(userId) : null
  if (!row) {
    res.status(401).json({ error: '登录已失效，请重新登录' })
    return
  }
  const user = toPublicUser(row)
  const wantsPublic = req.headers['x-space'] === 'public'
  if (wantsPublic && user.role !== 'admin') {
    res.status(403).json({ error: '只有管理员可以编辑公共原稿' })
    return
  }
  const locals: AuthLocals = { user, owner: wantsPublic ? PUBLIC_OWNER : user.id }
  res.locals.auth = locals
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
