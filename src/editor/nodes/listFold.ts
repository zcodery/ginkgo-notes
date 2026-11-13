import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { attachTooltip } from '@/directives/tooltip'
import { animateFold } from '@/editor/foldAnim'

/**
 * 列表项折叠：
 * - 通过 addGlobalAttributes 给 listItem 加一个 collapsed 属性，不改动 StarterKit 的 listItem
 * - 用 widget 装饰在每个"有子列表"的列表项左侧渲染折叠箭头（不会进入文档内容）
 * - 折叠状态存在节点属性里，CSS 负责隐藏子列表
 */

const FOLDABLE_PARENTS = new Set(['bulletList', 'orderedList', 'taskList'])
const NESTED_LISTS = new Set(['bulletList', 'orderedList', 'taskList'])
const FOLDABLE_ITEMS = new Set(['listItem', 'taskItem'])

export const ListFold = Extension.create({
  name: 'listFold',

  addGlobalAttributes() {
    return [
      {
        types: ['listItem', 'taskItem'],
        attributes: {
          collapsed: {
            default: false,
            parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
            renderHTML: (attributes) =>
              attributes.collapsed ? { 'data-collapsed': 'true' } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listFold'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            state.doc.descendants((node, pos, parent) => {
              if (!FOLDABLE_ITEMS.has(node.type.name)) return
              if (!parent || !FOLDABLE_PARENTS.has(parent.type.name)) return

              const last = node.lastChild
              if (!last || !NESTED_LISTS.has(last.type.name)) return

              decorations.push(
                Decoration.widget(
                  pos + 1,
                  () => {
                    const collapsed = !!node.attrs.collapsed
                    const arrow = document.createElement('span')
                    arrow.className = 'gn-list-fold'
                    arrow.setAttribute('contenteditable', 'false')
                    arrow.dataset.foldPos = String(pos)
                    arrow.dataset.collapsed = String(collapsed)
                    arrow.setAttribute('role', 'button')
                    arrow.setAttribute('tabindex', '-1')
                    attachTooltip(arrow, {
                      title: collapsed ? '展开子列表' : '收起子列表',
                      placement: 'right',
                    })
                    return arrow
                  },
                  {
                    side: -1,
                    // 只影响渲染，不参与光标移动
                    ignoreSelection: true,
                    /* 勿把 collapsed 写进 key，否则每次折叠会拆掉 widget，grid 过渡被掐断 */
                    key: `gn-fold-${pos}`,
                  },
                ),
              )
            })

            return DecorationSet.create(state.doc, decorations)
          },

          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement | null
              const arrow = target?.closest('.gn-list-fold') as HTMLElement | null
              if (!arrow) return false

              event.preventDefault()
              event.stopPropagation()

              const pos = Number(arrow.dataset.foldPos)
              const node = view.state.doc.nodeAt(pos)
              if (!node || !FOLDABLE_ITEMS.has(node.type.name)) return true

              const expanding = !!node.attrs.collapsed
              view.dispatch(
                view.state.tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  collapsed: !node.attrs.collapsed,
                }),
              )
              // 取重建后的 li 补动画，理由见 foldAnim.ts
              animateFold(view.nodeDOM(pos), expanding)
              return true
            },
          },
        },
      }),
    ]
  },
})
