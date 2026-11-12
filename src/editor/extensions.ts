import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import {
  GnDetails,
  GnDetailsSummary,
  GnDetailsContent,
  GnDetailsClick,
} from './nodes/details'
import { ListFold } from './nodes/listFold'
import { TableKit } from '@tiptap/extension-table'
import { GnTableCell, GnTableHeader } from './nodes/tableCell'
import { DiagramNode } from './nodes/diagram'
import { DatabaseNode } from './nodes/database'
import { PageLinkNode } from './nodes/pageLink'
import { EnhancedCodeBlock } from './nodes/codeBlock'
import { FontColor, BgColor } from './marks/colors'
import { SearchReplace } from './searchReplace'

export function buildExtensions(placeholder = "输入 '/' 唤起命令……") {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
      dropcursor: { color: 'var(--gn-accent)', width: 2 },
      // Ctrl+Z 撤销 / Ctrl+Y、Ctrl+Shift+Z 重做
      undoRedo: { depth: 200, newGroupDelay: 400 },
    }),
    Placeholder.configure({ placeholder }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true, allowBase64: true }),
    // 自定义代码块：带工具栏（语言 / 代码名字 / 格式化 / 复制 …）
    EnhancedCodeBlock.configure({ defaultLanguage: null, enableTabIndentation: true, tabSize: 2 }),
    TableKit.configure({
      // 拖动列边线调整单列宽度；宽度写在单元格 colwidth 上，随 Markdown 注释落盘
      table: {
        resizable: true,
        handleWidth: 6,
        cellMinWidth: 60,
        lastColumnResizable: true,
        HTMLAttributes: { class: 'gn-table' },
      },
      // 单元格换成带背景色 / 对齐属性的扩展版本
      tableCell: false,
      tableHeader: false,
    }),
    GnTableCell,
    GnTableHeader,
    // 着重文字：==text== Markdown → <mark>
    Highlight.configure({ multicolor: false }),
    // 折叠块：原生 <details>/<summary>，浏览器负责折叠，点击箭头同步 open 属性
    GnDetails,
    GnDetailsSummary,
    GnDetailsContent,
    GnDetailsClick,
    // 列表项折叠箭头（有子列表的 li 左侧）
    ListFold,
    FontColor,
    BgColor,
    DiagramNode,
    DatabaseNode,
    PageLinkNode,
    SearchReplace,
  ]
}
