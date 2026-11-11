<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  ChevronLeft,
  EyeOff,
  Plus,
  Trash2,
  ArrowLeftToLine,
  ArrowRightToLine,
  Palette,
} from 'lucide-vue-next'
import type { DbField, FieldOption, FieldType } from '@/types'
import { FIELD_TYPE_META, FIELD_TYPE_ORDER, OPTION_COLORS } from './dbFields'

const props = defineProps<{
  field: DbField
  /** 是否是唯一剩下的字段（不允许删除） */
  isLast?: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'update', patch: Partial<DbField>): void
  (e: 'delete'): void
  (e: 'insert', side: 'left' | 'right'): void
  (e: 'hide'): void
  (e: 'close'): void
}>()

const view = ref<'main' | 'options'>('main')

const meta = computed(() => FIELD_TYPE_META[props.field.type])

function rename(e: Event) {
  const name = (e.target as HTMLInputElement).value.trim()
  emit('update', { name: name || props.field.name })
}

function changeType(type: FieldType) {
  if (type === props.field.type) return
  const patch: Partial<DbField> = { type }
  // 换成单选/多选时补上默认选项；其它类型保留原 options 以便换回来
  if ((type === 'select' || type === 'multiSelect') && !props.field.options?.length) {
    patch.options = [
      { id: 'o_' + Math.random().toString(36).slice(2, 10), name: '选项 1', color: 'blue' },
      { id: 'o_' + Math.random().toString(36).slice(2, 10), name: '选项 2', color: 'green' },
    ]
  }
  emit('update', patch)
}

/* ---------------- 选项编辑 ---------------- */

function addOption() {
  const opts = [...(props.field.options ?? [])]
  const color = OPTION_COLORS[opts.length % OPTION_COLORS.length]
  opts.push({
    id: 'o_' + Math.random().toString(36).slice(2, 10),
    name: `选项 ${opts.length + 1}`,
    color,
  })
  emit('update', { options: opts })
}

function renameOption(opt: FieldOption, e: Event) {
  const name = (e.target as HTMLInputElement).value.trim()
  if (!name) return
  const opts = (props.field.options ?? []).map((o) => (o.id === opt.id ? { ...o, name } : o))
  emit('update', { options: opts })
}

function recolorOption(opt: FieldOption) {
  const idx = OPTION_COLORS.indexOf(opt.color as any)
  const color = OPTION_COLORS[(idx + 1) % OPTION_COLORS.length]
  const opts = (props.field.options ?? []).map((o) => (o.id === opt.id ? { ...o, color } : o))
  emit('update', { options: opts })
}

function removeOption(opt: FieldOption) {
  const opts = (props.field.options ?? []).filter((o) => o.id !== opt.id)
  emit('update', { options: opts })
}
</script>

<template>
  <div
    class="fm-pop gn-pop"
    :style="{ top: y + 'px', left: x + 'px' }"
    @mousedown.stop
    @click.stop
  >
    <!-- 主面板 -->
    <template v-if="view === 'main'">
      <div class="fm-fname">
        <input :value="field.name" placeholder="字段名" @keydown.stop @change="rename" />
      </div>

      <div class="fm-types">
        <div class="fm-label">字段类型</div>
        <div class="fm-type-grid">
          <button
            v-for="t in FIELD_TYPE_ORDER"
            :key="t"
            class="fm-type"
            :class="{ on: field.type === t }"
            @click="changeType(t)"
          >
            <component :is="FIELD_TYPE_META[t].icon" :size="13" />
            <span>{{ FIELD_TYPE_META[t].label }}</span>
            <Check v-if="field.type === t" :size="11" class="fm-type-check" />
          </button>
        </div>
        <div class="fm-hint">{{ meta.hint }}</div>
      </div>

      <button
        v-if="field.type === 'select' || field.type === 'multiSelect'"
        class="fm-row"
        @click="view = 'options'"
      >
        <Palette :size="13" />
        <span>管理选项</span>
        <span class="fm-count">{{ field.options?.length ?? 0 }}</span>
        <ChevronLeft :size="12" class="fm-arrow" />
      </button>

      <div class="fm-divider"></div>

      <button class="fm-row" @click="emit('insert', 'left')">
        <ArrowLeftToLine :size="13" /><span>向左插入字段</span>
      </button>
      <button class="fm-row" @click="emit('insert', 'right')">
        <ArrowRightToLine :size="13" /><span>向右插入字段</span>
      </button>
      <button class="fm-row" @click="emit('hide')">
        <EyeOff :size="13" /><span>隐藏这一列</span>
      </button>
      <button class="fm-row danger" :disabled="isLast" @click="emit('delete')">
        <Trash2 :size="13" /><span>删除字段</span>
      </button>
    </template>

    <!-- 选项面板 -->
    <template v-else>
      <div class="fm-opts-head">
        <button class="fm-back" @click="view = 'main'"><ChevronLeft :size="14" /></button>
        <span>选项</span>
      </div>
      <div class="fm-opts">
        <div v-for="o in field.options" :key="o.id" class="fm-opt">
          <button
            class="fm-opt-color"
            :data-color="o.color"
            title="点击换颜色"
            @click="recolorOption(o)"
          ></button>
          <input :value="o.name" @keydown.stop @change="renameOption(o, $event)" />
          <button class="fm-opt-del" title="删除选项" @click="removeOption(o)">
            <Trash2 :size="12" />
          </button>
        </div>
        <div v-if="!field.options?.length" class="fm-opts-none">还没有选项</div>
      </div>
      <button class="fm-add-opt" @click="addOption"><Plus :size="12" /> 添加选项</button>
    </template>
  </div>
</template>

<style scoped>
.fm-pop {
  position: fixed;
  z-index: 1300;
  width: 268px;
  padding: 7px;
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  font-size: 12.5px;
}
.fm-fname input {
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 13px;
  font-weight: 600;
  outline: none;
}
.fm-fname input:focus {
  border-color: var(--gn-accent);
}
.fm-types {
  margin-top: 9px;
}
.fm-label {
  font-size: 11px;
  color: var(--gn-text-muted);
  padding: 0 3px 5px;
}
.fm-type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
}
.fm-type {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.fm-type:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.fm-type.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
  font-weight: 550;
}
.fm-type-check {
  margin-left: auto;
}
.fm-hint {
  padding: 5px 4px 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--gn-text-muted);
}
.fm-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--gn-border);
}
.fm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.fm-row:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.fm-row.danger {
  color: var(--gn-danger);
}
.fm-row.danger:hover {
  background: color-mix(in srgb, var(--gn-danger) 10%, transparent);
}
.fm-row:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.fm-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--gn-text-muted);
}
.fm-arrow {
  transform: rotate(180deg);
  color: var(--gn-text-muted);
}
.fm-arrow,
.fm-count + .fm-arrow {
  margin-left: 0;
}
.fm-row .fm-count {
  margin-left: auto;
}

/* 选项面板 */
.fm-opts-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 8px;
  font-weight: 600;
  font-size: 12.5px;
}
.fm-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--gn-text-soft);
  cursor: pointer;
}
.fm-back:hover {
  background: var(--gn-bg-hover);
}
.fm-opts {
  max-height: 260px;
  overflow-y: auto;
}
.fm-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.fm-opt-color {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border: none;
  border-radius: 50%;
  background: #b9b9b3;
  cursor: pointer;
}
.fm-opt-color[data-color='gray'] {
  background: #8a8a84;
}
.fm-opt-color[data-color='brown'] {
  background: #9a7355;
}
.fm-opt-color[data-color='orange'] {
  background: #c97b34;
}
.fm-opt-color[data-color='yellow'] {
  background: #c2a02a;
}
.fm-opt-color[data-color='green'] {
  background: #3f8462;
}
.fm-opt-color[data-color='blue'] {
  background: #3e78b0;
}
.fm-opt-color[data-color='purple'] {
  background: #7a5bb5;
}
.fm-opt-color[data-color='pink'] {
  background: #c05a8c;
}
.fm-opt-color[data-color='red'] {
  background: #c44a4a;
}
.fm-opt input {
  flex: 1 1 auto;
  min-width: 0;
  height: 27px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text);
  font-size: 12.5px;
  outline: none;
}
.fm-opt input:hover {
  background: var(--gn-bg-hover);
}
.fm-opt input:focus {
  background: var(--gn-bg);
  border-color: var(--gn-accent);
}
.fm-opt-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--gn-text-muted);
  cursor: pointer;
  opacity: 0;
}
.fm-opt:hover .fm-opt-del {
  opacity: 1;
}
.fm-opt-del:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-danger);
}
.fm-opts-none {
  padding: 12px 0;
  text-align: center;
  color: var(--gn-text-muted);
  font-size: 12px;
}
.fm-add-opt {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 6px 8px;
  margin-top: 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--gn-accent);
  font-size: 12.5px;
  cursor: pointer;
}
.fm-add-opt:hover {
  background: var(--gn-accent-soft);
}
</style>
