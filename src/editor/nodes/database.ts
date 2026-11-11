import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import DatabaseBlock from '@/blocks/DatabaseBlock.vue'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    databaseBlock: {
      insertDatabaseBlock: (attrs: { dbId: string }) => ReturnType
    }
  }
}

/**
 * 多维表格块
 *
 * 正文只保存一个引用（```ginkgo-db <id>），
 * 表结构与行数据单独存在后端的多维表格表里 ——
 * 同一张表可以被多个页面嵌入，改一处到处同步。
 */
export const DatabaseNode = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      dbId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-db-id') ?? '',
        renderHTML: (attrs) => ({ 'data-db-id': attrs.dbId ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-ginkgo-db]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ginkgo-db': '' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(DatabaseBlock as any)
  },

  addCommands() {
    return {
      insertDatabaseBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
