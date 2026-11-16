<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
/** 下方空间不足时向上展开（类名不能叫 invert：Tailwind 有个同名工具类会把它整块反色） */
const dropUp = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
/** 面板 fixed 定位（Teleport 到 body，避免被滚动容器裁掉） */
const panelStyle = ref<Record<string, string>>({})

const label = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue,
)

const GAP = 4
const EDGE = 8
const MAX_PANEL_H = 220

/** 面板内容高度估算：内边距 8 + 每项 28 */
function wantedHeight() {
  return Math.min(MAX_PANEL_H, props.options.length * 28 + 10)
}

function place() {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  const want = wantedHeight()
  dropUp.value = below < want && above > below
  const room = Math.max(96, dropUp.value ? above : below)
  const width = Math.max(r.width, 150)
  // 右对齐触发器，再夹到视口内
  const left = Math.min(Math.max(EDGE, r.right - width), window.innerWidth - width - EDGE)
  const style: Record<string, string> = {
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(Math.min(want, room))}px`,
  }
  if (dropUp.value) style.bottom = `${Math.round(window.innerHeight - r.top + GAP)}px`
  else style.top = `${Math.round(r.bottom + GAP)}px`
  panelStyle.value = style
}

function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  place()
  open.value = true
}

function pick(v: string) {
  emit('update:modelValue', v)
  open.value = false
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (rootRef.value?.contains(t) || panelRef.value?.contains(t)) return
  open.value = false
}

/** 浮层是 fixed 的，触发器位置一变就得重新贴上去 */
function reposition() {
  if (open.value) place()
}

function close() {
  open.value = false
}

watch(open, (v) => {
  if (v) {
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
  } else {
    window.removeEventListener('scroll', reposition, true)
    window.removeEventListener('resize', reposition)
  }
})

// 选项或宽度变化时（例如窗口缩放后）保证面板不跑偏
watch(
  () => props.options.length,
  () => {
    if (open.value) void nextTick(place)
  },
)

onMounted(() => document.addEventListener('mousedown', onDocDown, true))

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  window.removeEventListener('scroll', reposition, true)
  window.removeEventListener('resize', reposition)
})
</script>

<template>
  <div ref="rootRef" class="gn-select" :class="{ open, disabled }">
    <button
      ref="triggerRef"
      type="button"
      class="gn-select-trigger"
      :style="{ minWidth: minWidth + 'px' }"
      :disabled="disabled"
      @click="toggle"
      @keydown.esc.stop="close"
    >
      <span>{{ label }}</span>
      <ChevronDown :size="13" :stroke-width="2" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="gn-select-list gn-pop"
        :class="{ 'is-up': dropUp }"
        :style="panelStyle"
      >
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
    </Teleport>
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
  position: fixed;
  z-index: 1200;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.gn-select-list:hover {
  scrollbar-color: var(--gn-border-strong) transparent;
}
.gn-select-list::-webkit-scrollbar {
  width: 6px;
}
.gn-select-list::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: transparent;
}
.gn-select-list:hover::-webkit-scrollbar-thumb {
  background: var(--gn-border-strong);
}
.gn-select-list::-webkit-scrollbar-track {
  background: transparent;
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
  overflow: hidden;
  text-overflow: ellipsis;
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
