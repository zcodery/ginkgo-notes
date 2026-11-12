import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import type { JSONContent } from '@tiptap/core'

/**
 * Markdown ←→ ProseMirror JSON 双向转换
 *
 * 这里的实现刻意保持「块级结构 1:1 映射」，保证：
 * 编辑器里看到的块，和落盘的 Markdown 文本是一一对应的，
 * 来回切换不会丢内容，也不会产生难以阅读的源码。
 */

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
})

/* ============================================================
 *  序列化：ProseMirror JSON → Markdown
 * ============================================================ */

const MARK_ORDER = [
  'code',
  'bold',
  'italic',
  'strike',
  'underline',
  'fontColor',
  'bgColor',
  'highlight',
  'link',
]

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]~$])/g, '\\$1').replace(/<(?=[a-zA-Z/!?])/g, '\\<')
}

function escapeLineStart(line: string): string {
  // 避免段落被误识别为标题 / 列表 / 引用 / 分割线
  if (/^#{1,6}\s/.test(line)) return '\\' + line
  if (/^[-+*]\s/.test(line)) return '\\' + line
  if (/^(\d+)\.\s/.test(line)) return line.replace(/^(\d+)/, '$1\\.')
  if (/^>/.test(line)) return '\\' + line
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return '\\' + line
  return line
}

function applyMark(text: string, mark: { type: string; attrs?: any }): string {
  switch (mark.type) {
    case 'bold':
      return `**${text}**`
    case 'italic':
      return `*${text}*`
    case 'strike':
      return `~~${text}~~`
    case 'underline':
      return `<u>${text}</u>`
    case 'fontColor': {
      const color = mark.attrs?.color
      if (!color) return text
      return `<span data-color="${color}">${text}</span>`
    }
    case 'bgColor': {
      const color = mark.attrs?.color
      if (!color) return text
      return `<mark data-bg="${color}">${text}</mark>`
    }
    case 'highlight':
      return `==${text}==`
    case 'link': {
      const href = mark.attrs?.href ?? ''
      return `[${text}](${href})`
    }
    default:
      return text
  }
}

/** 行内页面链接：ginkgo-page:<id>（整段是一个 text token，避免 HTML / [[]] 被 markdown-it 拆开） */
function serializePageLinkInline(node: JSONContent): string {
  const pageId = String(node.attrs?.pageId ?? '').trim()
  if (!pageId) return ''
  return `ginkgo-page:${pageId}`
}

const PAGE_LINK_OPEN_HTML_RE =
  /^<span\b[^>]*\bdata-ginkgo-page\b[^>]*\bdata-page-id=["']([^"']+)["'][^>]*>$/i

function serializeInlineNode(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\\\n'
  if (node.type === 'image') {
    const alt = (node.attrs?.alt ?? '').replace(/[\[\]]/g, '')
    return `![${alt}](${node.attrs?.src ?? ''})`
  }
  if (node.type === 'pageLink') return serializePageLinkInline(node)
  if (node.type !== 'text') return ''

  const raw = node.text ?? ''
  const marks = [...(node.marks ?? [])].sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
  )

  // 行内代码：内部不再做 markdown 转义
  if (marks.some((m) => m.type === 'code')) {
    const fence = raw.includes('`') ? '``' : '`'
    const pad = raw.includes('`') ? ' ' : ''
    const others = marks.filter((m) => m.type !== 'code')
    let out = `${fence}${pad}${raw}${pad}${fence}`
    for (const m of others) out = applyMark(out, m)
    return out
  }

  let out = escapeText(raw)
  for (const m of marks) out = applyMark(out, m)
  return out
}

function inlineOf(node: JSONContent): string {
  if (!node.content?.length) return ''
  return node.content.map(serializeInlineNode).join('')
}

function indentAll(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

function serializeList(node: JSONContent, pad: string): string {
  const isTask = node.type === 'taskList'
  const isOrdered = node.type === 'orderedList'
  const start = isOrdered ? Number(node.attrs?.start ?? 1) : 1
  const lines: string[] = []

  ;(node.content ?? []).forEach((item, idx) => {
    let marker = '- '
    if (isTask) marker = item.attrs?.checked ? '- [x] ' : '- [ ] '
    else if (isOrdered) marker = `${start + idx}. `
    lines.push(serializeListItem(item, marker, pad))
  })

  return lines.join('\n')
}

const LI_COLLAPSED_RE = /^<!--\s*gn-li\s+collapsed\s*-->$/i

function serializeListItem(item: JSONContent, marker: string, pad: string): string {
  const kids = item.content ?? []
  const out: string[] = []
  if (item.attrs?.collapsed) out.push(`${pad}<!-- gn-li collapsed -->`)
  // 子级缩进要与父级标记等宽，否则有序列表（"1. "）的嵌套会失效
  const childPad = pad + ' '.repeat(marker.length)
  let i = 0

  if (kids[0]?.type === 'paragraph') {
    out.push(pad + marker + inlineOf(kids[0]))
    i = 1
  } else {
    out.push((pad + marker).trimEnd())
  }

  for (; i < kids.length; i++) {
    const kid = kids[i]
    if (kid.type === 'bulletList' || kid.type === 'orderedList' || kid.type === 'taskList') {
      out.push(serializeList(kid, childPad))
    } else if (kid.type === 'paragraph') {
      out.push(childPad + inlineOf(kid))
    } else {
      const inner = serializeNode(kid)
      out.push(indentAll(inner, childPad))
    }
  }

  return out.join('\n')
}

/**
 * GFM 表格表达不了列宽、「首行不是表头」「首列是表头」，
 * 这些写进表格上方的一行注释：<!-- gn-table cols="120,,200" header-row="0" header-col="1" -->
 * 其它 Markdown 渲染器会忽略注释，表格本身照常显示。
 */
interface TableMeta {
  cols: (number | null)[]
  headerRow: boolean
  headerCol: boolean
  /** 单元格背景色：`行-列` → 预设色键 */
  bg: Record<string, string>
}

const TABLE_META_RE = /^<!--\s*gn-table\b([^>]*?)-->\s*$/

function tableMetaOf(node: JSONContent): TableMeta {
  const rows = node.content ?? []
  const first = rows[0]?.content ?? []
  const cols = first.map((cell) => {
    const w = cell.attrs?.colwidth
    return Array.isArray(w) && typeof w[0] === 'number' ? Math.round(w[0]) : null
  })
  const headerRow = first.length > 0 && first.every((c) => c.type === 'tableHeader')
  const headerCol =
    rows.length > 0 &&
    rows.every((r) => r.content?.[0]?.type === 'tableHeader') &&
    // 只有一行时首列是否表头无从区分，按首行表头算
    !(rows.length === 1 && headerRow)
  const bg: Record<string, string> = {}
  rows.forEach((r, ri) =>
    (r.content ?? []).forEach((c, ci) => {
      if (typeof c.attrs?.bg === 'string' && /^[a-z]+$/.test(c.attrs.bg)) bg[`${ri}-${ci}`] = c.attrs.bg
    }),
  )
  return { cols, headerRow, headerCol, bg }
}

function serializeTableMeta(meta: TableMeta): string {
  const parts: string[] = []
  if (meta.cols.some((w) => w != null)) parts.push(`cols="${meta.cols.map((w) => w ?? '').join(',')}"`)
  if (!meta.headerRow) parts.push('header-row="0"')
  if (meta.headerCol) parts.push('header-col="1"')
  const bg = Object.entries(meta.bg)
  if (bg.length) parts.push(`bg="${bg.map(([k, v]) => `${k}:${v}`).join(';')}"`)
  return parts.length ? `<!-- gn-table ${parts.join(' ')} -->` : ''
}

function parseTableMeta(raw: string): TableMeta | null {
  const m = TABLE_META_RE.exec(raw.trim())
  if (!m) return null
  const attr = (name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(m[1])?.[1]
  const cols = (attr('cols') ?? '')
    .split(',')
    .map((s) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null))
  const bg: Record<string, string> = {}
  for (const pair of (attr('bg') ?? '').split(';')) {
    const pm = /^(\d+-\d+):([a-z]+)$/.exec(pair.trim())
    if (pm) bg[pm[1]!] = pm[2]!
  }
  return {
    cols: attr('cols') == null ? [] : cols,
    headerRow: attr('header-row') !== '0',
    headerCol: attr('header-col') === '1',
    bg,
  }
}

function applyTableMeta(rows: JSONContent[], meta: TableMeta) {
  rows.forEach((row, ri) => {
    ;(row.content ?? []).forEach((cell, ci) => {
      const w = meta.cols[ci]
      if (w) cell.attrs = { ...cell.attrs, colwidth: [w] }
      const bg = meta.bg[`${ri}-${ci}`]
      if (bg) cell.attrs = { ...cell.attrs, bg }
      const isHeader = (ri === 0 && meta.headerRow) || (ci === 0 && meta.headerCol)
      cell.type = isHeader ? 'tableHeader' : 'tableCell'
    })
  })
}

function serializeTable(node: JSONContent): string {
  const rows = node.content ?? []
  const cellText = (cell: JSONContent) =>
    (cell.content ?? [])
      .map((c) => inlineOf(c))
      .join(' ')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')

  const lines: string[] = []
  const meta = serializeTableMeta(tableMetaOf(node))
  if (meta) lines.push(meta)
  // 列对齐写进 GFM 分隔行（:--- / :---: / ---:），取每列第一个设置了对齐的单元格
  const width = rows[0]?.content?.length ?? 0
  const aligns = Array.from({ length: width }, (_, ci) => {
    for (const r of rows) {
      const a = r.content?.[ci]?.attrs?.align
      if (a) return a as string
    }
    return null
  })
  const delimiter = (a: string | null) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---')
  rows.forEach((row, ri) => {
    const cells = (row.content ?? []).map(cellText)
    lines.push(`| ${cells.join(' | ')} |`)
    if (ri === 0) {
      lines.push(`| ${cells.map((_, ci) => delimiter(aligns[ci] ?? null)).join(' | ')} |`)
    }
  })
  return lines.join('\n')
}

function serializeNode(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph': {
      const text = inlineOf(node)
      return text ? escapeLineStart(text) : ''
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      return `${'#'.repeat(level)} ${inlineOf(node)}`
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return serializeList(node, '')
    case 'blockquote': {
      const inner = (node.content ?? [])
        .map(serializeNode)
        .filter((s) => s !== '')
        .join('\n\n')
      if (!inner) return '>'
      return inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    }
    case 'codeBlock': {
      const lang = node.attrs?.language ?? ''
      const name = node.attrs?.title ?? ''
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      const fence = code.includes('```') ? '````' : '```'
      // 代码名字写成 title="xxx"，跟 Obsidian / GitHub 的写法一致
      const title = name ? ` title="${String(name).replace(/"/g, '')}"` : ''
      return `${fence}${lang}${title}\n${code}\n${fence}`
    }
    case 'diagram': {
      // 图表就是一段 Mermaid 代码，别的工具打开也能渲染
      const code = (node.attrs?.code ?? '').replace(/\s+$/, '')
      const fence = code.includes('```') ? '````' : '```'
      return `${fence}mermaid\n${code}\n${fence}`
    }
    case 'databaseBlock': {
      // 多维表格在正文里只留一个引用，数据在独立 store 里
      return `\`\`\`ginkgo-db\n${node.attrs?.dbId ?? ''}\n\`\`\``
    }
    case 'pageLink': {
      return `\`\`\`ginkgo-page\n${node.attrs?.pageId ?? ''}\n\`\`\``
    }
    case 'details': {
      const open = !!node.attrs?.open
      // 找 summary 子节点
      let summary = ''
      let contentStart = 0
      const children = node.content ?? []
      for (let i = 0; i < children.length; i++) {
        if (children[i]?.type === 'detailsSummary') {
          summary = inlineOf(children[i]!)
          contentStart = i + 1
          break
        }
      }
      const contentNodes = children.slice(contentStart).filter(
        (n) => n?.type === 'detailsContent' && n.content,
      )
      const inner = contentNodes
        .flatMap((c) => (c.content ?? []).map(serializeNode))
        .filter((s) => s !== '')
        .join('\n\n')
      const openAttr = open ? ' open' : ''
      const sumTag = `<summary>${summary}</summary>`
      return `<details${openAttr}>\n${sumTag}\n\n${inner}\n</details>`
    }
    case 'detailsSummary':
    case 'detailsContent':
      return '' // 由父节点 details 处理
    case 'horizontalRule':
      return '---'
    case 'image':
      return `![${node.attrs?.alt ?? ''}](${node.attrs?.src ?? ''})`
    case 'table':
      return serializeTable(node)
    case 'hardBreak':
      return ''
    default:
      return inlineOf(node) || ''
  }
}

export function docToMarkdown(doc: JSONContent | null | undefined): string {
  if (!doc?.content?.length) return ''
  const blocks = doc.content
    .map(serializeNode)
    .filter((s) => s !== '')
  if (!blocks.length) return ''
  return blocks.join('\n\n') + '\n'
}

/* ============================================================
 *  解析：Markdown → ProseMirror JSON
 * ============================================================ */

function matchClose(tokens: Token[], openIdx: number): number {
  const open = tokens[openIdx].type
  const closeType = open.replace(/_open$/, '_close')
  let depth = 0
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].type === open) depth++
    else if (tokens[i].type === closeType) {
      depth--
      if (depth === 0) return i
    }
  }
  return tokens.length - 1
}

function withMarks(
  text: string,
  marks: { type: string; attrs?: any }[],
): JSONContent {
  const node: JSONContent = { type: 'text', text }
  if (marks.length) node.marks = marks.map((m) => ({ ...m }))
  return node
}

function inlineFromTokens(tokens: Token[]): JSONContent[] {
  const out: JSONContent[] = []
  const stack: { type: string; attrs?: any }[] = []

  const pop = (type: string) => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === type) {
        stack.splice(i, 1)
        return
      }
    }
  }

  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        const text = t.content ?? ''
        for (const seg of splitInlineText(text)) {
          if (seg.pageId) {
            out.push({ type: 'pageLink', attrs: { pageId: seg.pageId } })
          } else if (seg.highlight) {
            const hlMarks = [...stack.map((m) => ({ ...m })), { type: 'highlight' }]
            out.push(withMarks(seg.text, hlMarks))
          } else if (seg.text) {
            out.push(withMarks(seg.text, stack))
          }
        }
        break
      }
      case 'strong_open':
        stack.push({ type: 'bold' })
        break
      case 'strong_close':
        pop('bold')
        break
      case 'em_open':
        stack.push({ type: 'italic' })
        break
      case 'em_close':
        pop('italic')
        break
      case 's_open':
        stack.push({ type: 'strike' })
        break
      case 's_close':
        pop('strike')
        break
      case 'code_inline': {
        const marks = [...stack.map((m) => ({ ...m })), { type: 'code' }]
        out.push({ type: 'text', text: t.content, marks })
        break
      }
      case 'link_open': {
        const href = t.attrGet('href') ?? ''
        const title = t.attrGet('title')
        stack.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener', title } })
        break
      }
      case 'link_close':
        pop('link')
        break
      case 'image': {
        out.push({
          type: 'image',
          attrs: {
            src: t.attrGet('src') ?? '',
            alt: t.content || t.attrGet('alt') || '',
            title: t.attrGet('title') ?? null,
          },
        })
        break
      }
      case 'softbreak':
        out.push({ type: 'text', text: ' ' })
        break
      case 'hardbreak':
        out.push({ type: 'hardBreak' })
        break
      case 'html_inline': {
        const raw = t.content.trim()
        const pageOpen = PAGE_LINK_OPEN_HTML_RE.exec(raw)
        if (pageOpen) {
          out.push({ type: 'pageLink', attrs: { pageId: pageOpen[1]!.trim() } })
          break
        }
        if (/^<\/span>$/i.test(raw)) break
        const lower = raw.toLowerCase()
        if (lower === '<br>' || lower === '<br/>' || lower === '<br />') {
          out.push({ type: 'hardBreak' })
        } else if (lower === '<u>') {
          stack.push({ type: 'underline' })
        } else if (lower === '</u>') {
          pop('underline')
        } else {
          const openColor = raw.match(
            /^<span\b[^>]*\bdata-color=["']?(#[0-9a-fA-F]{3,8}|[a-z]+)["']?[^>]*>$/i,
          )
          if (openColor) {
            stack.push({ type: 'fontColor', attrs: { color: openColor[1].toLowerCase() } })
            break
          }
          const openBg =
            raw.match(/^<mark\b[^>]*\bdata-bg=["']?(#[0-9a-fA-F]{3,8}|[a-z]+)["']?[^>]*>$/i) ||
            raw.match(/^<span\b[^>]*\bdata-bg=["']?(#[0-9a-fA-F]{3,8}|[a-z]+)["']?[^>]*>$/i)
          if (openBg) {
            stack.push({ type: 'bgColor', attrs: { color: openBg[1].toLowerCase() } })
            break
          }
          if (/^<\/span>$/i.test(raw)) {
            // 可能是字体色或旧版背景色 span
            if (stack.some((m) => m.type === 'fontColor')) pop('fontColor')
            else if (stack.some((m) => m.type === 'bgColor')) pop('bgColor')
            break
          }
          if (/^<\/mark>$/i.test(raw)) {
            pop('bgColor')
          }
        }
        break
      }
      default:
        break
    }
  }

  return mergeText(out)
}

function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (
      prev &&
      n.type === 'text' &&
      prev.type === 'text' &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])
    ) {
      prev.text = (prev.text ?? '') + (n.text ?? '')
    } else {
      out.push({ ...n })
    }
  }
  return out
}

const TASK_RE = /^\[([ xX])\]\s+/

type InlineTextSeg = { text: string; highlight?: boolean; pageId?: string }

/** 解析行内 ginkgo-page:<id> 与 ==高亮==（按出现顺序） */
function splitInlineText(text: string): InlineTextSeg[] {
  const out: InlineTextSeg[] = []
  const re = /(ginkgo-page:([^\s]+)|==([^=]+)==)/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > lastIdx) out.push({ text: text.slice(lastIdx, m.index) })
    if (m[2] !== undefined) out.push({ text: '', pageId: m[2].trim() })
    else if (m[3] !== undefined) out.push({ text: m[3], highlight: true })
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) out.push({ text: text.slice(lastIdx) })
  if (out.length === 0) out.push({ text })
  return out
}

/** 解析 HTML <details> 块，提取 summary 文本和内部 Markdown 内容 */
function parseDetailsHtml(raw: string): { summary: string; contentMd: string; open: boolean } | null {
  const text = raw.trim()
  const lower = text.toLowerCase()
  const open = /^<details\b[^>]*\sopen\b/.test(lower)
  const closeIdx = lower.lastIndexOf('</details>')
  if (closeIdx === -1) return null

  // <summary 之后可能带属性，先找到它的 '>' 再取文本
  const sumOpen = lower.indexOf('<summary')
  const sumClose = lower.indexOf('</summary>')
  let summary = ''
  let bodyStart = text.indexOf('>') + 1
  if (sumOpen !== -1 && sumClose !== -1) {
    const sumTagEnd = lower.indexOf('>', sumOpen)
    summary = text
      .slice(sumTagEnd + 1, sumClose)
      .replace(/<[^>]+>/g, '')
      .trim()
    bodyStart = sumClose + '</summary>'.length
  }
  const contentMd = text.slice(bodyStart, closeIdx).trim()
  return { summary, contentMd, open }
}

interface DetailsBlock {
  summary: string
  contentMd: string
  open: boolean
}

/** 由抽出来的 <details> 信息构造 TipTap 节点（内部 Markdown 递归解析） */
function buildDetailsNode(info: DetailsBlock, detailsBlocks: DetailsBlock[]): JSONContent {
  const innerTokens = md.parse(info.contentMd, {})
  const innerBlocks = convertBlocks(innerTokens, 0, innerTokens.length, detailsBlocks)
  return {
    type: 'details',
    attrs: { open: info.open },
    content: [
      {
        type: 'detailsSummary',
        ...(info.summary ? { content: [{ type: 'text', text: info.summary }] } : {}),
      },
      {
        // detailsContent 要求 block+，空内容补一个空段落，避免文档非法
        type: 'detailsContent',
        content: innerBlocks.length ? innerBlocks : [{ type: 'paragraph' }],
      },
    ],
  }
}

const DETAILS_PLACEHOLDER_RE = /^<!--\s*gn-details:(\d+)\s*-->$/

/**
 * 先把源码里的 <details>…</details> 整块抠出来换成占位注释。
 * 原因：markdown-it 的 HTML 块规则遇到空行就截断，
 * `<details>` 里含多个 Markdown 块时会解析错位，必须提前处理。
 */
function extractDetailsBlocks(src: string, out: DetailsBlock[]): string {
  let result = ''
  let i = 0
  while (i < src.length) {
    const start = src.toLowerCase().indexOf('<details', i)
    if (start === -1) {
      result += src.slice(i)
      break
    }
    // 配对扫描，支持嵌套 <details>
    let depth = 0
    let end = -1
    const re = /<details\b|<\/details>/gi
    re.lastIndex = start
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if (m[0][1] === '/') {
        depth--
        if (depth === 0) {
          end = m.index + m[0].length
          break
        }
      } else {
        depth++
      }
    }
    if (end === -1) {
      result += src.slice(i)
      break
    }
    const info = parseDetailsHtml(src.slice(start, end))
    if (!info) {
      result += src.slice(i, end)
      i = end
      continue
    }
    result += src.slice(i, start)
    const idx = out.push(info) - 1
    result += `<!--gn-details:${idx}-->`
    i = end
  }
  return result
}

/** 只判断是否为待办项，不修改内容 */
function taskStateOf(paragraph: JSONContent): boolean | null {
  const first = paragraph.content?.[0]
  if (!first || first.type !== 'text') return null
  const m = TASK_RE.exec(first.text ?? '')
  return m ? m[1].toLowerCase() === 'x' : null
}

/** 整个列表都是待办时才去掉 `[ ]` 前缀；混合列表保留原文，避免吞字 */
function stripTaskPrefix(paragraph: JSONContent): void {
  const first = paragraph.content?.[0]
  if (!first || first.type !== 'text') return
  first.text = (first.text ?? '').replace(TASK_RE, '')
  if (!first.text) paragraph.content!.shift()
}

function convertBlocks(
  tokens: Token[],
  from: number,
  to: number,
  detailsBlocks: DetailsBlock[] = [],
): JSONContent[] {
  const nodes: JSONContent[] = []
  let i = from
  let pendingTableMeta: TableMeta | null = null

  while (i < to) {
    const t = tokens[i]

    if (t.type === 'html_block') {
      // <details> 已被 extractDetailsBlocks 换成占位注释
      const ph = DETAILS_PLACEHOLDER_RE.exec(t.content.trim())
      if (ph) {
        const info = detailsBlocks[Number(ph[1])]
        if (info) {
          nodes.push(buildDetailsNode(info, detailsBlocks))
          i++
          continue
        }
      }
      const meta = parseTableMeta(t.content)
      if (meta) {
        pendingTableMeta = meta
        i++
        continue
      }
    }
    if (t.type !== 'table_open') pendingTableMeta = null

    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1]
      const content = inline?.children ? inlineFromTokens(inline.children) : []
      if (content.length) nodes.push({ type: 'paragraph', content })
      i += 3
      continue
    }

    if (t.type === 'heading_open') {
      const inline = tokens[i + 1]
      const level = Math.min(Math.max(Number(t.tag.slice(1)) || 1, 1), 6)
      nodes.push({
        type: 'heading',
        attrs: { level },
        content: inline?.children ? inlineFromTokens(inline.children) : [],
      })
      i += 3
      continue
    }

    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const closeIdx = matchClose(tokens, i)
      const ordered = t.type === 'ordered_list_open'
      const start = Number(t.attrGet('start') ?? 1)
      const items: { content: JSONContent[]; checked: boolean | null; collapsed: boolean }[] = []

      let j = i + 1
      let pendingCollapsed = false
      while (j < closeIdx) {
        if (tokens[j].type === 'html_block' && LI_COLLAPSED_RE.test(tokens[j].content.trim())) {
          pendingCollapsed = true
          j++
          continue
        }
        if (tokens[j].type === 'list_item_open') {
          const itemClose = matchClose(tokens, j)
          const inner = convertBlocks(tokens, j + 1, itemClose, detailsBlocks)
          const checked = inner[0]?.type === 'paragraph' ? taskStateOf(inner[0]) : null
          items.push({ content: inner, checked, collapsed: pendingCollapsed })
          pendingCollapsed = false
          j = itemClose + 1
        } else {
          j++
        }
      }

      const allTasks = items.length > 0 && items.every((it) => it.checked !== null)
      if (allTasks) {
        for (const it of items) stripTaskPrefix(it.content[0]!)
        nodes.push({
          type: 'taskList',
          content: items.map((it) => ({
            type: 'taskItem',
            attrs: { checked: !!it.checked },
            content: it.content.length ? it.content : [{ type: 'paragraph' }],
          })),
        })
      } else {
        nodes.push({
          type: ordered ? 'orderedList' : 'bulletList',
          ...(ordered && start !== 1 ? { attrs: { start } } : {}),
          content: items.map((it) => ({
            type: 'listItem',
            ...(it.collapsed ? { attrs: { collapsed: true } } : {}),
            content: it.content.length ? it.content : [{ type: 'paragraph' }],
          })),
        })
      }
      i = closeIdx + 1
      continue
    }

    if (t.type === 'blockquote_open') {
      const closeIdx = matchClose(tokens, i)
      const inner = convertBlocks(tokens, i + 1, closeIdx, detailsBlocks)
      nodes.push({
        type: 'blockquote',
        content: inner.length ? inner : [{ type: 'paragraph' }],
      })
      i = closeIdx + 1
      continue
    }

    if (t.type === 'fence' || t.type === 'code_block') {
      const code = t.content.replace(/\n$/, '')
      const info = (t.info || '').trim()
      const language = info.split(/\s+/)[0] || null
      // 代码名字：```js title="a.js"  /  ```js filename="a.js"
      const titleMatch = info.match(/(?:title|filename|name)\s*=\s*"([^"]*)"/i)
      const title = titleMatch ? titleMatch[1] : null
      // 图表 / 多维表格是「有结构的代码块」，解析成对应的节点
      if (language === 'mermaid') {
        nodes.push({ type: 'diagram', attrs: { kind: 'mermaid', code } })
        i++
        continue
      }
      if (language === 'ginkgo-db') {
        nodes.push({ type: 'databaseBlock', attrs: { dbId: code.trim() } })
        i++
        continue
      }
      if (language === 'ginkgo-page') {
        nodes.push({ type: 'pageLink', attrs: { pageId: code.trim() } })
        i++
        continue
      }
      nodes.push({
        type: 'codeBlock',
        attrs: { language, title },
        content: code ? [{ type: 'text', text: code }] : [],
      })
      i++
      continue
    }

    if (t.type === 'hr') {
      nodes.push({ type: 'horizontalRule' })
      i++
      continue
    }

    if (t.type === 'table_open') {
      const closeIdx = matchClose(tokens, i)
      const rows: JSONContent[] = []
      let j = i + 1
      while (j < closeIdx) {
        if (tokens[j].type === 'tr_open') {
          const trClose = matchClose(tokens, j)
          const cells: JSONContent[] = []
          let k = j + 1
          while (k < trClose) {
            if (tokens[k].type === 'th_open' || tokens[k].type === 'td_open') {
              const cellClose = matchClose(tokens, k)
              let inline: JSONContent[] = []
              for (let x = k + 1; x < cellClose; x++) {
                if (tokens[x].type === 'inline' && tokens[x].children) {
                  inline = inlineFromTokens(tokens[x].children!)
                  break
                }
              }
              const alignMatch = /text-align:\s*(left|center|right)/.exec(String(tokens[k].attrGet('style') ?? ''))
              cells.push({
                type: tokens[k].type === 'th_open' ? 'tableHeader' : 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null, align: alignMatch?.[1] ?? null },
                content: [{ type: 'paragraph', ...(inline.length ? { content: inline } : {}) }],
              })
              k = cellClose + 1
            } else {
              k++
            }
          }
          if (cells.length) rows.push({ type: 'tableRow', content: cells })
          j = trClose + 1
        } else {
          j++
        }
      }
      if (rows.length) {
        if (pendingTableMeta) applyTableMeta(rows, pendingTableMeta)
        nodes.push({ type: 'table', content: rows })
      }
      pendingTableMeta = null
      i = closeIdx + 1
      continue
    }

    if (t.type === 'html_block') {
      // 兜底：源码里直接写了 <details> 块（没经过 extractDetailsBlocks）
      const detailsInfo = parseDetailsHtml(t.content)
      if (detailsInfo) {
        nodes.push(buildDetailsNode(detailsInfo, detailsBlocks))
        i++
        continue
      }
      const text = t.content.trim()
      if (text) {
        nodes.push({ type: 'paragraph', content: [{ type: 'text', text }] })
      }
      i++
      continue
    }

    i++
  }

  return nodes
}

export function markdownToDoc(content: string): JSONContent {
  if (!content || !content.trim()) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }
  // 先抠出 <details> 整块（markdown-it 的 HTML 块遇空行会截断），换成占位注释
  const detailsBlocks: DetailsBlock[] = []
  const source = extractDetailsBlocks(content, detailsBlocks)
  const tokens = md.parse(source, {})
  let nodes = convertBlocks(tokens, 0, tokens.length, detailsBlocks)
  if (!nodes.length) nodes = [{ type: 'paragraph' }]
  // 末尾永远留一个空段落：保存时会被滤掉，打开后再补回来，方便继续输入
  const last = nodes[nodes.length - 1]
  if (!(last?.type === 'paragraph' && !last.content?.length)) {
    nodes.push({ type: 'paragraph' })
  }
  return { type: 'doc', content: nodes }
}

/** 从 Markdown 里提取纯文本（用于反向链接 / 搜索高亮） */
export function markdownToPlain(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(?:details|summary)\b[^>]*>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
