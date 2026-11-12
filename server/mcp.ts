import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import { authOf } from './auth.ts'
import { getDoc, listDocs, putPage, type Doc } from './db.ts'
import { ID_RE } from './http.ts'
import { emitPageEvent, pageEventOf } from './webhooks.ts'

/**
 * MCP（Model Context Protocol）服务，Streamable HTTP 传输的无状态实现：
 * 客户端把 JSON-RPC 请求 POST 到 /api/mcp，这里直接返回 JSON。
 * 认证用「设置 → MCP 与集成」里创建的个人访问令牌（Authorization: Bearer gn_xxx）。
 */

export const mcpRouter = Router()

const SERVER_VERSION = '0.3.0'

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

class ToolError extends Error {}

function plainText(md: string, limit = 200): string {
  return md
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

const TOOLS = [
  {
    name: 'search_pages',
    description: '按关键词搜索笔记标题与正文，返回匹配页面的 id、标题和摘要。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '最多返回条数，默认 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_pages',
    description: '列出笔记页面（不含回收站），可按父页面筛选，返回 id、标题、父页面与更新时间。',
    inputSchema: {
      type: 'object',
      properties: { parentId: { type: 'string', description: '只列出该页面的直接子页面；不传则列出全部' } },
    },
  },
  {
    name: 'read_page',
    description: '读取某个页面的标题与完整 Markdown 正文。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_page',
    description: '新建一个笔记页面，正文为 Markdown。需要可写令牌。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown 正文' },
        parentId: { type: 'string', description: '父页面 id，不传则放在根目录' },
        icon: { type: 'string', description: '页面图标，一个 emoji' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_page',
    description: '修改页面标题或正文。mode=append 时把 content 追加到正文末尾，默认整体替换。需要可写令牌。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'trash_page',
    description: '把页面（连同子页面）移到回收站，可在网页中恢复。需要可写令牌。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

const WRITE_TOOLS = new Set(['create_page', 'update_page', 'trash_page'])

function alivePages(owner: string): Doc[] {
  return listDocs<Doc>('pages', owner).filter((p) => !p.trashed)
}

function mustPage(owner: string, id: unknown): Doc {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new ToolError('页面 id 不合法')
  const p = getDoc<Doc>('pages', id, owner)
  if (!p || p.trashed) throw new ToolError('页面不存在')
  return p
}

function save(owner: string, before: Doc | null, page: Doc) {
  putPage(owner, page)
  emitPageEvent(owner, pageEventOf(before, page), page)
}

function callTool(owner: string, name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'search_pages': {
      const q = String(args.query ?? '').trim().toLowerCase()
      if (!q) throw new ToolError('query 不能为空')
      const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 50)
      const hits = alivePages(owner)
        .map((p) => {
          const title = String(p.title ?? '')
          const text = plainText(String(p.content ?? ''), 100_000)
          const ti = title.toLowerCase().indexOf(q)
          const ci = text.toLowerCase().indexOf(q)
          if (ti < 0 && ci < 0) return null
          const snippet = ci >= 0 ? text.slice(Math.max(0, ci - 40), ci + 80) : text.slice(0, 120)
          return { id: p.id, title: title || '未命名', snippet, score: ti >= 0 ? 2 : 1, updatedAt: p.updatedAt }
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => b.score - a.score || Number(b.updatedAt) - Number(a.updatedAt))
        .slice(0, limit)
      return JSON.stringify(hits.map(({ score: _s, ...h }) => h), null, 2)
    }
    case 'list_pages': {
      const parentId = typeof args.parentId === 'string' ? args.parentId : undefined
      const list = alivePages(owner)
        .filter((p) => parentId === undefined || p.parentId === parentId)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((p) => ({
          id: p.id,
          title: p.title || '未命名',
          parentId: p.parentId ?? null,
          updatedAt: new Date(Number(p.updatedAt)).toISOString(),
        }))
      return JSON.stringify(list, null, 2)
    }
    case 'read_page': {
      const p = mustPage(owner, args.id)
      return `# ${p.title || '未命名'}\n\n${String(p.content ?? '')}`
    }
    case 'create_page': {
      const title = String(args.title ?? '').slice(0, 200)
      const content = String(args.content ?? '')
      const parentId = typeof args.parentId === 'string' ? mustPage(owner, args.parentId).id : null
      const siblings = alivePages(owner).filter((p) => (p.parentId ?? null) === parentId)
      const now = Date.now()
      const page: Doc = {
        id: randomUUID(),
        title,
        icon: typeof args.icon === 'string' ? args.icon.slice(0, 16) : '',
        parentId,
        content,
        excerpt: plainText(content),
        favorite: false,
        trashed: false,
        trashedAt: null,
        createdAt: now,
        updatedAt: now,
        order: siblings.reduce((m, p) => Math.max(m, Number(p.order ?? 0)), 0) + 1,
        cover: null,
        locked: false,
      }
      save(owner, null, page)
      return JSON.stringify({ id: page.id, title: page.title, url: `/${page.id}` })
    }
    case 'update_page': {
      const before = mustPage(owner, args.id)
      if (before.locked) throw new ToolError('页面已锁定，请先在网页中解锁')
      const next: Doc = { ...before, updatedAt: Date.now() }
      if (typeof args.title === 'string') next.title = args.title.slice(0, 200)
      if (typeof args.content === 'string') {
        const cur = String(before.content ?? '')
        next.content = args.mode === 'append' ? `${cur.replace(/\s+$/, '')}\n\n${args.content}\n` : args.content
        next.excerpt = plainText(String(next.content))
      }
      save(owner, before, next)
      return JSON.stringify({ id: next.id, title: next.title, updated: true })
    }
    case 'trash_page': {
      const root = mustPage(owner, args.id)
      const all = listDocs<Doc>('pages', owner)
      const ids = new Set([root.id])
      let changed = true
      while (changed) {
        changed = false
        for (const p of all) {
          if (typeof p.parentId === 'string' && ids.has(p.parentId) && !ids.has(p.id)) {
            ids.add(p.id)
            changed = true
          }
        }
      }
      const now = Date.now()
      for (const p of all) if (ids.has(p.id) && !p.trashed) save(owner, p, { ...p, trashed: true, trashedAt: now })
      return JSON.stringify({ trashed: ids.size })
    }
    default:
      throw new ToolError(`未知工具：${name}`)
  }
}

function handle(res: Response, req: RpcRequest): unknown | undefined {
  const auth = authOf(res)
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: req.id ?? null, result })
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: req.id ?? null, error: { code, message } })

  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return err(-32600, 'Invalid Request')
  // 通知没有 id，不需要回复
  if (req.id === undefined) return undefined

  switch (req.method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ginkgo-notes', title: '银杏笔记', version: SERVER_VERSION },
        instructions: '银杏笔记的 MCP 服务：可以搜索、读取、新建和修改用户的 Markdown 笔记。',
      })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: TOOLS })
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>
      if (WRITE_TOOLS.has(name) && auth.apiToken?.scope === 'read') {
        return ok({ content: [{ type: 'text', text: '当前访问令牌只有读取权限，无法执行写入操作。' }], isError: true })
      }
      try {
        return ok({ content: [{ type: 'text', text: callTool(auth.owner, name, args) }] })
      } catch (e) {
        if (e instanceof ToolError) return ok({ content: [{ type: 'text', text: e.message }], isError: true })
        throw e
      }
    }
    default:
      return err(-32601, `Method not found: ${req.method}`)
  }
}

mcpRouter.post('/mcp', (req, res) => {
  const body = req.body as RpcRequest | RpcRequest[]
  if (Array.isArray(body)) {
    const out = body.map((r) => handle(res, r)).filter((r) => r !== undefined)
    if (!out.length) res.status(202).end()
    else res.json(out)
    return
  }
  const out = handle(res, body)
  if (out === undefined) res.status(202).end()
  else res.json(out)
})

mcpRouter.get('/mcp', (_req, res) => {
  res.status(405).json({ error: '本服务只支持 POST（无状态 Streamable HTTP）' })
})

mcpRouter.delete('/mcp', (_req, res) => {
  res.status(405).end()
})
