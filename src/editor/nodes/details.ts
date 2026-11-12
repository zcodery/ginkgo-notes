import { Extension, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { runFoldAnimation } from '@/editor/collapseRun'

/**
 * 折叠块：直接渲染原生 <details>/<summary>，由浏览器负责显示/隐藏，
 * 点击箭头时我们自己同步 open 属性到文档（保证能落盘到 Markdown）。
 *
 * 不用官方 @tiptap/extension-details 的原因：它用自定义 NodeView + button
 * 来切换，样式和事件都不在文档结构里，容易失配。原生 details 的行为是确定的。
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    gnDetails: {
      /** 在光标处插入一个折叠块 */
      setDetails: () => ReturnType
    }
  }
}

export const GnDetails = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => {
          const dataOpen = element.getAttribute('data-open')
          if (dataOpen === 'false') return false
          if (dataOpen === 'true') return true
          return element.hasAttribute('open')
        },
        renderHTML: (attributes) => ({
          'data-open': attributes.open ? 'true' : 'false',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }) {
    // 始终保持 open，由 data-open + CSS 做展开动画（避免浏览器原生 display 切换无法过渡）
    return ['details', mergeAttributes(HTMLAttributes, { class: 'gn-details', open: '' }), 0]
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ commands, state }) => {
          const { $from } = state.selection
          // 已经在折叠块内部就不重复嵌套
          if ($from.parent.type.name === 'detailsContent') return false
          return commands.insertContent([
            {
              type: 'details',
              attrs: { open: true },
              content: [
                { type: 'detailsSummary', content: [{ type: 'text', text: '折叠标题' }] },
                { type: 'detailsContent', content: [{ type: 'paragraph' }] },
              ],
            },
            // 折叠块后面留一个空段落，方便继续在外面输入
            { type: 'paragraph' },
          ])
        },
    }
  },
})

export const GnDetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'gn-details-summary' }), 0]
  },
})

export const GnDetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',

  parseHTML() {
    return [{ tag: 'div[data-type="detailsContent"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { class: 'gn-details-content', 'data-type': 'detailsContent' }),
      0,
    ]
  },
})

/**
 * 点击 summary 左侧箭头区域（前 26px）切换折叠状态；
 * 点文字区域仍然是正常编辑，不受影响。
 */
export const GnDetailsClick = Extension.create({
  name: 'gnDetailsClick',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement | null
              const summary = target?.closest('summary.gn-details-summary') as HTMLElement | null
              if (!summary || !view.dom.contains(summary)) return false

              const detailsEl = summary.parentElement as HTMLElement | null
              if (!detailsEl || detailsEl.tagName !== 'DETAILS') return false

              // 阻止浏览器对 <details> 的原生切换：不然点标题文字也会被折叠
              event.preventDefault()

              const rect = summary.getBoundingClientRect()
              const onArrow = event.clientX - rect.left <= 40

              if (onArrow) {
                const pos = view.posAtDOM(detailsEl, 0) - 1
                const node = view.state.doc.nodeAt(pos)
                if (!node || node.type.name !== 'details') return true

                const willOpen = !node.attrs.open
                const content = detailsEl.querySelector(':scope > .gn-details-content') as HTMLElement | null

                const commit = () => {
                  view.dispatch(
                    view.state.tr.setNodeMarkup(pos, undefined, {
                      ...node.attrs,
                      open: willOpen,
                    }),
                  )
                }

                runFoldAnimation(detailsEl, content, willOpen, commit)
                return true
              }

              // 点标题文字：把光标放到文字里，正常编辑
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (coords) {
                const selection = TextSelection.near(view.state.doc.resolve(coords.pos))
                view.dispatch(view.state.tr.setSelection(selection))
              }
              view.focus()
              return true
            },
          },
        },
      }),
    ]
  },
})
