<script setup lang="ts">
/**
 * 表格控制层（参考飞书文档的交互）
 *
 * - 悬停单元格（或光标所在单元格）时，在该列上方、该行左侧出现小手柄，表格左上角出现整表手柄；
 * - 点手柄会整列 / 整行选中，并弹出菜单：标题列 / 标题行开关、背景颜色、对齐（列）、
 *   两侧插入、拷贝副本（Ctrl+D）、清除内容、删除，底部显示单元格数与字数；
 * - 整表菜单：平均分配列宽、创建副本、删除表格；
 * - 悬停表格时右侧 / 底部出现「+」条，一键在末尾追加列 / 行；
 * - 列宽拖动由 TipTap Table 的 columnResizing 插件负责。
 *
 * 所有坐标都相对 note-editor 根节点（position: relative）计算。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap, deleteCellSelection } from '@tiptap/pm/tables'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Copy,
  Eraser,
  GripHorizontal,
  GripVertical,
  PaintBucket,
  PanelLeft,
  PanelTop,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import { COLOR_PRESETS } from './marks/colors'
import { cellBgCss, type CellAlign } from './nodes/tableCell'
import { tr } from '@/i18n/phrases'

const props = defineProps<{
  editor: Editor | undefined
  root: HTMLElement | null
  editable: boolean
  /** 每次事务递增，用来驱动重新计算 */
  rev: number
}>()

const BG_KEYS = ['gray', 'brown', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'red'] as const
const BG_OPTIONS = BG_KEYS.map((k) => {
  const p = COLOR_PRESETS.find((c) => c.key === k)!
  return { key: k, label: p.label, css: cellBgCss(k)!, swatch: p.swatch }
})

/* ---------------- 文档定位工具 ---------------- */

interface CellRef {
  tablePos: number
  row: number
  col: number
}

function tableAt(pos: number): PMNode | null {
  const n = props.editor?.state.doc.nodeAt(pos)
  return n?.type.name === 'table' ? n : null
}

/** 第 r 行第 c 列单元格节点的起始位置 */
function cellPos(tablePos: number, r: number, c: number): number {
  const table = tableAt(tablePos)!
  const map = TableMap.get(table)
  return tablePos + 1 + map.map[r * map.width + c]!
}

function tableDom(tablePos: number): HTMLTableElement | null {
  const dom = props.editor?.view.nodeDOM(tablePos) as HTMLElement | null
  if (!dom) return null
  return (dom.matches('table') ? dom : dom.querySelector('table')) as HTMLTableElement | null
}

function tablePosFromDom(table: Element): number | null {
  const ed = props.editor
  const cell = table.querySelector('td, th')
  if (!ed || !cell) return null
  const $p = ed.state.doc.resolve(ed.view.posAtDOM(cell, 0))
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type.name === 'table') return $p.before(d)
  }
  return null
}

/** 光标所在单元格（触屏、键盘操作时也能出现手柄） */
const selectionCell = computed<CellRef | null>(() => {
  void props.rev
  const ed = props.editor
  if (!ed || !props.editable) return null
  const sel = ed.state.selection
  if (sel instanceof TextSelection && !sel.empty) return null
  const $from = sel instanceof CellSelection ? sel.$anchorCell : sel.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'table') continue
    const tablePos = $from.before(d)
    const table = $from.node(d)
    const map = TableMap.get(table)
    // 找到包含 $from 的单元格
    const cellStart = sel instanceof CellSelection ? $from.pos : $from.before(d + 2)
    const rect = map.findCell(cellStart - tablePos - 1)
    return { tablePos, row: rect.top, col: rect.left }
  }
  return null
})

/* ---------------- 悬停 ---------------- */

const hoverCell = ref<CellRef | null>(null)
let hideTimer: number | null = null

const focus = computed<CellRef | null>(() => menu.value ?? hoverCell.value ?? selectionCell.value)

function cancelHide() {
  if (hideTimer) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide() {
  cancelHide()
  hideTimer = window.setTimeout(() => (hoverCell.value = null), 220)
}

function onRootMouseMove(e: MouseEvent) {
  if (!props.editable) return
  const el = e.target as HTMLElement | null
  if (el?.closest('.tc-ui')) return cancelHide()
  const td = el?.closest('.ProseMirror td, .ProseMirror th') as HTMLTableCellElement | null
  const table = td?.closest('table')
  if (!td || !table) {
    if (hoverCell.value) scheduleHide()
    return
  }
  cancelHide()
  const tablePos = tablePosFromDom(table)
  if (tablePos == null) return
  const row = (td.parentElement as HTMLTableRowElement).rowIndex
  const col = td.cellIndex
  const cur = hoverCell.value
  if (!cur || cur.tablePos !== tablePos || cur.row !== row || cur.col !== col) hoverCell.value = { tablePos, row, col }
}

/* ---------------- 手柄位置 ---------------- */

interface Geometry {
  colHandle: { top: number; left: number } | null
  rowHandle: { top: number; left: number }
  corner: { top: number; left: number }
  addCol: { top: number; left: number; height: number }
  addRow: { top: number; left: number; width: number }
}

const geo = ref<Geometry | null>(null)

function place() {
  const f = focus.value
  const root = props.root
  if (!f || !root || !props.editable || !tableAt(f.tablePos)) {
    geo.value = null
    return
  }
  const table = tableDom(f.tablePos)
  const row = table?.rows[f.row]
  const cell = row?.cells[f.col]
  if (!table || !row || !cell) {
    geo.value = null
    return
  }
  const r = root.getBoundingClientRect()
  const t = table.getBoundingClientRect()
  const wrap = (table.parentElement as HTMLElement).getBoundingClientRect()
  const c = cell.getBoundingClientRect()
  const rw = row.getBoundingClientRect()
  const visLeft = Math.max(t.left, wrap.left)
  const visRight = Math.min(t.right, wrap.right)
  const cx = c.left + c.width / 2
  geo.value = {
    colHandle: cx >= visLeft && cx <= visRight ? { top: t.top - r.top - 7, left: cx - r.left - 10 } : null,
    rowHandle: { top: rw.top - r.top + rw.height / 2 - 10, left: visLeft - r.left - 7 },
    corner: { top: t.top - r.top - 7, left: visLeft - r.left - 7 },
    addCol: { top: t.top - r.top, left: visRight - r.left + 4, height: t.height },
    addRow: { top: t.bottom - r.top + 4, left: visLeft - r.left, width: visRight - visLeft },
  }
}

/* ---------------- 菜单 ---------------- */

type MenuKind = 'col' | 'row' | 'table'

const menu = ref<(CellRef & { kind: MenuKind; top: number; left: number }) | null>(null)
const colorOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function selectLine(kind: 'col' | 'row', f: CellRef) {
  const ed = props.editor!
  const table = tableAt(f.tablePos)!
  const map = TableMap.get(table)
  const doc = ed.state.doc
  const sel =
    kind === 'col'
      ? CellSelection.colSelection(doc.resolve(cellPos(f.tablePos, 0, f.col)), doc.resolve(cellPos(f.tablePos, map.height - 1, f.col)))
      : CellSelection.rowSelection(doc.resolve(cellPos(f.tablePos, f.row, 0)), doc.resolve(cellPos(f.tablePos, f.row, map.width - 1)))
  ed.view.dispatch(ed.state.tr.setSelection(sel))
  ed.view.focus()
}

function openMenu(kind: MenuKind) {
  const f = focus.value
  const g = geo.value
  const root = props.root
  if (!f || !g || !root) return
  if (kind !== 'table') selectLine(kind, f)
  const rootW = root.getBoundingClientRect().width
  const anchor = kind === 'col' ? g.colHandle! : kind === 'row' ? g.rowHandle : g.corner
  const top = kind === 'row' ? anchor.top - 4 : anchor.top + 18
  const left = kind === 'row' ? anchor.left + 18 : anchor.left
  menu.value = { ...f, kind, top, left: Math.max(0, Math.min(left, rootW - 236)) }
  colorOpen.value = false
}

function closeMenu() {
  menu.value = null
  colorOpen.value = false
}

/** 当前菜单作用的那一列 / 行里所有单元格的位置（文档坐标） */
function lineCells(m: CellRef & { kind: MenuKind }): { pos: number; node: PMNode }[] {
  const doc = props.editor!.state.doc
  const table = tableAt(m.tablePos)!
  const map = TableMap.get(table)
  const out: { pos: number; node: PMNode }[] = []
  const seen = new Set<number>()
  const count = m.kind === 'col' ? map.height : map.width
  for (let i = 0; i < count; i++) {
    const rel = m.kind === 'col' ? map.map[i * map.width + m.col]! : map.map[m.row * map.width + i]!
    if (seen.has(rel)) continue
    seen.add(rel)
    const pos = m.tablePos + 1 + rel
    out.push({ pos, node: doc.nodeAt(pos)! })
  }
  return out
}

const stats = computed(() => {
  void props.rev
  const m = menu.value
  if (!m || !props.editor || !tableAt(m.tablePos)) return null
  if (m.kind === 'table') {
    const map = TableMap.get(tableAt(m.tablePos)!)
    const text = tableAt(m.tablePos)!.textContent
    return { cells: map.width * map.height, chars: text.replace(/\s/g, '').length, size: `${map.height} × ${map.width}` }
  }
  const cells = lineCells(m)
  return { cells: cells.length, chars: cells.reduce((n, c) => n + c.node.textContent.replace(/\s/g, '').length, 0), size: '' }
})

const headerOn = computed(() => {
  void props.rev
  const m = menu.value
  if (!m || m.kind === 'table' || !tableAt(m.tablePos)) return false
  return lineCells(m).every((c) => c.node.type.name === 'tableHeader')
})

const currentBg = computed(() => {
  void props.rev
  const m = menu.value
  if (!m || m.kind === 'table' || !tableAt(m.tablePos)) return null
  const bgs = new Set(lineCells(m).map((c) => (c.node.attrs.bg as string | null) ?? null))
  return bgs.size === 1 ? [...bgs][0] : 'mixed'
})

const currentAlign = computed<CellAlign | null>(() => {
  void props.rev
  const m = menu.value
  if (!m || m.kind !== 'col' || !tableAt(m.tablePos)) return null
  return (lineCells(m)[0]?.node.attrs.align as CellAlign | null) ?? null
})

function setCellAttrs(attrs: Record<string, unknown>) {
  const ed = props.editor
  const m = menu.value
  if (!ed || !m) return
  const t = ed.state.tr
  for (const c of lineCells(m)) t.setNodeMarkup(c.pos, undefined, { ...c.node.attrs, ...attrs })
  ed.view.dispatch(t)
}

function toggleHeader() {
  const m = menu.value
  const ed = props.editor
  if (!m || !ed) return
  selectLine(m.kind as 'col' | 'row', m)
  if (m.kind === 'col') ed.chain().focus().toggleHeaderColumn().run()
  else ed.chain().focus().toggleHeaderRow().run()
}

function insert(side: 'before' | 'after') {
  const m = menu.value
  const ed = props.editor
  if (!m || !ed) return
  selectLine(m.kind as 'col' | 'row', m)
  const c = ed.chain().focus()
  if (m.kind === 'col') (side === 'before' ? c.addColumnBefore() : c.addColumnAfter()).run()
  else (side === 'before' ? c.addRowBefore() : c.addRowAfter()).run()
  closeMenu()
}

/** 拷贝副本：在右侧 / 下方插入一列 / 一行，内容与样式和原来的一样 */
function duplicate() {
  const m = menu.value
  const ed = props.editor
  if (!m || !ed) return
  if (m.kind === 'table') {
    const table = tableAt(m.tablePos)!
    ed.chain().focus().insertContentAt(m.tablePos + table.nodeSize, table.toJSON()).run()
    closeMenu()
    return
  }
  if (m.kind === 'row') {
    const table = tableAt(m.tablePos)!
    let rowPos = m.tablePos + 1
    for (let i = 0; i < m.row; i++) rowPos += table.child(i).nodeSize
    const row = table.child(m.row)
    const schema = ed.state.schema
    // 复制首行（表头）时，副本作为普通行
    const cells: PMNode[] = []
    row.forEach((cell) => cells.push(schema.nodes.tableCell!.create(cell.attrs, cell.content)))
    const copy = m.row === 0 && row.firstChild?.type.name === 'tableHeader' ? row.type.create(row.attrs, cells) : row.copy(row.content)
    ed.view.dispatch(ed.state.tr.insert(rowPos + row.nodeSize, copy))
    closeMenu()
    return
  }
  // 列：先在右侧加空列，再逐行把内容拷过去（自下而上，前面的位置不受影响）
  selectLine('col', m)
  ed.chain().focus().addColumnAfter().run()
  const map = TableMap.get(tableAt(m.tablePos)!)
  const t = ed.state.tr
  for (let r = map.height - 1; r >= 0; r--) {
    const src = t.doc.nodeAt(cellPos(m.tablePos, r, m.col))!
    const dstPos = cellPos(m.tablePos, r, m.col + 1)
    const dst = t.doc.nodeAt(dstPos)!
    t.replaceWith(dstPos, dstPos + dst.nodeSize, dst.type.create({ ...src.attrs, colwidth: src.attrs.colwidth }, src.content))
  }
  ed.view.dispatch(t)
  closeMenu()
}

function clearContent() {
  const m = menu.value
  const ed = props.editor
  if (!m || !ed) return
  selectLine(m.kind as 'col' | 'row', m)
  deleteCellSelection(ed.state, ed.view.dispatch)
  closeMenu()
}

function removeLine() {
  const m = menu.value
  const ed = props.editor
  if (!m || !ed) return
  selectLine(m.kind as 'col' | 'row', m)
  if (m.kind === 'col') ed.chain().focus().deleteColumn().run()
  else ed.chain().focus().deleteRow().run()
  closeMenu()
  hoverCell.value = null
}

function evenWidths() {
  const ed = props.editor
  const m = menu.value
  if (!ed || !m) return
  const table = tableAt(m.tablePos)!
  const t = ed.state.tr
  table.descendants((n, p) => {
    if (n.type.name !== 'tableCell' && n.type.name !== 'tableHeader') return true
    if (n.attrs.colwidth) t.setNodeMarkup(m.tablePos + 1 + p, undefined, { ...n.attrs, colwidth: null })
    return false
  })
  if (t.docChanged) ed.view.dispatch(t)
  closeMenu()
}

function deleteTable() {
  const ed = props.editor
  const m = menu.value
  if (!ed || !m) return
  const table = tableAt(m.tablePos)!
  ed.chain().focus().deleteRange({ from: m.tablePos, to: m.tablePos + table.nodeSize }).run()
  closeMenu()
  hoverCell.value = null
}

/* ---------------- 「+」条 ---------------- */

function appendLine(kind: 'row' | 'col') {
  const ed = props.editor
  const f = focus.value
  if (!ed || !f) return
  const map = TableMap.get(tableAt(f.tablePos)!)
  const at = cellPos(f.tablePos, kind === 'row' ? map.height - 1 : 0, kind === 'col' ? map.width - 1 : 0) + 2
  const c = ed.chain().focus().setTextSelection(at)
  ;(kind === 'row' ? c.addRowAfter() : c.addColumnAfter()).run()
}

/* ---------------- 生命周期 ---------------- */

watch(
  () => [props.rev, focus.value?.tablePos, focus.value?.row, focus.value?.col] as const,
  () => void nextTick(place),
  { immediate: true },
)

watch(
  () => props.editable,
  (v) => {
    if (!v) {
      hoverCell.value = null
      closeMenu()
    }
  },
)

function onDocDown(e: MouseEvent) {
  if (menu.value && !menuRef.value?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.tc-handle')) {
    closeMenu()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!menu.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeMenu()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    e.stopPropagation()
    duplicate()
  }
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

onMounted(() => {
  window.addEventListener('resize', place)
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  cancelHide()
  window.removeEventListener('resize', place)
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKeydown, true)
  props.root?.removeEventListener('mousemove', onRootMouseMove)
  props.root?.removeEventListener('mouseleave', scheduleHide)
})
</script>

<template>
  <template v-if="geo && focus">
    <button
      v-if="geo.colHandle"
      type="button"
      class="tc-ui tc-handle col"
      :class="{ on: menu?.kind === 'col' }"
      :style="{ top: geo.colHandle.top + 'px', left: geo.colHandle.left + 'px' }"
      v-tooltip="tr('点击选中整列')"
      @mousedown.prevent
      @click="openMenu('col')"
    >
      <GripHorizontal :size="12" :stroke-width="2.2" />
    </button>
    <button
      type="button"
      class="tc-ui tc-handle row"
      :class="{ on: menu?.kind === 'row' }"
      :style="{ top: geo.rowHandle.top + 'px', left: geo.rowHandle.left + 'px' }"
      v-tooltip="tr('点击选中整行')"
      @mousedown.prevent
      @click="openMenu('row')"
    >
      <GripVertical :size="12" :stroke-width="2.2" />
    </button>
    <button
      type="button"
      class="tc-ui tc-handle corner"
      :class="{ on: menu?.kind === 'table' }"
      :style="{ top: geo.corner.top + 'px', left: geo.corner.left + 'px' }"
      v-tooltip="tr('表格操作')"
      @mousedown.prevent
      @click="openMenu('table')"
    ></button>

    <button
      type="button"
      class="tc-ui tc-bar right"
      :style="{ top: geo.addCol.top + 'px', left: geo.addCol.left + 'px', height: geo.addCol.height + 'px' }"
      v-tooltip="tr('点击添加一列')"
      @mousedown.prevent
      @click="appendLine('col')"
    >
      <Plus :size="12" :stroke-width="2.4" />
    </button>
    <button
      type="button"
      class="tc-ui tc-bar bottom"
      :style="{ top: geo.addRow.top + 'px', left: geo.addRow.left + 'px', width: geo.addRow.width + 'px' }"
      v-tooltip="tr('点击添加一行')"
      @mousedown.prevent
      @click="appendLine('row')"
    >
      <Plus :size="12" :stroke-width="2.4" />
    </button>
  </template>

  <div
    v-if="menu"
    ref="menuRef"
    class="tc-ui tc-menu gn-pop"
    :style="{ top: menu.top + 'px', left: menu.left + 'px' }"
    @mousedown.prevent
  >
    <template v-if="menu.kind !== 'table'">
      <button
        v-if="(menu.kind === 'col' && menu.col === 0) || (menu.kind === 'row' && menu.row === 0)"
        type="button"
        class="tc-item"
        @click="toggleHeader"
      >
        <component :is="menu.kind === 'col' ? PanelLeft : PanelTop" :size="15" :stroke-width="1.8" />
        <span>{{ menu.kind === 'col' ? tr('标题列') : tr('标题行') }}</span>
        <i class="tc-switch" :class="{ on: headerOn }"></i>
      </button>
      <div v-if="(menu.kind === 'col' && menu.col === 0) || (menu.kind === 'row' && menu.row === 0)" class="tc-sep"></div>

      <div class="tc-sub-row">
        <button type="button" class="tc-item" :class="{ open: colorOpen }" @click="colorOpen = !colorOpen">
          <PaintBucket :size="15" :stroke-width="1.8" />
          <span>{{ tr('颜色') }}</span>
          <ChevronRight :size="14" class="tc-arrow" />
        </button>
        <div v-if="colorOpen" class="tc-colors gn-pop">
          <button type="button" class="tc-swatch none" :class="{ on: !currentBg }" v-tooltip="tr('无颜色')" @click="setCellAttrs({ bg: null })"></button>
          <button
            v-for="c in BG_OPTIONS"
            :key="c.key"
            type="button"
            class="tc-swatch"
            :class="{ on: currentBg === c.key }"
            :style="{ background: c.css, borderColor: c.swatch }"
            v-tooltip="tr(c.label)"
            @click="setCellAttrs({ bg: c.key })"
          ></button>
        </div>
      </div>

      <div v-if="menu.kind === 'col'" class="tc-align">
        <span>{{ tr('对齐') }}</span>
        <button type="button" :class="{ on: !currentAlign || currentAlign === 'left' }" v-tooltip="tr('左对齐')" @click="setCellAttrs({ align: null })">
          <AlignLeft :size="14" />
        </button>
        <button type="button" :class="{ on: currentAlign === 'center' }" v-tooltip="tr('居中')" @click="setCellAttrs({ align: 'center' })">
          <AlignCenter :size="14" />
        </button>
        <button type="button" :class="{ on: currentAlign === 'right' }" v-tooltip="tr('右对齐')" @click="setCellAttrs({ align: 'right' })">
          <AlignRight :size="14" />
        </button>
      </div>

      <button type="button" class="tc-item" @click="insert('before')">
        <component :is="menu.kind === 'col' ? ArrowLeft : ArrowUp" :size="15" :stroke-width="1.8" />
        <span>{{ menu.kind === 'col' ? tr('在左侧插入列') : tr('在上方插入行') }}</span>
      </button>
      <button type="button" class="tc-item" @click="insert('after')">
        <component :is="menu.kind === 'col' ? ArrowRight : ArrowDown" :size="15" :stroke-width="1.8" />
        <span>{{ menu.kind === 'col' ? tr('在右侧插入列') : tr('在下方插入行') }}</span>
      </button>
      <button type="button" class="tc-item" @click="duplicate">
        <Copy :size="15" :stroke-width="1.8" />
        <span>{{ tr('拷贝副本') }}</span>
        <kbd>Ctrl+D</kbd>
      </button>
      <div class="tc-sep"></div>
      <button type="button" class="tc-item" @click="clearContent">
        <Eraser :size="15" :stroke-width="1.8" />
        <span>{{ tr('清除内容') }}</span>
      </button>
      <button type="button" class="tc-item danger" @click="removeLine">
        <Trash2 :size="15" :stroke-width="1.8" />
        <span>{{ menu.kind === 'col' ? tr('删除列') : tr('删除行') }}</span>
      </button>
    </template>

    <template v-else>
      <button type="button" class="tc-item" @click="evenWidths">
        <ArrowLeftRight :size="15" :stroke-width="1.8" />
        <span>{{ tr('平均分配列宽') }}</span>
      </button>
      <button type="button" class="tc-item" @click="duplicate">
        <Copy :size="15" :stroke-width="1.8" />
        <span>{{ tr('创建表格副本') }}</span>
        <kbd>Ctrl+D</kbd>
      </button>
      <div class="tc-sep"></div>
      <button type="button" class="tc-item danger" @click="deleteTable">
        <Trash2 :size="15" :stroke-width="1.8" />
        <span>{{ tr('删除表格') }}</span>
      </button>
    </template>

    <div v-if="stats" class="tc-foot">
      <div v-if="stats.size">{{ tr('表格大小：{size}', { size: stats.size }) }}</div>
      <div>{{ tr('单元格：{n} 个', { n: stats.cells }) }}</div>
      <div>{{ tr('字数：{n}', { n: stats.chars }) }}</div>
    </div>
  </div>
</template>

<style scoped>
.tc-handle {
  position: absolute;
  z-index: 35;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--gn-border-strong);
  border-radius: 4px;
  background: var(--gn-bg);
  color: var(--gn-text-muted);
  cursor: pointer;
  box-shadow: var(--gn-shadow-sm);
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.tc-handle.col {
  width: 20px;
  height: 14px;
}
.tc-handle.row {
  width: 14px;
  height: 20px;
}
.tc-handle.corner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}
.tc-handle:hover,
.tc-handle.on {
  border-color: var(--gn-accent);
  background: var(--gn-accent);
  color: #fff;
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

.tc-menu {
  position: absolute;
  z-index: 70;
  width: 228px;
  padding: 5px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  user-select: none;
}
.tc-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}
.tc-item > span {
  flex: 1 1 auto;
}
.tc-item:hover,
.tc-item.open {
  background: var(--gn-bg-hover);
}
.tc-item :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-text-soft);
}
.tc-item kbd {
  font-family: var(--gn-font);
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.tc-item.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 10%, transparent);
  color: var(--gn-danger);
}
.tc-item.danger:hover :deep(svg) {
  color: var(--gn-danger);
}
.tc-arrow {
  color: var(--gn-text-muted) !important;
}
.tc-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--gn-border);
}
.tc-switch {
  position: relative;
  width: 30px;
  height: 17px;
  border-radius: 99px;
  background: var(--gn-border-strong);
  transition: background 0.15s ease;
}
.tc-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}
.tc-switch.on {
  background: var(--gn-accent);
}
.tc-switch.on::after {
  transform: translateX(13px);
}
.tc-sub-row {
  position: relative;
}
.tc-colors {
  position: absolute;
  top: -4px;
  left: calc(100% + 8px);
  display: grid;
  grid-template-columns: repeat(4, 26px);
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.tc-swatch {
  width: 26px;
  height: 26px;
  border: 1.5px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.tc-swatch.none {
  border-color: var(--gn-border-strong);
  background:
    linear-gradient(135deg, transparent 46%, var(--gn-danger) 47%, var(--gn-danger) 53%, transparent 54%),
    var(--gn-bg);
}
.tc-swatch.on {
  outline: 2px solid var(--gn-accent);
  outline-offset: 1px;
}
.tc-align {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  padding: 0 4px 0 9px;
  font-size: 13.5px;
  color: var(--gn-text);
}
.tc-align span {
  flex: 1 1 auto;
}
.tc-align button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
}
.tc-align button:hover {
  background: var(--gn-bg-hover);
}
.tc-align button.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
.tc-foot {
  margin-top: 4px;
  padding: 7px 9px 3px;
  border-top: 1px solid var(--gn-border);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--gn-text-muted);
}
@media (max-width: 600px) {
  .tc-colors {
    left: 0;
    top: calc(100% + 4px);
  }
}
</style>
