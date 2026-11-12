<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { ArrowDownToLine, Check, Copy, CornerDownLeft, RefreshCw, Replace, Sparkles, Square, X } from 'lucide-vue-next'
import { AI_ACTIONS, buildMessages, customPrompt, type AiMode } from './ai'
import { streamChat } from '@/api/features'
import { markdownToDoc } from './markdown'
import { goProfile } from '@/store'

const props = defineProps<{
  editor: Editor
  mode: AiMode
  /** 相对 note-editor 根节点的位置 */
  top: number
  left: number
  /** page 模式下的全文 Markdown */
  pageMarkdown?: string
  /** 打开后立即执行的动作 */
  autoAction?: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>()

/** 打开时冻结的上下文：选区范围与文本 */
const sel = props.editor.state.selection
const range = { from: sel.from, to: sel.to }
const sourceText =
  props.mode === 'page'
    ? (props.pageMarkdown ?? '')
    : props.mode === 'selection'
      ? props.editor.state.doc.textBetween(sel.from, sel.to, '\n')
      : props.editor.state.doc.textBetween(Math.max(0, sel.from - 4000), sel.from, '\n')

const actions = computed(() => AI_ACTIONS.filter((a) => a.modes.includes(props.mode)))
const instruction = ref('')
const output = ref('')
const running = ref(false)
const error = ref('')
const copied = ref(false)
const lastPrompt = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
let ctrl: AbortController | null = null

async function generate(prompt: string) {
  lastPrompt.value = prompt
  output.value = ''
  error.value = ''
  running.value = true
  ctrl = new AbortController()
  try {
    await streamChat(buildMessages(prompt), (_d, full) => (output.value = full), ctrl.signal)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') error.value = (e as Error).message
  } finally {
    running.value = false
    ctrl = null
  }
}

function runAction(id: string) {
  const a = AI_ACTIONS.find((x) => x.id === id)
  if (a) void generate(a.prompt(sourceText))
}

function runCustom() {
  const ins = instruction.value.trim()
  if (!ins) return
  void generate(customPrompt(ins, props.mode, sourceText))
}

function stop() {
  ctrl?.abort()
}

/** Markdown 结果转成编辑器节点；只有一段文字时按行内插入，避免拆段 */
function toContent(md: string) {
  const nodes = (markdownToDoc(md).content ?? []).filter((n, i, arr) => !(i === arr.length - 1 && n.type === 'paragraph' && !n.content?.length))
  if (nodes.length === 1 && nodes[0]!.type === 'paragraph') return nodes[0]!.content ?? []
  return nodes
}

function replaceSelection() {
  props.editor.chain().focus().insertContentAt(range, toContent(output.value.trim())).run()
  emit('changed')
  emit('close')
}

function insertBelow() {
  const ed = props.editor
  const $to = ed.state.doc.resolve(props.mode === 'page' ? ed.state.doc.content.size : range.to)
  // 插到当前块之后；续写时直接接在光标处
  if (props.mode === 'cursor') {
    ed.chain().focus().insertContentAt(range.from, toContent(output.value.trim())).run()
  } else {
    const at = props.mode === 'page' ? 0 : $to.depth >= 1 ? $to.after(1) : $to.pos
    const nodes = markdownToDoc(output.value.trim()).content ?? []
    const content = props.mode === 'page' ? [{ type: 'blockquote', content: nodes.filter((n) => n.content?.length || n.type !== 'paragraph') }] : nodes
    ed.chain().focus().insertContentAt(at, content).run()
  }
  emit('changed')
  emit('close')
}

async function copyOut() {
  await navigator.clipboard.writeText(output.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1400)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    if (running.value) stop()
    else emit('close')
  }
}

function onDocDown(e: MouseEvent) {
  if (!running.value && !output.value && !panelRef.value?.contains(e.target as Node)) emit('close')
}

const needsConfig = computed(() => /还没有配置 AI 模型/.test(error.value))

function openSettings() {
  emit('close')
  goProfile('ai')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
  document.addEventListener('mousedown', onDocDown)
  if (props.autoAction) runAction(props.autoAction)
  else void nextTick(() => inputRef.value?.focus())
})
onBeforeUnmount(() => {
  ctrl?.abort()
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('mousedown', onDocDown)
})
</script>

<template>
  <div ref="panelRef" class="ai-panel gn-pop" :style="{ top: top + 'px', left: left + 'px' }" @mousedown.stop>
    <div class="ai-input">
      <Sparkles :size="14" :stroke-width="2" class="ai-spark" />
      <input
        ref="inputRef"
        v-model="instruction"
        :placeholder="mode === 'selection' ? '告诉 AI 如何处理选中的内容…' : mode === 'page' ? '对整篇笔记提问或下指令…' : '让 AI 写点什么…'"
        :disabled="running"
        @keydown.enter.prevent="runCustom"
      />
      <button v-if="running" type="button" class="ai-icon" v-tooltip="'停止'" @click="stop"><Square :size="12" /></button>
      <button v-else type="button" class="ai-icon" :disabled="!instruction.trim()" @click="runCustom"><CornerDownLeft :size="13" /></button>
      <button type="button" class="ai-icon" v-tooltip="'关闭'" @click="emit('close')"><X :size="13" /></button>
    </div>

    <div v-if="output || running" class="ai-output gn-scroll">
      <div class="ai-text">{{ output }}<span v-if="running" class="ai-caret"></span></div>
    </div>
    <div v-if="error" class="ai-error">
      {{ error }}
      <button v-if="needsConfig" type="button" class="ai-link" @click="openSettings">去配置</button>
    </div>

    <div v-if="output && !running" class="ai-result-actions">
      <button v-if="mode === 'selection'" type="button" @click="replaceSelection"><Replace :size="13" />替换选中</button>
      <button type="button" @click="insertBelow"><ArrowDownToLine :size="13" />{{ mode === 'cursor' ? '插入' : mode === 'page' ? '插入到开头' : '插入到下方' }}</button>
      <button type="button" @click="copyOut"><component :is="copied ? Check : Copy" :size="13" />{{ copied ? '已复制' : '复制' }}</button>
      <button type="button" @click="generate(lastPrompt)"><RefreshCw :size="13" />重试</button>
      <button type="button" class="ghost" @click="emit('close')">丢弃</button>
    </div>

    <div v-if="!output && !running" class="ai-actions">
      <button v-for="a in actions" :key="a.id" type="button" @click="runAction(a.id)">{{ a.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.ai-panel {
  position: absolute;
  z-index: 70;
  width: min(440px, calc(100vw - 24px));
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  overflow: hidden;
}
.ai-input {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 8px 10px;
  border-bottom: 1px solid var(--gn-border);
}
.ai-spark {
  flex: 0 0 auto;
  color: #9065b0;
}
.ai-input input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--gn-text);
  font-size: 13px;
}
.ai-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.ai-icon:hover:not(:disabled) {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ai-icon:disabled {
  opacity: 0.4;
}
.ai-output {
  max-height: 280px;
  overflow-y: auto;
  padding: 10px 12px;
  border-bottom: 1px solid var(--gn-border);
}
.ai-text {
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-caret {
  display: inline-block;
  width: 6px;
  height: 14px;
  margin-left: 2px;
  vertical-align: -2px;
  background: #9065b0;
  animation: ai-blink 0.9s steps(2) infinite;
}
@keyframes ai-blink {
  50% {
    opacity: 0;
  }
}
.ai-error {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--gn-danger);
  border-bottom: 1px solid var(--gn-border);
}
.ai-link {
  margin-left: 6px;
  border: none;
  background: none;
  color: var(--gn-accent);
  font-size: 12px;
  cursor: pointer;
}
.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
}
.ai-actions button,
.ai-result-actions button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
}
.ai-actions button:hover,
.ai-result-actions button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.ai-result-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px;
}
.ai-result-actions button:first-child {
  border-color: transparent;
  background: var(--gn-text);
  color: var(--gn-bg);
}
.ai-result-actions .ghost {
  margin-left: auto;
  border-color: transparent;
}
</style>
