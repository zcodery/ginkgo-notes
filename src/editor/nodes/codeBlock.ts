/**
 * 增强版代码块节点
 *
 * 在官方 CodeBlock 的基础上补三件事：
 * 1. 新增 `title` 属性 —— 代码名字（文件名），会随 Markdown 一起往返；
 * 2. 挂上自定义 NodeView —— 提供语言选择、代码名字、格式化、复制等工具栏；
 * 3. 挂上自建的高亮插件 —— 语言切换后能按需加载并立即重新高亮。
 *
 * 注意：官方 CodeBlockLowlight 已被替换掉，因为它的插件用的是全局
 * highlight.js 注册表，跟 lowlight 实例不一致，语言切换后会失效。
 */

import CodeBlock from '@tiptap/extension-code-block'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockView from '@/blocks/CodeBlockView.vue'
import { createCodeHighlightPlugin } from '../highlight'

export const EnhancedCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      // 父级的 language 属性（rendered: false，不进 HTML attributes）
      ...this.parent?.(),
      // 代码名字：输出成 data-title，方便 HTML 粘贴时也能还原
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-title'),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.title ? { 'data-title': attributes.title } : {},
      },
    }
  },

  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView as any)
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      createCodeHighlightPlugin(this.name),
    ]
  },
})

export default EnhancedCodeBlock
