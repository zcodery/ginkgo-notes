import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import ColumnsView from '@/blocks/ColumnsView.vue'

/** 一列是否为「空」：仅含一个空文本块 */
function isColEmpty(col: PMNode | null | undefined): boolean {
  if (!col) return false
  return col.childCount === 1 && col.firstChild?.isTextblock === true && col.firstChild.content.size === 0
}

const LIST_TYPES = ['bulletList', 'orderedList', 'taskList']

/**
 * 把拖拽出来的内容规整成合法的「列内容」（column 的 content 是 `block+`）。
 * - 本身合法（普通段落/标题等）→ 原样返回；
 * - 全是列表项（listItem / taskItem，拖动清单条目就是这种）→ 按原列表类型回包成
 *   bulletList / orderedList / taskList，否则「一个孤立的 li」不是合法块；
 * - 其它（如半截列表、孤立的行内内容）→ 返回 null，交给普通重排。
 */
function toColumnContent(state: any, content: Fragment, from: number): Fragment | null {
  const columnType = state.schema.nodes.column
  if (!columnType) return null
  if (columnType.validContent(content)) return content
  if (!content.childCount) return null

  let allListItems = true
  content.forEach((c: PMNode) => {
    if (c.type.name !== 'listItem' && c.type.name !== 'taskItem') allListItems = false
  })
  if (!allListItems) return null

  // 优先沿用「原列表」的类型与属性（有序列表的 start 等），保证语义不丢
  const parent = from <= state.doc.content.size ? state.doc.resolve(from).parent : state.doc
  const parentIsList = LIST_TYPES.includes(parent.type.name)
  const nodes = state.schema.nodes
  const listType = parentIsList
    ? parent.type
    : content.firstChild!.type.name === 'taskItem'
      ? nodes.taskList
      : nodes.bulletList
  if (!listType) return null

  const wrapped = listType.create(parentIsList ? parent.attrs : null, content)
  const frag = Fragment.from(wrapped)
  return columnType.validContent(frag) ? frag : null
}

/** 把 columns 节点整体替换为单个空段落（退出分栏） */
function unwrapColumnsImpl(tr: Transaction, state: any, columnsPos: number, node: PMNode) {
  const para = state.schema.nodes.paragraph.create()
  tr.replaceWith(columnsPos, columnsPos + node.nodeSize, para)
  tr.setSelection(TextSelection.near(tr.doc.resolve(columnsPos + 1)))
}

/**
 * 安全删除范围。
 *
 * `column` 的 content 是 `block+`：如果删除的范围恰好是某列的全部内容，
 * 直接删会留下「空列」→ 文档非法（ProseMirror 会直接抛错）。
 * 因此把删除范围向上扩大：只剩这一列 → 删掉整个 columns；否则删掉整列。
 */
export function safeDeleteRange(doc: PMNode, from: number, to: number): [number, number] {
  if (from >= to) return [from, to]
  let $from
  try {
    $from = doc.resolve(from)
  } catch {
    return [from, to]
  }
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d)
    if (node.type.name !== 'column') continue
    const parent = $from.node(d - 1)
    if (parent.type.name !== 'columns') return [from, to]
    const colStart = $from.before(d)
    const innerStart = colStart + 1
    const innerEnd = colStart + node.nodeSize - 1
    // 只在该范围覆盖整列内容时才扩大；部分删除列内内容不受影响
    if (!(from <= innerStart && to >= innerEnd)) return [from, to]
    const colsStart = $from.before(d - 1)
    if (parent.childCount === 1) return [colsStart, colsStart + parent.nodeSize]
    return [colStart, colStart + node.nodeSize]
  }
  return [from, to]
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
      /**
       * 把「普通块」就地变成两栏，并把拖拽进来的块放到它的左/右侧。
       * 用于「拖一个块到任意普通行上 → 该行动态多出一栏」，无需先存在分栏。
       * - 目标块成为其中一列，拖拽内容成为另一列（side 决定左右）；
       * - 源块会被删除（移动语义），即便源块在目标之前/之后都按原坐标正确换算；
       * - 目标本身是 columns/column、与源范围重叠、或内容不合法时返回 false（交给普通重排）。
       */
      makeColumnsWithBlock: (opts: {
        targetPos: number
        from: number
        to: number
        side: 'left' | 'right'
      }) => ReturnType
      /**
       * 清单条目级的「并排成栏」。
       *
       * 目标是一个 listItem/taskItem 时不能按整张清单换成分栏（那会把整张表放进一列），
       * 必须把这一条从列表里**切出来单独成列**：原列表按位置拆成「前面的条目」
       * + 分栏 + 「后面的条目」，分栏两列分别是目标条目与拖入内容（各自回包成同类列表）。
       * 列表只有这一条时退化为整体替换，不会留下空列表。
       */
      makeColumnsWithListItem: (opts: {
        itemPos: number
        from: number
        to: number
        side: 'left' | 'right'
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
          const raw: Fragment = state.doc.slice(from, to).content
          if (raw.size === 0) return false
          // 拖拽内容必须是合法的列内容（block+）；清单条目会回包成同类列表
          const content = toColumnContent(state, raw, from)
          if (!content) return false

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
          if (dispatch) {
            const [dFrom, dTo] = safeDeleteRange(tr.doc, fromM, toM)
            tr.delete(dFrom, dTo)
          }

          if (dispatch) {
            const caret = effectiveMode === 'new' ? insertPos + 3 : colStarts[intoColIndex] + 3
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(caret, tr.doc.content.size))))
          }
          return true
        },

      makeColumnsWithBlock:
        (opts: { targetPos: number; from: number; to: number; side: 'left' | 'right' }) =>
        ({ state, dispatch, tr }) => {
          const { targetPos, from, to, side } = opts
          if (to <= from) return false
          const target = state.doc.nodeAt(targetPos)
          if (!target) return false
          if (target.type.name === 'columns' || target.type.name === 'column') return false
          // 目标必须是「顶层块」；孤立列表项不能直接换成块级分栏（会破坏列表结构）
          if (target.type.name === 'listItem' || target.type.name === 'taskItem') return false
          // 拖到自己身上（或与自己重叠）时不做处理，避免自我嵌套
          if (from < targetPos + target.nodeSize && to > targetPos) return false
          // 空段落作为目标是「占位行」，保持普通移动语义，不产生半空分栏
          if (target.isTextblock && target.content.size === 0) return false

          const raw: Fragment = state.doc.slice(from, to).content
          if (raw.size === 0) return false

          const columnType = state.schema.nodes.column
          const columnsType = state.schema.nodes.columns
          if (!columnType || !columnsType) return false
          // 目标块必须本身就能成为一列；拖拽内容允许是清单条目（回包成同类列表）
          if (!columnType.validContent(Fragment.from(target))) return false
          const content = toColumnContent(state, raw, from)
          if (!content) return false

          const targetCol = columnType.create({ width: 1 }, target)
          const dragCol = columnType.create({ width: 1 }, content)
          const cols = side === 'left' ? [dragCol, targetCol] : [targetCol, dragCol]
          const columnsNode = columnsType.create(null, cols)

          if (dispatch) {
            // 先删源块：源在目标之前时目标坐标要相应前移；源在目标之后则不受影响。
            // 源块若是某列的唯一内容，删除范围会扩大到整列（否则会留下非法空列）。
            const [dFrom, dTo] = safeDeleteRange(state.doc, from, to)
            tr.delete(dFrom, dTo)
            const at = targetPos >= dTo ? targetPos - (dTo - dFrom) : targetPos
            tr.replaceWith(at, at + target.nodeSize, columnsNode)
            // 光标落到第一列首个块内（near 兼容非文本块）
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 2, tr.doc.content.size))))
          }
          return true
        },

      makeColumnsWithListItem:
        (opts: { itemPos: number; from: number; to: number; side: 'left' | 'right' }) =>
        ({ state, dispatch, tr }) => {
          const { itemPos, from, to, side } = opts
          if (to <= from) return false
          // 源就是目标条目本身 / 源范围覆盖目标 → 没有意义
          if (itemPos >= from && itemPos < to) return false

          const item = state.doc.nodeAt(itemPos)
          if (!item || (item.type.name !== 'listItem' && item.type.name !== 'taskItem')) return false
          const $item = state.doc.resolve(itemPos)
          const list = $item.parent
          if (!LIST_TYPES.includes(list.type.name)) return false

          const columnType = state.schema.nodes.column
          const columnsType = state.schema.nodes.columns
          if (!columnType || !columnsType) return false

          const raw: Fragment = state.doc.slice(from, to).content
          if (raw.size === 0) return false
          const content = toColumnContent(state, raw, from)
          if (!content) return false

          // 目标条目单独回包成同类列表（保留 taskItem 的 checked 等属性），才能作为一列
          const targetFrag = Fragment.from(list.type.create(list.attrs, Fragment.from(item)))
          if (!columnType.validContent(targetFrag)) return false
          const targetCol = columnType.create({ width: 1 }, targetFrag)
          const dragCol = columnType.create({ width: 1 }, content)
          const columnsNode = columnsType.create(null, side === 'left' ? [dragCol, targetCol] : [targetCol, dragCol])

          if (dispatch) {
            // 1) 先删源块（可能是同一张清单里的另一条，删除后列表结构与位置都会变）
            const [dFrom, dTo] = safeDeleteRange(state.doc, from, to)
            tr.delete(dFrom, dTo)

            // 2) 把目标条目映射到删除后的坐标，并重新确认它仍在列表里
            const itemPos2 = tr.mapping.map(itemPos)
            const item2 = tr.doc.nodeAt(itemPos2)
            if (!item2 || (item2.type.name !== 'listItem' && item2.type.name !== 'taskItem')) return false
            const $i2 = tr.doc.resolve(itemPos2)
            const list2 = $i2.parent
            if (!LIST_TYPES.includes(list2.type.name)) return false
            const listPos2 = $i2.before($i2.depth)

            // 3) 该条目在列表中的序号（按子节点实际偏移累加，避免额外包裹层算错）
            let idx = 0
            let p = listPos2 + 1
            while (p < itemPos2 && idx < list2.childCount) {
              p += list2.child(idx).nodeSize
              idx++
            }
            const beforeItems: PMNode[] = []
            const afterItems: PMNode[] = []
            list2.forEach((child: PMNode, _offset: number, i: number) => {
              if (i < idx) beforeItems.push(child)
              else if (i > idx) afterItems.push(child)
            })

            // 4) 原列表拆成「前面的条目」+ 分栏 + 「后面的条目」；空的半边直接不生成
            const parts: PMNode[] = []
            if (beforeItems.length) parts.push(list2.type.create(list2.attrs, Fragment.from(beforeItems)))
            parts.push(columnsNode)
            if (afterItems.length) parts.push(list2.type.create(list2.attrs, Fragment.from(afterItems)))

            tr.replaceWith(listPos2, listPos2 + list2.nodeSize, Fragment.from(parts))
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(listPos2 + 3, tr.doc.content.size))))
          }
          return true
        },

      removeColumnsAt:        (opts: { columnsPos: number; indices: number[] }) =>
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
