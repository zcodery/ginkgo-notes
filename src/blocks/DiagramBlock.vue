<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { useEditorEditable } from '@/editor/editableContext'
import {
  Copy,
  Pencil,
  Replace,
  Trash2,
  Check,
  TriangleAlert,
  Loader2,
  ArrowLeft,
  GitBranch,
} from 'lucide-vue-next'
import { renderMermaid } from './mermaid'
import { diagramTemplates } from './diagramTemplates'
import { afterThemeTransition, store } from '@/store'

const props = defineProps<{
  node: any
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: any
  selected: boolean
  getPos: () => number
}>()

const canEdit = useEditorEditable()

const code = computed<string>(() => props.node?.attrs?.code ?? '')
const hasCode = computed(() => code.value.trim().length > 0)

/* ---------------- 渲染 ---------------- */

const svg = ref('')
const error = ref<string | null>(null)
const rendering = ref(false)
let token = 0

async function draw() {
  const mine = ++token
  if (!hasCode.value) {
    svg.value = ''
    error.value = null
    return
  }
  rendering.value = true
  const r = await renderMermaid(code.value, store.theme === 'dark')
  // 渲染完成时如果正好在做主题扩散，先别改 DOM，否则过渡会被取消
  await afterThemeTransition()
  if (mine !== token) return
  svg.value = r.svg ?? ''
  error.value = r.error
  rendering.value = false
}

watch(
  [code, () => store.theme],
  async () => {
    const theme = store.theme
    const current = code.value
    // 等圆形扩散结束再重绘，避免中途改 DOM 把 View Transition 取消掉
    await afterThemeTransition()
    if (store.theme !== theme || code.value !== current) return
    void draw()
  },
  { immediate: true },
)

/* ---------------- 悬停 / 工具栏 ---------------- */

const hovered = ref(false)
const showPicker = ref(false)

/**
 * 面板的关闭时机：
 * 1. 鼠标移出整个图表块（含面板本身）→ 关闭
 * 2. 点击图表块以外的地方 → 关闭
 * 3. Esc → 关闭
 * 4. 节点失去选中态 → 关闭
 * 面板是 .gn-diagram 的 DOM 子节点，鼠标移进面板不会触发 mouseleave，
 * 所以可以放心地把「移出即关」和「点击外部即关」同时开启。
 */
function closePicker() {
  showPicker.value = false
}

function onDocMouseDown(e: MouseEvent) {
  if (!showPicker.value) return
  const t = e.target as HTMLElement | null
  if (!t?.closest?.('[data-diagram]')) closePicker()
}

function onDocKeyDown(e: KeyboardEvent) {
  if (showPicker.value && e.key === 'Escape') {
    e.stopPropagation()
    closePicker()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onDocKeyDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  document.removeEventListener('keydown', onDocKeyDown, true)
})

// 节点被取消选中时，面板也一并收起
watch(
  () => props.selected,
  (sel) => {
    if (!sel) closePicker()
  },
)

/** 点完模板/应用源码后，把光标交还给块后面的段落，方便继续写 */
function focusAfterBlock() {
  const ed = props.editor
  const pos = props.getPos()
  if (!ed || typeof pos !== 'number') return
  const after = pos + props.node.nodeSize
  if (after < ed.state.doc.content.size) {
    ed.chain().focus().setTextSelection(after + 1).run()
  } else {
    ed.chain().focus().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).run()
  }
}

function pickTemplate(tplCode: string) {
  if (!canEdit.value) return
  props.updateAttributes({ code: tplCode })
  showPicker.value = false
  focusAfterBlock()
}

/* ---------------- 源码编辑 ---------------- */

const editing = ref(false)
const draft = ref('')
const draftErr = ref<string | null>(null)
const draftSvg = ref('')
const draftRef = ref<HTMLTextAreaElement | null>(null)
let draftToken = 0

async function openEditor() {
  if (!canEdit.value) return
  draft.value = code.value
  draftErr.value = null
  draftSvg.value = svg.value
  editing.value = true
  await nextTick()
  draftRef.value?.focus()
  // 打开时整体选中不合理，光标放到末尾
  const el = draftRef.value
  if (el) el.selectionStart = el.selectionEnd = el.value.length
  void drawDraft()
}

async function drawDraft() {
  const mine = ++draftToken
  if (!draft.value.trim()) {
    draftSvg.value = ''
    draftErr.value = null
    return
  }
  const r = await renderMermaid(draft.value, store.theme === 'dark')
  if (mine !== draftToken) return
  draftSvg.value = r.svg ?? ''
  draftErr.value = r.error
}

let draftTimer: number | null = null
function onDraftInput() {
  if (draftTimer) window.clearTimeout(draftTimer)
  draftTimer = window.setTimeout(() => {
    draftTimer = null
    void drawDraft()
  }, 320)
}

function applyEdit() {
  if (!canEdit.value) return
  props.updateAttributes({ code: draft.value })
  editing.value = false
  focusAfterBlock()
}

function cancelEdit() {
  editing.value = false
  draftErr.value = null
}

function onDraftKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    applyEdit()
  }
}

/* ---------------- 其他操作 ---------------- */

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

function removeSelf() {
  if (!canEdit.value) return
  const ed = props.editor
  if (!ed) return
  // 用节点自身位置删除，避免选中态下误删相邻块
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  ed.chain().focus().deleteRange({ from: pos, to: pos + props.node.nodeSize }).run()
}

onBeforeUnmount(() => {
  if (draftTimer) window.clearTimeout(draftTimer)
})

const kindLabel = computed(() => {
  const c = code.value.trim()
  if (/^erDiagram/.test(c)) return 'ER 图'
  if (/^flowchart|^graph/.test(c)) return '链路图'
  if (/^sequenceDiagram/.test(c)) return '时序图'
  if (/^mindmap/.test(c)) return '思维导图'
  if (/^stateDiagram/.test(c)) return '状态图'
  if (/^classDiagram/.test(c)) return '类图'
  if (/^gantt/.test(c)) return '甘特图'
  if (/^pie/.test(c)) return '饼图'
  return 'Mermaid'
})
</script>

<template>
  <NodeViewWrapper
    class="gn-diagram"
    :class="{ selected: props.selected, empty: !hasCode }"
    data-diagram=""
    @mouseenter="hovered = true"
    @mouseleave="hovered = false; closePicker()"
  >
    <!-- 空状态：选一个模板开始 -->
    <div v-if="!hasCode" class="dg-empty">
      <div class="dg-empty-head">
        <GitBranch :size="18" />
        <div>
          <div class="dg-empty-title">插入图表</div>
          <div class="dg-empty-sub">{{ canEdit ? '选一个模板，或从空白 Mermaid 开始' : '页面已锁定' }}</div>
        </div>
      </div>
      <div v-if="canEdit" class="dg-tpl-grid">
        <button
          v-for="t in diagramTemplates"
          :key="t.id"
          class="dg-tpl"
          @mousedown.prevent
          @click="pickTemplate(t.code)"
        >
          <component :is="t.icon" :size="16" :stroke-width="1.8" class="dg-tpl-icon" />
          <span class="dg-tpl-title">{{ t.title }}</span>
          <span class="dg-tpl-desc">{{ t.desc }}</span>
        </button>
      </div>
      <button v-if="canEdit" class="dg-blank" @mousedown.prevent @click="openEditor">从空白开始 →</button>
    </div>

    <!-- 图表本体 -->
    <div v-else class="dg-body">
      <div v-if="error" class="dg-error">
        <TriangleAlert :size="15" />
        <div>
          <div class="dg-error-title">图表渲染失败</div>
          <div class="dg-error-msg">{{ error }}</div>
        </div>
        <button v-if="canEdit" class="dg-error-fix" @mousedown.prevent @click="openEditor">修改源码</button>
      </div>
      <div v-else class="dg-canvas">
        <div v-if="rendering && !svg" class="dg-loading"><Loader2 :size="16" class="spin" /> 渲染中…</div>
        <div class="dg-svg" v-html="svg"></div>
      </div>

      <!-- 悬浮工具条 -->
      <div class="dg-tools" :class="{ show: hovered || props.selected }">
        <span class="dg-kind">{{ kindLabel }}</span>
        <button v-if="canEdit" v-tooltip="'编辑源码'" @mousedown.prevent @click="openEditor"><Pencil :size="14" /></button>
        <button v-if="canEdit" v-tooltip="'换个模板'" @mousedown.prevent @click="showPicker = !showPicker">
          <Replace :size="14" />
        </button>
        <button v-tooltip="'复制源码'" @mousedown.prevent @click="copyCode">
          <Check v-if="copied" :size="14" />
          <Copy v-else :size="14" />
        </button>
        <button v-if="canEdit" v-tooltip="'删除图表'" class="danger" @mousedown.prevent @click="removeSelf">
          <Trash2 :size="14" />
        </button>
      </div>

      <!-- 模板替换面板 -->
      <div v-if="showPicker && canEdit" class="dg-picker" @mousedown.stop>
        <button
          v-for="t in diagramTemplates"
          :key="t.id"
          class="dg-picker-item"
          @click="pickTemplate(t.code)"
        >
          <component :is="t.icon" :size="14" />
          <span>{{ t.title }}</span>
          <span class="dg-picker-desc">{{ t.desc }}</span>
        </button>
      </div>
    </div>

    <!-- 源码编辑器（浮层，挂到 body 避免被编辑器裁剪） -->
    <Teleport to="body">
      <div v-if="editing" class="dg-modal-mask" @mousedown.self="cancelEdit">
        <div class="dg-modal" @mousedown.stop>
          <header class="dg-modal-head">
            <button class="dg-back" v-tooltip="'取消'" @click="cancelEdit"><ArrowLeft :size="16" /></button>
            <div class="dg-modal-title">
              <span>{{ kindLabel }}</span>
              <span class="dg-modal-hint">Mermaid 源码 · ⌘/Ctrl + Enter 应用</span>
            </div>
            <div class="dg-modal-actions">
              <button class="gn-btn" @click="cancelEdit">取消</button>
              <button class="gn-btn gn-btn-primary" @click="applyEdit">应用</button>
            </div>
          </header>
          <div class="dg-modal-body">
            <div class="dg-modal-code">
              <textarea
                ref="draftRef"
                v-model="draft"
                spellcheck="false"
                placeholder="在这里写 Mermaid 语法…"
                @input="onDraftInput"
                @keydown="onDraftKey"
              ></textarea>
            </div>
            <div class="dg-modal-preview">
              <div v-if="draftErr" class="dg-error compact">
                <TriangleAlert :size="14" />
                <div class="dg-error-msg">{{ draftErr }}</div>
              </div>
              <div v-if="draftSvg" class="dg-svg preview" v-html="draftSvg"></div>
              <div v-else-if="!draftErr" class="dg-preview-empty">左侧输入语法，这里实时预览</div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </NodeViewWrapper>
</template>

<style scoped>
.gn-diagram {
  position: relative;
  margin-block: 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.gn-diagram:hover,
.gn-diagram.selected {
  border-color: var(--gn-border);
  background: color-mix(in srgb, var(--gn-bg-sidebar) 55%, transparent);
}
.gn-diagram.empty {
  border: 1px dashed var(--gn-border-strong);
  background: transparent;
}

/* 空状态 */
.dg-empty {
  padding: 14px 16px 12px;
}
.dg-empty-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--gn-text-soft);
  margin-bottom: 12px;
}
.dg-empty-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--gn-text);
}
.dg-empty-sub {
  font-size: 12px;
  color: var(--gn-text-muted);
  margin-top: 1px;
}
.dg-tpl-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.dg-tpl {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
}
.dg-tpl:hover {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.dg-tpl-icon {
  color: var(--gn-accent);
  margin-bottom: 1px;
}
.dg-tpl-title {
  font-size: 12.5px;
  font-weight: 550;
  color: var(--gn-text);
}
.dg-tpl-desc {
  font-size: 11px;
  color: var(--gn-text-muted);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dg-blank {
  margin-top: 10px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--gn-accent);
  cursor: pointer;
}

/* 图表本体 */
.dg-body {
  position: relative;
  padding: 8px 10px;
}
.dg-canvas {
  display: flex;
  justify-content: center;
  overflow-x: auto;
}
.dg-svg {
  width: 100%;
  display: flex;
  justify-content: center;
}
.dg-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
.dg-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 22px 0;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.spin {
  animation: gn-spin 0.9s linear infinite;
}
@keyframes gn-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 工具条 */
.dg-tools {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-sm);
  opacity: 0;
  transform: translateY(-2px);
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 6;
}
.dg-tools.show {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.dg-tools button {
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
}
.dg-tools button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.dg-tools button.danger:hover {
  color: var(--gn-danger);
}
.dg-kind {
  font-size: 11px;
  color: var(--gn-text-muted);
  padding: 0 5px;
  white-space: nowrap;
}

/* 模板替换 */
.dg-picker {
  position: absolute;
  top: 30px;
  right: 0;
  width: 250px;
  padding: 5px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
  z-index: 20;
}
.dg-picker-item {
  display: grid;
  grid-template-columns: 18px 1fr;
  align-items: center;
  gap: 2px 6px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  font-size: 12.5px;
  color: var(--gn-text);
  cursor: pointer;
  text-align: left;
}
.dg-picker-item:hover {
  background: var(--gn-bg-hover);
}
.dg-picker-desc {
  grid-column: 2;
  font-size: 11px;
  color: var(--gn-text-muted);
}

/* 错误 */
.dg-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--gn-danger) 32%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--gn-danger) 7%, transparent);
  color: var(--gn-danger);
  font-size: 12.5px;
}
.dg-error.compact {
  padding: 7px 9px;
  margin-bottom: 8px;
}
.dg-error-title {
  font-weight: 600;
  margin-bottom: 2px;
}
.dg-error-msg {
  font-family: var(--gn-mono);
  font-size: 11.5px;
  line-height: 1.5;
  word-break: break-word;
  color: color-mix(in srgb, var(--gn-danger) 88%, var(--gn-text));
}
.dg-error-fix {
  margin-left: auto;
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

/* 源码编辑浮层 */
.dg-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 22, 21, 0.42);
  backdrop-filter: blur(2px);
}
.dg-modal {
  width: min(1060px, 92vw);
  height: min(680px, 86vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  overflow: hidden;
}
.dg-modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--gn-border);
}
.dg-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
}
.dg-back:hover {
  background: var(--gn-bg-hover);
}
.dg-modal-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
}
.dg-modal-hint {
  font-size: 11.5px;
  font-weight: 400;
  color: var(--gn-text-muted);
}
.dg-modal-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.dg-modal-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.dg-modal-code {
  border-right: 1px solid var(--gn-border);
  min-height: 0;
}
.dg-modal-code textarea {
  width: 100%;
  height: 100%;
  padding: 14px 16px;
  border: none;
  outline: none;
  resize: none;
  background: var(--gn-bg-code);
  color: var(--gn-text);
  font-family: var(--gn-mono);
  font-size: 12.5px;
  line-height: 1.72;
  tab-size: 2;
}
.dg-modal-preview {
  min-height: 0;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.dg-svg.preview {
  width: 100%;
}
.dg-preview-empty {
  text-align: center;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
</style>
