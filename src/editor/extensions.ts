import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { DiagramNode } from './nodes/diagram'
import { DatabaseNode } from './nodes/database'
import { EnhancedCodeBlock } from './nodes/codeBlock'
import { FontColor, BgColor } from './marks/colors'

export function buildExtensions(placeholder = "输入 '/' 唤起命令……") {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
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
      table: { resizable: false, HTMLAttributes: { class: 'gn-table' } },
    }),
    FontColor,
    BgColor,
    DiagramNode,
    DatabaseNode,
  ]
}
