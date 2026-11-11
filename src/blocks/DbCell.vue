<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ExternalLink, Plus, X } from 'lucide-vue-next'
import type { DbField, FieldOption } from '@/types'
import { OPTION_COLORS, optionOf } from './dbFields'

const props = defineProps<{
  field: DbField
  value: unknown
  /** 只读模式下不渲染任何输入控件 */
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', value: unknown): void
  (e: 'create-option', name: string): void
}>()

const cellEl = ref<HTMLElement | null>(null)

/* ---------------- 文本 / 链接 / 数字 ---------------- */

const textValue = computed(() => {
  const v = props.value
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
})

function commitText(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (props.field.type === 'number') {
    const n = raw.trim() === '' ? null : Number(raw)
    emit('update', n == null || Number.isNaN(n) ? null : n)
  } else {
    emit('update', raw)
  }
}

/* ---------------- 日期 ---------------- */

const dateValue = computed(() => {
  const v = textValue.value
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
})

const dateLabel = computed(() => {
  const d = dateValue.value
  if (!d) return ''
  const [, y, m, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) ?? []
  return `${y}/${m}/${day}`
})

function commitDate(e: Event) {
  const v = (e.target as HTMLInputElement).value
  emit('update', v || null)
}

/* ---------------- 复选框 ---------------- */

function toggleCheck() {
  emit('update', !props.value)
}

/* ---------------- 单选 / 多选 ---------------- */

const menuOpen = ref(false)
const menuPos = ref({ top: 0, left: 0, width: 200 })
const query = ref('')
const searchRef = ref<HTMLInputElement | null>(null)

const selected = computed<FieldOption | undefined>(() => optionOf(props.field, props.value))

const multiIds = computed<string[]>(() =>
  Array.isArray(props.value) ? (props.value as string[]) : [],
)

const multiSelected = computed(() =>
  multiIds.value.map((id) => optionOf(props.field, id)).filter(Boolean) as FieldOption[],
)

const options = computed(() => props.field.options ?? [])

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return options.value
  return options.value.filter((o) => o.name.toLowerCase().includes(q))
})

const canCreate = computed(() => {
  const q = query.value.trim()
  if (!q) return false
  return !options.value.some((o) => o.name.toLowerCase() === q.toLowerCase())
})

function openMenu(e: MouseEvent) {
  if (props.readonly) return
  e.stopPropagation()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menuPos.value = {
    top: Math.min(r.bottom + 4, window.innerHeight - 300),
    left: Math.min(r.left, window.innerWidth - 240),
    width: Math.max(190, Math.min(260, r.width + 60)),
  }
  menuOpen.value = true
  query.value = ''
  document.addEventListener('mousedown', onDocDown)
  void nextTick(() => searchRef.value?.focus())
}

function closeMenu() {
  menuOpen.value = false
  document.removeEventListener('mousedown', onDocDown)
}

function pick(id: string | null) {
  if (props.field.type === 'multiSelect') {
    if (id == null) return
    const cur = new Set(multiIds.value)
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    emit('update', [...cur])
    return
  }
  emit('update', id)
  closeMenu()
}

function createFromQuery() {
  const name = query.value.trim()
  if (!name) return
  emit('create-option', name)
  query.value = ''
}

/* 新增选项后自动选中它（由父组件把新选项回传给当前单元格） */
function autoPickNew() {
  const latest = options.value[options.value.length - 1]
  if (!latest) return
  if (props.field.type === 'multiSelect') {
    const cur = new Set(multiIds.value)
    cur.add(latest.id)
    emit('update', [...cur])
  } else {
    emit('update', latest.id)
  }
}

watch(
  () => props.value,
  () => {
    if (props.field.type === 'select') closeMenu()
  },
)

function onDocDown(e: MouseEvent) {
  if (!menuOpen.value) return
  const el = document.querySelector('.db-opt-pop')
  if (el && !el.contains(e.target as Node) && !cellEl.value?.contains(e.target as Node)) {
    closeMenu()
  }
}
// 只有打开浮层时才挂全局监听，避免一屏几十个单元格各挂一个
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown))

defineExpose({ autoPickNew })
</script>

<template>
  <div ref="cellEl" class="db-cell" :class="`t-${field.type}`">
    <!-- 复选框 -->
    <template v-if="field.type === 'checkbox'">
      <button
        class="db-check"
        :class="{ on: !!value }"
        :disabled="readonly"
        @mousedown.stop
        @click.stop="toggleCheck"
      >
        <Check v-if="value" :size="12" :stroke-width="3" />
      </button>
    </template>

    <!-- 日期 -->
    <template v-else-if="field.type === 'date'">
      <label class="db-date" @mousedown.stop>
        <span v-if="dateLabel" class="db-date-label">{{ dateLabel }}</span>
        <span v-else class="db-placeholder">—</span>
        <input type="date" :value="dateValue" :disabled="readonly" @change="commitDate" />
      </label>
    </template>

    <!-- 单选 -->
    <template v-else-if="field.type === 'select'">
      <button class="db-tag-trigger" :disabled="readonly" @mousedown.stop @click="openMenu">
        <span v-if="selected" class="gn-tag" :data-color="selected.color">{{ selected.name }}</span>
        <span v-else class="db-placeholder">—</span>
      </button>
    </template>

    <!-- 多选 -->
    <template v-else-if="field.type === 'multiSelect'">
      <button class="db-tag-trigger multi" :disabled="readonly" @mousedown.stop @click="openMenu">
        <span
          v-for="o in multiSelected"
          :key="o.id"
          class="gn-tag"
          :data-color="o.color"
          >{{ o.name }}</span
        >
        <span v-if="!multiSelected.length" class="db-placeholder">—</span>
      </button>
    </template>

    <!-- 链接 -->
    <template v-else-if="field.type === 'url'">
      <div class="db-url" @mousedown.stop>
        <input
          class="db-input"
          :value="textValue"
          :disabled="readonly"
          placeholder="—"
          @change="commitText"
          @keydown.stop
        />
        <a
          v-if="textValue"
          class="db-url-open"
          :href="textValue"
          target="_blank"
          rel="noopener noreferrer"
          title="打开链接"
          @mousedown.stop
          @click.stop
        >
          <ExternalLink :size="12" />
        </a>
      </div>
    </template>

    <!-- 数字 -->
    <template v-else-if="field.type === 'number'">
      <input
        class="db-input num"
        type="text"
        inputmode="decimal"
        :value="textValue"
        :disabled="readonly"
        placeholder="—"
        @change="commitText"
        @keydown.stop
        @mousedown.stop
      />
    </template>

    <!-- 文本 -->
    <template v-else>
      <input
        class="db-input"
        :value="textValue"
        :disabled="readonly"
        placeholder="—"
        @change="commitText"
        @keydown.stop
        @mousedown.stop
      />
    </template>

    <!-- 选项浮层 -->
    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="db-opt-pop gn-pop"
        :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px', width: menuPos.width + 'px' }"
        @mousedown.stop
      >
        <div class="db-opt-search">
          <input
            ref="searchRef"
            v-model="query"
            placeholder="搜索或新建选项"
            @keydown.stop
            @keydown.enter.prevent="canCreate ? createFromQuery() : null"
            @keydown.escape.prevent="closeMenu"
          />
        </div>
        <div class="db-opt-list">
          <button
            v-for="o in filtered"
            :key="o.id"
            class="db-opt-item"
            :class="{ on: multiIds.includes(o.id) || value === o.id }"
            @click="pick(o.id)"
          >
            <span class="gn-tag" :data-color="o.color">{{ o.name }}</span>
            <Check
              v-if="multiIds.includes(o.id) || value === o.id"
              :size="12"
              class="db-opt-check"
            />
          </button>
          <div v-if="!filtered.length && !canCreate" class="db-opt-none">没有匹配的选项</div>
        </div>
        <button v-if="canCreate" class="db-opt-create" @click="createFromQuery">
          <Plus :size="12" /> 新建 “{{ query.trim() }}”
        </button>
        <button
          v-if="field.type === 'select' && value"
          class="db-opt-clear"
          @click="pick(null)"
        >
          <X :size="12" /> 清除
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.db-cell {
  min-width: 0;
  min-height: 30px;
  display: flex;
  align-items: center;
}
.db-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  outline: none;
  background: transparent;
  color: var(--gn-text);
  font: inherit;
  font-size: 13px;
}
.db-input::placeholder {
  color: var(--gn-text-muted);
}
.db-input:focus {
  background: var(--gn-bg);
  box-shadow: inset 0 0 0 1.5px var(--gn-accent);
}
.db-input.num {
  font-variant-numeric: tabular-nums;
}
.db-placeholder {
  color: var(--gn-text-muted);
  font-size: 13px;
  padding: 0 8px;
}

/* 复选框 */
.db-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  margin-left: 8px;
  border: 1.5px solid var(--gn-border-strong);
  border-radius: 4px;
  background: var(--gn-bg);
  cursor: pointer;
  color: transparent;
  transition: all 0.12s ease;
}
.db-check:hover {
  border-color: var(--gn-accent);
}
.db-check.on {
  background: var(--gn-accent);
  border-color: var(--gn-accent);
  color: #fff;
}

/* 日期 */
.db-date {
  position: relative;
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  width: 100%;
}
.db-date:hover {
  background: var(--gn-bg-hover);
}
.db-date input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
  border: none;
}

/* 标签触发 */
.db-tag-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  width: 100%;
  min-height: 30px;
  padding: 3px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.db-tag-trigger:hover {
  background: var(--gn-bg-hover);
}

/* 链接 */
.db-url {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}
.db-url-open {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  border-radius: 4px;
  color: var(--gn-text-muted);
  flex: 0 0 auto;
}
.db-url-open:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-accent);
}

/* 选项浮层 */
.db-opt-pop {
  position: fixed;
  z-index: 1200;
  padding: 5px;
  border: 1px solid var(--gn-border);
  border-radius: 9px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
}
.db-opt-search {
  padding: 2px 2px 5px;
}
.db-opt-search input {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg-sidebar);
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.db-opt-search input:focus {
  border-color: var(--gn-accent);
}
.db-opt-list {
  max-height: 218px;
  overflow-y: auto;
}
.db-opt-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 5px 7px;
  border: none;
  border-radius: 5px;
  background: none;
  cursor: pointer;
  text-align: left;
}
.db-opt-item:hover {
  background: var(--gn-bg-hover);
}
.db-opt-item.on {
  background: var(--gn-accent-soft);
}
.db-opt-check {
  margin-left: auto;
  color: var(--gn-accent);
}
.db-opt-none {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--gn-text-muted);
  text-align: center;
}
.db-opt-create,
.db-opt-clear {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 6px 7px;
  margin-top: 3px;
  border: none;
  border-top: 1px solid var(--gn-border);
  border-radius: 0 0 5px 5px;
  background: none;
  color: var(--gn-accent);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.db-opt-create:hover,
.db-opt-clear:hover {
  background: var(--gn-accent-soft);
}
.db-opt-clear {
  color: var(--gn-text-soft);
  border-top: none;
  margin-top: 0;
}
</style>
