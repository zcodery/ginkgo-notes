/**
 * 发布前必跑：把线上库的数据回流合并到本地 server/data/ginkgo.db，
 * 避免发布时本地快照覆盖掉用户在线上写的内容。
 *
 * 用法：
 *   node scripts/pull-prod-data.mjs            # 默认线上地址 + 默认分享码
 *   GINKGO_BASE_URL=https://xxx GINKGO_SHARE_CODE=yyyy node scripts/pull-prod-data.mjs
 *
 * 原理：用本地库里的 jwt_secret 签一个 admin 令牌（签名密钥本地线上一致），
 * 调线上 GET /api/admin/snapshot 拿全表快照，再逐表 INSERT OR REPLACE 回本地。
 * 跳过 app_meta（JWT 密钥必须与本地一致，否则本地会话全失效）—— 这是唯一
 * 需要以本地为准的表；其余表线上优先，线上没有的行保留本地（团队/种子数据）。
 *
 * 不会打印任何正文、密钥或令牌。
 */
import { DatabaseSync } from 'node:sqlite'
import { createHmac } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(here, '..', 'server', 'data', 'ginkgo.db')
const BASE = process.env.GINKGO_BASE_URL ?? 'https://ginkgo-notes.app.workbuddy.host'
const SHARE = process.env.GINKGO_SHARE_CODE ?? '5BCZKAOB2D'
// 这些表必须以本地为准：app_meta 含 jwt_secret，覆盖会让本地全部令牌失效
const KEEP_LOCAL = new Set(['app_meta'])

function signToken(secret, sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const now = Math.floor(Date.now() / 1000)
  const payload = b64({ sub, iat: now, exp: now + 3600 })
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const db = new DatabaseSync(DB_PATH)
let secret
let adminId
try {
  secret = db.prepare("SELECT value FROM app_meta WHERE key='jwt_secret'").get()?.value
  adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").get()?.id
} catch (e) {
  console.error('读取本地库失败：', e.message)
  process.exit(1)
}
if (!secret || !adminId) {
  console.error('本地库缺少 jwt_secret 或 admin 用户，无法签名')
  process.exit(1)
}

const token = signToken(secret, adminId)
let snapshot
try {
  const res = await fetch(`${BASE}/api/admin/snapshot?sharecode=${encodeURIComponent(SHARE)}`, {
    headers: { 'x-ginkgo-token': token },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`线上快照接口返回 ${res.status}：${text.slice(0, 200)}`)
    process.exit(1)
  }
  snapshot = await res.json()
} catch (e) {
  console.error('拉取线上快照失败：', e.message)
  process.exit(1)
}

if (!snapshot?.ok || !snapshot?.tables) {
  console.error('快照格式不正确')
  process.exit(1)
}

// 逐表合并：线上行以主键/唯一键 REPLACE 进本地；本地独有行保留。
// 用 SQLite 的 INSERT OR REPLACE 依赖表本身的主键/唯一约束，语义正确。
let mergedTables = 0
let mergedRows = 0
const skipped = []
db.exec('PRAGMA busy_timeout = 8000')
db.exec('BEGIN')
try {
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (KEEP_LOCAL.has(table)) {
      skipped.push(table)
      continue
    }
    if (!Array.isArray(rows) || rows.length === 0) continue
    // 校验表名，杜绝拼接注入（快照来自我们自己的服务，仍防御）
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) continue
    // 取本地表结构确认列存在，跳过线上多出的列
    const cols = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name))
    if (cols.size === 0) continue
    const usable = Object.keys(rows[0]).filter((k) => cols.has(k))
    if (usable.length === 0) continue
    const placeholders = usable.map(() => '?').join(',')
    const sql = `INSERT OR REPLACE INTO "${table}" (${usable.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders})`
    const stmt = db.prepare(sql)
    for (const row of rows) {
      const values = usable.map((c) => {
        const v = row[c]
        if (v && typeof v === 'object' && '__blob_b64__' in v) {
          return Buffer.from(v.__blob_b64__, 'base64')
        }
        return v ?? null
      })
      stmt.run(...values)
      mergedRows++
    }
    mergedTables++
  }
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error('合并失败，已回滚：', e.message)
  db.close()
  process.exit(1)
}

db.close()
console.log(`回流完成：合并 ${mergedTables} 张表 / ${mergedRows} 行；保留本地表：${skipped.join(', ') || '无'}`)
console.log('现在可以安全发布——线上内容已并入本地库。')
