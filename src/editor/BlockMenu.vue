<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Copy,
  Scissors,
  CopyPlus,
  FileSymlink,
  Repeat2,
  Link,
  Trash2,
  CornerUpRight,
  Baseline,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Check,
  Search,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
} from 'lucide-vue-next'
import { COLOR_PRESETS } from './marks/colors'
import PageIcon from '@/components/PageIcon.vue'

export interface BlockMenuInfo {
  /** 当前块类型，用于「转换为」打勾：paragraph / h1…h4 / bulletList / … */
  currentType: string
  canTurn: boolean
  canColor: boolean
  charCount: number
  editorName: string
  editedAt: string
}

export interface BlockMenuPage {
  id: string
  title: string
  icon: string
}

type SubKey = 'turn' | 'color' | 'move' | 'copyTo'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  info: BlockMenuInfo
  pages: BlockMenuPage[]
}>()

const emit = defineEmits<{ (e: 'action', type: string): void }>()

const style = computed(() => ({ left: `${props.x}px`, top: `${props.y}px` }))

const sub = ref<SubKey | null>(null)
const subRef = ref<HTMLElement | null>(null)
const subShift = ref(0)
const pageQuery = ref('')
const searchRef = ref<HTMLInputElement | null>(null)
const copyRowRef = ref<HTMLElement | null>(null)
const moveRowRef = ref<HTMLElement | null>(null)
const pickerTop = ref(0)

const turnInto = [
  { type: 'paragraph', label: '正文', icon: Type },
  { type: 'h1', label: '标题1', icon: Heading1 },
  { type: 'h2', label: '标题2', icon: Heading2 },
  { type: 'h3', label: '标题3', icon: Heading3 },
  { type: 'h4', label: '标题4', icon: Heading4 },
  { type: 'taskList', label: '待办列表', icon: ListChecks },
  { type: 'bulletList', label: '项目列表', icon: List },
  { type: 'orderedList', label: '编号列表', icon: ListOrdered },
  { type: 'blockquote', label: '引用', icon: Quote },
  { type: 'codeBlock', label: '代码块', icon: Code2 },
]

const filteredPages = computed(() => {
  const q = pageQuery.value.trim().toLowerCase()
  const list = q
    ? props.pages.filter((p) => (p.title || '未命名').toLowerCase().includes(q))
    : props.pages
  return list.slice(0, 50)
})

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      sub.value = null
      pageQuery.value = ''
    }
  },
)

/** 子菜单贴着视口底部时整体上移，避免被截掉 */
async function fitSub() {
  subShift.value = 0
  await nextTick()
  const el = subRef.value
  if (!el) return
  const overflow = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
  if (overflow > 0) subShift.value = -overflow
}

function openSub(key: SubKey | null) {
  if (sub.value === key) return
  sub.value = key
  pageQuery.value = ''
  if (!key) return
  if (key === 'move' || key === 'copyTo') {
    const row = key === 'move' ? moveRowRef.value : copyRowRef.value
    pickerTop.value = (row?.offsetTop ?? 0) - 5
    void nextTick(() => searchRef.value?.focus())
  }
  void fitSub()
}

function act(type: string) {
  emit('action', type)
}

function pickPage(id: string) {
  act(`${sub.value === 'copyTo' ? 'copyTo' : 'moveTo'}:${id}`)
}

function onSearchEnter() {
  const first = filteredPages.value[0]
  if (first) pickPage(first.id)
}

function fontSwatch(swatch: string) {
  return { color: swatch }
}

function bgSwatch(swatch: string) {
  return { background: `color-mix(in srgb, ${swatch} 26%, var(--gn-bg))` }
}

defineExpose({ openSub })
</script>

<template>
  <div v-if="visible" class="block-menu gn-pop" :style="style">
    <div class="bm-group">
      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('copy')">
        <Copy :size="15" :stroke-width="1.8" /><span class="bm-label">复制</span>
        <kbd>Ctrl+C</kbd>
      </button>
      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('cut')">
        <Scissors :size="15" :stroke-width="1.8" /><span class="bm-label">剪切</span>
        <kbd>Ctrl+X</kbd>
      </button>
      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('duplicate')">
        <CopyPlus :size="15" :stroke-width="1.8" /><span class="bm-label">创建副本</span>
        <kbd>Ctrl+D</kbd>
      </button>

      <div ref="copyRowRef" class="bm-row" @mouseenter="openSub('copyTo')">
        <button
          class="bm-item"
          :class="{ open: sub === 'copyTo' }"
          @mousedown.prevent
          @click="openSub('copyTo')"
        >
          <FileSymlink :size="15" :stroke-width="1.8" /><span class="bm-label">复制并移动到页面</span>
          <ChevronRight class="bm-arrow" :size="14" :stroke-width="1.8" />
        </button>
      </div>

      <div class="bm-row" @mouseenter="openSub(info.canTurn ? 'turn' : null)">
        <button
          class="bm-item"
          :class="{ open: sub === 'turn' }"
          :disabled="!info.canTurn"
          @mousedown.prevent
          @click="openSub('turn')"
        >
          <Repeat2 :size="15" :stroke-width="1.8" /><span class="bm-label">转换为</span>
          <ChevronRight class="bm-arrow" :size="14" :stroke-width="1.8" />
        </button>
        <div
          v-if="sub === 'turn'"
          ref="subRef"
          class="bm-sub gn-pop"
          :style="{ transform: `translateY(${subShift}px)` }"
        >
          <button
            v-for="t in turnInto"
            :key="t.type"
            class="bm-item"
            @mousedown.prevent="act('turn:' + t.type)"
          >
            <component :is="t.icon" :size="15" :stroke-width="1.8" />
            <span class="bm-label">{{ t.label }}</span>
            <Check v-if="info.currentType === t.type" class="bm-check" :size="14" :stroke-width="2" />
          </button>
        </div>
      </div>

      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('copyLink')">
        <Link :size="15" :stroke-width="1.8" /><span class="bm-label">复制块链接</span>
        <kbd>F</kbd>
      </button>
      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('delete')">
        <Trash2 :size="15" :stroke-width="1.8" /><span class="bm-label">删除</span>
        <kbd>Del</kbd>
      </button>
    </div>

    <div class="bm-group">
      <div ref="moveRowRef" class="bm-row" @mouseenter="openSub('move')">
        <button
          class="bm-item"
          :class="{ open: sub === 'move' }"
          @mousedown.prevent
          @click="openSub('move')"
        >
          <CornerUpRight :size="15" :stroke-width="1.8" /><span class="bm-label">移动到</span>
          <kbd>Ctrl+Shift+P</kbd>
        </button>
      </div>
    </div>

    <div class="bm-group">
      <div class="bm-row" @mouseenter="openSub(info.canColor ? 'color' : null)">
        <button
          class="bm-item"
          :class="{ open: sub === 'color' }"
          :disabled="!info.canColor"
          @mousedown.prevent
          @click="openSub('color')"
        >
          <Baseline :size="15" :stroke-width="1.8" /><span class="bm-label">颜色</span>
          <ChevronRight class="bm-arrow" :size="14" :stroke-width="1.8" />
        </button>
        <div
          v-if="sub === 'color'"
          ref="subRef"
          class="bm-sub bm-color gn-pop"
          :style="{ transform: `translateY(${subShift}px)` }"
        >
          <div class="bm-sub-title">文字颜色</div>
          <div class="bm-swatches">
            <button class="bm-swatch" v-tooltip="'默认'" @mousedown.prevent="act('font:none')">A</button>
            <button
              v-for="c in COLOR_PRESETS"
              :key="'f-' + c.key"
              class="bm-swatch"
              v-tooltip="c.label"
              :style="fontSwatch(c.swatch)"
              @mousedown.prevent="act('font:' + c.key)"
            >
              A
            </button>
          </div>
          <div class="bm-sub-title">背景颜色</div>
          <div class="bm-swatches">
            <button class="bm-swatch bg-none" v-tooltip="'默认'" @mousedown.prevent="act('bg:none')"></button>
            <button
              v-for="c in COLOR_PRESETS"
              :key="'b-' + c.key"
              class="bm-swatch"
              v-tooltip="c.label"
              :style="bgSwatch(c.swatch)"
              @mousedown.prevent="act('bg:' + c.key)"
            ></button>
          </div>
        </div>
      </div>
    </div>

    <div class="bm-group">
      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('insertAbove')">
        <ArrowUp :size="15" :stroke-width="1.8" /><span class="bm-label">在上方插入</span>
        <kbd>A</kbd>
      </button>
      <button class="bm-item" @mouseenter="openSub(null)" @mousedown.prevent="act('insertBelow')">
        <ArrowDown :size="15" :stroke-width="1.8" /><span class="bm-label">在下方插入</span>
        <kbd>B</kbd>
      </button>
    </div>

    <div class="bm-footer" @mouseenter="openSub(null)">
      <div>块字数统计: {{ info.charCount }}</div>
      <div>最后编辑人: {{ info.editorName }}</div>
      <div v-if="info.editedAt">最后编辑于: {{ info.editedAt }}</div>
    </div>

    <!-- 页面选择器挂在菜单本身上，「复制并移动到页面」和「移动到」共用 -->
    <div
      v-if="sub === 'move' || sub === 'copyTo'"
      ref="subRef"
      class="bm-sub bm-pages gn-pop"
      :style="{ top: `${pickerTop}px`, transform: `translateY(${subShift}px)` }"
    >
      <div class="bm-search">
        <Search :size="14" :stroke-width="1.8" />
        <input
          ref="searchRef"
          v-model="pageQuery"
          :placeholder="sub === 'move' ? '移动到哪个页面…' : '复制到哪个页面…'"
          @keydown.enter.prevent="onSearchEnter"
        />
      </div>
      <div class="bm-page-list gn-scroll">
        <button
          v-for="p in filteredPages"
          :key="p.id"
          class="bm-item"
          @mousedown.prevent="pickPage(p.id)"
        >
          <PageIcon class="bm-page-icon" :icon="p.icon" :size="15" />
          <span class="bm-label">{{ p.title || '未命名' }}</span>
        </button>
        <div v-if="!filteredPages.length" class="bm-empty">没有可选的页面</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block-menu {
  position: absolute;
  z-index: 60;
  width: 236px;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
}
.bm-group + .bm-group,
.bm-group + .bm-footer {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--gn-border);
}
.bm-row {
  position: relative;
}
.bm-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 29px;
  padding: 0 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--gn-text);
  text-align: left;
  cursor: pointer;
}
.bm-item > svg:first-child {
  flex: 0 0 auto;
  color: var(--gn-text-soft);
}
.bm-item:hover:not(:disabled),
.bm-item.open {
  background: var(--gn-bg-hover);
}
.bm-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.bm-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bm-item kbd {
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 12px;
  color: var(--gn-text-muted);
}
.bm-arrow {
  flex: 0 0 auto;
  color: var(--gn-text-muted);
}
.bm-check {
  flex: 0 0 auto;
  color: var(--gn-accent);
}
.bm-footer {
  padding: 4px 8px 3px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--gn-text-muted);
}

.bm-sub {
  position: absolute;
  top: -5px;
  left: calc(100% + 6px);
  width: 188px;
  padding: 5px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
  z-index: 1;
}
.bm-color {
  width: 236px;
  padding: 6px 8px 8px;
}
.bm-sub-title {
  font-size: 12px;
  color: var(--gn-text-muted);
  padding: 4px 0 6px;
}
.bm-swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 5px;
  margin-bottom: 4px;
}
.bm-swatch {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--gn-border);
  background: var(--gn-bg);
  font-size: 12px;
  font-weight: 600;
  color: var(--gn-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bm-swatch:hover {
  border-color: var(--gn-border-strong);
  transform: scale(1.08);
}
.bm-swatch.bg-none {
  background: linear-gradient(
    to top right,
    transparent calc(50% - 1px),
    var(--gn-danger) calc(50% - 1px),
    var(--gn-danger) calc(50% + 1px),
    transparent calc(50% + 1px)
  );
}

.bm-pages {
  width: 240px;
  padding: 5px;
}
.bm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 30px;
  margin-bottom: 4px;
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  color: var(--gn-text-muted);
}
.bm-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--gn-text);
}
.bm-page-list {
  max-height: 260px;
  overflow-y: auto;
}
.bm-page-icon {
  width: 16px;
  flex: 0 0 auto;
  text-align: center;
  font-size: 14px;
}
.bm-empty {
  padding: 12px 8px;
  font-size: 12.5px;
  color: var(--gn-text-muted);
  text-align: center;
}
</style>
