<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Plus, GripVertical, Check, Calendar } from 'lucide-vue-next'
import type { Database, DbField, DbRow, DbView } from '@/types'
import { cellText, optionOf } from './dbFields'

const props = defineProps<{
  db: Database
  rows: DbRow[]
  view: DbView
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update-cell', rowId: string, fieldId: string, value: unknown): void
  (e: 'add-row', cells: Record<string, unknown>): void
  (e: 'delete-row', rowId: string): void
  (e: 'open-row', rowId: string): void
}>()

const groupField = computed<DbField | undefined>(() => {
  const byId = props.db.fields.find((f) => f.id === props.view.groupBy)
  if (byId && byId.type === 'select') return byId
  return props.db.fields.find((f) => f.type === 'select')
})

const titleField = computed<DbField>(() => {
  const text = props.db.fields.find((f) => f.type === 'text')
  return text ?? props.db.fields[0]
})

interface Column {
  id: string | null
  name: string
  color: string
  rows: DbRow[]
}

const columns = computed<Column[]>(() => {
  const gf = groupField.value
  if (!gf) {
    return [{ id: null, name: '全部', color: 'gray', rows: props.rows }]
  }
  const opts = gf.options ?? []
  const cols: Column[] = opts.map((o) => ({
    id: o.id,
    name: o.name,
    color: o.color,
    rows: props.rows.filter((r) => r.cells[gf.id] === o.id),
  }))
  const rest = props.rows.filter(
    (r) => !r.cells[gf.id] || !opts.some((o) => o.id === r.cells[gf.id]),
  )
  if (rest.length || !cols.length) {
    cols.push({ id: null, name: '未分组', color: 'gray', rows: rest })
  }
  return cols
})

/** 卡片上除标题与分组字段外，最多再展示两条有值的信息 */
function cardMeta(row: DbRow): { field: DbField; text: string; isDate: boolean }[] {
  const gf = groupField.value
  return props.db.fields
    .filter((f) => f.id !== titleField.value.id && f.id !== gf?.id && f.type !== 'checkbox')
    .map((f) => ({ field: f, text: cellText(f, row.cells[f.id]), isDate: f.type === 'date' }))
    .filter((x) => x.text)
    .slice(0, 3)
}

function titleOf(row: DbRow) {
  return cellText(titleField.value, row.cells[titleField.value.id]) || '未命名'
}

const checkField = computed(() =>
  props.db.fields.find((f) => f.type === 'checkbox'),
)

/* ---------------- 卡片上的状态标签 ---------------- */

/**
 * 看板最常用的操作就是改状态，但状态字段就是分组字段，
 * 之前被 cardMeta 排除掉了，卡片上根本看不到也改不了。
 * 这里在卡片上单独渲染一个可点击的状态标签。
 */
const statusMenuFor = ref<string | null>(null)
const statusMenuPos = ref({ top: 0, left: 0 })

function statusOf(row: DbRow) {
  const gf = groupField.value
  if (!gf) return undefined
  return optionOf(gf, row.cells[gf.id])
}

function toggleStatusMenu(row: DbRow, e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  if (props.readonly) return
  if (statusMenuFor.value === row.id) {
    statusMenuFor.value = null
    return
  }
  // 用点击处的屏幕坐标定位，避免浮层被卡片裁掉
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const h = 4 + (groupField.value?.options?.length ?? 0) * 26 + 10
  statusMenuPos.value = {
    top: Math.min(r.bottom + 2, window.innerHeight - h - 12),
    left: Math.min(r.left, window.innerWidth - 180),
  }
  statusMenuFor.value = row.id
}

const statusRow = computed(
  () => props.rows.find((r) => r.id === statusMenuFor.value) ?? null,
)

function pickStatus(row: DbRow, optionId: string | null) {
  if (props.readonly) return
  const gf = groupField.value
  if (!gf) return
  emit('update-cell', row.id, gf.id, optionId)
  statusMenuFor.value = null
}

function onDocDown(e: MouseEvent) {
  if (statusMenuFor.value === null) return
  const el = document.querySelector('.db-status-pop')
  if (el && !el.contains(e.target as Node)) statusMenuFor.value = null
}

onMounted(() => document.addEventListener('mousedown', onDocDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

/* ---------------- 拖拽 ---------------- */

const dragging = ref<string | null>(null)
const dragOver = ref<string | null>(null)

function onDragStart(row: DbRow, e: DragEvent) {
  if (props.readonly) {
    e.preventDefault()
    return
  }
  dragging.value = row.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', row.id)
  }
}

function onDragEnd() {
  dragging.value = null
  dragOver.value = null
}

function onDrop(col: Column) {
  if (props.readonly) return
  const gf = groupField.value
  const rowId = dragging.value
  dragOver.value = null
  dragging.value = null
  if (!rowId || !gf) return
  emit('update-cell', rowId, gf.id, col.id)
}

function addCard(col: Column) {
  if (props.readonly) return
  const cells: Record<string, unknown> = {}
  const gf = groupField.value
  if (gf && col.id) cells[gf.id] = col.id
  emit('add-row', cells)
}
</script>

<template>
  <div class="db-board gn-scroll">
    <div
      v-for="col in columns"
      :key="col.id ?? 'none'"
      class="db-col"
      :class="{ over: dragOver === col.id }"
      @dragover.prevent="dragOver = col.id"
      @dragleave="dragOver = dragOver === col.id ? null : dragOver"
      @drop.prevent="onDrop(col)"
    >
      <div class="db-col-head">
        <span class="gn-tag" :data-color="col.color">{{ col.name }}</span>
        <span class="db-col-count">{{ col.rows.length }}</span>
        <button
          v-if="!readonly"
          class="db-col-add"
          v-tooltip="'新增卡片'"
          @mousedown.stop
          @click="addCard(col)"
        >
          <Plus :size="13" />
        </button>
      </div>

      <div class="db-col-body">
        <div
          v-for="row in col.rows"
          :key="row.id"
          class="db-card"
          :class="{ dragging: dragging === row.id, readonly }"
          :draggable="!readonly"
          @dragstart="onDragStart(row, $event)"
          @dragend="onDragEnd"
          @click="emit('open-row', row.id)"
        >
          <div class="db-card-top">
            <GripVertical v-if="!readonly" :size="12" class="db-card-grip" />
            <span class="db-card-title">{{ titleOf(row) }}</span>
            <button
              v-if="checkField"
              class="db-card-check"
              :class="{ on: row.cells[checkField.id] }"
              :disabled="readonly"
              v-tooltip="readonly ? undefined : '切换完成状态'"
              @mousedown.stop
              @click.stop="!readonly && emit('update-cell', row.id, checkField.id, !row.cells[checkField.id])"
            >
              <Check v-if="row.cells[checkField.id]" :size="11" :stroke-width="3" />
            </button>
          </div>
          <div v-if="cardMeta(row).length" class="db-card-meta">
            <span v-for="m in cardMeta(row)" :key="m.field.id" class="db-card-meta-item">
              <Calendar v-if="m.isDate" :size="11" />
              <template v-else>
                <span
                  v-if="m.field.type === 'select' && optionOf(m.field, row.cells[m.field.id])"
                  class="gn-tag tiny"
                  :data-color="optionOf(m.field, row.cells[m.field.id])!.color"
                  >{{ m.text }}</span
                >
                <template v-else>{{ m.text }}</template>
              </template>
            </span>
          </div>

          <!-- 状态标签：看板里最常改的就是它，可以直接点 -->
          <div
            v-if="groupField"
            class="db-card-status"
            :class="{ locked: readonly }"
            @mousedown.stop
            @click.stop="!readonly && toggleStatusMenu(row, $event)"
          >
            <span
              v-if="statusOf(row)"
              class="gn-tag tiny"
              :data-color="statusOf(row)!.color"
              >{{ statusOf(row)!.name }}</span
            >
            <span v-else class="db-card-status-empty">{{ readonly ? '无状态' : '设置状态' }}</span>
          </div>

        </div>

        <button v-if="!readonly" class="db-card-add" @mousedown.stop @click="addCard(col)">
          <Plus :size="12" /> 新建
        </button>
      </div>
    </div>

    <!--
      状态下拉浮层用 Teleport 挂到 body 上。
      看板容器有 overflow-x: auto，浮层留在容器里会被裁掉。
    -->
    <Teleport to="body">
      <div
        v-if="statusMenuFor !== null && statusRow"
        class="db-status-pop gn-pop"
        :style="{ top: statusMenuPos.top + 'px', left: statusMenuPos.left + 'px' }"
        @mousedown.stop
        @click.stop
      >
        <button
          class="db-opt-item"
          :class="{ on: !statusRow.cells[groupField!.id] }"
          @click="pickStatus(statusRow, null)"
        >
          未分组
        </button>
        <button
          v-for="o in groupField!.options ?? []"
          :key="o.id"
          class="db-opt-item"
          :class="{ on: statusRow.cells[groupField!.id] === o.id }"
          @click="pickStatus(statusRow, o.id)"
        >
          <span class="gn-tag tiny" :data-color="o.color">{{ o.name }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.db-board {
  display: flex;
  gap: 10px;
  padding: 10px 2px 12px;
  overflow-x: auto;
  align-items: flex-start;
}
.db-col {
  flex: 1 1 180px;
  min-width: 168px;
  display: flex;
  flex-direction: column;
  max-height: 560px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: color-mix(in srgb, var(--gn-bg-sidebar) 72%, transparent);
  padding: 6px;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.db-col.over {
  border-color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.db-col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 8px;
}
.db-col-count {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  font-variant-numeric: tabular-nums;
}
.db-col-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.db-col-add:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.db-col-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 42px;
  padding-bottom: 2px;
}
.db-card {
  position: relative;
  padding: 8px 9px;
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  background: var(--gn-bg);
  box-shadow: 0 1px 2px rgba(15, 15, 15, 0.04);
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
}
.db-card:hover {
  border-color: var(--gn-border-strong);
  box-shadow: var(--gn-shadow-sm);
}
.db-card.dragging {
  opacity: 0.45;
  transform: rotate(1deg);
}
.db-card-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.db-card-grip {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--gn-text-muted);
  opacity: 0;
}
.db-card:hover .db-card-grip {
  opacity: 1;
}
.db-card-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--gn-text);
  word-break: break-word;
}
.db-card-check {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 1px;
  border: 1.5px solid var(--gn-border-strong);
  border-radius: 4px;
  background: transparent;
  color: transparent;
  cursor: pointer;
}
.db-card-check.on {
  background: var(--gn-accent);
  border-color: var(--gn-accent);
  color: var(--gn-accent-ink);
}
.db-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  padding-left: 16px;
}
.db-card-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--gn-text-muted);
}

/* 卡片上的状态标签 */
.db-card-status {
  margin-top: 7px;
  display: flex;
  align-items: center;
  cursor: pointer;
  min-height: 18px;
}
.db-card-status-empty {
  font-size: 11px;
  color: var(--gn-text-faint);
  opacity: 0;
  transition: opacity 0.12s;
}
.db-card:hover .db-card-status-empty {
  opacity: 1;
}

.db-card-add {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.db-card-add:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
</style>
