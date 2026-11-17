/**
 * 给存量代注册账号补发公共原稿。
 *
 * 背景：团队「批量建号」这条路径（POST /spaces/:id/members/register）早期
 * 漏了 copyTemplatesToUser，导致这批账号登录后是空空间。代码已修好，
 * 但库里已存在的账号不会自动补上，本脚本负责追平。
 *
 * 筛选条件（三条同时满足，避免误伤）：
 *   1. 用户名是 11 位手机号 —— 只有代注册账号满足这个形态；
 *   2. 是某个团队空间的活跃成员 —— 排除孤立的历史账号；
 *   3. 名下没有任何页面 —— 已经发过的不重复发。
 *
 * 用法：
 *   node scripts/backfill-public-templates.mjs          # 先看会改哪些账号
 *   node scripts/backfill-public-templates.mjs --apply  # 真正执行
 *
 * 幂等：重复执行不会产生第二份副本（条件 3 会把已发过的账号跳过）。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const APPLY = process.argv.includes('--apply')

const dbPath = process.env.GINKGO_DB ?? resolve('server/data/ginkgo.db')
if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}\n请先启动一次服务再运行本脚本。`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000')

/* 公共原稿与补发逻辑都从 server/ 里取，避免和线上实现漂移 */
const { copyTemplatesToUser } = await import('../server/templates.ts')

/**
 * 候选账号：手机号用户名 + 团队活跃成员 + 零页面。
 * 直接用 SQL 拼出交集，剩下的判断在 JS 里做，方便逐条打印原因。
 */
const candidates = db
  .prepare(
    `SELECT DISTINCT u.id, u.username, u.nickname
       FROM users u
       JOIN space_members m ON m.user_id = u.id AND m.status = 'active'
       JOIN spaces s ON s.id = m.space_id AND s.type = 'team'
      WHERE u.username GLOB '[0-9]*'
      ORDER BY u.created_at`,
  )
  .all()
  .filter((u) => /^1[3-9]\d{9}$/.test(u.username))

const targets = candidates.filter(
  (u) => db.prepare('SELECT COUNT(*) AS n FROM pages WHERE owner = ?').get(u.id).n === 0,
)

if (!targets.length) {
  console.log('没有需要补发的账号（所有手机号账号都已有页面）。')
  process.exit(0)
}

console.log(`找到 ${targets.length} 个待补发账号：`)
for (const u of targets) {
  console.log(`  ${u.username}${u.nickname ? `（${u.nickname}）` : ''}`)
}

if (!APPLY) {
  console.log('\n这是预览。加 --apply 才会真正写入。')
  process.exit(0)
}

let ok = 0
const failed = []
for (const u of targets) {
  try {
    copyTemplatesToUser(u.id)
    const pages = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE owner = ?').get(u.id).n
    const dbs = db.prepare('SELECT COUNT(*) AS n FROM databases WHERE owner = ?').get(u.id).n
    if (pages > 0) {
      ok++
      console.log(`  ✓ ${u.username}：${pages} 个页面 / ${dbs} 个多维表格`)
    } else {
      failed.push([u.username, '补发后仍无页面'])
    }
  } catch (e) {
    failed.push([u.username, e instanceof Error ? e.message : String(e)])
  }
}

console.log(`\n补发完成：成功 ${ok} 个，失败 ${failed.length} 个。`)
for (const [name, why] of failed) console.error(`  ✗ ${name}：${why}`)
db.close()
process.exit(failed.length ? 1 : 0)
