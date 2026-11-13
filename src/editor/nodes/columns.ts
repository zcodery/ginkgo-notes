import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
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
      /** 在光标处插入一个空白分栏块，默认 2 列 */
      setColumns: (opts?: { count?: number }) => ReturnType
      /**
       * 把一段范围内的顶层块（默认取当前选区覆盖的顶层块）就地转成多栏布局。
       * - 选区覆盖多个顶层块时，这些块会被依次分配到各列（轮流填充）；
       * - 列数多于块数时，多余列补空段落；块数多于列数时轮流分配；
       * - 选区为单块（或空段落）时，该块进入第一列，其余列空白，等价于"从现有行变多栏"。
       */
      convertToColumns: (opts?: { count?: number; from?: number; to?: number }) => ReturnType
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

      convertToColumns:
        (opts?: { count?: number; from?: number; to?: number }) =>
        ({ state, dispatch, tr }) => {
          const count = Math.min(Math.max(opts?.count ?? 2, 1), 4)
          const doc = state.doc
          const sel = state.selection
          const from = opts?.from != null ? opts.from : Math.min(sel.from, sel.to)
          const to = opts?.to != null ? opts.to : Math.max(sel.from, sel.to)

          // 收集被选区覆盖（或给定范围）的顶层块
          const blocks: { node: PMNode; pos: number }[] = []
          doc.forEach((node: PMNode, offset: number) => {
            const end = offset + node.nodeSize
            if (end > from && offset < to) blocks.push({ node, pos: offset })
          })
          if (!blocks.length) return false

          const columnsType = state.schema.nodes.columns
          const columnType = state.schema.nodes.column
          const paragraphType = state.schema.nodes.paragraph

          // 把收集到的块轮流分配到各列；列数多于块数时该列补空段落
          const buckets: PMNode[][] = Array.from({ length: count }, () => [])
          blocks.forEach((b, i) => buckets[i % count].push(b.node))
          const columnNodes = buckets.map((content) =>
            columnType.create({ width: 1 }, content.length ? content : [paragraphType.create()]),
          )
          const columnsNode = columnsType.create(null, columnNodes)
          const trailing = paragraphType.create()

          if (dispatch) {
            const firstPos = blocks[0].pos
            const last = blocks[blocks.length - 1]
            const lastPos = last.pos + last.node.nodeSize
            // 用分栏节点替换原区块范围，再在后面补一个空段落
            tr.replaceWith(firstPos, lastPos, columnsNode)
            tr.insert(firstPos + columnsNode.nodeSize, trailing)
            // 光标落到第一列首个块的起始处（near 兼容首个块非文本块的情况）
            tr.setSelection(TextSelection.near(tr.doc.resolve(firstPos + 3)))
          }
          return true
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
