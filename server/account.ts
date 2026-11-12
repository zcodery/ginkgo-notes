import { Router, type Request, type Response } from 'express'
import {
  authOf,
  clearFailures,
  createApiToken,
  createSession,
  findUserById,
  hashPassword,
  isLocked,
  issueTicket,
  issueToken,
  listSessions,
  readTicket,
  recordFailure,
  requireSession,
  revokeOtherSessions,
  revokeSession,
  toPublicUser,
  verifyPassword,
  type ApiTokenRow,
  type UserRow,
} from './auth.ts'
import { db, transaction } from './db.ts'
import { HttpError, clientIp, param, str } from './http.ts'
import { describeUa, notify } from './notify.ts'
import { generateTotpSecret, totpUri, verifyTotp } from './totp.ts'

export const accountRouter = Router()

function currentRow(res: Response): UserRow {
  const row = findUserById(authOf(res).user.id)
  if (!row) throw new HttpError(404, '用户不存在')
  return row
}

/** 已登录状态下的密码 / PIN 错误用 400：401 会被前端当作登录失效而直接登出 */
function assertPassword(row: UserRow, password: unknown): void {
  if (typeof password !== 'string' || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(400, '登录密码不正确')
  }
}

/* ---------------- 设备管理 ---------------- */

accountRouter.get('/auth/sessions', requireSession, (_req, res) => {
  const { user, sid } = authOf(res)
  res.json(
    listSessions(user.id).map((s) => ({
      id: s.id,
      device: describeUa(s.ua),
      ip: s.ip,
      createdAt: s.created_at,
      lastSeen: s.last_seen,
      current: s.id === sid,
    })),
  )
})

accountRouter.delete('/auth/sessions/:id', requireSession, (req, res) => {
  revokeSession(authOf(res).user.id, param(req, 'id'))
  res.json({ ok: true })
})

accountRouter.post('/auth/sessions/revoke-others', requireSession, (_req, res) => {
  const { user, sid } = authOf(res)
  revokeOtherSessions(user.id, sid)
  res.json({ ok: true })
})

/* ---------------- 两步验证（TOTP） ---------------- */

accountRouter.post('/auth/2fa/setup', requireSession, (_req, res) => {
  const row = currentRow(res)
  if (row.totp_enabled) throw new HttpError(409, '两步验证已开启')
  const secret = generateTotpSecret()
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, row.id)
  res.json({ secret, uri: totpUri(secret, row.username) })
})

accountRouter.post('/auth/2fa/enable', requireSession, (req, res) => {
  const row = currentRow(res)
  const code = str(req.body?.code, '验证码', 10)
  if (!row.totp_secret) throw new HttpError(400, '请先生成密钥')
  if (!verifyTotp(row.totp_secret, code)) throw new HttpError(400, '验证码不正确，请确认手机时间准确')
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(row.id)
  notify(row.id, 'security', '已开启两步验证', '之后登录需要额外输入验证器 App 中的动态码。')
  res.json({ user: toPublicUser(currentRow(res)) })
})

accountRouter.post('/auth/2fa/disable', requireSession, (req, res) => {
  const row = currentRow(res)
  assertPassword(row, req.body?.password)
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(row.id)
  notify(row.id, 'security', '已关闭两步验证')
  res.json({ user: toPublicUser(currentRow(res)) })
})

/* ---------------- PIN 码锁屏 ---------------- */

const PIN_RE = /^\d{4,8}$/

accountRouter.put('/auth/pin', requireSession, (req, res) => {
  const row = currentRow(res)
  assertPassword(row, req.body?.password)
  const pin = req.body?.pin
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new HttpError(400, 'PIN 码需为 4-8 位数字')
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPassword(pin), row.id)
  res.json({ user: toPublicUser(currentRow(res)) })
})

accountRouter.delete('/auth/pin', requireSession, (req, res) => {
  const row = currentRow(res)
  assertPassword(row, req.body?.password)
  db.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').run(row.id)
  res.json({ user: toPublicUser(currentRow(res)) })
})

accountRouter.post('/auth/pin/verify', requireSession, (req, res) => {
  const row = currentRow(res)
  const key = `pin|${row.id}`
  if (isLocked(key)) throw new HttpError(429, '尝试次数过多，请 10 分钟后再试，或退出后重新登录')
  const pin = req.body?.pin
  if (!row.pin_hash || typeof pin !== 'string' || !verifyPassword(pin, row.pin_hash)) {
    recordFailure(key)
    throw new HttpError(400, 'PIN 码不正确')
  }
  clearFailures(key)
  res.json({ ok: true })
})

/* ---------------- 个人访问令牌 ---------------- */

function publicToken(t: ApiTokenRow) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scope: t.scope,
    createdAt: t.created_at,
    lastUsedAt: t.last_used_at,
    expiresAt: t.expires_at,
  }
}

accountRouter.get('/tokens', requireSession, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(authOf(res).user.id) as unknown as ApiTokenRow[]
  res.json(rows.map(publicToken))
})

accountRouter.post('/tokens', requireSession, (req, res) => {
  const { user } = authOf(res)
  const name = str(req.body?.name, '名称', 60) || '未命名令牌'
  const scope = req.body?.scope === 'write' ? 'write' : 'read'
  const days = Number(req.body?.expiresInDays ?? 0)
  const expiresAt = days > 0 ? Date.now() + Math.min(days, 3650) * 86_400_000 : null
  const count = (db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').get(user.id) as { n: number }).n
  if (count >= 30) throw new HttpError(400, '令牌数量已达上限（30 个）')
  const { row, token } = createApiToken(user.id, name, scope, expiresAt)
  notify(user.id, 'security', `已创建访问令牌「${name}」`, scope === 'write' ? '该令牌可读写你的笔记。' : '该令牌只能读取你的笔记。')
  res.status(201).json({ ...publicToken(row), token })
})

accountRouter.delete('/tokens/:id', requireSession, (req, res) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(param(req, 'id'), authOf(res).user.id)
  res.json({ ok: true })
})

/* ---------------- 注销账号 ---------------- */

accountRouter.delete('/auth/account', requireSession, (req, res) => {
  const row = currentRow(res)
  assertPassword(row, req.body?.password)
  if (req.body?.confirm !== row.username) throw new HttpError(400, '请输入用户名以确认注销')
  if (row.role === 'admin') {
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n
    if (admins <= 1) throw new HttpError(400, '你是唯一的管理员，不能注销账号')
  }
  transaction(() => {
    for (const table of ['db_rows', 'databases', 'pages', 'assets', 'shares']) {
      db.prepare(`DELETE FROM ${table} WHERE owner = ?`).run(row.id)
    }
    db.prepare('DELETE FROM page_grants WHERE owner = ? OR grantee_id = ?').run(row.id, row.id)
    for (const table of ['sessions', 'api_tokens', 'user_settings', 'webhooks', 'notifications', 'feedback']) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(row.id)
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(row.id)
  })
  res.json({ ok: true })
})

/* ---------------- 第三方账号：GitHub OAuth ---------------- */

const GH_ID = process.env.GITHUB_CLIENT_ID ?? ''
const GH_SECRET = process.env.GITHUB_CLIENT_SECRET ?? ''
export const githubEnabled = () => !!(GH_ID && GH_SECRET)

function callbackUrl(req: Request): string {
  const base = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`
  return `${base.replace(/\/+$/, '')}/api/auth/github/callback`
}

function authorizeUrl(req: Request, state: string): string {
  const q = new URLSearchParams({
    client_id: GH_ID,
    redirect_uri: callbackUrl(req),
    scope: 'read:user',
    state,
  })
  return `https://github.com/login/oauth/authorize?${q}`
}

accountRouter.post('/auth/github/bind', requireSession, (req, res) => {
  if (!githubEnabled()) throw new HttpError(400, '管理员尚未配置 GitHub 登录（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）')
  const state = issueTicket(authOf(res).user.id, 'gh', 600, { mode: 'bind' })
  res.json({ url: authorizeUrl(req, state) })
})

accountRouter.delete('/auth/github', requireSession, (_req, res) => {
  const row = currentRow(res)
  db.prepare('UPDATE users SET github_id = NULL, github_login = NULL WHERE id = ?').run(row.id)
  res.json({ user: toPublicUser(currentRow(res)) })
})

/** 不需要登录：GitHub 登录入口与回调 */
export const oauthPublicRouter = Router()

oauthPublicRouter.get('/auth/providers', (_req, res) => {
  res.json({ github: githubEnabled() })
})

oauthPublicRouter.get('/auth/github/login', (req, res) => {
  if (!githubEnabled()) {
    res.redirect('/?oauth_error=' + encodeURIComponent('管理员尚未配置 GitHub 登录'))
    return
  }
  res.redirect(authorizeUrl(req, issueTicket('anonymous', 'gh', 600, { mode: 'login' })))
})

oauthPublicRouter.get('/auth/github/callback', async (req, res) => {
  const fail = (msg: string) => res.redirect('/?oauth_error=' + encodeURIComponent(msg))
  try {
    const state = readTicket(String(req.query.state ?? ''), 'gh')
    if (!state || typeof req.query.code !== 'string') return fail('授权已过期，请重试')
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GH_ID,
        client_secret: GH_SECRET,
        code: req.query.code,
        redirect_uri: callbackUrl(req),
      }),
    })
    const tokenData = (await tokenRes.json()) as { access_token?: string }
    if (!tokenData.access_token) return fail('GitHub 授权失败')
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'GinkgoNotes' },
    })
    const gh = (await userRes.json()) as { id?: number; login?: string }
    if (!gh.id) return fail('读取 GitHub 账号失败')
    const ghId = String(gh.id)
    const owner = db.prepare('SELECT * FROM users WHERE github_id = ?').get(ghId) as UserRow | undefined

    if (state.mode === 'bind') {
      if (owner && owner.id !== state.sub) return fail('该 GitHub 账号已绑定其他用户')
      db.prepare('UPDATE users SET github_id = ?, github_login = ? WHERE id = ?').run(ghId, gh.login ?? ghId, state.sub)
      notify(state.sub, 'security', `已绑定 GitHub 账号 ${gh.login ?? ''}`)
      return res.redirect('/?oauth=bound')
    }
    if (!owner) return fail('该 GitHub 账号尚未绑定银杏笔记账号，请先用密码登录后在设置中绑定')
    if (owner.totp_enabled) {
      return res.redirect('/?oauth_2fa=' + encodeURIComponent(issueTicket(owner.id, '2fa', 300)))
    }
    const sid = createSession(owner.id, clientIp(req), req.headers['user-agent'])
    res.redirect('/?oauth_token=' + encodeURIComponent(issueToken(owner.id, sid)))
  } catch (err) {
    fail(err instanceof Error ? err.message : '登录失败')
  }
})
