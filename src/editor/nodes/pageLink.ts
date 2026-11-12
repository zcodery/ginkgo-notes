import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import PageLinkBlock from '@/blocks/PageLinkBlock.vue'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      insertPageLink: (attrs: { pageId: string }) => ReturnType
    }
  }
}

/**
 * 正文中的页面卡片：引用某个页面（通常是子页面）。
 * Markdown：```ginkgo-page\n<pageId>\n```
 */
export const PageLinkNode = Node.create({
  name: 'pageLink',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      pageId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-page-id') ?? '',
        renderHTML: (attrs) => ({ 'data-page-id': attrs.pageId ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-ginkgo-page]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ginkgo-page': '' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(PageLinkBlock as any)
  },

  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
