import { ApiError, api, apiBlob, apiMaybe, apiUpload } from '@/api/client'
import type { Asset, Page, TreeNode } from '@/types'

/** 服务端版本已变：把当前版本与内容交给上层决定覆盖 / 另存 / 放弃 */
export class VersionConflictError extends Error {
  currentVersion: number | null
  current: Page | null
  constructor(currentVersion: number | null, current: Page | null) {
    super('文档已被他人修改')
    this.currentVersion = currentVersion
    this.current = current
  }
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * 同一份数据的「先读后写」必须串行，否则标题和正文两路保存交错时，
 * 后到的请求会用旧快照把先到的修改覆盖掉。
 */
const locks = new Map<string, Promise<unknown>>()

export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  locks.set(key, next)
  void next
    .catch(() => undefined)
    .finally(() => {
      if (locks.get(key) === next) locks.delete(key)
    })
  return next
}

/** 等所有排队中的写入完成（退出登录、切换空间前调用，避免用新身份去写旧数据） */
export async function whenWritesIdle(): Promise<void> {
  while (locks.size) {
    await Promise.allSettled([...locks.values()])
  }
}

/** 把 Markdown 粗转成纯文本，用于搜索与摘要 */
export function toPlainText(md: string, limit = 240): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, limit)
}

/**
 * 生成摘要。
 *
 * 正文里引用的多维表格只有一个 ID，标题存在表本身里；
 * 这里把被引用表格的标题也拼进摘要，全局搜索才搜得到。
 */
async function excerptOf(content: string): Promise<string> {
  const body = toPlainText(content, 200)
  if (!content.includes('```ginkgo-db')) return body
  const { databaseRefs, getDatabase } = await import('./databases')
  const ids = databaseRefs(content)
  const titles = await Promise.all(ids.map(async (id) => (await getDatabase(id))?.title ?? ''))
  const extra = titles.filter(Boolean).join(' ')
  return extra ? `${body} ${extra}`.trim() : body
}

export function titleFromMarkdown(md: string): string {
  const first = md
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first) return ''
  return first.replace(/^#{1,6}\s+/, '').replace(/[*_`~]/g, '').slice(0, 80)
}

/* ---------------- 页面 ---------------- */

export async function listPages(): Promise<Page[]> {
  return api<Page[]>('GET', '/pages')
}

export async function getPage(id: string): Promise<Page | undefined> {
  return apiMaybe<Page>('GET', `/pages/${encodeURIComponent(id)}`)
}

async function putPage(page: Page, baseVersion?: number): Promise<void> {
  const body: Record<string, unknown> = { ...page }
  if (baseVersion !== undefined) body.baseVersion = baseVersion
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await api('PUT', `/pages/${encodeURIComponent(page.id)}`, body)
      return
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) throw err
      // 409 = 写入竞态：多标签页 / 多设备同时编辑时，服务端 version 已被推进。
      // 拉取最新版本作为新 baseVersion 重试，保留本地正在编辑的内容，避免把
      // 用户自己另一个标签页的保存误判成「他人修改」而卡死。最多重试 3 次。
      const conflict = () => {
        const data = err.data as { currentVersion?: number; current?: Page } | null
        return new VersionConflictError(data?.currentVersion ?? null, data?.current ?? null)
      }
      if (attempt === 2 || baseVersion === undefined) throw conflict()
      const latest = await getPage(page.id)
      if (!latest) throw conflict()
      body.baseVersion = latest.version
    }
  }
}

async function batchPages(upsert: Page[], remove: string[] = []): Promise<void> {
  if (!upsert.length && !remove.length) return
  await api('POST', '/pages/batch', { upsert, remove })
}

export async function createPage(
  init: Partial<Page> & { after?: string } = {},
): Promise<Page> {
  const now = Date.now()
  const siblings = (await listPages()).filter(
    (p) => p.parentId === (init.parentId ?? null) && !p.trashed,
  )
  const maxOrder = siblings.reduce((m, p) => Math.max(m, p.order), 0)
  const page: Page = {
    id: uid(),
    title: init.title ?? '',
    icon: init.icon ?? '',
    parentId: init.parentId ?? null,
    content: init.content ?? '',
    excerpt: await excerptOf(init.content ?? ''),
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    order: maxOrder + 1,
    cover: init.cover ?? null,
    locked: init.locked ?? false,
  }
  await putPage(page)
  return page
}

export function savePage(id: string, patch: Partial<Page>): Promise<void> {
  return serial(`page:${id}`, async () => {
    const cur = await getPage(id)
    if (!cur) return
    const next: Page = { ...cur, ...patch, updatedAt: Date.now() }
    if (patch.content !== undefined) {
      next.excerpt = await excerptOf(patch.content)
      if (!next.title && !patch.title) {
        const t = titleFromMarkdown(patch.content)
        if (t) next.title = t
      }
    }
    await putPage(next, cur.version)
  })
}

/** 保存正文，返回新的摘要 */
export function saveContent(id: string, content: string, title?: string): Promise<string> {
  return serial(`page:${id}`, async () => {
    const cur = await getPage(id)
    if (!cur) return ''
    const excerpt = await excerptOf(content)
    await putPage(
      {
        ...cur,
        content,
        excerpt,
        title: title !== undefined ? title : cur.title,
        updatedAt: Date.now(),
      },
      cur.version,
    )
    return excerpt
  })
}

function collectSubtree(all: Page[], id: string): Set<string> {
  const collect = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const p of all) {
      if (p.parentId && collect.has(p.parentId) && !collect.has(p.id)) {
        collect.add(p.id)
        changed = true
      }
    }
  }
  return collect
}

export async function trashPage(id: string): Promise<void> {
  const all = await listPages()
  const now = Date.now()
  const ids = collectSubtree(all, id)
  await batchPages(
    all.filter((p) => ids.has(p.id)).map((p) => ({ ...p, trashed: true, trashedAt: now })),
  )
}

export async function restorePage(id: string): Promise<void> {
  const all = await listPages()
  const trashed = all.find((p) => p.id === id)
  if (!trashed) return
  // 父级若还在回收站，则挂到根目录
  const parentTrashed = trashed.parentId
    ? all.find((p) => p.id === trashed.parentId)?.trashed
    : false
  await putPage({
    ...trashed,
    trashed: false,
    trashedAt: null,
    parentId: parentTrashed ? null : trashed.parentId,
  })
}

export async function deletePageForever(id: string): Promise<void> {
  const all = await listPages()
  await batchPages([], [...collectSubtree(all, id)])
}

export async function movePage(
  id: string,
  parentId: string | null,
  order: number,
): Promise<void> {
  const all = await listPages()
  const p = all.find((x) => x.id === id)
  if (!p) return
  // 防止拖到自己的后代里造成环
  let cursor = parentId
  while (cursor) {
    if (cursor === id) return
    cursor = all.find((x) => x.id === cursor)?.parentId ?? null
  }
  await putPage({ ...p, parentId, order, updatedAt: Date.now() })
}

export async function reorderSiblings(ids: string[]): Promise<void> {
  const all = await listPages()
  const byId = new Map(all.map((p) => [p.id, p]))
  const upsert: Page[] = []
  let i = 1
  for (const id of ids) {
    const p = byId.get(id)
    if (p) upsert.push({ ...p, order: i++ })
  }
  await batchPages(upsert)
}

export function buildTree(pages: Page[]): TreeNode[] {
  const alive = pages.filter((p) => !p.trashed)
  const map = new Map<string, TreeNode>()
  for (const p of alive) map.set(p.id, { ...p, children: [], depth: 0 })
  const roots: TreeNode[] = []
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRec = (nodes: TreeNode[], depth: number) => {
    nodes.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    for (const n of nodes) {
      n.depth = depth
      sortRec(n.children, depth + 1)
    }
  }
  sortRec(roots, 0)
  return roots
}

export function descendantIds(pages: Page[], id: string): string[] {
  const out: string[] = []
  const walk = (pid: string) => {
    for (const p of pages) {
      if (p.parentId === pid) {
        out.push(p.id)
        walk(p.id)
      }
    }
  }
  walk(id)
  return out
}

/* ---------------- 资源（图片） ---------------- */

type AssetMeta = Omit<Asset, 'blob'>

export type AssetSummary = Pick<Asset, 'id' | 'name' | 'type' | 'size' | 'createdAt'>

export async function putAsset(
  file: Blob,
  name?: string,
  id?: string,
  kind?: 'image' | 'icon',
): Promise<Asset> {
  const fileName = name ?? (file as File).name ?? 'image'
  const params = new URLSearchParams()
  if (id) params.set('id', id)
  if (kind) params.set('kind', kind)
  const qs = params.toString()
  const query = qs ? `?${qs}` : ''
  const meta = await apiUpload<AssetMeta>(`/assets${query}`, file, fileName, kind)
  return { ...meta, blob: file }
}

/** 当前用户上传过的资源；kind='icon' 用于图标库跨页复用 */
export async function listAssets(kind: 'image' | 'icon' = 'icon', limit = 60): Promise<AssetSummary[]> {
  const res = await api<{ items: AssetSummary[] }>(
    'GET',
    `/assets?kind=${encodeURIComponent(kind)}&limit=${limit}`,
  )
  return res.items ?? []
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const blob = await apiBlob(`/assets/${encodeURIComponent(id)}`)
  if (!blob) return undefined
  return { id, blob, name: id, type: blob.type, size: blob.size, createdAt: 0 }
}

/* ---------------- 本机偏好（主题、宽度等，按设备保存） ---------------- */

const META_PREFIX = 'ginkgo-meta:'

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = localStorage.getItem(META_PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    localStorage.setItem(META_PREFIX + key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
