/**
 * 探测本地开发库里每个账号的真实密码。
 *
 * 密码在库里是 scrypt 单向哈希，不可反解；但本地开发库的账号有明显的密码规律
 * （种子脚本固定密码、批量建号「账号=初始密码=手机号」），所以用候选表逐个校验。
 * 仅用于本地开发库，切勿对生产库使用。
 *
 * 用法：node scripts/probe-passwords.mjs [--reset]
 *   不带 --reset：只读探测，报告命中情况
 *   带 --reset：把没命中候选的账号统一重置（会改库！）
 */
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dbPath = process.env.GINKGO_DB ?? resolve('server/data/ginkgo.db')
if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`)
  process.exit(1)
}
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000')

function verify(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  try {
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
function hashPassword(password) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`
}

/** 候选密码表：通用弱口令 + 账号派生 + 手机号本身 */
const COMMON = [
  'admin123', 'admin1234', 'admin', 'admin888', '123456', '12345678', '1234567890',
  'password', 'password123', 'pass1234', 'passw0rd', 'test1234', 'test123456',
  'demo1234', 'demo123456', 'ginkgo1234', 'ginkgo', 'ginkgo123', 'ginkgodb',
  'qwer1234', 'qwerty123', 'abc123456', 'a12345678', '111111', '666666', '888888',
  'Aa123456', 'Aa12345678', 'Abc123456', 'Abc12345678', 'root1234', 'root',
  'changeme', 'letmein', 'welcome', 'welcome1', 'user1234', 'user123456',
]

const users = db.prepare('SELECT id, username, password_hash, role, nickname, phone, email FROM users').all()
const results = []
for (const u of users) {
  const cands = new Set(COMMON)
  cands.add(u.username)
  if (u.username && /^\d+$/.test(u.username)) cands.add(u.username)
  if (u.phone) cands.add(u.phone)
  if (u.nickname) cands.add(u.nickname)
  let hit = null
  for (const c of cands) {
    if (verify(c, u.password_hash)) { hit = c; break }
  }
  results.push({ ...u, password: hit })
}

const ok = results.filter((r) => r.password)
const miss = results.filter((r) => !r.password)
console.log(`总账号 ${results.length}，候选命中 ${ok.length}，未命中 ${miss.length}`)
console.log('\n--- 命中 ---')
for (const r of ok) console.log(`${r.username}\t${r.password}\t${r.role}`)
console.log('\n--- 未命中 ---')
for (const r of miss) console.log(`${r.username}\t(${r.role})\t${r.nickname ?? ''}\t${r.phone ?? ''}`)

if (process.argv.includes('--reset') && miss.length) {
  const NEW = 'ginkgo1234'
  for (const r of miss) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(NEW), r.id)
  }
  console.log(`\n已把 ${miss.length} 个账号的密码重置为 ${NEW}`)
}
