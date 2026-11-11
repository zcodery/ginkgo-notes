import { randomUUID } from 'node:crypto'
import {
  PUBLIC_OWNER,
  type Doc,
  getSetting,
  listDocs,
  listRowsOf,
  putDatabase,
  putPage,
  putRow,
  setSetting,
  transaction,
} from './db.ts'

function shortId(prefix: string, len: number): string {
  return prefix + randomUUID().replace(/-/g, '').slice(0, len)
}

/** 与前端 toPlainText 保持一致，用于生成摘要 */
export function toPlainText(md: string, limit = 240): string {
  return md
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
    .slice(0, limit)
}

const DB_REF_RE = /(```ginkgo-db[^\n]*\n)([\s\S]*?)(```)/g

/* ---------------- 公共原稿初始内容 ---------------- */

const WELCOME = `这是一款 Markdown 笔记工具，笔记保存在你自己的账号下，换台电脑登录也能继续写。

### 区块可以随意组合

在任意空行输入 \`/\` 唤出命令菜单，就能插入标题、列表、待办、引用、代码块、图片……

- 输入 \`# \` 加空格，立刻变成一级标题
- 输入 \`- \` 加空格，是列表
- 输入 \`[] \` 加空格，是待办
- 输入 \`> \` 加空格，是引用
- 输入 \`---\` 回车，是分割线

### 待办清单

- [x] 打开第一份笔记
- [x] 写下一个想法
- [ ] 把想法变成行动

> 笔记的价值不在记录，而在于被重新读到的时刻。

### 代码块

\`\`\`ts
export function capture(thought: string) {
  return { thought, at: Date.now() }
}
\`\`\`

### 底层就是 Markdown

每份笔记在存储时都会被序列化成纯 Markdown 文本，右上角菜单里随时能导出成 \`.md\` 文件，迁移到任何别的工具都不需要重新整理。

---

这几篇是系统发给你的示例副本，删掉不会影响别人。按 \`⌘/Ctrl + K\` 可以全局搜索。

### 图表不是图片，是一段代码

\`\`\`mermaid
flowchart LR
  A["写下来"] --> B{"想清楚了吗"}
  B -- 还没有 --> A
  B -- 有了 --> C["行动"]
\`\`\`

图表块存的是 Mermaid 源码，双击就能改；导出成 \`.md\` 后在 GitHub 上照样能渲染。
输入 \`/\` 可以插入 ER 图、链路图、时序图、思维导图、甘特图、状态图、类图、饼图。

### 多维表格

下面这张表是真实的数据，不是排版：可以加字段、切看板、筛选排序，也能被多个页面引用。
`

const GUIDE = `## Markdown 语法速查

| 写法 | 效果 |
| --- | --- |
| \`**粗体**\` | **粗体** |
| \`*斜体*\` | *斜体* |
| \`~~删除线~~\` | ~~删除线~~ |
| \`\`行内代码\`\` | \`行内代码\` |
| \`[文字](链接)\` | 超链接 |

### 快捷键

- \`⌘/Ctrl + B\` 粗体
- \`⌘/Ctrl + I\` 斜体
- \`⌘/Ctrl + U\` 下划线
- \`⌘/Ctrl + Z\` 撤销，\`⌘/Ctrl + Y\` 重做
- \`⌘/Ctrl + K\` 全局搜索
- 选中文字会浮出格式工具条
- 把鼠标移到段落左侧，可以拖动排序或转换区块

### 图表：也是一个代码块

用 \`mermaid\` 代码块包起来的内容会被渲染成图，源码就是普通 Markdown：

\`\`\`mermaid
sequenceDiagram
  participant 你
  participant 笔记
  你->>笔记: 写下来
  笔记-->>你: 重新读到时
\`\`\`

### 多维表格：正文只留一个引用

多维表格的结构化数据单独存在数据库里，正文里只留一个 \`ginkgo-db\` 代码块（内容是表格 ID），所以同一张表可以被多个页面共用 —— 用斜杠菜单插入即可，不用手写。

导出 \`.md\` 时这个引用会自动展开成真实的表格快照，别的地方打开也能看到内容。
`

function newPage(init: { title: string; icon: string; content: string; order: number }): Doc {
  const now = Date.now()
  return {
    id: randomUUID(),
    title: init.title,
    icon: init.icon,
    parentId: null,
    content: init.content,
    excerpt: toPlainText(init.content, 200),
    favorite: false,
    trashed: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    order: init.order,
    cover: null,
  }
}

function sampleDatabase(owner: string): string {
  const now = Date.now()
  const nameField = { id: shortId('f_', 8), name: '名称', type: 'text' }
  const statusField = {
    id: shortId('f_', 8),
    name: '状态',
    type: 'select',
    options: [
      { id: 'o_todo', name: '待开始', color: 'gray' },
      { id: 'o_doing', name: '进行中', color: 'blue' },
      { id: 'o_done', name: '已完成', color: 'green' },
    ],
  }
  const priorityField = {
    id: shortId('f_', 8),
    name: '优先级',
    type: 'select',
    options: [
      { id: 'o_p0', name: 'P0', color: 'red' },
      { id: 'o_p1', name: 'P1', color: 'orange' },
      { id: 'o_p2', name: 'P2', color: 'gray' },
    ],
  }
  const fields = [
    nameField,
    statusField,
    priorityField,
    { id: shortId('f_', 8), name: '截止日期', type: 'date' },
    { id: shortId('f_', 8), name: '完成', type: 'checkbox' },
  ]
  const view = (name: string, type: string, groupBy: string | null) => ({
    id: shortId('v_', 8),
    name,
    type,
    groupBy,
    filters: [],
    sorts: [],
    hiddenFields: [],
  })
  const dbId = shortId('db_', 10)
  putDatabase(owner, {
    id: dbId,
    title: '示例：任务清单',
    icon: '🗂️',
    fields,
    views: [view('表格', 'table', null), view('看板', 'board', statusField.id)],
    createdAt: now,
    updatedAt: now,
  })
  const seed: [string, string, string][] = [
    ['梳理需求', 'o_todo', 'o_p0'],
    ['画一版原型', 'o_doing', 'o_p1'],
    ['写完第一篇笔记', 'o_done', 'o_p2'],
  ]
  seed.forEach(([name, status, priority], i) => {
    putRow(owner, {
      id: shortId('r_', 10),
      dbId,
      cells: { [nameField.id]: name, [statusField.id]: status, [priorityField.id]: priority },
      order: i + 1,
      createdAt: now,
      updatedAt: now,
    })
  })
  return dbId
}

/** 首次启动时生成公共原稿；只做一次，管理员删光原稿后不会再自动补回 */
export function seedPublicTemplates(): void {
  if (getSetting('publicSeeded')) return
  transaction(() => {
    if (listDocs('pages', PUBLIC_OWNER).length === 0) {
      const dbId = sampleDatabase(PUBLIC_OWNER)
      putPage(
        PUBLIC_OWNER,
        newPage({
          title: '欢迎来到银杏笔记',
          icon: '🍃',
          content: `${WELCOME}\n\`\`\`ginkgo-db\n${dbId}\n\`\`\`\n`,
          order: 1,
        }),
      )
      putPage(
        PUBLIC_OWNER,
        newPage({ title: 'Markdown 语法速查', icon: '📐', content: GUIDE, order: 2 }),
      )
    }
    setSetting('publicSeeded', '1')
  })
}

/**
 * 把当前所有公共原稿复制一份给新用户。
 *
 * 副本是完全独立的：页面、引用到的多维表格及其行都换成新 id，
 * 用户删改副本不会碰到原稿；图片仍指向公共图片（只读共享）。
 */
export function copyTemplatesToUser(userId: string): void {
  const pages = listDocs('pages', PUBLIC_OWNER).filter((p) => !p.trashed)
  if (!pages.length) return

  const pageIds = new Map<string, string>()
  for (const p of pages) pageIds.set(p.id, randomUUID())
  const dbIds = new Map<string, string>()
  const publicDbIds = new Set(listDocs('databases', PUBLIC_OWNER).map((d) => d.id))
  const now = Date.now()

  const copyDatabase = (sourceId: string): string => {
    const cached = dbIds.get(sourceId)
    if (cached) return cached
    const source = listDocs('databases', PUBLIC_OWNER).find((d) => d.id === sourceId)
    if (!source) return sourceId
    const newId = shortId('db_', 10)
    dbIds.set(sourceId, newId)
    putDatabase(userId, { ...source, id: newId, createdAt: now, updatedAt: now })
    for (const row of listRowsOf(sourceId, PUBLIC_OWNER)) {
      putRow(userId, { ...row, id: shortId('r_', 10), dbId: newId, createdAt: now, updatedAt: now })
    }
    return newId
  }

  transaction(() => {
    for (const p of pages) {
      const content = String(p.content ?? '').replace(
        DB_REF_RE,
        (whole, open: string, body: string, close: string) => {
          const ref = body.trim().split('\n')[0]?.trim() ?? ''
          if (!publicDbIds.has(ref)) return whole
          return `${open}${copyDatabase(ref)}\n${close}`
        },
      )
      const parentId = typeof p.parentId === 'string' ? (pageIds.get(p.parentId) ?? null) : null
      putPage(
        userId,
        {
          ...p,
          id: pageIds.get(p.id)!,
          parentId,
          content,
          favorite: false,
          trashed: false,
          trashedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        p.id,
      )
    }
  })
}
