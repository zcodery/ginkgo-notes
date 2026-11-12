import MarkdownIt from 'markdown-it'
import type { Database, DbRow } from '@/types'
import { cellText } from '@/blocks/dbFields'
import { parseColorAttr, resolveSwatch } from '@/editor/marks/colors'

/**
 * 只读场景（公开分享页）把 Markdown 渲染成 HTML。
 * 保留正文里自定义的 <span data-color> / <mark data-bg> / <u> 等内联标记，
 * 其余 HTML 走白名单清洗，防止分享内容里夹带脚本。
 */

const md = new MarkdownIt({ html: true, linkify: true, breaks: false })

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
  'img', 'input', 'li', 'mark', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'colgroup', 'col', 'details', 'summary',
])
const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'class', 'data-color', 'data-bg', 'type', 'checked', 'disabled', 'colspan',
  'rowspan', 'style', 'data-lang', 'data-db', 'data-code', 'target', 'rel',
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

/** 渲染为 HTML；mermaid 代码块保留为占位，由调用方异步渲染 */
export function renderMarkdown(source: string, opts: RenderOptions): string {
  const content = source.replace(/<!--\s*gn-table[^>]*-->\n?/g, '')
  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    const lang = token.info.trim().split(/\s+/)[0] ?? ''
    if (lang === 'mermaid') return `<div class="sv-mermaid" data-code="${escapeHtml(token.content)}"></div>`
    if (lang === 'ginkgo-db') return renderDatabase(opts.databases?.[token.content.trim()])
    const html = defaultFence(tokens, idx, options, env, self)
    return lang ? html.replace('<pre>', `<pre data-lang="${escapeHtml(lang)}">`) : html
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
