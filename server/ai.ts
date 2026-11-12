import { Router } from 'express'
import { authOf } from './auth.ts'
import { getUserSetting, setUserSetting } from './db.ts'
import { HttpError } from './http.ts'

/**
 * AI 助手：转发到任意 OpenAI 兼容的 /chat/completions 接口。
 * 优先用用户自己填写的配置，其次用服务端环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL。
 * API Key 只存在服务端，前端只能看到是否已填写和末四位。
 */

export const aiRouter = Router()

interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const SERVER_CONFIG: AiConfig = {
  baseUrl: process.env.AI_BASE_URL ?? '',
  apiKey: process.env.AI_API_KEY ?? '',
  model: process.env.AI_MODEL ?? '',
}

function userConfig(userId: string): AiConfig {
  return getUserSetting<AiConfig>(userId, 'ai', { baseUrl: '', apiKey: '', model: '' })
}

function effectiveConfig(userId: string): { cfg: AiConfig; source: 'user' | 'server' | 'none' } {
  const u = userConfig(userId)
  if (u.baseUrl && u.apiKey) return { cfg: { ...u, model: u.model || 'gpt-4o-mini' }, source: 'user' }
  if (SERVER_CONFIG.baseUrl && SERVER_CONFIG.apiKey) {
    return { cfg: { ...SERVER_CONFIG, model: SERVER_CONFIG.model || 'gpt-4o-mini' }, source: 'server' }
  }
  return { cfg: u, source: 'none' }
}

aiRouter.get('/ai/config', (_req, res) => {
  const { user } = authOf(res)
  const u = userConfig(user.id)
  const { source } = effectiveConfig(user.id)
  res.json({
    baseUrl: u.baseUrl,
    model: u.model,
    hasKey: !!u.apiKey,
    keyHint: u.apiKey ? `••••${u.apiKey.slice(-4)}` : '',
    source,
    serverAvailable: !!(SERVER_CONFIG.baseUrl && SERVER_CONFIG.apiKey),
  })
})

aiRouter.put('/ai/config', (req, res) => {
  const { user, apiToken } = authOf(res)
  if (apiToken) throw new HttpError(403, '该操作需要在网页中登录后进行')
  const cur = userConfig(user.id)
  const { baseUrl, apiKey, model } = req.body ?? {}
  if (baseUrl !== undefined) {
    if (typeof baseUrl !== 'string') throw new HttpError(400, '接口地址格式不正确')
    const v = baseUrl.trim().replace(/\/+$/, '')
    if (v && !/^https?:\/\//.test(v)) throw new HttpError(400, '接口地址需以 http:// 或 https:// 开头')
    cur.baseUrl = v.slice(0, 300)
  }
  if (apiKey !== undefined) cur.apiKey = typeof apiKey === 'string' ? apiKey.trim().slice(0, 300) : ''
  if (model !== undefined) cur.model = typeof model === 'string' ? model.trim().slice(0, 100) : ''
  setUserSetting(user.id, 'ai', cur)
  res.json({ ok: true })
})

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function asMessages(v: unknown): ChatMessage[] {
  if (!Array.isArray(v) || !v.length || v.length > 40) throw new HttpError(400, '消息格式不正确')
  return v.map((m) => {
    const role = (m as ChatMessage)?.role
    const content = (m as ChatMessage)?.content
    if (!['system', 'user', 'assistant'].includes(role) || typeof content !== 'string') {
      throw new HttpError(400, '消息格式不正确')
    }
    return { role, content: content.slice(0, 60_000) }
  })
}

aiRouter.post('/ai/chat', async (req, res) => {
  const { user } = authOf(res)
  const { cfg, source } = effectiveConfig(user.id)
  if (source === 'none') throw new HttpError(400, '还没有配置 AI 模型，请到「设置 → AI 助手」填写接口地址与 API Key')
  const messages = asMessages(req.body?.messages)
  const stream = req.body?.stream !== false
  const ctrl = new AbortController()
  req.on('close', () => ctrl.abort())

  let upstream: globalThis.Response
  try {
    upstream = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream,
        temperature: typeof req.body?.temperature === 'number' ? req.body.temperature : 0.7,
      }),
      signal: ctrl.signal,
    })
  } catch (err) {
    throw new HttpError(502, `无法连接 AI 服务：${err instanceof Error ? err.message : String(err)}`)
  }

  if (!upstream.ok) {
    let detail = ''
    try {
      const data = (await upstream.json()) as { error?: { message?: string } | string }
      detail = typeof data.error === 'string' ? data.error : (data.error?.message ?? '')
    } catch {
      /* 非 JSON */
    }
    throw new HttpError(502, `AI 服务返回错误（${upstream.status}）${detail ? `：${detail}` : ''}`)
  }

  if (!stream || !upstream.body) {
    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] }
    res.json({ content: data.choices?.[0]?.message?.content ?? '' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } catch {
    /* 客户端中途取消 */
  } finally {
    res.end()
  }
})
