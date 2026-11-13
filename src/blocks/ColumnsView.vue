<script setup lang="ts">
/**
 * 分栏容器 NodeView
 *
 * - 上方工具栏（可编辑时显示）：栏数增减（1–4）+ 宽度比例预设（均分 / 1:2 / 2:1 …）；
 * - 下方 `NodeViewContent` 即各列的 flex 行，PM 把 `column` 子节点渲染进这里。
 *
 * 交互要点同代码块 NodeView：工具栏在 contentDOM 之外，且是 INPUT/BUTTON，
 * 事件天然不会被编辑器抢走；NodeViewWrapper 已自动处理 ignoreMutation / stopEvent。
 */
import { computed, ref, watch } from 'vue'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { useEditorEditable } from '@/editor/editableContext'
import { Minus, Plus, Columns3 } from 'lucide-vue-next'

const props = defineProps<{
  node: any
  editor: any
  selected: boolean
  getPos: () => number
  updateAttributes: (attrs: Record<string, unknown>) => void
  deleteNode: () => void
}>()

const canEdit = useEditorEditable()

const count = computed(() => props.node?.childCount ?? 0)
const widths = computed<number[]>(() =>
  Array.from(props.node?.content?.content ?? []).map((c: any) => Number(c.attrs?.width) || 1),
)

const MIN = 1
const MAX = 4

/** 不同栏数下的宽度比例预设（含「均分」） */
const PRESETS = computed<{ label: string; ratios: number[] }[]>(() => {
  const n = count.value
  if (n <= 1) return []
  if (n === 2) return [
    { label: '均分', ratios: [1, 1] },
    { label: '1:2', ratios: [1, 2] },
    { label: '2:1', ratios: [2, 1] },
  ]
  if (n === 3)
    return [
      { label: '均分', ratios: [1, 1, 1] },
      { label: '1:1:2', ratios: [1, 1, 2] },
      { label: '1:2:1', ratios: [1, 2, 1] },
      { label: '2:1:1', ratios: [2, 1, 1] },
    ]
  return [
    { label: '均分', ratios: [1, 1, 1, 1] },
    { label: '1:1:2:2', ratios: [1, 1, 2, 2] },
    { label: '1:2:1:2', ratios: [1, 2, 1, 2] },
    { label: '2:1:1:2', ratios: [2, 1, 1, 2] },
  ]
})

/** 当前是否正好命中某个预设（用于高亮） */
function isActivePreset(ratios: number[]): boolean {
  const w = widths.value
  if (w.length !== ratios.length) return false
  return w.every((v, i) => (Number(v) || 1) === ratios[i])
}

function addColumn() {
  if (!canEdit.value || count.value >= MAX) return
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  const node = props.node
  const insertPos = pos + node.nodeSize - 1
  props.editor
    .chain()
    .focus()
    .command(({ tr, dispatch }: any) => {
      if (dispatch) {
        const col = props.editor.schema.nodes.column.create(
          { width: 1 },
          props.editor.schema.nodes.paragraph.create(),
        )
        tr.insert(insertPos, col)
      }
      return true
    })
    .run()
}

function removeColumn() {
  if (!canEdit.value) return
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  // 仅剩 1 栏时，再减即退出分栏（整行退化为一个段落），符合「不用则无」
  if (count.value <= MIN) {
    props.editor.chain().focus().unwrapColumns({ columnsPos: pos }).run()
    return
  }
  const node = props.node
  let childPos = pos + 1
  for (let i = 0; i < node.childCount - 1; i++) childPos += node.child(i).nodeSize
  const lastStart = childPos
  const lastSize = node.child(node.childCount - 1).nodeSize
  props.editor
    .chain()
    .focus()
    .command(({ tr, dispatch }: any) => {
      if (dispatch) tr.delete(lastStart, lastStart + lastSize)
      return true
    })
    .run()
}

function applyPreset(ratios: number[]) {
  if (!canEdit.value) return
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  const node = props.node
  props.editor
    .chain()
    .focus()
    .command(({ tr, dispatch }: any) => {
      if (dispatch) {
        let childPos = pos + 1
        node.forEach((col: any, i: number) => {
          const w = ratios[i] ?? 1
          if ((Number(col.attrs?.width) || 1) !== w) {
            tr.setNodeMarkup(childPos, undefined, { ...col.attrs, width: w })
          }
          childPos += col.nodeSize
        })
      }
      return true
    })
    .run()
}

const hover = ref(false)

/** 一列是否为「空」：仅含一个空文本块 */
function isEmptyCol(col: any): boolean {
  return !!col && col.childCount === 1 && col.firstChild?.isTextblock === true && col.firstChild.content?.size === 0
}

/**
 * 动态清理：当某一列「从有内容变为空」时，自动删除该列；
 * 若删完只剩一个空列或零列，命令会直接退出分栏（用则有，不用则无）。
 * - 初始创建（如「分栏 2」空白两栏）不触发清理，保留用户显式开出的空栏；
 * - 用户通过「+」显式加出的空栏也不触发清理（仅因内容被清空而触发的空栏才清）。
 */
// 初始即记录每列的空状态：这样挂载后的第一次编辑就能正确对比（否则首次清空会被当作「首帧」跳过）
let prevEmpties: boolean[] = Array.from(props.node?.content?.content ?? []).map((c: any) => isEmptyCol(c))
let pruning = false
let skipNextPrune = false

function checkPrune() {
  const node = props.node
  if (!node) return
  const cur = Array.from(node.content.content).map((c: any) => isEmptyCol(c))
  if (skipNextPrune) {
    skipNextPrune = false
    prevEmpties = cur
    return
  }
  const newlyEmpty: number[] = []
  cur.forEach((e: boolean, i: number) => {
    if (i < prevEmpties.length && e && !prevEmpties[i]) newlyEmpty.push(i)
  })
  prevEmpties = cur
  if (newlyEmpty.length && !pruning && canEdit.value) {
    pruning = true
    queueMicrotask(() => {
      pruning = false
      const pos = props.getPos()
      if (typeof pos === 'number' && canEdit.value) {
        props.editor.commands.removeColumnsAt({ columnsPos: pos, indices: newlyEmpty })
        skipNextPrune = true
      }
    })
  }
}

watch(() => props.node, () => checkPrune(), { flush: 'post' })
</script>

<template>
  <NodeViewWrapper
    class="gn-columns"
    data-type="columns"
    :class="{ 'is-selected': selected, 'is-hover': hover }"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <div v-if="canEdit" class="gn-cols-toolbar" contenteditable="false">
      <Columns3 :size="13" class="gn-cols-icon" />
      <span class="gn-cols-label">分栏</span>
      <span class="gn-cols-sep"></span>
      <div class="gn-cols-stepper">
        <button type="button" class="gn-cols-btn" :disabled="count <= MIN" v-tooltip="'减少一列'" @mousedown.prevent @click="removeColumn">
          <Minus :size="13" />
        </button>
        <span class="gn-cols-count">{{ count }} 栏</span>
        <button type="button" class="gn-cols-btn" :disabled="count >= MAX" v-tooltip="'增加一列'" @mousedown.prevent @click="addColumn">
          <Plus :size="13" />
        </button>
      </div>
      <span class="gn-cols-sep"></span>
      <div class="gn-cols-presets">
        <button
          v-for="p in PRESETS"
          :key="p.label"
          type="button"
          class="gn-cols-preset"
          :class="{ on: isActivePreset(p.ratios) }"
          v-tooltip="'宽度比例 ' + p.label.replace('均分', '均分')"
          @mousedown.prevent
          @click="applyPreset(p.ratios)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <NodeViewContent class="gn-columns-row" />
  </NodeViewWrapper>
</template>

<style scoped>
.gn-columns {
  position: relative;
  margin-block: 10px;
  border: 1px solid transparent;
  border-radius: var(--gn-radius, 10px);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.gn-columns.is-hover,
.gn-columns.is-selected {
  border-color: var(--gn-border, #e3e3e8);
}
.gn-columns.is-selected {
  box-shadow: 0 0 0 1px var(--gn-accent-soft, rgba(51, 126, 169, 0.18));
}
.gn-cols-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 5px 8px;
  margin-bottom: 4px;
  border: 1px solid var(--gn-border, #e3e3e8);
  border-radius: 8px;
  background: color-mix(in srgb, var(--gn-bg-sidebar, #f6f6f8) 55%, transparent);
  font-size: 12px;
  color: var(--gn-text-soft, #6b6b76);
  user-select: none;
}
.gn-cols-icon {
  opacity: 0.7;
}
.gn-cols-label {
  font-weight: 550;
  color: var(--gn-text, #2a2a30);
}
.gn-cols-sep {
  width: 1px;
  height: 14px;
  background: var(--gn-border, #e3e3e8);
}
.gn-cols-stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}
.gn-cols-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft, #6b6b76);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.gn-cols-btn:hover:not(:disabled) {
  background: var(--gn-bg-hover, #ececf0);
  color: var(--gn-text, #2a2a30);
}
.gn-cols-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.gn-cols-count {
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.gn-cols-presets {
  display: flex;
  align-items: center;
  gap: 2px;
}
.gn-cols-preset {
  height: 22px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft, #6b6b76);
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.gn-cols-preset:hover {
  background: var(--gn-bg-hover, #ececf0);
  color: var(--gn-text, #2a2a30);
}
.gn-cols-preset.on {
  background: var(--gn-accent-soft, rgba(51, 126, 169, 0.14));
  border-color: color-mix(in srgb, var(--gn-accent, #337ea9) 40%, transparent);
  color: var(--gn-accent, #337ea9);
}
.gn-columns-row {
  display: flex;
  gap: 18px;
  align-items: stretch;
}
.gn-columns-row > .gn-column {
  flex-grow: 1;
  flex-basis: 0;
  min-width: 0;
}
</style>
