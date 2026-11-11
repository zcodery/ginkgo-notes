import { getDatabase, listRows } from '@/db/databases'
import { applyView, cellText } from './dbFields'

const REF_RE = /```ginkgo-db[^\n]*\n([\s\S]*?)```/g

/**
 * 导出 Markdown 时，把 ```ginkgo-db <id> 引用展开成真实的表格快照。
 *
 * 理由：.md 是给别的工具看的，一个指向本机数据库的 ID 在别处毫无意义；
 * 换成表格至少内容能带走。要「原样往返」请用全库 JSON 备份。
 */
export async function expandDatabases(md: string): Promise<string> {
  const refs = [...md.matchAll(REF_RE)]
  if (!refs.length) return md

  let out = md
  for (const m of refs) {
    const id = m[1].trim().split('\n')[0].trim()
    const table = await renderTableSnapshot(id)
    // 前面补一个空行，避免标题和上一段粘在一起
    out = out.replace(m[0], () => '\n' + table)
  }
  return out
}

async function renderTableSnapshot(dbId: string): Promise<string> {
  const d = await getDatabase(dbId)
  if (!d) return '> （引用的多维表格已不存在）\n'

  const rows = await listRows(dbId)
  const view = d.views[0] ?? null
  const shown = applyView(rows, d.fields, view)
  const fields = d.fields.filter((f) => !(view?.hiddenFields ?? []).includes(f.id))
  if (!fields.length) return `### ${d.title}\n\n（这张表没有字段）\n`

  const cell = (f: (typeof fields)[number], row: (typeof shown)[number]) =>
    cellText(f, row.cells[f.id]).replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '

  const head = `| ${fields.map((f) => f.name).join(' | ')} |`
  const sep = `| ${fields.map(() => '---').join(' | ')} |`
  const body = shown.map((r) => `| ${fields.map((f) => cell(f, r)).join(' | ')} |`)

  const parts = [`### ${d.icon ? d.icon + ' ' : ''}${d.title}`, '', head, sep, ...body]
  if (!shown.length) parts.push('> 暂无数据')
  parts.push('')
  return parts.join('\n')
}
