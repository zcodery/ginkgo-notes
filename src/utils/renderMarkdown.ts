import MarkdownIt from 'markdown-it'
import type { Database, DbRow } from '@/types'
import { cellText } from '@/blocks/dbFields'
import { parseColorAttr, resolveSwatch } from '@/editor/marks/colors'
import { languageLabel, normalizeLanguage } from '@/editor/codeLanguages'

/**
 * 只读场景（公开分享页）把 Markdown 渲染成 HTML。
 * 保留正文里自定义的 <span data-color> / <mark data-bg> / <u> 等内联标记，
 * 其余 HTML 走白名单清洗，防止分享内容里夹带脚本。
 */

const md = new MarkdownIt({ html: true, linkify: true, breaks: false })

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'button', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'img', 'input', 'li', 'mark', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'colgroup', 'col', 'details', 'summary',
])
const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'class', 'data-color', 'data-bg', 'type', 'checked', 'disabled', 'colspan',
  'rowspan', 'style', 'data-lang', 'data-db', 'data-code', 'target', 'rel',
  // 只读页代码块工具栏
  'data-codeblock', 'data-title', 'data-cb',
  // 折叠块：编辑器序列化成 <details open>，旧数据可能写 data-open
  'open', 'data-open',
])

function safeUrl(v: string): boolean {
  return !/^\s*(javascript|vbscript|data:text\/html)/i.test(v)
}

export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) {
        child.replaceWith(...(['script', 'style', 'iframe', 'object', 'embed'].includes(tag) ? [] : [...child.childNodes]))
        continue
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase()
        if (!ALLOWED_ATTRS.has(name) || ((name === 'href' || name === 'src') && !safeUrl(attr.value))) {
          child.removeAttribute(attr.name)
        }
        if (name === 'style' && /expression|url\s*\(/i.test(attr.value)) child.removeAttribute(attr.name)
      }
      if (tag === 'a') {
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noopener noreferrer')
      }
      if (tag === 'input') child.setAttribute('disabled', '')
      if (tag === 'details') {
        // 保留编辑时的展开/收起状态：优先认 data-open（旧数据），否则认 open。
        // 不这么做的话所有折叠块到分享页都会被强制收起，正文内容读不到。
        const explicit = child.getAttribute('data-open')
        const wantOpen = explicit === null ? child.hasAttribute('open') : explicit !== 'false'
        child.toggleAttribute('open', wantOpen)
      }
      walk(child)
    }
  }
  walk(tpl.content as unknown as Element)
  return tpl.innerHTML
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function renderDatabase(data: { db: Database; rows: DbRow[] } | undefined): string {
  if (!data) return '<div class="sv-db-missing">多维表格不可用</div>'
  const { db, rows } = data
  const view = db.views.find((v) => v.id === db.lastViewId) ?? db.views[0]
  const fields = db.fields.filter((f) => !view?.hiddenFields.includes(f.id))
  const head = fields.map((f) => `<th>${escapeHtml(f.name)}</th>`).join('')
  const body = [...rows]
    .sort((a, b) => a.order - b.order)
    .map((r) => `<tr>${fields.map((f) => `<td>${escapeHtml(cellText(f, r.cells[f.id]))}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="sv-db"><div class="sv-db-title">${escapeHtml(db.icon || '🗂️')} ${escapeHtml(db.title || '未命名表格')}</div><div class="sv-db-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`
}

export interface RenderOptions {
  /** 把 asset:<id> 换成可访问的地址 */
  assetUrl: (id: string) => string
  databases?: Record<string, { db: Database; rows: DbRow[] }>
}

/** 把 ==着重== 换成 <mark>，跳过代码围栏内的内容 */
function applyHighlightSyntax(source: string): string {
  const parts = source.split(/(```[\s\S]*?```|````[\s\S]*?````)/g)
  const re = /==([^=\n][^=\n]*?)==/g
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, '<mark class="sv-highlight">$1</mark>')))
    .join('')
}

/** 渲染为 HTML；mermaid 代码块保留为占位，由调用方异步渲染 */
export function renderMarkdown(source: string, opts: RenderOptions): string {
  let content = applyHighlightSyntax(source)
  content = content.replace(/<!--\s*gn-table[^>]*-->\n?/g, '')
  content = content.replace(/<!--\s*gn-li\s+collapsed\s*-->\n?/gi, '')
  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!
    const info = token.info.trim()
    const lang = info.split(/\s+/)[0] ?? ''
    if (lang === 'mermaid') return `<div class="sv-mermaid" data-code="${escapeHtml(token.content)}"></div>`
    if (lang === 'ginkgo-db') return renderDatabase(opts.databases?.[token.content.trim()])

    // 代码块在只读页也要有完整工具栏：语言 / 名字 / 行号 / 换行 / 折叠 / 复制。
    // 全部输出静态 HTML + data-cb，交互由 SharedPublicView 做事件委托（v-html 内不能挂组件）。
    const code = token.content.replace(/\n$/, '')
    const lines = code ? code.split('\n') : []
    const name = /(?:^|\s)(?:title|filename)="([^"]*)"/i.exec(info)?.[1] ?? ''
    const safeLang = lang.replace(/[^A-Za-z0-9_-]/g, '')
    const label = lang ? (normalizeLanguage(lang) ? languageLabel(lang) : lang) : '纯文本'
    const lnWidth = `calc(${String(Math.max(lines.length, 1)).length}ch + 26px)`

    // 每行放一份不可见的原文，自动换行时行号才能对齐折行后的首行
    const gutter = lines
      .map(
        (line, i) =>
          `<div class="sv-code-ln-row"><span class="sv-code-ln-num">${i + 1}</span><span class="sv-code-ln-ghost">${escapeHtml(line || ' ')}</span></div>`,
      )
      .join('')

    return [
      `<div class="sv-code" data-codeblock data-lang="${escapeHtml(lang)}" data-title="${escapeHtml(name)}" style="--sv-ln-w:${lnWidth}">`,
      '<div class="sv-code-bar">',
      `<span class="sv-code-lang">${escapeHtml(label)}</span>`,
      name ? `<span class="sv-code-title">${escapeHtml(name)}</span>` : '',
      '<span class="sv-code-spacer"></span>',
      `<span class="sv-code-count">${lines.length} 行 · ${code.length} 字符</span>`,
      '<button type="button" class="sv-code-btn" data-cb="lines" title="显示 / 隐藏行号">行号</button>',
      '<button type="button" class="sv-code-btn" data-cb="wrap" title="自动换行">换行</button>',
      '<button type="button" class="sv-code-btn" data-cb="fold" title="折叠 / 展开代码">收起</button>',
      '<button type="button" class="sv-code-btn" data-cb="copy" title="复制代码">复制</button>',
      '</div>',
      '<div class="sv-code-fold"><div class="sv-code-fold-inner"><div class="sv-code-wrap">',
      `<div class="sv-code-ln">${gutter}</div>`,
      `<pre><code${safeLang ? ` class="language-${safeLang}"` : ''}>${escapeHtml(code)}</code></pre>`,
      '</div></div></div>',
      '</div>',
    ].join('')
  }
  let html = md.render(content)
  md.renderer.rules.fence = defaultFence
  html = html.replace(/(src|href)="asset:([A-Za-z0-9_-]+)"/g, (_m, attr, id) => `${attr}="${opts.assetUrl(id)}"`)
  // 任务列表：- [ ] / - [x]
  html = html.replace(/<li>\s*\[( |x|X)\]\s*/g, (_m, c) => `<li class="sv-task"><input type="checkbox"${c.trim() ? ' checked' : ''}> `)
  html = html.replace(/<li>\s*<p>\s*\[( |x|X)\]\s*/g, (_m, c) => `<li class="sv-task"><p><input type="checkbox"${c.trim() ? ' checked' : ''}> `)
  // 文字颜色 / 背景色标记换成内联样式
  html = html.replace(/<span data-color="([^"]+)">/g, (m, raw: string) => {
    const c = parseColorAttr(raw)
    return c ? `<span style="color:${resolveSwatch(c)}">` : m
  })
  html = html.replace(/<mark data-bg="([^"]+)">/g, (m, raw: string) => {
    const c = parseColorAttr(raw)
    return c ? `<mark style="background:color-mix(in srgb, ${resolveSwatch(c)} 22%, transparent);color:inherit">` : m
  })
  return sanitizeHtml(html)
}
