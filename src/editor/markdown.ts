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

const MARK_ORDER = ['code', 'bold', 'italic', 'strike', 'underline', 'fontColor', 'bgColor', 'link']

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
    case 'link': {
      const href = mark.attrs?.href ?? ''
      return `[${text}](${href})`
    }
    default:
      return text
  }
}

function serializeInlineNode(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\\\n'
  if (node.type === 'image') {
    const alt = (node.attrs?.alt ?? '').replace(/[\[\]]/g, '')
    return `![${alt}](${node.attrs?.src ?? ''})`
  }
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

function serializeListItem(item: JSONContent, marker: string, pad: string): string {
  const kids = item.content ?? []
  const out: string[] = []
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

function serializeTable(node: JSONContent): string {
  const rows = node.content ?? []
  const cellText = (cell: JSONContent) =>
    (cell.content ?? [])
      .map((c) => inlineOf(c))
      .join(' ')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')

  const lines: string[] = []
  rows.forEach((row, ri) => {
    const cells = (row.content ?? []).map(cellText)
    lines.push(`| ${cells.join(' | ')} |`)
    if (ri === 0) {
      lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
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
      case 'text':
        if (t.content) out.push(withMarks(t.content, stack))
        break
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

function stripTaskPrefix(paragraph: JSONContent): boolean | null {
  const first = paragraph.content?.[0]
  if (!first || first.type !== 'text') return null
  const m = TASK_RE.exec(first.text ?? '')
  if (!m) return null
  first.text = (first.text ?? '').replace(TASK_RE, '')
  if (!first.text) paragraph.content!.shift()
  return m[1].toLowerCase() === 'x'
}

function convertBlocks(
  tokens: Token[],
  from: number,
  to: number,
): JSONContent[] {
  const nodes: JSONContent[] = []
  let i = from

  while (i < to) {
    const t = tokens[i]

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
      const items: { content: JSONContent[]; checked: boolean | null }[] = []

      let j = i + 1
      while (j < closeIdx) {
        if (tokens[j].type === 'list_item_open') {
          const itemClose = matchClose(tokens, j)
          const inner = convertBlocks(tokens, j + 1, itemClose)
          let checked: boolean | null = null
          if (inner[0]?.type === 'paragraph') checked = stripTaskPrefix(inner[0])
          items.push({ content: inner, checked })
          j = itemClose + 1
        } else {
          j++
        }
      }

      const allTasks = items.length > 0 && items.every((it) => it.checked !== null)
      if (allTasks) {
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
            content: it.content.length ? it.content : [{ type: 'paragraph' }],
          })),
        })
      }
      i = closeIdx + 1
      continue
    }

    if (t.type === 'blockquote_open') {
      const closeIdx = matchClose(tokens, i)
      const inner = convertBlocks(tokens, i + 1, closeIdx)
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
              cells.push({
                type: tokens[k].type === 'th_open' ? 'tableHeader' : 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
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
      if (rows.length) nodes.push({ type: 'table', content: rows })
      i = closeIdx + 1
      continue
    }

    // html_block 里的 <u> 之类先当普通段落处理
    if (t.type === 'html_block') {
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
  const tokens = md.parse(content, {})
  let nodes = convertBlocks(tokens, 0, tokens.length)
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
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
