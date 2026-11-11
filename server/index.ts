import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUser, findUserByName } from './auth.ts'
import { db } from './db.ts'
import { api } from './routes.ts'
import { copyTemplatesToUser, seedPublicTemplates } from './templates.ts'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3101)

function ensureAdmin(): void {
  const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()
  if (hasAdmin) return
  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const password = process.env.ADMIN_PASSWORD ?? 'admin123'
  if (findUserByName(username)) {
    db.prepare("UPDATE users SET role = 'admin' WHERE username = ?").run(username)
    console.log(`[ginkgo] 已把已有用户 ${username} 设为管理员`)
    return
  }
  const admin = createUser(username, password, 'admin')
  copyTemplatesToUser(admin.id)
  console.log(`[ginkgo] 已创建管理员账号 ${username}，初始密码 ${password}，请登录后尽快修改`)
}

seedPublicTemplates()
ensureAdmin()

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use('/api', api)

// 生产环境：同一个进程直接托管前端构建产物
const dist = resolve(here, '..', 'dist')
if (existsSync(resolve(dist, 'index.html'))) {
  app.use(express.static(dist))
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[ginkgo] 后端已启动：http://localhost:${PORT}`)
})
