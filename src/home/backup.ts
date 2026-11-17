import { createPage, listPages } from '@/db/repo'
import { exportDatabaseData, importDatabaseData } from '@/db/databases'
import { reloadPages } from '@/store'

/**
 * 首页与侧栏共用的「导入 / 备份」能力。
 *
 * 原来只有首页有这两个入口，首页改成仪表盘后仍然要保留，
 * 所以抽到这个独立模块里，两边都能调用。
 */

/** 导入 Markdown / 纯文本 / JSON 备份，返回导入的笔记数 */
export async function importFiles(files: File[]): Promise<number> {
  let count = 0
  for (const file of files) {
    if (file.name.endsWith('.json')) {
      try {
        const data = JSON.parse(await file.text())
        if (Array.isArray(data.databases) && data.databases.length) {
          await importDatabaseData(data.databases, Array.isArray(data.dbRows) ? data.dbRows : [])
        }
        if (Array.isArray(data.pages)) {
          for (const p of data.pages) {
            await createPage({
              title: p.title ?? '',
              icon: p.icon ?? '',
              content: p.content ?? '',
              parentId: null,
            })
            count++
          }
        }
      } catch {
        /* 单个文件失败不影响其余 */
      }
      continue
    }
    const text = await file.text()
    const name = file.name.replace(/\.(md|markdown|txt)$/i, '')
    let title = name
    let content = text
    // 以 H1 开头的 Markdown 文件，把这个 H1 收作页面标题，避免和页面标题重复
    const m = /^#\s+(.+?)\s*\n+/.exec(text)
    if (m) {
      title = m[1].replace(/[*_`~]/g, '').trim() || name
      content = text.slice(m[0].length)
    }
    await createPage({ title, content })
    count++
  }
  await reloadPages()
  return count
}

/** 导出全部笔记 + 多维表格为 JSON 备份文件 */
export async function exportBackup(): Promise<void> {
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
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ginkgo-notes-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
