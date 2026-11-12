import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { api } from '@/api/client'
import { getAsset, listPages, putAsset, toPlainText, uid } from '@/db/repo'
import { exportDatabaseData, importDatabaseData } from '@/db/databases'
import { expandDatabases } from '@/blocks/exportDatabases'
import type { Page } from '@/types'

/* ============================================================
 *  导入：Markdown 文件 / 文件夹 / zip（含 Notion 导出包）/ JSON 备份
 * ============================================================ */

export interface ImportEntry {
  /** 相对路径，用 / 分隔，如 `笔记/子页面.md` */
  path: string
  data: Uint8Array
}

export interface ImportResult {
  pages: number
  images: number
  databases: number
  skipped: string[]
}

const MD_RE = /\.(md|markdown|txt)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const CSV_RE = /\.csv$/i
/** Notion 导出的文件 / 文件夹名带 32 位 id 后缀：`页面名 1a2b...` */
const NOTION_ID_RE = /\s+[0-9a-f]{32}$/i

const decoder = new TextDecoder()

function stripNotionId(name: string): string {
  return name.replace(NOTION_ID_RE, '')
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function stem(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, '')
}

function normalizePath(p: string): string {
  const out: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      avif: 'image/avif',
    }[ext] ?? 'application/octet-stream'
  )
}

/** 简单 CSV 解析（支持引号与引号内换行） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

function csvToMarkdown(text: string): string {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || ' '
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => esc(r[i] ?? '')).join(' | ')} |`
  return [line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n'
}

/** 解开 zip，过滤掉 macOS 的 __MACOSX 等垃圾文件；Notion 导出包里可能还嵌套 zip */
export function unzipEntries(data: Uint8Array, prefix = ''): ImportEntry[] {
  const files = unzipSync(data)
  const out: ImportEntry[] = []
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || baseName(name).startsWith('.')) continue
    if (/\.zip$/i.test(name)) out.push(...unzipEntries(bytes, prefix))
    else out.push({ path: normalizePath(prefix + name), data: bytes })
  }
  return out
}

export async function filesToEntries(files: File[]): Promise<ImportEntry[]> {
  const out: ImportEntry[] = []
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer())
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    if (/\.zip$/i.test(f.name)) out.push(...unzipEntries(data))
    else out.push({ path: normalizePath(rel), data })
  }
  return out
}

/** 所有文件都在同一个顶层文件夹下时，去掉这一层（zip 打包常见） */
function stripCommonRoot(entries: ImportEntry[]): ImportEntry[] {
  const firsts = new Set(entries.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : '')))
  if (firsts.size !== 1 || firsts.has('')) return entries
  const root = [...firsts][0]!
  // 根文件夹本身对应一个同名 md 时保留（Notion：`页面.md` + `页面/`）
  if (entries.some((e) => e.path === `${root}.md`)) return entries
  return entries.map((e) => ({ ...e, path: e.path.slice(root.length + 1) }))
}

interface PendingPage {
  key: string
  title: string
  content: string
  sourcePath: string | null
  parentKey: string | null
  id: string
  order: number
}

/**
 * 把一组文件转换成页面并写入当前空间。
 * - `A.md` 与文件夹 `A/` 同时存在时，文件夹里的内容成为 A 的子页面（Notion 的结构）
 * - 只有文件夹没有同名 md 时，自动建一个以文件夹命名的空页面作为父页面
 * - 图片按相对路径上传并替换为 asset 引用；指向其它 md 的链接改成站内链接
 * - CSV（Notion 数据库）转成一张 Markdown 表格页面
 */
export async function importEntries(
  rawEntries: ImportEntry[],
  parentId: string | null,
  onProgress?: (text: string) => void,
): Promise<ImportResult> {
  const result: ImportResult = { pages: 0, images: 0, databases: 0, skipped: [] }

  // JSON 备份单独处理
  const jsonFiles = rawEntries.filter((e) => /\.json$/i.test(e.path))
  for (const j of jsonFiles) {
    try {
      const r = await importBackupJson(decoder.decode(j.data), parentId)
      result.pages += r.pages
      result.databases += r.databases
    } catch {
      result.skipped.push(j.path)
    }
  }

  const entries = stripCommonRoot(rawEntries.filter((e) => !/\.json$/i.test(e.path)))
  const byPath = new Map(entries.map((e) => [e.path, e]))
  const pages = new Map<string, PendingPage>()
  let order = Date.now()

  const ensureFolder = (dir: string): string | null => {
    if (!dir) return null
    if (pages.has(dir)) return dir
    pages.set(dir, {
      key: dir,
      title: stripNotionId(baseName(dir)),
      content: '',
      sourcePath: null,
      parentKey: ensureFolder(dirName(dir)),
      id: uid(),
      order: order++,
    })
    return dir
  }

  for (const e of entries) {
    const isMd = MD_RE.test(e.path)
    const isCsv = CSV_RE.test(e.path) && !/_all\.csv$/i.test(e.path)
    if (!isMd && !isCsv) {
      if (!IMAGE_RE.test(e.path) && !/_all\.csv$/i.test(e.path)) result.skipped.push(e.path)
      continue
    }
    // `A.md` 对应的子页面目录是 `A/`
    const key = e.path.replace(/\.[^.]+$/, '')
    const dir = dirName(e.path)
    let text = decoder.decode(e.data).replace(/^\uFEFF/, '')
    let title = stripNotionId(stem(e.path))
    if (isCsv) {
      text = csvToMarkdown(text)
      result.databases++
    } else {
      const h1 = /^#\s+(.+?)\s*(\n+|$)/.exec(text)
      if (h1) {
        title = h1[1]!.replace(/[*_`~]/g, '').trim() || title
        text = text.slice(h1[0].length)
      }
    }
    const existing = pages.get(key)
    pages.set(key, {
      key,
      title,
      content: text,
      sourcePath: e.path,
      parentKey: existing?.parentKey ?? ensureFolder(dir),
      id: existing?.id ?? uid(),
      order: existing?.order ?? order++,
    })
  }

  // 链接改写需要知道每个源文件对应的页面 id
  const idBySource = new Map<string, string>()
  for (const p of pages.values()) if (p.sourcePath) idBySource.set(p.sourcePath, p.id)

  const assetCache = new Map<string, string>()
  async function assetFor(path: string): Promise<string | null> {
    if (assetCache.has(path)) return assetCache.get(path)!
    const entry = byPath.get(path)
    if (!entry || !IMAGE_RE.test(path)) return null
    onProgress?.(`上传图片 ${baseName(path)}`)
    const blob = new Blob([entry.data.slice().buffer as ArrayBuffer], { type: mimeOf(path) })
    const asset = await putAsset(blob, baseName(path))
    assetCache.set(path, asset.id)
    result.images++
    return asset.id
  }

  const resolveRef = (from: string, ref: string): string => {
    let target = ref.trim().replace(/^<|>$/g, '')
    try {
      target = decodeURIComponent(target)
    } catch {
      /* 保持原样 */
    }
    target = target.split('#')[0]!.split('?')[0]!
    return normalizePath(`${dirName(from)}/${target}`)
  }

  for (const p of pages.values()) {
    if (!p.sourcePath || !p.content) continue
    const from = p.sourcePath
    const imgRefs = [...p.content.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    for (const m of imgRefs) {
      if (/^(https?:|data:|asset:)/.test(m[2]!)) continue
      const id = await assetFor(resolveRef(from, m[2]!))
      if (id) p.content = p.content.replace(m[0], `![${m[1]}](asset:${id})`)
    }
    p.content = p.content.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+\.(?:md|csv))\)/gi, (all, text: string, ref: string) => {
      if (/^https?:/.test(ref)) return all
      const id = idBySource.get(resolveRef(from, ref))
      return id ? `[${text}](/${id})` : all
    })
  }

  // 父页面在前，按层级写入
  const list = [...pages.values()]
  const depth = (p: PendingPage): number => (p.parentKey ? 1 + depth(pages.get(p.parentKey)!) : 0)
  list.sort((a, b) => depth(a) - depth(b) || a.order - b.order)
  const now = Date.now()
  const toWrite: Page[] = list.map((p, i) => ({
    id: p.id,
    title: p.title.slice(0, 200),
    icon: '',
    parentId: p.parentKey ? pages.get(p.parentKey)!.id : parentId,
    content: p.content,
    excerpt: toPlainText(p.content, 200),
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    order: now + i,
    cover: null,
    locked: false,
  }))
  for (let i = 0; i < toWrite.length; i += 50) {
    onProgress?.(`写入页面 ${Math.min(i + 50, toWrite.length)} / ${toWrite.length}`)
    await api('POST', '/pages/batch', { upsert: toWrite.slice(i, i + 50), remove: [] })
  }
  result.pages += toWrite.length
  return result
}

/** 银杏笔记自己的 JSON 备份：保留页面层级、图标、封面与多维表格 */
export async function importBackupJson(text: string, parentId: string | null): Promise<{ pages: number; databases: number }> {
  const data = JSON.parse(text) as { pages?: Page[]; databases?: unknown[]; dbRows?: unknown[] }
  let dbCount = 0
  if (Array.isArray(data.databases) && data.databases.length) {
    await importDatabaseData(data.databases as never, (Array.isArray(data.dbRows) ? data.dbRows : []) as never)
    dbCount = data.databases.length
  }
  const src = (Array.isArray(data.pages) ? data.pages : []).filter((p) => p && typeof p.id === 'string' && !p.trashed)
  // 重新分配 id，避免和现有页面冲突；层级关系按新 id 映射
  const idMap = new Map(src.map((p) => [p.id, uid()]))
  const now = Date.now()
  const pages: Page[] = src.map((p, i) => ({
    ...p,
    id: idMap.get(p.id)!,
    parentId: p.parentId && idMap.has(p.parentId) ? idMap.get(p.parentId)! : parentId,
    excerpt: p.excerpt ?? toPlainText(p.content ?? '', 200),
    favorite: !!p.favorite,
    trashed: false,
    trashedAt: null,
    updatedAt: now,
    order: typeof p.order === 'number' ? p.order : now + i,
  }))
  for (let i = 0; i < pages.length; i += 50) {
    await api('POST', '/pages/batch', { upsert: pages.slice(i, i + 50), remove: [] })
  }
  return { pages: pages.length, databases: dbCount }
}

/* ============================================================
 *  导出
 * ============================================================ */

function safeName(name: string): string {
  return (name || '未命名').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 80) || '未命名'
}

export async function exportBackupJson(): Promise<Blob> {
  const pages = await listPages()
  const dbData = await exportDatabaseData()
  const payload = {
    app: 'ginkgo-notes',
    version: 2,
    exportedAt: new Date().toISOString(),
    pages: pages.filter((p) => !p.trashed),
    databases: dbData.databases,
    dbRows: dbData.rows,
  }
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
}

/**
 * 整个空间打包成 zip：
 * - 每个页面一个 .md，子页面放在与父页面同名的文件夹里
 * - 图片放到 assets/，正文里的引用改成相对路径
 * - 多维表格展开成表格快照；另附 backup.json 便于原样恢复
 */
export async function exportSpaceZip(onProgress?: (text: string) => void): Promise<Blob> {
  const all = (await listPages()).filter((p) => !p.trashed)
  const byParent = new Map<string | null, Page[]>()
  for (const p of all) {
    const key = p.parentId && all.some((x) => x.id === p.parentId) ? p.parentId : null
    byParent.set(key, [...(byParent.get(key) ?? []), p])
  }
  const files: Zippable = {}
  const assetPaths = new Map<string, string>()
  let done = 0

  async function assetPath(id: string): Promise<string | null> {
    if (assetPaths.has(id)) return assetPaths.get(id)!
    const asset = await getAsset(id)
    if (!asset) return null
    const ext = (asset.type.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    const path = `assets/${id}.${ext}`
    files[path] = new Uint8Array(await asset.blob.arrayBuffer())
    assetPaths.set(id, path)
    return path
  }

  async function writePage(p: Page, dir: string, used: Set<string>) {
    let name = safeName(p.title)
    let n = 2
    while (used.has(name)) name = `${safeName(p.title)} (${n++})`
    used.add(name)
    const depth = dir ? dir.split('/').length : 0
    const up = '../'.repeat(depth)
    let md = await expandDatabases(p.content ?? '')
    for (const m of [...md.matchAll(/asset:([A-Za-z0-9_-]+)/g)]) {
      const path = await assetPath(m[1]!)
      if (path) md = md.split(`asset:${m[1]}`).join(encodeURI(`${up}${path}`))
    }
    const header = `# ${p.icon && !p.icon.includes(':') ? `${p.icon} ` : ''}${p.title || '未命名'}\n\n`
    files[`${dir ? `${dir}/` : ''}${name}.md`] = strToU8(header + md)
    done++
    onProgress?.(`已打包 ${done} / ${all.length} 个页面`)
    const kids = (byParent.get(p.id) ?? []).sort((a, b) => a.order - b.order)
    const kidNames = new Set<string>()
    for (const k of kids) await writePage(k, `${dir ? `${dir}/` : ''}${name}`, kidNames)
  }

  const rootNames = new Set<string>()
  for (const p of (byParent.get(null) ?? []).sort((a, b) => a.order - b.order)) await writePage(p, '', rootNames)
  files['backup.json'] = new Uint8Array(await (await exportBackupJson()).arrayBuffer())
  files['README.txt'] = strToU8(
    `银杏笔记导出 · ${new Date().toLocaleString()}\n\n` +
      `- 每个页面一个 Markdown 文件，子页面在同名文件夹中\n- 图片在 assets/ 目录\n` +
      `- backup.json 可在「设置 → 导入与导出」中原样恢复（含多维表格）\n`,
  )
  onProgress?.('正在压缩…')
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' })
}
