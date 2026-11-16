import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 给管理员准备几个好友与团队成员，便于本地测试分享/邀请效果。
 *
 * 用法：node scripts/seed-demo-friends.mjs
 * 幂等：用户名已存在则复用，不覆盖密码与资料。
 */

const dbPath = process.env.GINKGO_DB ?? resolve('server/data/ginkgo.db')
if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}\n请先启动一次服务再运行本脚本。`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000')

function hasTable(name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

const admin = db
  .prepare("SELECT id, username, nickname FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")
  .get()
if (!admin) {
  console.error('没有找到管理员账号，请先启动服务完成初始化。')
  process.exit(1)
}

const demos = [
  { username: 'demo_zhang', nickname: '张三' },
  { username: 'demo_li', nickname: '李四' },
  { username: 'demo_wang', nickname: '王五' },
  { username: 'demo_zhao', nickname: '赵六' },
  { username: 'demo_chen', nickname: '陈七' },
]
const demoPassword = 'demo1234'
const now = Date.now()
const ids = {}

const hasSpaces = hasTable('spaces')
const hasFriends = hasTable('friendships')
const hasMembers = hasTable('space_members')
const hasNodes = hasTable('org_nodes')

for (const d of demos) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(d.username)
  if (existing) {
    ids[d.username] = existing.id
    continue
  }
  const id = randomUUID()
  db.prepare(
    'INSERT INTO users (id, username, password_hash, role, created_at, nickname) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, d.username, hashPassword(demoPassword), 'user', now, d.nickname)
  ids[d.username] = id
  if (hasSpaces) {
    db.prepare('INSERT OR IGNORE INTO spaces (id, type, name, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      'personal',
      d.nickname,
      id,
      now,
    )
  }
  console.log(`创建用户 ${d.username}（${d.nickname}）`)
}

if (hasFriends) {
  for (const d of demos) {
    const other = ids[d.username]
    const [low, high] = admin.id < other ? [admin.id, other] : [other, admin.id]
    const existing = db.prepare('SELECT 1 FROM friendships WHERE user_low = ? AND user_high = ?').get(low, high)
    if (existing) continue
    db.prepare(
      `INSERT INTO friendships (id, user_low, user_high, status, requested_by, message, created_at, updated_at)
       VALUES (?, ?, ?, 'accepted', ?, NULL, ?, ?)`,
    ).run(randomUUID(), low, high, admin.id, now, now)
    console.log(`建立好友关系：管理员 ↔ ${d.nickname}`)
  }
}

// 顺便把 demo 用户加入管理员已有的第一个团队，方便测试「好友 / 团队成员」混合选择
if (hasMembers && hasNodes) {
  const team = db.prepare("SELECT id FROM spaces WHERE type = 'team' ORDER BY created_at LIMIT 1").get()
  if (team) {
    const root = db
      .prepare('SELECT id FROM org_nodes WHERE space_id = ? ORDER BY depth, created_at LIMIT 1')
      .get(team.id)
    demos.forEach((d, i) => {
      const userId = ids[d.username]
      const exists = db
        .prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?')
        .get(team.id, userId)
      if (exists) return
      db.prepare(
        `INSERT INTO space_members (space_id, user_id, org_node_id, role, status, joined_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      ).run(team.id, userId, root?.id ?? '', i === 0 ? 'editor' : 'viewer', now)
    })
    console.log(`已将 demo 用户加入团队 ${team.id}`)
  }
}

const adminLabel = admin.nickname || admin.username
console.log('\n完成。管理员：', adminLabel)
console.log('测试好友：', demos.map((d) => `${d.nickname}(${d.username})`).join('、'))
console.log('统一密码：', demoPassword)
console.log('提示：重新登录管理员后，在「分享 → 邀请成员」或「团队 → 成员邀请」中即可看到这些好友。')