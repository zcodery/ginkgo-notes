import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ColumnsView from '@/blocks/ColumnsView.vue'

/**
 * 分栏容器：横向排布的若干「列」，每列内部是普通块内容。
 *
 * - `columns` 是容器，content 为 `column+`（至少一列）；
 * - `column` 是单列，content 为 `block+`（至少一段），各自带 `width` 权重；
 * - 列宽比例由每列的 `width` 决定，容器用 flex-grow 渲染；
 * - 序列化走 `<!-- gn-columns -->` 注释包裹（见 markdown.ts），与 details 同思路，
 *   保证在「编辑器 ↔ Markdown」之间 1:1 往返，其它 Markdown 渲染器打开只是纵向堆叠。
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    gnColumns: {
      /** 在光标处插入一个分栏块，默认 2 列 */
      setColumns: (opts?: { count?: number }) => ReturnType
    }
  }
}

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // 仅作 HTML 往返 / 剪贴板结构；实际显示由 ColumnsView NodeView 负责
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'gn-columns' }),
      0,
    ]
  },

  addNodeView() {
    return VueNodeViewRenderer(ColumnsView as any)
  },

  addCommands() {
    return {
      setColumns:
        (opts?: { count?: number }) =>
        ({ commands }) => {
          const count = Math.min(Math.max(opts?.count ?? 2, 1), 4)
          const cols = []
          for (let i = 0; i < count; i++) cols.push({ type: 'column', attrs: { width: 1 }, content: [{ type: 'paragraph' }] })
          // 分栏后面补一个空段落，方便继续在外面输入
          return commands.insertContent([{ type: 'columns', content: cols }, { type: 'paragraph' }])
        },
    }
  },
})

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      width: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const w = Number(element.getAttribute('data-width'))
          return Number.isFinite(w) && w > 0 ? w : 1
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const w = Number(attributes.width) || 1
          return { 'data-width': w }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const w = Number(node.attrs.width) || 1
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column',
        class: 'gn-column',
        style: `flex-grow:${w};flex-basis:0;min-width:0`,
      }),
      0,
    ]
  },
})
