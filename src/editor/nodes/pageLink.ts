import { Node, mergeAttributes } from '@tiptap/core'
import { store } from '@/store'
import { goToPage } from '@/store'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      insertPageLink: (attrs: { pageId: string }) => ReturnType
    }
  }
}

/**
 * 正文中的页面链接（inline 片段）。
 * 纯 HTML span 渲染（不用 NodeView），光标能正常放到两侧。
 * 标题在 renderHTML 时从 store 读出来存到 data-title。
 * Markdown：行内 `ginkgo-page:<pageId>`；独立块可用 ```ginkgo-page fence
 */
export const PageLinkNode = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-page-id') ?? '',
        renderHTML: (attrs) => ({ 'data-page-id': attrs.pageId ?? '' }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') ?? '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title ?? '' }),
      },
      icon: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-icon') ?? '',
        renderHTML: (attrs) => ({ 'data-icon': attrs.icon ?? '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-ginkgo-page]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const pageId = HTMLAttributes['data-page-id'] ?? ''
    // 从 store 里读最新的标题和图标
    const page = store.pages.find((p) => p.id === pageId && !p.trashed)
    const title = page?.title ?? ''
    const icon = page?.icon ?? ''
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-ginkgo-page': '',
        'data-page-id': pageId,
        'data-title': title,
        'data-icon': icon,
        'class': 'pl-chip',
      }),
      title || '未命名',
    ]
  },

  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              pageId: attrs.pageId,
              title: store.pages.find((p) => p.id === attrs.pageId)?.title ?? '',
              icon: store.pages.find((p) => p.id === attrs.pageId)?.icon ?? '',
            },
          }),
    }
  },
})

// 全局 click 委托：点击 .pl-chip 跳转到对应页面
if (typeof window !== 'undefined') {
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest?.('span.pl-chip') as HTMLElement | null
    if (target) {
      const pid = target.getAttribute('data-page-id')
      if (pid) {
        e.preventDefault()
        e.stopPropagation()
        goToPage(pid)
      }
    }
  })
}
