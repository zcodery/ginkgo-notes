<script lang="ts">
/** 级联选项：children 为空（或不存在）即为叶子 */
export interface GnCascadeOption {
  value: string
  label: string
  disabled?: boolean
  children?: GnCascadeOption[]
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronRight } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 顶层选项，子级通过 children 嵌套 */
    options: GnCascadeOption[]
    disabled?: boolean
    /** 没有任何匹配时触发器里显示的文字 */
    placeholder?: string
    /** 触发器最小宽度 */
    minWidth?: number
    /** 多级路径拼接用的分隔符 */
    separator?: string
    /** 面板单列宽度 */
    columnWidth?: number
  }>(),
  {
    disabled: false,
    placeholder: '请选择',
    minWidth: 140,
    separator: ' / ',
    columnWidth: 152,
  },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
/** 下方空间不足时向上展开（别叫 invert：Tailwind 有同名工具类会整块反色） */
const dropUp = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
/** 面板 fixed 定位（Teleport 到 body，避免被滚动容器裁掉） */
const panelStyle = ref<Record<string, string>>({})
/** 上翻时的固定顶边：展开子级只往下长，整列不会带着鼠标下的选项一起上移 */
const anchorTop = ref(0)
/** 触发器贴着右边、右边放不下整棵树时改为向左长列（首列位置不动，子列往左排） */
const flipX = ref(false)
/** 单列宽度 / 单列最大高度，由 place() 按视口算出来 */
const colWidth = ref(props.columnWidth)
const colMaxH = ref(240)

/** 每一列当前高亮的下标链；列数由它推导 */
const trail = ref<number[]>([])

const GAP = 4
const EDGE = 8
const ROW_H = 28
const PAD = 4
const MAX_H = 248

const kidsOf = (o: GnCascadeOption | undefined) => (o?.children?.length ? o.children : null)

/** 当前该展示的列：第 k 列由 trail[k-1] 那一项的子级决定 */
const columns = computed<GnCascadeOption[][]>(() => {
  const cols: GnCascadeOption[][] = [props.options]
  for (let k = 0; k < trail.value.length; k++) {
    const kids = kidsOf(cols[k]?.[trail.value[k]!])
    if (!kids) break
    cols.push(kids)
  }
  return cols
})

/** 当前高亮的那一项（回车时选它） */
const picked = computed<GnCascadeOption | null>(() => {
  const k = trail.value.length - 1
  if (k < 0) return null
  return columns.value[k]?.[trail.value[k]!] ?? null
})

/** 渲染顺序：向左长列时列要反过来排，浅层始终贴着触发器 */
const displayCols = computed(() => {
  const list = columns.value.map((items, idx) => ({ items, idx }))
  return flipX.value ? [...list].reverse() : list
})

/** 整棵树最深几层，用来决定往左还是往右长 */
function treeDepth(list: GnCascadeOption[]): number {
  let max = 1
  for (const o of list) {
    max = Math.max(max, 1 + (o.children?.length ? treeDepth(o.children) : 0))
  }
  return max
}

function findChain(list: GnCascadeOption[], value: string, acc: GnCascadeOption[] = []): GnCascadeOption[] | null {
  for (const o of list) {
    const next = [...acc, o]
    if (o.value === value) return next
    const hit = kidsOf(o) && findChain(o.children!, value, next)
    if (hit) return hit
  }
  return null
}

const chain = computed(() => findChain(props.options, props.modelValue))
const label = computed(() => {
  const ch = chain.value
  if (!ch) return props.modelValue || props.placeholder
  const names = ch.map((o) => o.label)
  // 层数多时只留最后两段，否则触发器里一路省略号、连名字都看不见
  if (names.length <= 2) return names.join(props.separator)
  return `…${props.separator}${names.slice(-2).join(props.separator)}`
})
/** 完整路径，供 tooltip 之类的场景取用 */
const pathText = computed(() => chain.value?.map((o) => o.label).join(props.separator) ?? '')

/** 打开时把高亮链定位到当前取值，免得每次从头翻 */
function resetTrail() {
  const ch = chain.value
  if (!ch) {
    trail.value = []
    return
  }
  const idx: number[] = []
  let list = props.options
  for (const opt of ch) {
    const i = list.indexOf(opt)
    if (i < 0) break
    idx.push(i)
    list = opt.children ?? []
  }
  trail.value = idx
}

function place(initial = false) {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const cols = Math.max(1, columns.value.length)
  const depth = Math.max(1, treeDepth(props.options))
  if (initial) {
    // 右边放不下整棵树就改向左长列；决定一次，之后展开子级不再横向跳
    flipX.value = r.left + depth * props.columnWidth + PAD * 2 + EDGE > window.innerWidth
  }
  // 列宽按「整棵树最深层数」一次算定，展开子级时不再变，鼠标下的选项也就不会被挤走
  const cap = flipX.value ? r.right - EDGE : window.innerWidth - EDGE - r.left
  colWidth.value = Math.max(96, Math.min(props.columnWidth, Math.floor((cap - PAD * 2) / depth)))
  const width = colWidth.value * cols + PAD * 2
  const rows = Math.max(...columns.value.map((c) => c.length), 1)
  const want = Math.min(MAX_H, rows * ROW_H + PAD * 2)
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  if (initial) {
    dropUp.value = below < want && above > below
    // 上翻：一次定住顶边，后续展开子级只增高，不下移
    anchorTop.value = dropUp.value ? Math.max(EDGE, r.top - GAP - want) : r.bottom + GAP
  }
  const room = dropUp.value
    ? Math.min(MAX_H, window.innerHeight - EDGE - anchorTop.value)
    : Math.min(MAX_H, Math.max(120, below))
  colMaxH.value = room - PAD * 2
  const style: Record<string, string> = {
    width: `${Math.round(width)}px`,
    top: `${Math.round(dropUp.value ? anchorTop.value : r.bottom + GAP)}px`,
    maxHeight: `${Math.round(room)}px`,
  }
  if (flipX.value) {
    // 右边缘贴触发器右边缘，宽度增长时向左长（首列不动）
    style.right = `${Math.round(window.innerWidth - r.right)}px`
  } else {
    // 左对齐触发器，再夹到视口里
    const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE)
    style.left = `${Math.round(left)}px`
  }
  panelStyle.value = style
}

function scrollActive() {
  nextTick(() => {
    const cols = panelRef.value?.querySelectorAll('.gc-col')
    if (!cols) return
    cols.forEach((col) => col.querySelector<HTMLElement>('.gc-opt.hl')?.scrollIntoView({ block: 'nearest' }))
  })
}

function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  resetTrail()
  place(true)
  open.value = true
  scrollActive()
}

function close() {
  open.value = false
}

function pick(opt: GnCascadeOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  close()
  triggerRef.value?.focus()
}

/** 悬停/键盘移动：截断该列之后的高亮，再重新挂上 */
function focusCell(ci: number, oi: number) {
  const next = trail.value.slice(0, ci)
  next[ci] = oi
  trail.value = next
  scrollActive()
}

/** 键盘落在哪一列：子级列已经展开时先走子级列 */
const activeCol = computed(() =>
  columns.value.length > trail.value.length ? columns.value.length - 1 : Math.max(0, trail.value.length - 1),
)

function move(delta: number) {
  if (!open.value) {
    toggle()
    return
  }
  const ci = activeCol.value
  const list = columns.value[ci] ?? []
  if (!list.length) return
  const cur = trail.value[ci] ?? (delta > 0 ? -1 : 0)
  const next = Math.min(Math.max(cur + delta, 0), list.length - 1)
  focusCell(ci, next)
}

function deeper() {
  if (!open.value) {
    toggle()
    return
  }
  const item = columns.value[activeCol.value]?.[trail.value[activeCol.value]!]
  if (kidsOf(item)) focusCell(activeCol.value, trail.value[activeCol.value]!)
}

function shallower() {
  if (!open.value || !trail.value.length) return
  trail.value = trail.value.slice(0, -1)
}

function onKey(e: KeyboardEvent) {
  if (props.disabled) return
  const map: Record<string, () => void> = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    ArrowRight: deeper,
    ArrowLeft: shallower,
    Enter: () => (open.value && picked.value ? pick(picked.value) : toggle()),
    ' ': () => (open.value && picked.value ? pick(picked.value) : toggle()),
    Escape: close,
  }
  const fn = map[e.key]
  if (!fn) return
  e.preventDefault()
  fn()
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (rootRef.value?.contains(t) || panelRef.value?.contains(t)) return
  open.value = false
}

function reposition() {
  if (open.value) place()
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

// 展开/收起子级列会改面板宽度，跟着重新定位
watch(
  () => columns.value.length,
  () => {
    if (open.value) void nextTick(place)
  },
)

// 外部改了取值（比如换团队后重置）时，若面板开着就同步高亮
watch(
  () => props.modelValue,
  () => {
    if (open.value) {
      resetTrail()
      scrollActive()
    }
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
  <div ref="rootRef" class="gn-cascader" :class="{ open, disabled }">
    <button
      ref="triggerRef"
      type="button"
      class="gc-trigger"
      :style="{ minWidth: minWidth + 'px' }"
      :disabled="disabled"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="pathText || placeholder"
      @click="toggle"
      @keydown="onKey"
    >
      <span class="gc-label">{{ label }}</span>
      <ChevronDown :size="13" :stroke-width="2" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="gc-panel gn-pop"
        :class="{ 'is-up': dropUp }"
        :style="panelStyle"
      >
        <div
          v-for="col in displayCols"
          :key="col.idx"
          class="gc-col"
          :style="{ width: colWidth + 'px', maxHeight: colMaxH + 'px' }"
        >
          <button
            v-for="(opt, oi) in col.items"
            :key="opt.value"
            type="button"
            class="gc-opt"
            :class="{ on: opt.value === modelValue, hl: trail[col.idx] === oi }"
            :disabled="opt.disabled"
            @mousedown.prevent
            @mouseenter="focusCell(col.idx, oi)"
            @click="pick(opt)"
          >
            <span class="gc-opt-text">{{ opt.label }}</span>
            <Check v-if="opt.value === modelValue" :size="13" :stroke-width="2.2" />
            <ChevronRight v-else-if="opt.children?.length" :size="13" class="gc-more" />
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gn-cascader {
  position: relative;
  flex: 0 0 auto;
}
.gc-trigger {
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
.gc-trigger:hover:not(:disabled),
.gn-cascader.open .gc-trigger {
  background: var(--gn-bg-hover);
  border-color: var(--gn-border-strong);
}
.gc-trigger:disabled {
  color: var(--gn-text-muted);
  cursor: not-allowed;
  opacity: 0.7;
}
.gc-label {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 220px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gc-trigger :deep(svg) {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
  transition: transform 0.14s ease;
}
.gn-cascader.open .gc-trigger :deep(svg) {
  transform: rotate(180deg);
}
.gc-panel {
  position: fixed;
  z-index: 1200;
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 4px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
  overflow: hidden;
}
.gc-col {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1px;
  border-radius: 5px;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.gc-col:hover {
  scrollbar-color: var(--gn-border-strong) transparent;
}
.gc-col + .gc-col {
  border-left: 1px solid var(--gn-border-soft, var(--gn-border));
}
.gc-col::-webkit-scrollbar {
  width: 6px;
}
.gc-col::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: transparent;
}
.gc-col:hover::-webkit-scrollbar-thumb {
  background: var(--gn-border-strong);
}
.gc-col::-webkit-scrollbar-track {
  background: transparent;
}
.gc-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
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
.gc-opt-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gc-opt :deep(svg) {
  flex: 0 0 auto;
}
.gc-more {
  color: var(--gn-text-muted);
}
.gc-opt.hl {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.gc-opt.on {
  color: var(--gn-accent);
  font-weight: 500;
}
.gc-opt.on.hl {
  background: var(--gn-accent-soft);
}
.gc-opt:disabled {
  color: var(--gn-text-muted);
  cursor: not-allowed;
}
</style>
