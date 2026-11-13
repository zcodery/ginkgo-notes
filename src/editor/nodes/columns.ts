import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNode, Fragment } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import ColumnsView from '@/blocks/ColumnsView.vue'

/** 一列是否为「空」：仅含一个空文本块 */
function isColEmpty(col: PMNode | null | undefined): boolean {
  if (!col) return false
  return col.childCount === 1 && col.firstChild?.isTextblock === true && col.firstChild.content.size === 0
}

/** 把 columns 节点整体替换为单个空段落（退出分栏） */
function unwrapColumnsImpl(tr: Transaction, state: any, columnsPos: number, node: PMNode) {
  const para = state.schema.nodes.paragraph.create()
  tr.replaceWith(columnsPos, columnsPos + node.nodeSize, para)
  tr.setSelection(TextSelection.near(tr.doc.resolve(columnsPos + 1)))
}

const MAX_COLUMNS = 4

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
      /**
       * 把 [from,to) 的块移动到某个分栏：
       * - mode='new'：在 targetColumnsPos 的第 index 列之前新建一列并放入这些块（index 省略则末尾）；
       *   若目标栏已达 MAX，自动降级为追加到最后一列（mode='into'）。
       * - mode='into'：把块追加进第 columnIndex 列；若目标列仅有一个空段落则直接替换之。
       * 源块始终会被删除（即「移动」而非「复制」）。
       */
      moveBlocksToColumn: (opts: {
        from: number
        to: number
        targetColumnsPos: number
        mode: 'new' | 'into'
        index?: number
        columnIndex?: number
      }) => ReturnType
      /** 按索引删除分栏中的若干列（索引去重、按原位置降序删除）；若删除后仅剩 1 个空列或 0 列则自动退出分栏 */
      removeColumnsAt: (opts: { columnsPos: number; indices: number[] }) => ReturnType
      /** 把分栏整行退化为一个空段落 */
      unwrapColumns: (opts: { columnsPos: number }) => ReturnType
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

      moveBlocksToColumn:
        (opts: { from: number; to: number; targetColumnsPos: number; mode: 'new' | 'into'; index?: number; columnIndex?: number }) =>
        ({ state, dispatch, tr }) => {
          const { from, to, targetColumnsPos, mode, index, columnIndex } = opts
          const node = state.doc.nodeAt(targetColumnsPos)
          if (!node || node.type.name !== 'columns') return false
          const content: Fragment = state.doc.slice(from, to).content
          if (content.size === 0) return false
          // 拖拽内容必须是合法的列内容（block+），否则放弃（交由普通重排处理）
          if (!state.schema.nodes.column.validContent(content)) return false

          // 计算该分栏各列在文档中的起始位置
          const colStarts: number[] = []
          {
            let p = targetColumnsPos + 1
            for (let i = 0; i < node.childCount; i++) {
              colStarts.push(p)
              p += node.child(i).nodeSize
            }
          }

          let effectiveMode: 'new' | 'into' = mode
          let insertPos = -1
          let intoColIndex = -1
          if (effectiveMode === 'new') {
            // 已满 4 栏则降级为「追加到最后一列」
            if (node.childCount >= MAX_COLUMNS) effectiveMode = 'into'
          }
          if (effectiveMode === 'new') {
            const idx = Math.min(Math.max(index ?? node.childCount, 0), node.childCount)
            // 第 idx 列之前；idx === childCount 时追加到分栏内容末尾
            insertPos = idx < node.childCount ? colStarts[idx] : targetColumnsPos + node.nodeSize - 1
            const col = state.schema.nodes.column.create({ width: 1 }, content)
            if (dispatch) tr.insert(insertPos, col)
          } else {
            intoColIndex = Math.min(Math.max(columnIndex ?? node.childCount - 1, 0), node.childCount - 1)
            const col = node.child(intoColIndex)
            const colStart = colStarts[intoColIndex]
            const colEnd = colStart + col.nodeSize
            if (dispatch) {
              if (isColEmpty(col)) {
                // 仅有一个空段落：直接替换为拖入的内容
                tr.replaceWith(colStart + 1, colEnd - 1, content)
              } else {
                // 否则追加到列末尾
                tr.insert(colEnd - 1, content)
              }
            }
          }

          // 删除源块（移动而非复制）；insert 之后用 mapping 把 from/to 映射到新坐标
          const fromM = tr.mapping.map(from)
          const toM = tr.mapping.map(to)
          if (dispatch) tr.delete(fromM, toM)

          if (dispatch) {
            const caret = effectiveMode === 'new' ? insertPos + 3 : colStarts[intoColIndex] + 3
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))))
          }
          return true
        },

      removeColumnsAt:
        (opts: { columnsPos: number; indices: number[] }) =>
        ({ state, dispatch, tr }) => {
          const { columnsPos, indices } = opts
          const node = state.doc.nodeAt(columnsPos)
          if (!node || node.type.name !== 'columns') return false
          const uniq = [...new Set(indices)].filter((i) => i >= 0 && i < node.childCount)
          if (!uniq.length) return false

          const remainingIdx: number[] = []
          for (let i = 0; i < node.childCount; i++) if (!uniq.includes(i)) remainingIdx.push(i)

          // 删完剩 0 列，或仅剩 1 个空列 → 退出分栏
          if (remainingIdx.length === 0 || (remainingIdx.length === 1 && isColEmpty(node.child(remainingIdx[0])))) {
            if (dispatch) unwrapColumnsImpl(tr, state, columnsPos, node)
            return true
          }

          if (dispatch) {
            // 计算每列在「删除前」文档中的原始位置，按索引降序删除，保证坐标不被前面的删除影响
            const origPos: number[] = []
            {
              let p = columnsPos + 1
              for (let i = 0; i < node.childCount; i++) {
                origPos.push(p)
                p += node.child(i).nodeSize
              }
            }
            for (let k = uniq.length - 1; k >= 0; k--) {
              const i = uniq[k]
              const pos = origPos[i]
              const size = node.child(i).nodeSize
              tr.delete(pos, pos + size)
            }
          }
          return true
        },

      unwrapColumns:
        (opts: { columnsPos: number }) =>
        ({ state, dispatch, tr }) => {
          const { columnsPos } = opts
          const node = state.doc.nodeAt(columnsPos)
          if (!node || node.type.name !== 'columns') return false
          if (dispatch) unwrapColumnsImpl(tr, state, columnsPos, node)
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
