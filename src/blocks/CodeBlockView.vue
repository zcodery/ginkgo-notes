<script setup lang="ts">
/**
 * 代码块 NodeView
 *
 * 在代码块上方提供一条工具栏：
 * - 代码名字（文件名）输入框 → 写入节点 title 属性
 * - 语言选择（可搜索，192 种）→ 写入节点 language 属性，并触发重新高亮
 * - 复制代码
 * - 格式化（prettier）
 * - 折叠 / 展开
 * - 换行开关
 * - 删除代码块
 *
 * 交互要点：
 * - NodeView.stopEvent 对 INPUT / BUTTON / SELECT / TEXTAREA 目标返回 true，
 *   所以工具栏里的表单元素天然不会被编辑器抢走焦点；
 * - 工具栏不在 contentDOM 内，NodeView.ignoreMutation 对 contentDOM 之外的
 *   DOM 变更返回 true，工具栏自身的 DOM 变化不会触发 PM 重新解析文档。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { useEditorEditable } from '@/editor/editableContext'
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  FileCode,
  Search,
  Sparkles,
  Trash2,
  WrapText,
  X,
} from 'lucide-vue-next'
import { CODE_LANGUAGES, languageLabel, normalizeLanguage } from '@/editor/codeLanguages'
import { ensureLanguage, refreshHighlight, resolveLanguage } from '@/editor/highlight'
import { canFormat, formatCode } from '@/editor/format'

const props = defineProps<{
  node: any
  editor: any
  selected: boolean
  getPos: () => number
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
}>()

const canEdit = useEditorEditable()

/* ------------------------------------------------------------------ */
/* 基础数据                                                             */
/* ------------------------------------------------------------------ */

const code = computed<string>(() => props.node?.textContent ?? '')
const language = computed<string | null>(() => props.node?.attrs?.language ?? null)
const title = computed<string>(() => props.node?.attrs?.title ?? '')

const languageName = computed<string>(() => languageLabel(language.value))

/** 常用语言，置顶显示 */
const COMMON_LANGUAGES = [
  'javascript',
  'typescript',
  'vue',
  'xml',
  'css',
  'scss',
  'json',
  'python',
  'java',
  'go',
  'rust',
  'sql',
  'bash',
  'yaml',
  'markdown',
  'shell',
]

/* ------------------------------------------------------------------ */
/* 代码名字                                                             */
/* ------------------------------------------------------------------ */

const titleDraft = ref(title.value)

watch(
  () => title.value,
  (v) => {
    titleDraft.value = v
  },
)

function commitTitle() {
  if (!canEdit.value) return
  const next = titleDraft.value.trim()
  if (next === title.value) return
  props.updateAttributes({ title: next || null })
}

function onTitleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commitTitle()
    ;(e.target as HTMLInputElement).blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    titleDraft.value = title.value
    ;(e.target as HTMLInputElement).blur()
  }
}

/* ------------------------------------------------------------------ */
/* 语言选择                                                             */
/* ------------------------------------------------------------------ */

const langOpen = ref(false)
const langQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const langButton = ref<HTMLElement | null>(null)

const filteredLanguages = computed(() => {
  const q = langQuery.value.trim().toLowerCase()
  if (!q) return CODE_LANGUAGES

  return CODE_LANGUAGES.filter((l) => {
    if (l.id.includes(q)) return true
    if (l.name.toLowerCase().includes(q)) return true
    if (l.label.toLowerCase().includes(q)) return true
    return l.aliases.some((a) => a.includes(q))
  })
})

/** 有搜索词时优先展示匹配项，否则按「常用 → 其余」排序 */
const languageList = computed(() => {
  if (langQuery.value.trim()) return filteredLanguages.value

  const common: typeof CODE_LANGUAGES = []
  const rest: typeof CODE_LANGUAGES = []
  for (const l of CODE_LANGUAGES) {
    if (COMMON_LANGUAGES.includes(l.id)) common.push(l)
    else rest.push(l)
  }
  return [...common, ...rest]
})

async function openLangPicker() {
  if (!canEdit.value) return
  langOpen.value = !langOpen.value
  if (langOpen.value) {
    langQuery.value = ''
    await nextTick()
    searchInput.value?.focus()
  }
}

async function pickLanguage(id: string) {
  if (!canEdit.value) return
  langOpen.value = false
  langQuery.value = ''
  if (id === language.value) return

  props.updateAttributes({ language: id })

  // 语言定义可能是按需加载的，等加载完再触发一次高亮重算
  await ensureLanguage(id)
  refreshHighlight(props.editor)
}

function onDocMouseDown(e: MouseEvent) {
  if (!langOpen.value) return
  const t = e.target as HTMLElement | null
  if (t?.closest?.('[data-code-lang-panel]') || t?.closest?.('[data-code-lang-btn]')) return
  langOpen.value = false
}

function onDocKeydown(e: KeyboardEvent) {
  if (!langOpen.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    langOpen.value = false
  }
}

/* ------------------------------------------------------------------ */
/* 复制 / 格式化 / 折叠 / 换行                                          */
/* ------------------------------------------------------------------ */

const copied = ref(false)

async function copyCode() {
  try {
    await navigator.clipboard.writeText(code.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1600)
  } catch {
    /* 忽略剪贴板权限问题 */
  }
}

const formatting = ref(false)
const formatError = ref<string | null>(null)

const formatSupported = computed(() => canFormat(resolveLanguage(language.value)))

async function runFormat() {
  if (!canEdit.value || formatting.value) return
  if (!formatSupported.value) return
  if (!code.value.trim()) return

  formatting.value = true
  formatError.value = null
  try {
    const formatted = await formatCode(code.value, resolveLanguage(language.value))
    if (formatted === code.value) return

    const pos = props.getPos()
    if (typeof pos !== 'number') return

    // 用一整段文本替换节点内容，保留 code block 自身的属性
    props.editor
      .chain()
      .focus()
      .command(({ tr, dispatch }: any) => {
        if (dispatch) {
          const from = pos + 1
          const to = pos + props.node.nodeSize - 1
          tr.replaceWith(from, to, tr.doc.type.schema.text(formatted))
        }
        return true
      })
      .run()
  } catch (err: any) {
    formatError.value = err?.message?.split('\n')[0] ?? '格式化失败'
    window.setTimeout(() => (formatError.value = null), 3000)
  } finally {
    formatting.value = false
  }
}

const collapsed = ref(false)
const wrapEnabled = ref(false)

/* ------------------------------------------------------------------ */
/* 统计                                                                 */
/* ------------------------------------------------------------------ */

const lineCount = computed(() => (code.value ? code.value.split('\n').length : 0))
const charCount = computed(() => code.value.length)

/* ------------------------------------------------------------------ */
/* 生命周期                                                             */
/* ------------------------------------------------------------------ */

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onDocKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('keydown', onDocKeydown, true)
})

// 节点失去选中态时收起语言面板
watch(
  () => props.selected,
  (sel) => {
    if (!sel) langOpen.value = false
  },
)
</script>

<template>
  <NodeViewWrapper class="gn-codeblock" :class="{ collapsed, readonly: !canEdit }" data-codeblock="">
    <!-- 工具栏 -->
    <div class="cb-toolbar" contenteditable="false">
      <!-- 语言选择 -->
      <div class="cb-lang">
        <button
          ref="langButton"
          class="cb-lang-btn"
          data-code-lang-btn=""
          type="button"
          :disabled="!canEdit"
          @mousedown.prevent
          @click="openLangPicker"
        >
          <FileCode :size="13" />
          <span>{{ languageName }}</span>
          <ChevronDown v-if="canEdit" :size="12" class="cb-caret" :class="{ open: langOpen }" />
        </button>

        <div v-if="langOpen && canEdit" class="cb-lang-panel" data-code-lang-panel="">
          <div class="cb-lang-search">
            <Search :size="13" />
            <input
              ref="searchInput"
              v-model="langQuery"
              type="text"
              placeholder="搜索语言…"
              spellcheck="false"
              @mousedown.stop
            />
            <button v-if="langQuery" class="cb-lang-clear" type="button" @mousedown.prevent @click="langQuery = ''">
              <X :size="12" />
            </button>
          </div>
          <div class="cb-lang-list">
            <button
              v-for="l in languageList"
              :key="l.id"
              class="cb-lang-item"
              :class="{ active: l.id === language }"
              type="button"
              @mousedown.prevent
              @click="pickLanguage(l.id)"
            >
              <span class="cb-lang-name">{{ l.label }}</span>
              <span class="cb-lang-id">{{ l.id }}</span>
            </button>
            <div v-if="!languageList.length" class="cb-lang-empty">没有匹配的语言</div>
          </div>
        </div>
      </div>

      <!-- 代码名字 -->
      <input
        v-model="titleDraft"
        class="cb-title"
        type="text"
        placeholder="代码名字…"
        spellcheck="false"
        :readonly="!canEdit"
        @mousedown.stop
        @blur="commitTitle"
        @keydown="onTitleKeydown"
      />

      <!-- 操作按钮 -->
      <div class="cb-actions">
        <span class="cb-stats">{{ lineCount }} 行 · {{ charCount }} 字符</span>

        <button
          v-if="canEdit"
          class="cb-btn"
          type="button"
          :disabled="!formatSupported || formatting"
          v-tooltip="formatSupported ? '格式化代码' : '当前语言暂不支持格式化'"
          @mousedown.prevent
          @click="runFormat"
        >
          <Sparkles :size="14" :class="{ spin: formatting }" />
        </button>

        <button
          class="cb-btn"
          type="button"
          :class="{ active: wrapEnabled }"
          v-tooltip="'自动换行'"
          @mousedown.prevent
          @click="wrapEnabled = !wrapEnabled"
        >
          <WrapText :size="14" />
        </button>

        <button
          class="cb-btn"
          type="button"
          :class="{ active: collapsed }"
          v-tooltip="collapsed ? '展开代码' : '折叠代码'"
          @mousedown.prevent
          @click="collapsed = !collapsed"
        >
          <ChevronsUpDown :size="14" />
        </button>

        <button class="cb-btn" type="button" v-tooltip="'复制代码'" @mousedown.prevent @click="copyCode">
          <Check v-if="copied" :size="14" class="cb-ok" />
          <Copy v-else :size="14" />
        </button>

        <button
          v-if="canEdit"
          class="cb-btn danger"
          type="button"
          v-tooltip="'删除代码块'"
          @mousedown.prevent
          @click="props.deleteNode()"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </div>

    <!-- 格式化错误提示 -->
    <div v-if="formatError" class="cb-error">{{ formatError }}</div>

    <!-- 代码内容 -->
    <div class="cb-fold">
      <div class="cb-fold-inner">
        <div class="cb-fold">
      <div class="cb-fold-inner">
        <pre class="cb-body" :class="{ wrap: wrapEnabled }"><NodeViewContent as="code" class="cb-code" /></pre>
      </div>
    </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.gn-codeblock {
  position: relative;
  margin: 10px 0;
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  background: var(--gn-bg-code);
  /* 不能用 overflow: hidden —— 会把语言下拉面板裁掉 */
  transition: border-color 0.15s ease;
}
.gn-codeblock:hover,
.gn-codeblock.ProseMirror-selectednode {
  border-color: var(--gn-border-strong);
}
/* 获得焦点时整体抬升，保证语言面板不被相邻代码块盖住 */
.gn-codeblock:focus-within {
  z-index: 20;
}
.gn-codeblock.readonly .cb-lang-btn:disabled {
  opacity: 1;
  cursor: default;
}
.gn-codeblock.readonly .cb-title {
  cursor: default;
  pointer-events: none;
}
/* ---------- 工具栏 ---------- */
.cb-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--gn-border);
  border-radius: calc(var(--gn-radius) - 1px) calc(var(--gn-radius) - 1px) 0 0;
  background: color-mix(in srgb, var(--gn-bg-sidebar) 45%, transparent);
  font-size: 12px;
  user-select: none;
  transition: border-color 0.2s ease;
}
.gn-codeblock.collapsed .cb-toolbar {
  border-bottom-color: transparent;
}

/* 折叠：grid 行高 1fr ↔ 0fr 可平滑过渡，无需测量高度 */
.cb-fold {
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows 0.22s ease,
    opacity 0.18s ease;
}
.cb-fold-inner {
  min-height: 0;
  overflow: hidden;
}
.gn-codeblock.collapsed .cb-fold {
  grid-template-rows: 0fr;
  opacity: 0;
}

/* 折叠：grid 行高 1fr ↔ 0fr 可平滑过渡，无需测量高度 */
.cb-fold {
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows 0.22s ease,
    opacity 0.18s ease;
}
.cb-fold-inner {
  min-height: 0;
  overflow: hidden;
}
.gn-codeblock.collapsed .cb-fold {
  grid-template-rows: 0fr;
  opacity: 0;
}

/* 语言选择 */
.cb-lang {
  position: relative;
  flex: 0 0 auto;
}
.cb-lang-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.cb-lang-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
  border-color: var(--gn-border);
}
.cb-caret {
  opacity: 0.6;
  transition: transform 0.15s ease;
}
.cb-caret.open {
  transform: rotate(180deg);
}

.cb-lang-panel {
  position: absolute;
  top: 28px;
  left: 0;
  z-index: 30;
  width: 260px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
  overflow: hidden;
}
.cb-lang-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--gn-border);
  color: var(--gn-text-muted);
}
.cb-lang-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--gn-text);
  font-size: 12.5px;
}
.cb-lang-search input::placeholder {
  color: var(--gn-text-muted);
}
.cb-lang-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  cursor: pointer;
}
.cb-lang-clear:hover {
  color: var(--gn-text);
}
.cb-lang-list {
  max-height: 268px;
  overflow-y: auto;
  padding: 4px;
}
.cb-lang-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 12.5px;
  color: var(--gn-text);
  cursor: pointer;
  text-align: left;
}
.cb-lang-item:hover {
  background: var(--gn-bg-hover);
}
.cb-lang-item.active {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.cb-lang-name {
  flex: 0 0 auto;
}
.cb-lang-id {
  margin-left: auto;
  font-family: var(--gn-mono);
  font-size: 10.5px;
  color: var(--gn-text-muted);
}
.cb-lang-item.active .cb-lang-id {
  color: color-mix(in srgb, var(--gn-accent) 70%, var(--gn-text-muted));
}
.cb-lang-empty {
  padding: 14px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--gn-text-muted);
}

/* 代码名字 */
.cb-title {
  flex: 1 1 auto;
  min-width: 60px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text);
  font-size: 12px;
  font-family: var(--gn-mono);
  outline: none;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.cb-title::placeholder {
  color: var(--gn-text-muted);
  font-family: var(--gn-font);
}
.cb-title:hover {
  background: var(--gn-bg-hover);
}
.cb-title:focus,
.cb-title:focus-visible {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  outline: none;
}

/* 操作区 */
.cb-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.cb-stats {
  margin-right: 6px;
  font-size: 11px;
  color: var(--gn-text-muted);
  white-space: nowrap;
}
.cb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.cb-btn:hover:not(:disabled) {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.cb-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cb-btn.active {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.cb-btn.danger:hover:not(:disabled) {
  color: var(--gn-danger);
}
.cb-ok {
  color: var(--gn-success, #16a34a);
}

/* 错误提示 */
.cb-error {
  padding: 6px 12px;
  border-bottom: 1px solid var(--gn-border);
  background: color-mix(in srgb, var(--gn-danger) 10%, transparent);
  color: var(--gn-danger);
  font-size: 11.5px;
}

/* ---------- 代码内容 ---------- */
.cb-body {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  font-family: var(--gn-mono);
  font-size: 13.5px;
  line-height: 1.62;
  tab-size: 2;
  white-space: pre;
  border-radius: 0 0 calc(var(--gn-radius) - 1px) calc(var(--gn-radius) - 1px);
}
.cb-body.wrap {
  white-space: pre-wrap;
  word-break: break-word;
}
.cb-code {
  display: block;
  background: none;
  color: inherit;
  padding: 0;
  font-size: inherit;
  border-radius: 0;
  white-space: inherit;
}

.spin {
  animation: gn-spin 0.9s linear infinite;
}
@keyframes gn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
