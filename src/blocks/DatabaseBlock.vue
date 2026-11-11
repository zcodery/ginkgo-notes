<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import {
  Table2,
  Columns3,
  Plus,
  Filter,
  ArrowUpDown,
  Settings2,
  Trash2,
  X,
  ChevronDown,
  CircleAlert,
} from 'lucide-vue-next'
import type { Database, DbField, DbRow, DbView, FieldType, FilterOp, ViewType } from '@/types'
import {
  addField as dbAddField,
  addRow as dbAddRow,
  createDatabase,
  deleteRow as dbDeleteRow,
  getDatabase,
  listRows,
  newField,
  newView,
  removeField as dbRemoveField,
  saveDatabase,
  updateField as dbUpdateField,
  updateRow as dbUpdateRow,
} from '@/db/databases'
import {
  FIELD_TYPE_META,
  FIELD_TYPE_ORDER,
  OPTION_COLORS,
  applyView,
  opsForType,
} from './dbFields'
import DbTableView from './DbTableView.vue'
import DbBoardView from './DbBoardView.vue'
import DbRowSheet from './DbRowSheet.vue'

const props = defineProps<{
  node: any
  updateAttributes: (attrs: Record<string, unknown>) => void
  editor: any
  selected: boolean
  getPos: () => number
}>()

const dbId = computed<string>(() => props.node?.attrs?.dbId ?? '')

/* ============================================================
 *  加载
 * ============================================================ */

const db = ref<Database | null>(null)
const rows = ref<DbRow[]>([])
const loading = ref(true)
const missing = ref(false)
const activeViewId = ref<string | null>(null)

async function load() {
  if (!dbId.value) {
    missing.value = true
    loading.value = false
    return
  }
  const d = await getDatabase(dbId.value)
  if (!d) {
    missing.value = true
    loading.value = false
    return
  }
  missing.value = false
  db.value = d
  rows.value = await listRows(dbId.value)
  if (!activeViewId.value || !d.views.some((v) => v.id === activeViewId.value)) {
    const remembered = d.lastViewId && d.views.some((v) => v.id === d.lastViewId)
    activeViewId.value = remembered ? d.lastViewId! : (d.views[0]?.id ?? null)
  }
  loading.value = false
}

onMounted(load)

const activeView = computed<DbView | null>(
  () => db.value?.views.find((v) => v.id === activeViewId.value) ?? null,
)

const displayRows = computed(() => {
  if (!db.value) return []
  return applyView(rows.value, db.value.fields, activeView.value)
})

const groupFieldId = computed({
  get: () => activeView.value?.groupBy ?? '',
  set: (id: string) => patchView({ groupBy: id || null }),
})

/* ============================================================
 *  写操作
 * ============================================================ */

async function persistDb() {
  const d = db.value
  if (!d) return
  await saveDatabase(d.id, {
    title: d.title,
    icon: d.icon,
    fields: d.fields,
    views: d.views,
  })
}

function updateCell(rowId: string, fieldId: string, value: unknown) {
  const row = rows.value.find((r) => r.id === rowId)
  if (!row) return
  row.cells = { ...row.cells, [fieldId]: value }
  row.updatedAt = Date.now()
  void dbUpdateRow(rowId, { [fieldId]: value })
}

async function onAddRow(cells: Record<string, unknown> = {}, afterOrder?: number) {
  if (!db.value) return
  const row = await dbAddRow(db.value.id, cells, afterOrder)
  rows.value = [...rows.value, row].sort((a, b) => a.order - b.order)
  return row
}

async function onDeleteRow(rowId: string) {
  rows.value = rows.value.filter((r) => r.id !== rowId)
  if (sheetRowId.value === rowId) sheetRowId.value = null
  await dbDeleteRow(rowId)
}

function onUpdateField(fieldId: string, patch: Partial<DbField>) {
  if (!db.value) return
  const f = db.value.fields.find((x) => x.id === fieldId)
  if (!f) return
  Object.assign(f, patch)
  void dbUpdateField(db.value.id, { ...f })
}

async function onDeleteField(fieldId: string) {
  if (!db.value || db.value.fields.length <= 1) return
  db.value.fields = db.value.fields.filter((f) => f.id !== fieldId)
  db.value.views = db.value.views.map((v) => ({
    ...v,
    hiddenFields: v.hiddenFields.filter((id) => id !== fieldId),
    groupBy: v.groupBy === fieldId ? null : v.groupBy,
    filters: v.filters.filter((x) => x.fieldId !== fieldId),
    sorts: v.sorts.filter((s) => s.fieldId !== fieldId),
  }))
  for (const r of rows.value) {
    if (fieldId in r.cells) {
      const next = { ...r.cells }
      delete next[fieldId]
      r.cells = next
    }
  }
  await dbRemoveField(db.value.id, fieldId)
}

async function onAddField() {
  await addFieldOfType('text')
}

async function addFieldOfType(type: FieldType) {
  const d = db.value
  if (!d) return
  const f = newField(`字段 ${d.fields.length + 1}`, type)
  d.fields = [...d.fields, f]
  await dbAddField(d.id, f)
}

async function onInsertField(side: 'left' | 'right', nearId: string) {
  if (!db.value) return
  const f = newField(`字段 ${db.value.fields.length + 1}`)
  const idx = db.value.fields.findIndex((x) => x.id === nearId)
  const at = side === 'left' ? idx : idx + 1
  const next = [...db.value.fields]
  next.splice(at < 0 ? next.length : at, 0, f)
  db.value.fields = next
  await dbAddField(db.value.id, f)
}

function onHideField(fieldId: string) {
  patchView({ hiddenFields: [...(activeView.value?.hiddenFields ?? []), fieldId] })
}

function onCreateOption(fieldId: string, name: string) {
  if (!db.value) return
  const f = db.value.fields.find((x) => x.id === fieldId)
  if (!f) return
  const opts = f.options ?? []
  f.options = [
    ...opts,
    {
      id: 'o_' + Math.random().toString(36).slice(2, 10),
      name,
      color: OPTION_COLORS[opts.length % OPTION_COLORS.length],
    },
  ]
  void persistDb()
}

/* ---------------- 视图 ---------------- */

async function switchView(id: string) {
  activeViewId.value = id
  const d = db.value
  if (!d || d.lastViewId === id) return
  d.lastViewId = id
  void saveDatabase(d.id, { lastViewId: id })
}

function patchView(patch: Partial<DbView>) {
  const d = db.value
  const v = activeView.value
  if (!d || !v) return
  Object.assign(v, patch)
  void saveDatabase(d.id, { views: d.views })
}

async function addView(type: ViewType) {
  const d = db.value
  if (!d) return
  const name = type === 'table' ? `表格 ${d.views.filter((v) => v.type === 'table').length + 1}` : `看板 ${d.views.filter((v) => v.type === 'board').length + 1}`
  const v = newView(name, type, d.fields.find((f) => f.type === 'select')?.id ?? null)
  d.views = [...d.views, v]
  activeViewId.value = v.id
  panel.value = null
  await saveDatabase(d.id, { views: d.views })
}

async function removeView(id: string) {
  const d = db.value
  if (!d || d.views.length <= 1) return
  d.views = d.views.filter((v) => v.id !== id)
  if (activeViewId.value === id) activeViewId.value = d.views[0].id
  await saveDatabase(d.id, { views: d.views })
}

const renamingView = ref<string | null>(null)
const viewNameDraft = ref('')

function startRename(v: DbView) {
  renamingView.value = v.id
  viewNameDraft.value = v.name
  void nextTick(() => {
    const el = document.querySelector('.dbb-view-rename') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitRename() {
  const v = db.value?.views.find((x) => x.id === renamingView.value)
  if (v && viewNameDraft.value.trim()) {
    v.name = viewNameDraft.value.trim()
    void saveDatabase(db.value!.id, { views: db.value!.views })
  }
  renamingView.value = null
}

/* ============================================================
 *  工具栏面板
 * ============================================================ */

type Panel = 'filter' | 'sort' | 'fields' | 'addView' | null
const panel = ref<Panel>(null)
const panelPos = ref({ top: 0, left: 0 })

function togglePanel(name: Exclude<Panel, null>, e: MouseEvent) {
  if (panel.value === name) {
    panel.value = null
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const w = 330
  panelPos.value = {
    top: r.bottom + 6,
    left: Math.max(12, Math.min(r.left, window.innerWidth - w - 16)),
  }
  panel.value = name
}

function onDocDown(e: MouseEvent) {
  if (!panel.value) return
  const el = document.querySelector('.dbb-panel')
  if (el && !el.contains(e.target as Node)) panel.value = null
}
document.addEventListener('mousedown', onDocDown)
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

/* ---------------- 筛选 ---------------- */

const fields = computed(() => db.value?.fields ?? [])

function addFilter() {
  const v = activeView.value
  const f = fields.value[0]
  if (!v || !f) return
  v.filters = [
    ...v.filters,
    { id: 'fl_' + Math.random().toString(36).slice(2, 8), fieldId: f.id, op: 'contains', value: '' },
  ]
  void saveDatabase(db.value!.id, { views: db.value!.views })
}

function updateFilter(id: string, patch: Record<string, unknown>) {
  const v = activeView.value
  if (!v) return
  v.filters = v.filters.map((f) => (f.id === id ? { ...f, ...patch } : f))
  void saveDatabase(db.value!.id, { views: db.value!.views })
}

function removeFilter(id: string) {
  const v = activeView.value
  if (!v) return
  v.filters = v.filters.filter((f) => f.id !== id)
  void saveDatabase(db.value!.id, { views: db.value!.views })
}

function fieldOf(id: string) {
  return fields.value.find((f) => f.id === id)
}

function opsOf(fieldId: string) {
  const f = fieldOf(fieldId)
  return f ? opsForType(f.type) : [{ op: 'contains' as FilterOp, label: '包含' }]
}

/* ---------------- 排序 ---------------- */

function addSort() {
  const v = activeView.value
  const f = fields.value[0]
  if (!v || !f) return
  v.sorts = [...v.sorts, { fieldId: f.id, dir: 'asc' }]
  void saveDatabase(db.value!.id, { views: db.value!.views })
}

function updateSort(idx: number, patch: Partial<{ fieldId: string; dir: 'asc' | 'desc' }>) {
  const v = activeView.value
  if (!v) return
  v.sorts = v.sorts.map((s, i) => (i === idx ? { ...s, ...patch } : s))
  void saveDatabase(db.value!.id, { views: db.value!.views })
}

function removeSort(idx: number) {
  const v = activeView.value
  if (!v) return
  v.sorts = v.sorts.filter((_, i) => i !== idx)
  void saveDatabase(db.value!.id, { views: db.value!.views })
}

/* ---------------- 字段显隐 ---------------- */

function toggleFieldVisible(id: string) {
  const v = activeView.value
  if (!v) return
  const set = new Set(v.hiddenFields ?? [])
  if (set.has(id)) set.delete(id)
  else set.add(id)
  patchView({ hiddenFields: [...set] })
}

/* ============================================================
 *  行详情
 * ============================================================ */

const sheetRowId = ref<string | null>(null)
const sheetRow = computed(() => rows.value.find((r) => r.id === sheetRowId.value) ?? null)

/* ============================================================
 *  标题 / 删除 / 修复
 * ============================================================ */

async function onTitleChange(e: Event) {
  const t = (e.target as HTMLInputElement).value.trim()
  if (!db.value) return
  db.value.title = t || '未命名多维表格'
  await persistDb()
}

async function repairCreate() {
  const d = await createDatabase({ title: '恢复的多维表格' })
  db.value = d
  rows.value = await listRows(d.id)
  missing.value = false
  props.updateAttributes({ dbId: d.id })
}

function removeSelf() {
  const pos = props.getPos()
  if (typeof pos !== 'number') return
  props.editor
    ?.chain()
    .focus()
    .deleteRange({ from: pos, to: pos + props.node.nodeSize })
    .run()
}

</script>

<template>
  <NodeViewWrapper
    class="gn-db"
    :class="{ selected: props.selected }"
    data-ginkgo-db=""
    contenteditable="false"
  >
    <!-- 加载中 -->
    <div v-if="loading" class="dbb-skeleton">
      <div class="dbb-sk-line w40"></div>
      <div class="dbb-sk-line w90"></div>
      <div class="dbb-sk-line w80"></div>
    </div>

    <!-- 引用失效 -->
    <div v-else-if="missing || !db" class="dbb-missing">
      <CircleAlert :size="16" />
      <div class="dbb-missing-body">
        <div class="dbb-missing-title">这个表格不存在了</div>
        <div class="dbb-missing-sub">
          数据可能被清理，或这是一份从别处导入的笔记（原表不在当前账号下）。
        </div>
      </div>
      <button class="gn-btn" @mousedown.stop @click="repairCreate">新建一张空表</button>
    </div>

    <template v-else>
      <!-- 头部 -->
      <header class="dbb-head">
        <div class="dbb-title-row">
          <span class="dbb-icon">{{ db.icon }}</span>
          <input
            class="dbb-title"
            :value="db.title"
            spellcheck="false"
            @keydown.stop
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @change="onTitleChange"
          />
          <span class="dbb-count">{{ rows.length }} 行</span>
          <button class="dbb-del" title="删除整张表" @mousedown.stop @click="removeSelf">
            <Trash2 :size="13" />
          </button>
        </div>

        <!-- 视图切换 -->
        <div class="dbb-views">
          <div class="dbb-view-tabs">
            <div
              v-for="v in db.views"
              :key="v.id"
              class="dbb-view-tab"
              :class="{ on: v.id === activeViewId }"
              @mousedown.stop
              @click="switchView(v.id)"
              @dblclick="startRename(v)"
            >
              <component
                :is="v.type === 'table' ? Table2 : Columns3"
                :size="12.5"
                class="dbb-view-icon"
              />
              <input
                v-if="renamingView === v.id"
                v-model="viewNameDraft"
                class="dbb-view-rename"
                @keydown.stop
                @keydown.enter="commitRename"
                @keydown.escape="renamingView = null"
                @blur="commitRename"
              />
              <span v-else class="dbb-view-name">{{ v.name }}</span>
              <button
                v-if="db.views.length > 1 && v.id === activeViewId"
                class="dbb-view-x"
                title="删除这个视图"
                @click.stop="removeView(v.id)"
              >
                <X :size="10" />
              </button>
            </div>
            <button
              class="dbb-view-add"
              title="新建视图"
              @mousedown.stop
              @click="togglePanel('addView', $event)"
            >
              <Plus :size="13" />
            </button>
          </div>

          <div class="dbb-tools">
            <button
              v-if="activeView?.type === 'board'"
              class="dbb-group-pick"
              :title="'看板按这个字段分组'"
            >
              <span class="dbb-group-label">分组</span>
              <select v-model="groupFieldId" @mousedown.stop>
                <option value="">未分组</option>
                <option v-for="f in db.fields.filter((x) => x.type === 'select')" :key="f.id" :value="f.id">
                  {{ f.name }}
                </option>
              </select>
              <ChevronDown :size="11" class="dbb-group-caret" />
            </button>

            <button
              class="dbb-tool"
              :class="{ on: !!activeView?.filters.length }"
              title="筛选"
              @mousedown.stop
              @click="togglePanel('filter', $event)"
            >
              <Filter :size="13" />
              <span v-if="activeView?.filters.length" class="dbb-tool-badge">{{
                activeView.filters.length
              }}</span>
            </button>
            <button
              class="dbb-tool"
              :class="{ on: !!activeView?.sorts.length }"
              title="排序"
              @mousedown.stop
              @click="togglePanel('sort', $event)"
            >
              <ArrowUpDown :size="13" />
              <span v-if="activeView?.sorts.length" class="dbb-tool-badge">{{
                activeView.sorts.length
              }}</span>
            </button>
            <button
              class="dbb-tool"
              :class="{ on: !!activeView?.hiddenFields.length }"
              title="显示字段"
              @mousedown.stop
              @click="togglePanel('fields', $event)"
            >
              <Settings2 :size="13" />
            </button>
          </div>
        </div>
      </header>

      <!-- 视图主体 -->
      <DbTableView
        v-if="activeView?.type === 'table'"
        :db="db"
        :rows="displayRows"
        :view="activeView"
        @update-cell="updateCell"
        @add-row="(afterOrder?: number) => onAddRow({}, afterOrder)"
        @delete-row="onDeleteRow"
        @update-field="onUpdateField"
        @delete-field="onDeleteField"
        @insert-field="onInsertField"
        @add-field="onAddField"
        @hide-field="onHideField"
      />
      <DbBoardView
        v-else-if="activeView"
        :db="db"
        :rows="displayRows"
        :view="activeView"
        @update-cell="updateCell"
        @add-row="(cells: Record<string, unknown>) => onAddRow(cells)"
        @delete-row="onDeleteRow"
        @open-row="(id: string) => (sheetRowId = id)"
      />
      <div v-else class="dbb-noview">这个表格还没有视图</div>

      <!-- 工具面板 -->
      <Teleport to="body">
        <div
          v-if="panel && panel !== 'addView'"
          class="dbb-panel gn-pop"
          :style="{ top: panelPos.top + 'px', left: panelPos.left + 'px' }"
          @mousedown.stop
        >
          <!-- 筛选 -->
          <template v-if="panel === 'filter'">
            <div class="dbb-panel-head">筛选条件</div>
            <div v-if="!activeView?.filters.length" class="dbb-panel-empty">
              还没有条件，所有行都会显示
            </div>
            <div v-for="f in activeView?.filters" :key="f.id" class="dbb-cond">
              <select
                class="dbb-sel"
                :value="f.fieldId"
                @change="updateFilter(f.id, { fieldId: ($event.target as HTMLSelectElement).value, value: '' })"
              >
                <option v-for="fd in db.fields" :key="fd.id" :value="fd.id">{{ fd.name }}</option>
              </select>
              <select
                class="dbb-sel narrow"
                :value="f.op"
                @change="updateFilter(f.id, { op: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="o in opsOf(f.fieldId)" :key="o.op" :value="o.op">{{ o.label }}</option>
              </select>
              <select
                v-if="fieldOf(f.fieldId)?.type === 'select'"
                class="dbb-sel"
                :value="f.value"
                @change="updateFilter(f.id, { value: ($event.target as HTMLSelectElement).value })"
              >
                <option value="">选择…</option>
                <option
                  v-for="o in fieldOf(f.fieldId)?.options ?? []"
                  :key="o.id"
                  :value="o.id"
                >
                  {{ o.name }}
                </option>
              </select>
              <input
                v-else-if="!['isEmpty', 'isNotEmpty', 'checked', 'unchecked'].includes(f.op)"
                class="dbb-inp"
                :value="f.value"
                placeholder="值"
                @input="updateFilter(f.id, { value: ($event.target as HTMLInputElement).value })"
              />
              <button class="dbb-cond-x" @click="removeFilter(f.id)"><X :size="11" /></button>
            </div>
            <button class="dbb-panel-add" @click="addFilter"><Plus :size="12" /> 添加条件</button>
          </template>

          <!-- 排序 -->
          <template v-else-if="panel === 'sort'">
            <div class="dbb-panel-head">排序规则</div>
            <div v-if="!activeView?.sorts.length" class="dbb-panel-empty">按创建顺序排列</div>
            <div v-for="(s, i) in activeView?.sorts" :key="i" class="dbb-cond">
              <select
                class="dbb-sel"
                :value="s.fieldId"
                @change="updateSort(i, { fieldId: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="fd in db.fields" :key="fd.id" :value="fd.id">{{ fd.name }}</option>
              </select>
              <button
                class="dbb-dir"
                @click="updateSort(i, { dir: s.dir === 'asc' ? 'desc' : 'asc' })"
              >
                {{ s.dir === 'asc' ? '升序 ↑' : '降序 ↓' }}
              </button>
              <button class="dbb-cond-x" @click="removeSort(i)"><X :size="11" /></button>
            </div>
            <button class="dbb-panel-add" @click="addSort"><Plus :size="12" /> 添加排序</button>
          </template>

          <!-- 字段显隐 -->
          <template v-else>
            <div class="dbb-panel-head">显示字段</div>
            <label v-for="f in db.fields" :key="f.id" class="dbb-field-row">
              <input
                type="checkbox"
                :checked="!activeView?.hiddenFields.includes(f.id)"
                @change="toggleFieldVisible(f.id)"
              />
              <component :is="FIELD_TYPE_META[f.type].icon" :size="12" class="dbb-field-icon" />
              <span>{{ f.name }}</span>
              <span class="dbb-field-type">{{ FIELD_TYPE_META[f.type].label }}</span>
            </label>
            <div class="dbb-panel-divider"></div>
            <div class="dbb-panel-add" @click="onAddField"><Plus :size="12" /> 新增字段</div>
            <div class="dbb-type-list">
              <button
                v-for="t in FIELD_TYPE_ORDER"
                :key="t"
                class="dbb-type-btn"
                :title="FIELD_TYPE_META[t].hint"
                @click="addFieldOfType(t)"
              >
                <component :is="FIELD_TYPE_META[t].icon" :size="12" />
                {{ FIELD_TYPE_META[t].label }}
              </button>
            </div>
          </template>
        </div>

        <!-- 新建视图菜单 -->
        <div
          v-if="panel === 'addView'"
          class="dbb-panel small gn-pop"
          :style="{ top: panelPos.top + 'px', left: panelPos.left + 'px' }"
          @mousedown.stop
        >
          <button class="dbb-viewopt" @click="addView('table')">
            <Table2 :size="14" /><span>表格视图</span>
            <span class="dbb-viewopt-desc">像电子表格一样逐行编辑</span>
          </button>
          <button class="dbb-viewopt" @click="addView('board')">
            <Columns3 :size="14" /><span>看板视图</span>
            <span class="dbb-viewopt-desc">按单选字段分列，可拖拽</span>
          </button>
        </div>
      </Teleport>

      <DbRowSheet
        v-if="db"
        :db="db"
        :row="sheetRow"
        @update-cell="(fid: string, v: unknown) => sheetRow && updateCell(sheetRow.id, fid, v)"
        @create-option="onCreateOption"
        @delete="sheetRow && onDeleteRow(sheetRow.id)"
        @close="sheetRowId = null"
      />
    </template>
  </NodeViewWrapper>
</template>

<style scoped>
.gn-db {
  margin: 12px 0;
  border: 1px solid var(--gn-border);
  border-radius: 11px;
  background: var(--gn-bg);
  overflow: hidden;
  transition: border-color 0.15s ease;
}
.gn-db:hover,
.gn-db.selected {
  border-color: var(--gn-border-strong);
}

/* 头部 */
.dbb-head {
  padding: 10px 12px 0;
}
.dbb-title-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.dbb-icon {
  font-size: 17px;
  line-height: 1;
}
.dbb-title {
  flex: 0 1 auto;
  min-width: 40px;
  max-width: 60%;
  height: 26px;
  padding: 0 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text);
  font-size: 14.5px;
  font-weight: 650;
  outline: none;
}
.dbb-title:hover {
  background: var(--gn-bg-hover);
}
.dbb-title:focus {
  background: var(--gn-bg-hover);
  box-shadow: inset 0 0 0 1.5px var(--gn-accent);
}
.dbb-count {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  padding: 1px 7px;
  border-radius: 20px;
  background: var(--gn-bg-sidebar);
}
.dbb-del {
  margin-left: auto;
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
  opacity: 0;
}
.gn-db:hover .dbb-del {
  opacity: 1;
}
.dbb-del:hover {
  background: color-mix(in srgb, var(--gn-danger) 12%, transparent);
  color: var(--gn-danger);
}

/* 视图栏 */
.dbb-views {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  border-bottom: 1px solid var(--gn-border);
  padding-bottom: 0;
}
.dbb-view-tabs {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
}
.dbb-view-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px 6px 0 0;
  color: var(--gn-text-muted);
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.dbb-view-tab:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text-soft);
}
.dbb-view-tab.on {
  color: var(--gn-text);
  border-bottom-color: var(--gn-accent);
  font-weight: 550;
}
.dbb-view-icon {
  opacity: 0.75;
}
.dbb-view-rename {
  width: 74px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--gn-accent);
  border-radius: 4px;
  font-size: 12.5px;
  outline: none;
  background: var(--gn-bg);
  color: var(--gn-text);
}
.dbb-view-x {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
  opacity: 0;
}
.dbb-view-tab:hover .dbb-view-x {
  opacity: 1;
}
.dbb-view-x:hover {
  background: var(--gn-bg-active);
  color: var(--gn-danger);
}
.dbb-view-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.dbb-view-add:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}

/* 右侧工具 */
.dbb-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding-bottom: 1px;
}
.dbb-tool {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-muted);
  cursor: pointer;
}
.dbb-tool:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.dbb-tool.on {
  color: var(--gn-accent);
  background: var(--gn-accent-soft);
}
.dbb-tool-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--gn-accent);
  color: #fff;
  font-size: 9px;
  line-height: 13px;
  text-align: center;
}
.dbb-group-pick {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
  position: relative;
}
.dbb-group-label {
  color: var(--gn-text-muted);
}
.dbb-group-pick select {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  max-width: 88px;
  padding-right: 12px;
}
.dbb-group-caret {
  position: absolute;
  right: 4px;
  pointer-events: none;
  color: var(--gn-text-muted);
}

/* 骨架 / 缺失 */
.dbb-skeleton {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dbb-sk-line {
  height: 12px;
  border-radius: 4px;
  background: var(--gn-bg-hover);
  animation: dbb-pulse 1.4s ease-in-out infinite;
}
.dbb-sk-line.w40 {
  width: 40%;
}
.dbb-sk-line.w90 {
  width: 90%;
}
.dbb-sk-line.w80 {
  width: 80%;
}
@keyframes dbb-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
.dbb-missing {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  color: var(--gn-text-soft);
}
.dbb-missing-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--gn-text);
}
.dbb-missing-sub {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  margin-top: 2px;
}
.dbb-missing-body {
  flex: 1 1 auto;
  min-width: 0;
}
.dbb-noview {
  padding: 22px;
  text-align: center;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}

/* 工具面板 */
.dbb-panel {
  position: fixed;
  z-index: 1250;
  width: 330px;
  padding: 8px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  font-size: 12.5px;
}
.dbb-panel.small {
  width: 268px;
}
.dbb-panel-head {
  font-size: 11px;
  color: var(--gn-text-muted);
  padding: 2px 4px 7px;
  letter-spacing: 0.02em;
}
.dbb-panel-empty {
  padding: 8px 4px 10px;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.dbb-cond {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.dbb-sel {
  flex: 1 1 0;
  min-width: 0;
  height: 27px;
  padding: 0 5px;
  border: 1px solid var(--gn-border);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12px;
  outline: none;
}
.dbb-sel.narrow {
  flex: 0 0 84px;
}
.dbb-inp {
  flex: 1 1 0;
  min-width: 0;
  height: 27px;
  padding: 0 7px;
  border: 1px solid var(--gn-border);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12px;
  outline: none;
}
.dbb-inp:focus,
.dbb-sel:focus {
  border-color: var(--gn-accent);
}
.dbb-cond-x {
  flex: 0 0 auto;
  display: flex;
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
.dbb-cond-x:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-danger);
}
.dbb-dir {
  flex: 0 0 74px;
  height: 27px;
  border: 1px solid var(--gn-border);
  border-radius: 5px;
  background: var(--gn-bg);
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
}
.dbb-dir:hover {
  border-color: var(--gn-accent);
  color: var(--gn-accent);
}
.dbb-panel-add {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 6px 6px;
  margin-top: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--gn-accent);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.dbb-panel-add:hover {
  background: var(--gn-accent-soft);
}
.dbb-field-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px;
  border-radius: 5px;
  cursor: pointer;
  color: var(--gn-text);
}
.dbb-field-row:hover {
  background: var(--gn-bg-hover);
}
.dbb-field-icon {
  color: var(--gn-text-muted);
}
.dbb-field-type {
  margin-left: auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.dbb-panel-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--gn-border);
}
.dbb-type-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}
.dbb-type-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--gn-text-soft);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.dbb-type-btn:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}

/* 新建视图菜单 */
.dbb-viewopt {
  display: grid;
  grid-template-columns: 18px 1fr;
  align-items: center;
  gap: 0 6px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--gn-text);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.dbb-viewopt:hover {
  background: var(--gn-bg-hover);
}
.dbb-viewopt-desc {
  grid-column: 2;
  font-size: 11px;
  color: var(--gn-text-muted);
}
</style>
