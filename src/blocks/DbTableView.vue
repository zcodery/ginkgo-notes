<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import type { Database, DbField, DbRow, DbView } from '@/types'
import { FIELD_TYPE_META, OPTION_COLORS } from './dbFields'
import DbCell from './DbCell.vue'
import DbFieldMenu from './DbFieldMenu.vue'

const props = defineProps<{
  db: Database
  rows: DbRow[]
  view: DbView
}>()

const emit = defineEmits<{
  (e: 'update-cell', rowId: string, fieldId: string, value: unknown): void
  (e: 'add-row', afterOrder?: number): void
  (e: 'delete-row', rowId: string): void
  (e: 'update-field', fieldId: string, patch: Partial<DbField>): void
  (e: 'delete-field', fieldId: string): void
  (e: 'insert-field', side: 'left' | 'right', fieldId: string): void
  (e: 'add-field'): void
  (e: 'hide-field', fieldId: string): void
}>()

const fields = computed(() => props.db.fields)

const visibleFields = computed(() => {
  const hidden = new Set(props.view.hiddenFields ?? [])
  return fields.value.filter((f) => !hidden.has(f.id))
})

/* ---------------- 列宽拖拽 ---------------- */

const localWidth = ref<Record<string, number>>({})

function widthOf(f: DbField) {
  return localWidth.value[f.id] ?? f.width ?? defaultWidth(f)
}

function defaultWidth(f: DbField) {
  // 默认宽度要让「文本 + 两个单选 + 日期 + 复选框」刚好放得进正文栏宽
  if (f.type === 'checkbox') return 76
  if (f.type === 'select') return 108
  if (f.type === 'multiSelect') return 140
  if (f.type === 'date') return 106
  if (f.type === 'number') return 96
  return 162
}

let resizing: { id: string; startX: number; startW: number } | null = null

function startResize(f: DbField, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  resizing = { id: f.id, startX: e.clientX, startW: widthOf(f) }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: MouseEvent) {
  if (!resizing) return
  const w = Math.max(72, resizing.startW + (e.clientX - resizing.startX))
  localWidth.value = { ...localWidth.value, [resizing.id]: w }
}

function onResizeEnd() {
  if (resizing) {
    emit('update-field', resizing.id, { width: localWidth.value[resizing.id] })
  }
  resizing = null
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
})

/* ---------------- 字段菜单 ---------------- */

const menu = ref<{ field: DbField; x: number; y: number } | null>(null)

function openFieldMenu(f: DbField, e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = {
    field: f,
    x: Math.min(r.left, window.innerWidth - 300),
    y: Math.min(r.bottom + 4, window.innerHeight - 460),
  }
}

function closeMenu() {
  menu.value = null
}

function onDocDown(e: MouseEvent) {
  if (!menu.value) return
  const el = document.querySelector('.fm-pop')
  if (el && !el.contains(e.target as Node)) closeMenu()
}
document.addEventListener('mousedown', onDocDown)
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

/* ---------------- 单元格 / 选项 ---------------- */

function cellUpdate(rowId: string, fieldId: string, value: unknown) {
  emit('update-cell', rowId, fieldId, value)
}

function onCreateOption(field: DbField, name: string, rowId: string) {
  const opts = field.options ?? []
  const opt = {
    id: 'o_' + Math.random().toString(36).slice(2, 10),
    name,
    color: OPTION_COLORS[opts.length % OPTION_COLORS.length],
  }
  emit('update-field', field.id, { options: [...opts, opt] })
  if (field.type === 'multiSelect') {
    const cur = Array.isArray(props.rows.find((r) => r.id === rowId)?.cells[field.id])
      ? ([...(props.rows.find((r) => r.id === rowId)!.cells[field.id] as string[])] as string[])
      : []
    emit('update-cell', rowId, field.id, [...cur, opt.id])
  } else {
    emit('update-cell', rowId, field.id, opt.id)
  }
}

const hoveredRow = ref<string | null>(null)
</script>

<template>
  <div class="db-table-wrap gn-scroll">
    <table class="db-table">
      <colgroup>
        <col style="width: 42px" />
        <col v-for="f in visibleFields" :key="f.id" :style="{ width: widthOf(f) + 'px' }" />
        <col style="width: 44px" />
      </colgroup>
      <thead>
        <tr>
          <th class="db-th-idx"></th>
          <th
            v-for="f in visibleFields"
            :key="f.id"
            class="db-th"
            :title="f.name"
          >
            <div class="db-th-inner" @click="openFieldMenu(f, $event)">
              <component
                :is="FIELD_TYPE_META[f.type].icon"
                :size="12.5"
                class="db-th-icon"
              />
              <span class="db-th-name">{{ f.name }}</span>
            </div>
            <div class="db-th-resize" @mousedown="startResize(f, $event)"></div>
          </th>
          <th class="db-th-add">
            <button title="新增字段" @mousedown.stop @click="emit('add-field')">
              <Plus :size="14" />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, idx) in rows"
          :key="row.id"
          @mouseenter="hoveredRow = row.id"
          @mouseleave="hoveredRow = null"
        >
          <td class="db-td-idx">
            <span v-if="hoveredRow !== row.id" class="db-idx-num">{{ idx + 1 }}</span>
            <button
              v-else
              class="db-row-del"
              title="删除这一行"
              @mousedown.stop
              @click="emit('delete-row', row.id)"
            >
              <Trash2 :size="12" />
            </button>
          </td>
          <td v-for="f in visibleFields" :key="f.id" class="db-td">
            <DbCell
              :field="f"
              :value="row.cells[f.id]"
              @update="(v: unknown) => cellUpdate(row.id, f.id, v)"
              @create-option="(name: string) => onCreateOption(f, name, row.id)"
            />
          </td>
          <td class="db-td-tail"></td>
        </tr>
      </tbody>
    </table>

    <div v-if="!rows.length" class="db-empty">
      <span>还没有行</span>
    </div>

    <button class="db-add-row" @mousedown.stop @click="emit('add-row')">
      <Plus :size="13" /> 新建一行
    </button>

    <DbFieldMenu
      v-if="menu"
      :field="menu.field"
      :x="menu.x"
      :y="menu.y"
      :is-last="db.fields.length <= 1"
      @update="(patch: Partial<DbField>) => emit('update-field', menu!.field.id, patch)"
      @delete="emit('delete-field', menu!.field.id); closeMenu()"
      @hide="emit('hide-field', menu!.field.id); closeMenu()"
      @insert="(side: 'left' | 'right') => emit('insert-field', side, menu!.field.id)"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.db-table-wrap {
  overflow-x: auto;
  overflow-y: visible;
  padding-bottom: 2px;
}
.db-table {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  min-width: 100%;
  font-size: 13px;
}
.db-table th,
.db-table td {
  border-right: 1px solid var(--gn-border);
  border-bottom: 1px solid var(--gn-border);
  padding: 0;
  vertical-align: middle;
}
.db-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 34px;
  background: var(--gn-bg-sidebar);
  text-align: left;
  font-weight: 500;
}
.db-th-idx,
.db-td-idx {
  width: 42px;
  border-right: 1px solid var(--gn-border);
  text-align: center;
  color: var(--gn-text-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.db-th-idx {
  background: var(--gn-bg-sidebar);
}
.db-td-idx {
  background: color-mix(in srgb, var(--gn-bg-sidebar) 45%, transparent);
}
.db-idx-num {
  opacity: 0.85;
}
.db-row-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.db-row-del:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}

.db-th {
  position: relative;
  padding: 0;
}
.db-th-inner {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 33px;
  padding: 0 9px;
  cursor: pointer;
  color: var(--gn-text-soft);
  user-select: none;
}
.db-th-inner:hover {
  background: var(--gn-bg-hover);
}
.db-th-icon {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
}
.db-th-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.db-th-resize {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 3;
}
.db-th-resize:hover {
  background: var(--gn-accent);
  opacity: 0.4;
}
.db-th-add {
  border-right: none;
  text-align: center;
}
.db-th-add button {
  display: inline-flex;
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
.db-th-add button:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}

.db-td {
  padding: 0;
  height: 34px;
}
.db-td-tail {
  border-right: none;
}
.db-table tbody tr:hover .db-td {
  background: color-mix(in srgb, var(--gn-bg-hover) 45%, transparent);
}

.db-empty {
  padding: 18px 0 6px;
  text-align: center;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.db-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-bottom: 1px solid var(--gn-border);
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.db-add-row:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
</style>
