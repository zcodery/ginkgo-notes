import { Router } from 'express'
import { requireAdmin } from './auth.ts'
import { db } from './db.ts'
import { HttpError, param } from './http.ts'

/**
 * 管理员后台：人员信息统计。
 *
 * 口径说明：
 * - 笔记归属有两种：个人空间的页面 owner = 用户 id；团队空间的页面 owner = 空间 id。
 *   因此「我的笔记」按 owner = user.id 统计，团队页面单独按空间统计，不混在个人名下。
 * - 页面正文存在 pages.data 的 JSON 里，回收站标记用 json_extract 取 $.trashed。
 * - 好友关系是双向的（user_low / user_high 归一化），好友数按两端各计一次。
 */

export const adminRouter = Router()

const DAY = 86_400_000

/** 今天的零点（本地时区） */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 取 yyyy-mm-dd（本地时区） */
function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ---------------- 批量聚合 ---------------- */

interface UserRow {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
  email: string | null
  phone: string | null
  role: string
  created_at: number
  totp_enabled: number
  pin_hash: string | null
  github_login: string | null
}

/** 页面统计：按 owner 分组（个人页 owner=用户 id，团队页 owner=空间 id） */
function pageStatsByOwner(): Map<string, { alive: number; trashed: number; chars: number }> {
  const rows = db
    .prepare(
      `SELECT owner,
              SUM(CASE WHEN json_extract(data, '$.trashed') = 1 THEN 1 ELSE 0 END) AS trashed,
              SUM(CASE WHEN json_extract(data, '$.trashed') = 1 THEN 0 ELSE 1 END) AS alive,
              SUM(LENGTH(COALESCE(json_extract(data, '$.content'), ''))) AS chars
       FROM pages GROUP BY owner`,
    )
    .all() as { owner: string; trashed: number; alive: number; chars: number }[]
  const map = new Map<string, { alive: number; trashed: number; chars: number }>()
  for (const r of rows) {
    map.set(r.owner, { alive: r.alive ?? 0, trashed: r.trashed ?? 0, chars: r.chars ?? 0 })
  }
  return map
}

/** 数据库与行数按 owner 分组 */
function dbStatsByOwner(): Map<string, { databases: number; rows: number }> {
  const dbs = db.prepare('SELECT owner, COUNT(*) AS n FROM databases GROUP BY owner').all() as {
    owner: string
    n: number
  }[]
  const rows = db.prepare('SELECT owner, COUNT(*) AS n FROM db_rows GROUP BY owner').all() as {
    owner: string
    n: number
  }[]
  const map = new Map<string, { databases: number; rows: number }>()
  for (const d of dbs) map.set(d.owner, { databases: d.n, rows: 0 })
  for (const r of rows) {
    const cur = map.get(r.owner) ?? { databases: 0, rows: 0 }
    cur.rows = r.n
    map.set(r.owner, cur)
  }
  return map
}

/** 附件数量与体积按 owner 分组 */
function assetStatsByOwner(): Map<string, { count: number; bytes: number }> {
  const rows = db.prepare('SELECT owner, COUNT(*) AS n, SUM(size) AS bytes FROM assets GROUP BY owner').all() as {
    owner: string
    n: number
    bytes: number | null
  }[]
  const map = new Map<string, { count: number; bytes: number }>()
  for (const r of rows) map.set(r.owner, { count: r.n, bytes: r.bytes ?? 0 })
  return map
}

/** 好友数：accepted 关系两端各计一次 */
function friendCounts(): Map<string, number> {
  const rows = db
    .prepare("SELECT user_low AS a, user_high AS b FROM friendships WHERE status = 'accepted'")
    .all() as { a: string; b: string }[]
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.a, (map.get(r.a) ?? 0) + 1)
    map.set(r.b, (map.get(r.b) ?? 0) + 1)
  }
  return map
}

/** 每个用户的会话数与最后活跃时间 */
function sessionStats(): Map<string, { count: number; lastSeen: number | null }> {
  const rows = db
    .prepare(
      `SELECT user_id, COUNT(*) AS n, MAX(last_seen) AS last_seen
       FROM sessions WHERE revoked = 0 GROUP BY user_id`,
    )
    .all() as { user_id: string; n: number; last_seen: number | null }[]
  const map = new Map<string, { count: number; lastSeen: number | null }>()
  for (const r of rows) map.set(r.user_id, { count: r.n, lastSeen: r.last_seen })
  return map
}

/** 用户加入的团队空间数（personal 空间不计入） */
function teamSpaceCounts(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT m.user_id, COUNT(*) AS n
       FROM space_members m JOIN spaces s ON s.id = m.space_id
       WHERE s.type = 'team' AND m.status = 'active'
       GROUP BY m.user_id`,
    )
    .all() as { user_id: string; n: number }[]
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.user_id, r.n)
  return map
}

/** 担任负责人的组织节点数 */
function leadCounts(): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT lead_user_id, COUNT(*) AS n FROM org_nodes
       WHERE lead_user_id IS NOT NULL AND lead_user_id != '' GROUP BY lead_user_id`,
    )
    .all() as { lead_user_id: string; n: number }[]
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.lead_user_id, r.n)
  return map
}

/** 好友分组数 */
function groupCounts(): Map<string, number> {
  const rows = db.prepare('SELECT owner_id, COUNT(*) AS n FROM friend_groups GROUP BY owner_id').all() as {
    owner_id: string
    n: number
  }[]
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.owner_id, r.n)
  return map
}

/** API 令牌数 */
function tokenCounts(): Map<string, number> {
  const rows = db.prepare('SELECT user_id, COUNT(*) AS n FROM api_tokens GROUP BY user_id').all() as {
    user_id: string
    n: number
  }[]
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.user_id, r.n)
  return map
}

/* ---------------- 人员明细 ---------------- */

interface PersonStat {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
  email: string | null
  phone: string | null
  role: string
  createdAt: number
  /** 最后活跃时间（最近一次未撤销会话） */
  lastActiveAt: number | null
  /** 当前有效的登录设备数 */
  sessionCount: number
  /** 我的笔记（不含回收站） */
  pageCount: number
  /** 回收站里的笔记数 */
  trashedPageCount: number
  /** 正文字符数 */
  charCount: number
  /** 我创建的数据库与其中的行数 */
  databaseCount: number
  databaseRowCount: number
  /** 附件数与占用体积 */
  assetCount: number
  assetBytes: number
  /** 好友数 */
  friendCount: number
  /** 我这边的好友分组数 */
  friendGroupCount: number
  /** 加入的团队空间数 */
  teamSpaceCount: number
  /** 担任负责人的组织节点数 */
  leadNodeCount: number
  /** 访问令牌数 */
  tokenCount: number
  /** 安全状态 */
  twoFactor: boolean
  hasPin: boolean
  github: string | null
}

function buildPeople(): PersonStat[] {
  const users = db
    .prepare(
      `SELECT id, username, nickname, avatar, email, phone, role, created_at,
              totp_enabled, pin_hash, github_login
       FROM users ORDER BY created_at DESC`,
    )
    .all() as unknown as UserRow[]

  const pages = pageStatsByOwner()
  const dbs = dbStatsByOwner()
  const assets = assetStatsByOwner()
  const friends = friendCounts()
  const sessions = sessionStats()
  const teams = teamSpaceCounts()
  const leads = leadCounts()
  const groups = groupCounts()
  const tokens = tokenCounts()

  return users.map((u) => {
    const p = pages.get(u.id) ?? { alive: 0, trashed: 0, chars: 0 }
    const d = dbs.get(u.id) ?? { databases: 0, rows: 0 }
    const a = assets.get(u.id) ?? { count: 0, bytes: 0 }
    const s = sessions.get(u.id) ?? { count: 0, lastSeen: null }
    return {
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      email: u.email,
      phone: u.phone,
      role: u.role,
      createdAt: u.created_at,
      lastActiveAt: s.lastSeen,
      sessionCount: s.count,
      pageCount: p.alive,
      trashedPageCount: p.trashed,
      charCount: p.chars,
      databaseCount: d.databases,
      databaseRowCount: d.rows,
      assetCount: a.count,
      assetBytes: a.bytes,
      friendCount: friends.get(u.id) ?? 0,
      friendGroupCount: groups.get(u.id) ?? 0,
      teamSpaceCount: teams.get(u.id) ?? 0,
      leadNodeCount: leads.get(u.id) ?? 0,
      tokenCount: tokens.get(u.id) ?? 0,
      twoFactor: !!u.totp_enabled,
      hasPin: !!u.pin_hash,
      github: u.github_login,
    }
  })
}

/* ---------------- 接口 ---------------- */

/** 全局概览：总量 + 趋势 */
adminRouter.get('/admin/overview', requireAdmin, (_req, res) => {
  const today = startOfToday()
  const people = buildPeople()
  const weekAgo = today - 7 * DAY
  const monthAgo = today - 30 * DAY

  const totalUsers = people.length
  const adminCount = people.filter((p) => p.role === 'admin').length
  const newToday = people.filter((p) => p.createdAt >= today).length
  const newWeek = people.filter((p) => p.createdAt >= weekAgo).length
  const activeWeek = people.filter((p) => (p.lastActiveAt ?? 0) >= weekAgo).length
  const activeMonth = people.filter((p) => (p.lastActiveAt ?? 0) >= monthAgo).length
  const neverActive = people.filter((p) => p.lastActiveAt == null).length

  const sum = (pick: (p: PersonStat) => number) => people.reduce((n, p) => n + pick(p), 0)

  // 近 30 天注册趋势
  const signup: { date: string; count: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today - i * DAY)
    const key = dayKey(d.getTime())
    signup.push({ date: key, count: 0 })
  }
  const signupIndex = new Map(signup.map((s) => [s.date, s]))
  for (const p of people) {
    const s = signupIndex.get(dayKey(p.createdAt))
    if (s) s.count += 1
  }

  // 近 30 天活跃趋势：按会话最后活跃时间统计去重人数
  const active: { date: string; count: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today - i * DAY)
    active.push({ date: dayKey(d.getTime()), count: 0 })
  }
  const activeIndex = new Map(active.map((s) => [s.date, s]))
  const seen = db
    .prepare(
      `SELECT user_id, last_seen FROM sessions
       WHERE revoked = 0 AND last_seen >= ?`,
    )
    .all(monthAgo) as { user_id: string; last_seen: number }[]
  const perDay = new Map<string, Set<string>>()
  for (const s of seen) {
    const key = dayKey(s.last_seen)
    if (!activeIndex.has(key)) continue
    const set = perDay.get(key) ?? new Set<string>()
    set.add(s.user_id)
    perDay.set(key, set)
  }
  for (const [key, set] of perDay) {
    const slot = activeIndex.get(key)
    if (slot) slot.count = set.size
  }

  const spaceRows = db
    .prepare('SELECT type, COUNT(*) AS n FROM spaces GROUP BY type')
    .all() as { type: string; n: number }[]
  const spaceCount = spaceRows.reduce((n, r) => n + r.n, 0)
  const teamSpaceCount = spaceRows.find((r) => r.type === 'team')?.n ?? 0

  // 公共原稿与团队空间的页面不归属任何个人，单独统计
  const publicPages = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pages
         WHERE owner = 'public' AND json_extract(data, '$.trashed') IS NOT 1`,
      )
      .get() as { n: number }
  ).n
  const teamPages = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM pages p JOIN spaces s ON s.id = p.owner
         WHERE s.type = 'team' AND json_extract(p.data, '$.trashed') IS NOT 1`,
      )
      .get() as { n: number }
  ).n

  res.json({
    users: {
      total: totalUsers,
      admin: adminCount,
      newToday,
      newWeek,
      activeWeek,
      activeMonth,
      neverActive,
    },
    content: {
      pages: sum((p) => p.pageCount),
      trashedPages: sum((p) => p.trashedPageCount),
      chars: sum((p) => p.charCount),
      databases: sum((p) => p.databaseCount),
      databaseRows: sum((p) => p.databaseRowCount),
      assets: sum((p) => p.assetCount),
      assetBytes: sum((p) => p.assetBytes),
      publicPages,
      teamPages,
    },
    collab: {
      spaces: spaceCount,
      teamSpaces: teamSpaceCount,
      orgNodes: (db.prepare('SELECT COUNT(*) AS n FROM org_nodes').get() as { n: number }).n,
      members: (db.prepare('SELECT COUNT(*) AS n FROM space_members').get() as { n: number }).n,
      friendships: (
        db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted'").get() as { n: number }
      ).n,
      shares: (db.prepare('SELECT COUNT(*) AS n FROM shares').get() as { n: number }).n,
      tokens: sum((p) => p.tokenCount),
    },
    signup,
    active,
  })
})

const SORTS = {
  createdAt: 'createdAt',
  lastActiveAt: 'lastActiveAt',
  pageCount: 'pageCount',
  charCount: 'charCount',
  friendCount: 'friendCount',
  assetBytes: 'assetBytes',
  username: 'username',
} as const

type SortKey = keyof typeof SORTS

/** 人员列表：搜索 / 角色筛选 / 排序 / 分页 */
adminRouter.get('/admin/users', requireAdmin, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
  const role = typeof req.query.role === 'string' ? req.query.role : ''
  const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'createdAt'
  const order = req.query.order === 'asc' ? 1 : -1
  const page = Math.max(1, Number(req.query.page ?? 1) || 1)
  const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize ?? 20) || 20))

  const sortKey: SortKey = sortRaw in SORTS ? (sortRaw as SortKey) : 'createdAt'

  let list = buildPeople()
  if (role === 'admin' || role === 'user') list = list.filter((p) => p.role === role)
  if (q) {
    list = list.filter(
      (p) =>
        p.username.toLowerCase().includes(q) ||
        (p.nickname ?? '').toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q) ||
        (p.phone ?? '').includes(q),
    )
  }

  // lastActiveAt 空值统一排最后，不管升降序
  list.sort((a, b) => {
    if (sortKey === 'lastActiveAt') {
      const av = a.lastActiveAt ?? 0
      const bv = b.lastActiveAt ?? 0
      if (av === 0 && bv === 0) return b.createdAt - a.createdAt
      if (av === 0) return 1
      if (bv === 0) return -1
      return (av - bv) * order
    }
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * order
    return String(av).localeCompare(String(bv)) * order
  })

  const total = list.length
  const start = (page - 1) * pageSize
  res.json({
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: list.slice(start, start + pageSize),
  })
})

/** 单人详情：补充所在团队、好友名册、最近会话 */
adminRouter.get('/admin/users/:id', requireAdmin, (req, res) => {
  const id = param(req, 'id')
  const person = buildPeople().find((p) => p.id === id)
  if (!person) throw new HttpError(404, '用户不存在')

  const teams = db
    .prepare(
      `SELECT s.id, s.name, m.role, m.status, m.joined_at
       FROM space_members m JOIN spaces s ON s.id = m.space_id
       WHERE m.user_id = ? AND s.type = 'team'
       ORDER BY m.joined_at DESC`,
    )
    .all(id) as { id: string; name: string; role: string; status: string; joined_at: number }[]

  const friendRows = db
    .prepare(
      `SELECT CASE WHEN user_low = ? THEN user_high ELSE user_low END AS fid
       FROM friendships WHERE status = 'accepted' AND (user_low = ? OR user_high = ?)`,
    )
    .all(id, id, id) as { fid: string }[]
  const friendIds = friendRows.map((r) => r.fid)
  const friendUsers = friendIds.length
    ? (db
        .prepare(
          `SELECT id, username, nickname, avatar FROM users WHERE id IN (${friendIds.map(() => '?').join(',')})`,
        )
        .all(...friendIds) as { id: string; username: string; nickname: string | null; avatar: string | null }[])
    : []

  const sessions = db
    .prepare(
      `SELECT id, ip, ua, created_at, last_seen FROM sessions
       WHERE user_id = ? AND revoked = 0 ORDER BY last_seen DESC LIMIT 10`,
    )
    .all(id) as { id: string; ip: string | null; ua: string | null; created_at: number; last_seen: number }[]

  res.json({
    person,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      status: t.status,
      joinedAt: t.joined_at,
    })),
    friends: friendUsers.map((f) => ({
      id: f.id,
      username: f.username,
      name: f.nickname || f.username,
      avatar: f.avatar,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      ua: s.ua,
      createdAt: s.created_at,
      lastSeen: s.last_seen,
    })),
  })
})

/**
 * 管理端：全库快照导出。
 *
 * 用途：发布工具会把整个项目目录（含 server/data/ginkgo.db）压缩上传，覆盖线上库，
 * 导致用户在线上写的内容在下次发布时丢失。发布前先用本接口把线上库导出，回流合并
 * 回本地库，再发布，即可保住线上数据。仅管理员可调用；响应含账号与凭据哈希，
 * 调用方不得打印正文、不得让响应落到日志或公开仓库。
 * BLOB（如图片）以 { __blob_b64__ } 包装成 base64，便于 JSON 传输。
 */
adminRouter.get('/admin/snapshot', requireAdmin, (_req, res) => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]
  const snapshot: Record<string, Record<string, unknown>[]> = {}
  for (const { name } of tables) {
    // 表名来自 sqlite_master，仍做白名单校验，杜绝拼接注入
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]
    snapshot[name] = rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [col, value] of Object.entries(row)) {
        out[col] =
          value instanceof Uint8Array
            ? { __blob_b64__: Buffer.from(value).toString('base64') }
            : value
      }
      return out
    })
  }
  res.json({ ok: true, generatedAt: Date.now(), tables: snapshot })
})
