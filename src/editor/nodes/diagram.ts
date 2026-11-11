import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import DiagramBlock from '@/blocks/DiagramBlock.vue'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagram: {
      insertDiagram: (attrs?: { code?: string; kind?: string }) => ReturnType
    }
  }
}

/**
 * 图表块
 *
 * 落盘为 ```mermaid 代码块，所以它同时是「结构化内容」和「纯文本」：
 * 别的工具打开 .md 也能渲染，这里打开则变成可交互的图。
 */
export const DiagramNode = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-code') ?? '',
        renderHTML: (attrs) => ({ 'data-code': attrs.code ?? '' }),
      },
      kind: {
        default: 'mermaid',
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'mermaid',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind ?? 'mermaid' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-diagram]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-diagram': '' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(DiagramBlock as any)
  },

  addCommands() {
    return {
      insertDiagram:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { kind: 'mermaid', ...attrs } }),
    }
  },
})
