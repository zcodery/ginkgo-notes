import type { Editor } from '@tiptap/vue-3'
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Minus,
  Table,
  Table2,
  Image as ImageIcon,
  StickyNote,
  Shapes,
} from 'lucide-vue-next'
import { diagramTemplates } from '@/blocks/diagramTemplates'

export interface SlashCtx {
  insertImage: () => void
  /** 新建一张多维表格并插入引用 */
  insertDatabase: () => void
  /** 插入空图表块（展开模板选择器） */
  insertDiagram: () => void
}

export interface SlashItem {
  id: string
  title: string
  desc: string
  icon: any
  keywords: string[]
  group: string
  run: (editor: Editor, ctx: SlashCtx) => void
}

/** 常用的几种图直接出现在命令菜单里，其余在图表块内切换 */
const QUICK_DIAGRAMS = ['er', 'flow', 'sequence', 'mindmap']

const diagramItems: SlashItem[] = QUICK_DIAGRAMS.flatMap((id) => {
  const t = diagramTemplates.find((x) => x.id === id)
  if (!t) return []
  return [
    {
      id: `dg-${t.id}`,
      title: t.title,
      desc: t.desc,
      icon: t.icon,
      keywords: [...t.keywords, 'tubiao', '图表'],
      group: '图表',
      run: (editor: Editor) =>
        editor
          .chain()
          .focus()
          .insertDiagram({ code: t.code })
          .run(),
    },
  ]
})

export const slashItems: SlashItem[] = [
  {
    id: 'text',
    title: '正文',
    desc: '普通文本段落',
    icon: Type,
    keywords: ['text', 'p', 'wenben', '正文', '段落'],
    group: '基础',
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    title: '一级标题',
    desc: '页面内的大标题',
    icon: Heading1,
    keywords: ['h1', 'heading', 'biaoti', '标题'],
    group: '基础',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: '二级标题',
    desc: '章节标题',
    icon: Heading2,
    keywords: ['h2', 'heading', 'biaoti'],
    group: '基础',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: '三级标题',
    desc: '小节标题',
    icon: Heading3,
    keywords: ['h3', 'heading', 'biaoti'],
    group: '基础',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'bullet',
    title: '无序列表',
    desc: '带圆点的项目列表',
    icon: List,
    keywords: ['ul', 'list', 'bullet', 'liebiao', '列表'],
    group: '列表',
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: '有序列表',
    desc: '带编号的项目列表',
    icon: ListOrdered,
    keywords: ['ol', 'number', 'youxu', '编号'],
    group: '列表',
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    title: '待办清单',
    desc: '可勾选的任务列表',
    icon: ListChecks,
    keywords: ['todo', 'task', 'check', 'daiban', '待办', '任务'],
    group: '列表',
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: '引用',
    desc: '高亮一段引用文字',
    icon: Quote,
    keywords: ['quote', 'yinyong', '引用'],
    group: '区块',
    run: (editor) => editor.chain().focus().setBlockquote().run(),
  },
  {
    id: 'callout',
    title: '提示块',
    desc: '引用样式的强调段落',
    icon: StickyNote,
    keywords: ['callout', 'note', 'tishi', '提示', '注意'],
    group: '区块',
    run: (editor) => {
      editor.chain().focus().setBlockquote().run()
      const { from } = editor.state.selection
      if (editor.state.doc.textContent.trim() === '') {
        editor.commands.insertContentAt(from, '💡 ')
        editor.commands.focus()
      }
    },
  },
  {
    id: 'code',
    title: '代码块',
    desc: '带语法高亮的代码',
    icon: Code2,
    keywords: ['code', 'pre', 'daima', '代码'],
    group: '区块',
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: '分割线',
    desc: '分隔不同内容',
    icon: Minus,
    keywords: ['hr', 'divider', 'fenge', '分割线'],
    group: '区块',
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'diagram',
    title: '图表',
    desc: 'ER 图、链路图、时序图等十种',
    icon: Shapes,
    keywords: ['diagram', 'mermaid', 'chart', 'tubiao', '图表', '绘图'],
    group: '图表',
    run: (_editor, ctx) => ctx.insertDiagram(),
  },
  ...diagramItems,
  {
    id: 'database',
    title: '多维表格',
    desc: '自定义字段、表格/看板视图',
    icon: Table2,
    keywords: ['database', 'db', 'table', 'duowei', '多维表格', '数据库', '看板'],
    group: '数据',
    run: (_editor, ctx) => ctx.insertDatabase(),
  },
  {
    id: 'table',
    title: '表格',
    desc: '插入 3×3 简单表格',
    icon: Table,
    keywords: ['table', 'biaoge', '表格'],
    group: '数据',
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    title: '图片',
    desc: '上传本地图片',
    icon: ImageIcon,
    keywords: ['img', 'image', 'photo', 'tupian', '图片'],
    group: '其他',
    run: (_editor, ctx) => ctx.insertImage(),
  },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return slashItems

  // 打分排序：标题命中优先于关键词命中，前缀命中优先于任意位置命中。
  // 否则输入 "er" 会先匹配到 "ordered list" 而不是 "ER 图"。
  const scored: { item: SlashItem; score: number; order: number }[] = []
  slashItems.forEach((item, order) => {
    const title = item.title.toLowerCase()
    let score = 0
    if (title === q) score = 100
    else if (title.startsWith(q)) score = 90
    else if (title.includes(q)) score = 70

    for (const k of item.keywords) {
      const kw = k.toLowerCase()
      if (kw === q) score = Math.max(score, 80)
      else if (kw.startsWith(q)) score = Math.max(score, 55)
      else if (kw.includes(q)) score = Math.max(score, 25)
    }
    if (!score && item.id.includes(q)) score = 10
    if (score) scored.push({ item, score, order })
  })

  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map((s) => s.item)
}
