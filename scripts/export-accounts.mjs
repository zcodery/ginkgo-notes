/**
 * 把本地开发库里的所有账号导成一份 Excel（含明文密码），方便切换账号测试逻辑。
 *
 * 密码在库里是 scrypt 单向哈希，不可反解。本脚本用候选口令逐个校验来恢复——
 * 本地开发库的账号密码有明确规律：
 *   1) 种子脚本创建的演示账号使用固定口令（见 scripts/seed-demo-friends.mjs）
 *   2) 团队「批量建号」的账号遵循「账号 = 初始密码 = 手机号」（见 server/routes.ts 注册逻辑）
 *   3) 管理员用初始化时的 ADMIN_PASSWORD 环境变量
 * 候选表全部落空时，可用 --reset 统一重置（会改库）。
 *
 * 注意：本脚本仅用于本地开发库，依赖上述开发期口令规律；切勿对生产库使用。
 *
 * 用法：
 *   node scripts/export-accounts.mjs                    # 导出到 server/data/账号清单.xlsx
 *   node scripts/export-accounts.mjs --out D:/xx.xlsx   # 指定输出路径
 *   node scripts/export-accounts.mjs --reset            # 候选未命中的账号统一重置密码
 */
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}

const dbPath = process.env.GINKGO_DB ?? resolve('server/data/ginkgo.db')
if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}\n请先启动一次服务再运行本脚本。`)
  process.exit(1)
}
const outPath = resolve(argOf('--out') ?? 'server/data/账号清单.xlsx')

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA busy_timeout = 5000')

/* ---------------- 密码校验与恢复 ---------------- */

function verifyPassword(password, stored) {
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

/** 通用弱口令候选 */
const COMMON = [
  'admin123', 'admin1234', 'admin', 'admin888', '123456', '12345678', '1234567890',
  'password', 'password123', 'pass1234', 'passw0rd', 'test1234', 'test123456',
  'demo1234', 'demo123456', 'ginkgo1234', 'ginkgo', 'ginkgo123',
  'qwer1234', 'qwerty123', 'abc123456', 'a12345678', '111111', '666666', '888888',
  'Aa123456', 'Aa12345678', 'Abc123456', 'Abc12345678', 'root1234', 'root',
  'changeme', 'letmein', 'welcome', 'welcome1', 'user1234', 'user123456',
]
const RESET_PASSWORD = 'ginkgo1234'

/* ---------------- 取数 ---------------- */

const users = db.prepare('SELECT id, username, password_hash, role, nickname, phone, email, created_at FROM users').all()

const accounts = []
for (const u of users) {
  const cands = new Set(COMMON)
  cands.add(u.username)
  if (u.phone) cands.add(u.phone)
  if (u.nickname) cands.add(u.nickname)

  let password = null
  for (const c of cands) {
    if (verifyPassword(c, u.password_hash)) { password = c; break }
  }

  const meta = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM spaces s WHERE s.owner_user_id = u.id) AS owned,
      (SELECT COUNT(*) FROM space_members m WHERE m.user_id = u.id) AS joined,
      (SELECT COUNT(*) FROM friendships f
        WHERE (f.user_low = u.id OR f.user_high = u.id) AND f.status = 'accepted') AS friends,
      (SELECT COUNT(*) FROM notifications n WHERE n.user_id = u.id AND n.read_at IS NULL) AS unread
    FROM users u WHERE u.id = ?`).get(u.id)

  accounts.push({
    username: u.username,
    password,
    nickname: u.nickname ?? '',
    role: u.role,
    phone: u.phone ?? '',
    email: u.email ?? '',
    owned: meta?.owned ?? 0,
    joined: meta?.joined ?? 0,
    friends: meta?.friends ?? 0,
    unread: meta?.unread ?? 0,
    createdAt: u.created_at,
  })
}

/* 未命中候选的账号：可选统一重置 */
const misses = accounts.filter((a) => !a.password)
if (misses.length) {
  if (argv.includes('--reset')) {
    for (const a of misses) {
      const row = users.find((u) => u.username === a.username)
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(RESET_PASSWORD), row.id)
    }
    for (const a of misses) a.password = RESET_PASSWORD
    console.log(`已把 ${misses.length} 个候选未命中的账号密码重置为 ${RESET_PASSWORD}`)
  } else {
    console.warn(`⚠️ ${misses.length} 个账号无法恢复密码：${misses.map((m) => m.username).join(', ')}`)
    console.warn('   加 --reset 可把它们统一重置为', RESET_PASSWORD)
  }
}

/* ---------------- 写 xlsx（zip + XML，与前端 memberImport 同一套做法） ---------------- */

const COLS = [
  ['账号', 'username', 22],
  ['密码', 'password', 20],
  ['昵称', 'nickname', 16],
  ['角色', 'role', 10],
  ['手机号', 'phone', 16],
  ['邮箱', 'email', 24],
  ['自建空间', 'owned', 11],
  ['加入空间', 'joined', 11],
  ['好友数', 'friends', 10],
  ['未读通知', 'unread', 11],
  ['注册时间', 'createdAt', 20],
]

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i) {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const fmtTime = (ms) => {
  const d = new Date(Number(ms))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const headerCells = COLS.map((c, i) =>
  `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${esc(c[0])}</t></is></c>`).join('')

const bodyRows = accounts
  .slice()
  .sort((a, b) => (a.role === b.role ? a.createdAt - b.createdAt : a.role === 'admin' ? -1 : 1))
  .map((a, ri) => {
    const r = ri + 2
    const cells = COLS.map((c, ci) => {
      const raw = a[c[1]]
      const ref = `${colName(ci)}${r}`
      if (c[1] === 'createdAt') return `<c r="${ref}" t="inlineStr"><is><t>${fmtTime(raw)}</t></is></c>`
      if (typeof raw === 'number') return `<c r="${ref}"><v>${raw}</v></c>`
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(raw)}</t></is></c>`
    }).join('')
    return `<row r="${r}">${cells}</row>`
  })
  .join('')

const colsXml = COLS.map((c, i) =>
  `<col min="${i + 1}" max="${i + 1}" width="${c[2]}" customWidth="1"/>`).join('')

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const files = {
  '[Content_Types].xml': strToU8(
    `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  ),
  '_rels/.rels': strToU8(
    `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  ),
  'xl/workbook.xml': strToU8(
    `${DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<sheets><sheet name="账号清单" sheetId="1" r:id="rId1"/></sheets></workbook>',
  ),
  'xl/_rels/workbook.xml.rels': strToU8(
    `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  ),
  'xl/styles.xml': strToU8(
    `${DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF4C7A5A"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
      '</styleSheet>',
  ),
  'xl/worksheets/sheet1.xml': strToU8(
    `${DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<cols>${colsXml}</cols>` +
      `<sheetData><row r="1" s="1" customFormat="1">${headerCells}</row>${bodyRows}</sheetData>` +
      '</worksheet>',
  ),
}

writeFileSync(outPath, Buffer.from(zipSync(files, { level: 6 })))
db.close()

const recovered = accounts.filter((a) => a.password).length
console.log(`\n导出完成：${outPath}`)
console.log(`账号总数 ${accounts.length}，含明文密码 ${recovered}`)
console.log('表头：' + COLS.map((c) => c[0]).join(' / '))
