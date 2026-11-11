<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

export interface GnSelectOption {
  value: string
  label: string
  style?: Record<string, string>
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: GnSelectOption[]
    disabled?: boolean
    /** 触发器最小宽度 */
    minWidth?: number
  }>(),
  { disabled: false, minWidth: 108 },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const label = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue,
)

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

function pick(v: string) {
  emit('update:modelValue', v)
  open.value = false
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (rootRef.value?.contains(t)) return
  open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true))
</script>

<template>
  <div ref="rootRef" class="gn-select" :class="{ open, disabled }">
    <button
      type="button"
      class="gn-select-trigger"
      :style="{ minWidth: minWidth + 'px' }"
      :disabled="disabled"
      @click="toggle"
    >
      <span>{{ label }}</span>
      <ChevronDown :size="13" :stroke-width="2" />
    </button>
    <div v-if="open" class="gn-select-list gn-pop">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="gn-select-opt"
        :class="{ on: opt.value === modelValue }"
        :style="opt.style"
        @click="pick(opt.value)"
      >
        <span>{{ opt.label }}</span>
        <Check v-if="opt.value === modelValue" :size="13" :stroke-width="2.2" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.gn-select {
  position: relative;
  flex: 0 0 auto;
}
.gn-select-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  background: var(--gn-bg);
  color: var(--gn-text);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.gn-select-trigger:hover:not(:disabled),
.gn-select.open .gn-select-trigger {
  background: var(--gn-bg-hover);
  border-color: var(--gn-border-strong);
}
.gn-select-trigger:disabled {
  color: var(--gn-text-muted);
  cursor: not-allowed;
  opacity: 0.7;
}
.gn-select-trigger span {
  flex: 1 1 auto;
  text-align: left;
  white-space: nowrap;
}
.gn-select-trigger :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.14s ease;
}
.gn-select.open .gn-select-trigger :deep(svg) {
  transform: rotate(180deg);
}
.gn-select-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  min-width: 100%;
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
}
.gn-select-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.gn-select-opt span {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
}
.gn-select-opt:hover {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.gn-select-opt.on {
  background: var(--gn-accent-soft);
  color: var(--gn-accent);
}
</style>
