<script setup lang="ts">
/**
 * 表格控制层
 *
 * - 光标落在表格内时，表格上方出现工具条：表头行 / 表头列开关、插入与删除行列、
 *   平均分配列宽、删除表格；
 * - 鼠标悬停表格时，右侧与底部边缘出现「+」条，点一下在末尾追加一列 / 一行；
 * - 列宽拖动由 TipTap Table 的 columnResizing 插件负责，这里只提供「平均分配」复位。
 *
 * 所有坐标都相对 note-editor 根节点（position: relative）计算。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import {
  ArrowLeftRight,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns2,
  PanelLeft,
  PanelTop,
  Plus,
  Rows2,
  Trash2,
} from 'lucide-vue-next'
import { t } from '@/i18n'

const props = defineProps<{
  editor: Editor | undefined
  root: HTMLElement | null
  editable: boolean
  /** 每次事务递增，用来驱动重新计算 */
  rev: number
}>()

function isCell(n: PMNode) {
  return n.type.name === 'tableCell' || n.type.name === 'tableHeader'
}

/* ---------------- 当前所在表格 ---------------- */

const active = computed(() => {
  void props.rev
  const ed = props.editor
  if (!ed || !props.editable) return null
  const sel = ed.state.selection
  // 选中一段文字时让位给文字格式浮条
  if (sel instanceof TextSelection && !sel.empty) return null
  const { $from } = sel
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table') return { pos: $from.before(d), node }
  }
  return null
})

const headerRowOn = computed(() => {
  const n = active.value?.node
  const first = n?.firstChild
  if (!first || !first.childCount) return false
  let all = true
  first.forEach((c) => (all &&= c.type.name === 'tableHeader'))
  return all
})

const headerColOn = computed(() => {
  const n = active.value?.node
  if (!n || !n.childCount) return false
  let all = true
  n.forEach((row) => (all &&= row.firstChild?.type.name === 'tableHeader'))
  // 单行表格首行是表头时，首列状态无从区分
  return all && !(n.childCount === 1 && headerRowOn.value)
})

const dims = computed(() => {
  const n = active.value?.node
  if (!n) return null
  const map = TableMap.get(n)
  return { rows: map.height, cols: map.width }
})

/* ---------------- 定位 ---------------- */

const toolbarPos = ref<{ top: number; left: number } | null>(null)

function tableDomAt(pos: number): HTMLElement | null {
  const dom = props.editor?.view.nodeDOM(pos) as HTMLElement | null
  if (!dom) return null
  return dom.matches('table') ? dom : dom.querySelector('table')
}

function placeToolbar() {
  const a = active.value
  const root = props.root
  if (!a || !root) {
    toolbarPos.value = null
    return
  }
  const table = tableDomAt(a.pos)
  if (!table) {
    toolbarPos.value = null
    return
  }
  const r = root.getBoundingClientRect()
  const tr = table.getBoundingClientRect()
  const wrap = (table.parentElement as HTMLElement).getBoundingClientRect()
  toolbarPos.value = { top: tr.top - r.top - 40, left: Math.max(wrap.left, tr.left) - r.left }
}

/* ---------------- 悬停「+」条 ---------------- */

const hoverTable = ref<HTMLElement | null>(null)
const bars = ref<{
  right: { top: number; left: number; height: number }
  bottom: { top: number; left: number; width: number }
} | null>(null)
let hideTimer: number | null = null

function placeBars() {
  const table = hoverTable.value
  const root = props.root
  if (!table || !root || !table.isConnected || !props.editable) {
    bars.value = null
    return
  }
  const r = root.getBoundingClientRect()
  const tr = table.getBoundingClientRect()
  const wrap = (table.parentElement as HTMLElement).getBoundingClientRect()
  const right = Math.min(tr.right, wrap.right)
  const left = Math.max(tr.left, wrap.left)
  bars.value = {
    right: { top: tr.top - r.top, left: right - r.left + 4, height: tr.height },
    bottom: { top: tr.bottom - r.top + 4, left: left - r.left, width: right - left },
  }
}

function cancelHide() {
  if (hideTimer) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide() {
  cancelHide()
  hideTimer = window.setTimeout(() => {
    hoverTable.value = null
    bars.value = null
  }, 180)
}

function onRootMouseMove(e: MouseEvent) {
  if (!props.editable) return
  const el = e.target as HTMLElement | null
  if (el?.closest('.tc-bar')) return cancelHide()
  const table = el?.closest('.ProseMirror table') as HTMLElement | null
  if (table) {
    cancelHide()
    if (hoverTable.value !== table) hoverTable.value = table
    placeBars()
  } else if (hoverTable.value) {
    scheduleHide()
  }
}

function tablePosFromDom(table: HTMLElement): number | null {
  const ed = props.editor
  const cell = table.querySelector('td, th')
  if (!ed || !cell) return null
  const $p = ed.state.doc.resolve(ed.view.posAtDOM(cell, 0))
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type.name === 'table') return $p.before(d)
  }
  return null
}

/** 把光标放进第 row 行、第 col 列的单元格开头 */
function cellCursor(tablePos: number, row: number, col: number): number | null {
  const table = props.editor?.state.doc.nodeAt(tablePos)
  if (!table) return null
  const map = TableMap.get(table)
  const r = Math.min(Math.max(row, 0), map.height - 1)
  const c = Math.min(Math.max(col, 0), map.width - 1)
  return tablePos + 1 + map.map[r * map.width + c] + 2
}

function appendRow() {
  const ed = props.editor
  const table = hoverTable.value
  if (!ed || !table) return
  const pos = tablePosFromDom(table)
  if (pos == null) return
  const node = ed.state.doc.nodeAt(pos)!
  const at = cellCursor(pos, TableMap.get(node).height - 1, 0)
  if (at == null) return
  ed.chain().focus().setTextSelection(at).addRowAfter().run()
  void nextTick(placeBars)
}

function appendCol() {
  const ed = props.editor
  const table = hoverTable.value
  if (!ed || !table) return
  const pos = tablePosFromDom(table)
  if (pos == null) return
  const node = ed.state.doc.nodeAt(pos)!
  const at = cellCursor(pos, 0, TableMap.get(node).width - 1)
  if (at == null) return
  ed.chain().focus().setTextSelection(at).addColumnAfter().run()
  void nextTick(placeBars)
}

/* ---------------- 工具条操作 ---------------- */

type Action =
  | 'headerRow'
  | 'headerCol'
  | 'rowAbove'
  | 'rowBelow'
  | 'colLeft'
  | 'colRight'
  | 'deleteRow'
  | 'deleteCol'
  | 'resetWidths'
  | 'deleteTable'

function resetWidths() {
  const ed = props.editor
  const a = active.value
  if (!ed || !a) return
  const tr = ed.state.tr
  a.node.descendants((n, p) => {
    if (!isCell(n)) return true
    if (n.attrs.colwidth) tr.setNodeMarkup(a.pos + 1 + p, undefined, { ...n.attrs, colwidth: null })
    return false
  })
  if (tr.docChanged) ed.view.dispatch(tr)
  ed.commands.focus()
}

function run(action: Action) {
  const ed = props.editor
  if (!ed) return
  const c = ed.chain().focus()
  switch (action) {
    case 'headerRow':
      c.toggleHeaderRow().run()
      break
    case 'headerCol':
      c.toggleHeaderColumn().run()
      break
    case 'rowAbove':
      c.addRowBefore().run()
      break
    case 'rowBelow':
      c.addRowAfter().run()
      break
    case 'colLeft':
      c.addColumnBefore().run()
      break
    case 'colRight':
      c.addColumnAfter().run()
      break
    case 'deleteRow':
      c.deleteRow().run()
      break
    case 'deleteCol':
      c.deleteColumn().run()
      break
    case 'resetWidths':
      resetWidths()
      break
    case 'deleteTable':
      c.deleteTable().run()
      break
  }
}

const GROUPS: { action: Action; icon: Component; label: () => string; danger?: boolean }[][] = [
  [
    { action: 'headerRow', icon: PanelTop, label: () => t('table.headerRow') },
    { action: 'headerCol', icon: PanelLeft, label: () => t('table.headerCol') },
  ],
  [
    { action: 'rowAbove', icon: BetweenHorizontalStart, label: () => t('table.rowAbove') },
    { action: 'rowBelow', icon: BetweenHorizontalEnd, label: () => t('table.rowBelow') },
    { action: 'colLeft', icon: BetweenVerticalStart, label: () => t('table.colLeft') },
    { action: 'colRight', icon: BetweenVerticalEnd, label: () => t('table.colRight') },
  ],
  [{ action: 'resetWidths', icon: ArrowLeftRight, label: () => t('table.resetWidths') }],
  [
    { action: 'deleteRow', icon: Rows2, label: () => t('table.deleteRow'), danger: true },
    { action: 'deleteCol', icon: Columns2, label: () => t('table.deleteCol'), danger: true },
    { action: 'deleteTable', icon: Trash2, label: () => t('table.deleteTable'), danger: true },
  ],
]

function isOn(action: Action) {
  if (action === 'headerRow') return headerRowOn.value
  if (action === 'headerCol') return headerColOn.value
  return false
}

/* ---------------- 生命周期 ---------------- */

watch(
  () => [props.rev, active.value?.pos] as const,
  () => {
    void nextTick(() => {
      placeToolbar()
      if (hoverTable.value) placeBars()
    })
  },
  { immediate: true },
)

watch(
  () => props.editable,
  (v) => {
    if (!v) {
      hoverTable.value = null
      bars.value = null
    }
  },
)

const onResize = () => {
  placeToolbar()
  placeBars()
}

watch(
  () => props.root,
  (el, old) => {
    old?.removeEventListener('mousemove', onRootMouseMove)
    old?.removeEventListener('mouseleave', scheduleHide)
    el?.addEventListener('mousemove', onRootMouseMove, { passive: true })
    el?.addEventListener('mouseleave', scheduleHide)
  },
  { immediate: true },
)

onMounted(() => window.addEventListener('resize', onResize))

onBeforeUnmount(() => {
  cancelHide()
  window.removeEventListener('resize', onResize)
  props.root?.removeEventListener('mousemove', onRootMouseMove)
  props.root?.removeEventListener('mouseleave', scheduleHide)
})
</script>

<template>
  <div
    v-if="active && toolbarPos"
    class="tc-toolbar gn-pop"
    :style="{ top: toolbarPos.top + 'px', left: toolbarPos.left + 'px' }"
    @mousedown.prevent
  >
    <span v-if="dims" class="tc-dims">{{ t('table.rowsCols', dims) }}</span>
    <template v-for="(g, gi) in GROUPS" :key="gi">
      <span class="tc-sep"></span>
      <button
        v-for="b in g"
        :key="b.action"
        type="button"
        class="tc-btn"
        :class="{ on: isOn(b.action), danger: b.danger }"
        v-tooltip="b.label()"
        :aria-label="b.label()"
        @click="run(b.action)"
      >
        <component :is="b.icon" :size="15" :stroke-width="1.9" />
      </button>
    </template>
  </div>

  <template v-if="bars">
    <button
      type="button"
      class="tc-bar right"
      :style="{ top: bars.right.top + 'px', left: bars.right.left + 'px', height: bars.right.height + 'px' }"
      v-tooltip="t('table.addCol')"
      @mousedown.prevent
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
      @click="appendCol"
    >
      <Plus :size="12" :stroke-width="2.4" />
    </button>
    <button
      type="button"
      class="tc-bar bottom"
      :style="{ top: bars.bottom.top + 'px', left: bars.bottom.left + 'px', width: bars.bottom.width + 'px' }"
      v-tooltip="t('table.addRow')"
      @mousedown.prevent
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
      @click="appendRow"
    >
      <Plus :size="12" :stroke-width="2.4" />
    </button>
  </template>
</template>

<style scoped>
.tc-toolbar {
  position: absolute;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 1px;
  height: 34px;
  padding: 0 4px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-md);
  user-select: none;
  white-space: nowrap;
  max-width: calc(100vw - 24px);
  overflow-x: auto;
  scrollbar-width: none;
}
.tc-dims {
  padding: 0 6px 0 4px;
  font-size: 11.5px;
  color: var(--gn-text-muted);
  font-variant-numeric: tabular-nums;
}
.tc-sep {
  flex: 0 0 1px;
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--gn-border);
}
.tc-dims + .tc-sep {
  margin-left: 0;
}
.tc-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.tc-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.tc-btn.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.tc-btn.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}

.tc-bar {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: var(--gn-bg-hover);
  color: var(--gn-text-muted);
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.tc-bar:hover {
  opacity: 1;
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.tc-bar.right {
  width: 16px;
}
.tc-bar.bottom {
  height: 16px;
}
</style>
