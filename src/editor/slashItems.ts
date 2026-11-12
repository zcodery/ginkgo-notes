import type { Editor } from '@tiptap/vue-3'
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
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
  Sparkles,
  FileText,
  ChevronDown,
  Highlighter,
} from 'lucide-vue-next'
import { diagramTemplates } from '@/blocks/diagramTemplates'

export interface SlashCtx {
  insertImage: () => void
  /** 新建一张多维表格并插入引用 */
  insertDatabase: () => void
  /** 插入空图表块（展开模板选择器） */
  insertDiagram: () => void
  /** 新建子页面并在正文插入页面卡片 */
  insertPageLink: () => void
  /** 在光标处打开 AI 面板，可指定立即执行的动作 */
  openAi: (action?: string) => void
}

export interface SlashItem {
  id: string
  title: string
  desc: string
  icon: any
  /** 菜单右侧显示的快捷输入，如 `/zw` 中的 `zw`（拼音首字母） */
  shortcut: string
  keywords: string[]
  group: string
  run: (editor: Editor, ctx: SlashCtx) => void
}

/** 常用的几种图直接出现在命令菜单里，其余在图表块内切换 */
const QUICK_DIAGRAMS: Record<string, string> = {
  er: 'er',
  flow: 'llt',
  sequence: 'sxt',
  mindmap: 'swdt',
}

const diagramItems: SlashItem[] = Object.entries(QUICK_DIAGRAMS).flatMap(([id, shortcut]) => {
  const t = diagramTemplates.find((x) => x.id === id)
  if (!t) return []
  return [
    {
      id: `dg-${t.id}`,
      title: t.title,
      desc: t.desc,
      icon: t.icon,
      shortcut,
      keywords: [...t.keywords, 'tubiao', '图表'],
      group: '高级块',
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
    shortcut: 'zw',
    keywords: ['text', 'p', 'wenben', '正文', '段落'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'todo',
    title: '待办列表',
    desc: '可勾选的任务列表',
    icon: ListChecks,
    shortcut: 'dblb',
    keywords: ['todo', 'task', 'check', 'daiban', '待办', '任务'],
    group: '基础块',
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'h1',
    title: '标题1',
    desc: '页面内的大标题',
    icon: Heading1,
    shortcut: 'h1',
    keywords: ['heading', 'biaoti', '标题', '一级标题'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    title: '标题2',
    desc: '章节标题',
    icon: Heading2,
    shortcut: 'h2',
    keywords: ['heading', 'biaoti', '二级标题'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    title: '标题3',
    desc: '小节标题',
    icon: Heading3,
    shortcut: 'h3',
    keywords: ['heading', 'biaoti', '三级标题'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'h4',
    title: '标题4',
    desc: '更小一级的标题',
    icon: Heading4,
    shortcut: 'h4',
    keywords: ['heading', 'biaoti', '四级标题'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setNode('heading', { level: 4 }).run(),
  },
  {
    id: 'table',
    title: '简单表格',
    desc: '插入 3×3 简单表格',
    icon: Table,
    shortcut: 'jdbg',
    keywords: ['table', 'biaoge', '表格'],
    group: '基础块',
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'bullet',
    title: '项目列表',
    desc: '带圆点的项目列表',
    icon: List,
    shortcut: 'xmlb',
    keywords: ['ul', 'list', 'bullet', 'liebiao', '列表', '无序列表'],
    group: '基础块',
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: '编号列表',
    desc: '带编号的项目列表',
    icon: ListOrdered,
    shortcut: 'bhlb',
    keywords: ['ol', 'number', 'youxu', '编号', '有序列表'],
    group: '基础块',
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'quote',
    title: '引用',
    desc: '高亮一段引用文字',
    icon: Quote,
    shortcut: 'yy',
    keywords: ['quote', 'yinyong', '引用'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setBlockquote().run(),
  },
  {
    id: 'callout',
    title: '提示块',
    desc: '引用样式的强调段落',
    icon: StickyNote,
    shortcut: 'tsk',
    keywords: ['callout', 'note', 'tishi', '提示', '注意'],
    group: '基础块',
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
    id: 'details',
    title: '折叠块',
    desc: '可展开/收起的内容块',
    icon: ChevronDown,
    shortcut: 'zdk',
    keywords: ['details', 'fold', 'collapse', 'suck', '折叠', '展开'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setDetails().run(),
  },
  {
    id: 'highlight',
    title: '着重文字',
    desc: '给选中文字加黄色高亮',
    icon: Highlighter,
    shortcut: 'zz',
    keywords: ['highlight', 'mark', 'emphasis', 'zhuozhong', '着重', '高亮'],
    group: '基础块',
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
  },
  {
    id: 'code',
    title: '代码块',
    desc: '带语法高亮的代码',
    icon: Code2,
    shortcut: 'dmk',
    keywords: ['code', 'pre', 'daima', '代码'],
    group: '基础块',
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    title: '分割线',
    desc: '分隔不同内容',
    icon: Minus,
    shortcut: 'fgx',
    keywords: ['hr', 'divider', 'fenge', '分割线'],
    group: '基础块',
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'image',
    title: '图片',
    desc: '上传本地图片',
    icon: ImageIcon,
    shortcut: 'tp',
    keywords: ['img', 'image', 'photo', 'tupian', '图片'],
    group: '媒体',
    run: (_editor, ctx) => ctx.insertImage(),
  },
  {
    id: 'database',
    title: '多维表格',
    desc: '自定义字段、表格/看板视图',
    icon: Table2,
    shortcut: 'dwbg',
    keywords: ['database', 'db', 'duowei', '多维表格', '数据库', '看板'],
    group: '高级块',
    run: (_editor, ctx) => ctx.insertDatabase(),
  },
  {
    id: 'diagram',
    title: '图表',
    desc: 'ER 图、链路图、时序图等十种',
    icon: Shapes,
    shortcut: 'tb',
    keywords: ['diagram', 'mermaid', 'chart', 'tubiao', '图表', '绘图'],
    group: '高级块',
    run: (_editor, ctx) => ctx.insertDiagram(),
  },
  {
    id: 'page-link',
    title: '子页面',
    desc: '新建子页面，并在正文插入可点击的页面卡片',
    icon: FileText,
    shortcut: 'zym',
    keywords: ['page', 'subpage', 'child', 'ziyemian', '子页面', '页面卡片', '链接页面'],
    group: '高级块',
    run: (_editor, ctx) => ctx.insertPageLink(),
  },
  ...diagramItems,
  {
    id: 'ai-write',
    title: 'AI 写作',
    desc: '告诉 AI 要写什么，结果插入到光标处',
    icon: Sparkles,
    shortcut: 'ai',
    keywords: ['ai', 'gpt', 'xiezuo', '写作', '生成', '助手'],
    group: 'AI',
    run: (_editor, ctx) => ctx.openAi(),
  },
  {
    id: 'ai-continue',
    title: 'AI 续写',
    desc: '根据上文自动往下写',
    icon: Sparkles,
    shortcut: 'xx',
    keywords: ['ai', 'continue', 'xuxie', '续写'],
    group: 'AI',
    run: (_editor, ctx) => ctx.openAi('continue'),
  },
]

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return slashItems

  // 打分排序：快捷词 / 标题命中优先于关键词命中，前缀命中优先于任意位置命中。
  // 否则输入 "er" 会先匹配到 "ordered list" 而不是 "ER 图"。
  const scored: { item: SlashItem; score: number; order: number }[] = []
  slashItems.forEach((item, order) => {
    const title = item.title.toLowerCase()
    const sc = item.shortcut.toLowerCase()
    let score = 0
    if (sc === q) score = 100
    else if (title === q) score = 98
    else if (title.startsWith(q)) score = 90
    else if (sc.startsWith(q)) score = 85
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
