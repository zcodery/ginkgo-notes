<script setup lang="ts">
import { computed } from 'vue'
import { X, Trash2 } from 'lucide-vue-next'
import type { Database, DbField, DbRow } from '@/types'
import { FIELD_TYPE_META } from './dbFields'
import DbCell from './DbCell.vue'

const props = defineProps<{
  db: Database
  row: DbRow | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update-cell', fieldId: string, value: unknown): void
  (e: 'create-option', fieldId: string, name: string): void
  (e: 'delete'): void
  (e: 'close'): void
}>()

const titleField = computed<DbField | undefined>(
  () => props.db.fields.find((f) => f.type === 'text') ?? props.db.fields[0],
)

function onCreateOption(field: DbField, name: string) {
  emit('create-option', field.id, name)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="row" class="rs-mask" @mousedown.self="emit('close')">
      <div class="rs-panel" @mousedown.stop>
        <header class="rs-head">
          <span class="rs-badge">{{ db.icon || '🗂️' }} {{ db.title }}</span>
          <button class="rs-close" v-tooltip="'关闭'" @click="emit('close')"><X :size="15" /></button>
        </header>

        <div class="rs-body gn-scroll">
          <div class="rs-title">
            <DbCell
              v-if="titleField"
              :field="titleField"
              :value="row.cells[titleField.id]"
              :readonly="readonly"
              @update="(v: unknown) => titleField && emit('update-cell', titleField.id, v)"
            />
          </div>

          <div class="rs-fields">
            <div v-for="f in db.fields" :key="f.id" class="rs-field">
              <div class="rs-label">
                <component :is="FIELD_TYPE_META[f.type].icon" :size="12" />
                <span>{{ f.name }}</span>
              </div>
              <div class="rs-value">
                <DbCell
                  :field="f"
                  :value="row.cells[f.id]"
                  :readonly="readonly"
                  @update="(v: unknown) => emit('update-cell', f.id, v)"
                  @create-option="(name: string) => onCreateOption(f, name)"
                />
              </div>
            </div>
          </div>
        </div>

        <footer class="rs-foot">
          <button v-if="!readonly" class="rs-del" @click="emit('delete'); emit('close')">
            <Trash2 :size="13" /> 删除这一行
          </button>
          <span class="rs-hint">{{ readonly ? '页面已锁定，仅可查看' : '改动即时保存' }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rs-mask {
  position: fixed;
  inset: 0;
  z-index: 950;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 22, 21, 0.36);
  backdrop-filter: blur(1.5px);
}
.rs-panel {
  width: min(560px, 92vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--gn-bg);
  box-shadow: var(--gn-shadow-lg);
  overflow: hidden;
}
.rs-head {
  display: flex;
  align-items: center;
  padding: 9px 10px 9px 14px;
  border-bottom: 1px solid var(--gn-border);
}
.rs-badge {
  font-size: 11.5px;
  color: var(--gn-text-muted);
  padding: 2px 7px;
  border-radius: 20px;
  background: var(--gn-bg-sidebar);
}
.rs-close {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-text-soft);
  cursor: pointer;
}
.rs-close:hover {
  background: var(--gn-bg-hover);
}
.rs-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 10px;
}
.rs-title {
  font-size: 19px;
  font-weight: 650;
  margin-bottom: 14px;
}
.rs-title :deep(.db-input) {
  font-size: 19px;
  font-weight: 650;
  height: 34px;
  padding: 0 4px;
}
.rs-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rs-field {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  border-radius: 6px;
}
.rs-field:hover {
  background: color-mix(in srgb, var(--gn-bg-hover) 50%, transparent);
}
.rs-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
  font-size: 12.5px;
  color: var(--gn-text-muted);
}
.rs-value {
  min-width: 0;
}
.rs-foot {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  border-top: 1px solid var(--gn-border);
}
.rs-del {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gn-danger);
  font-size: 12.5px;
  cursor: pointer;
}
.rs-del:hover {
  background: color-mix(in srgb, var(--gn-danger) 10%, transparent);
}
.rs-hint {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
</style>
