<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import type { Editor } from '@tiptap/core'
import { getSearchReplaceState } from '@/editor/searchReplace'

const props = withDefaults(
  defineProps<{
    editor: Editor | null | undefined
    /** 打开时是否默认展开替换行 */
    startWithReplace?: boolean
    /** 锁定页面时禁止替换 */
    replaceEnabled?: boolean
  }>(),
  { startWithReplace: false, replaceEnabled: true },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const query = ref('')
const replace = ref('')
const replaceOpen = ref(!!props.startWithReplace && props.replaceEnabled)
const optionsOpen = ref(false)
const caseSensitive = ref(false)
const wholeWord = ref(false)
const findInput = ref<HTMLInputElement | null>(null)
const tick = ref(0)

const searchState = computed(() => {
  void tick.value
  if (!props.editor) return null
  return getSearchReplaceState(props.editor)
})

const matchLabel = computed(() => {
  const s = searchState.value
  if (!s || !query.value) return '0/0'
  if (!s.matches.length) return '0/0'
  return `${s.current + 1}/${s.matches.length}`
})

function bump() {
  tick.value++
}

function syncQuery() {
  props.editor?.commands.setSearchQuery(query.value)
  bump()
}

function syncReplace() {
  props.editor?.commands.setReplaceText(replace.value)
}

function onQueryInput() {
  syncQuery()
}

function findNext() {
  props.editor?.commands.findNext()
  bump()
}

function findPrev() {
  props.editor?.commands.findPrev()
  bump()
}

function doReplace() {
  if (!props.replaceEnabled) return
  props.editor?.commands.replaceCurrent()
  bump()
}

function doReplaceAll() {
  if (!props.replaceEnabled) return
  props.editor?.commands.replaceAll()
  bump()
}

function toggleCase() {
  caseSensitive.value = !caseSensitive.value
  props.editor?.commands.setSearchCaseSensitive(caseSensitive.value)
  bump()
}

function toggleWord() {
  wholeWord.value = !wholeWord.value
  props.editor?.commands.setSearchWholeWord(wholeWord.value)
  bump()
}

function onFindKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) findPrev()
    else findNext()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

function onReplaceKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    doReplace()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

function close() {
  props.editor?.commands.clearSearch()
  emit('close')
}

onMounted(async () => {
  await nextTick()
  findInput.value?.focus()
  findInput.value?.select()
})

let boundEditor: Editor | null = null

function bindEditor(ed: Editor | null | undefined) {
  if (boundEditor) {
    boundEditor.off('transaction', bump)
    boundEditor = null
  }
  if (!ed) return
  boundEditor = ed
  ed.on('transaction', bump)
}

watch(
  () => props.editor,
  (ed) => {
    bindEditor(ed)
    if (!ed) return
    ed.commands.setSearchCaseSensitive(caseSensitive.value)
    ed.commands.setSearchWholeWord(wholeWord.value)
    ed.commands.setReplaceText(replace.value)
    if (query.value) ed.commands.setSearchQuery(query.value)
    bump()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  bindEditor(null)
})
</script>

<template>
  <div class="fr-bar gn-pop" @mousedown.stop>
    <div class="fr-row">
      <div class="fr-find">
        <input
          ref="findInput"
          v-model="query"
          class="fr-input"
          placeholder="查找内容"
          spellcheck="false"
          @input="onQueryInput"
          @keydown="onFindKeydown"
        />
        <span class="fr-count">{{ matchLabel }}</span>
        <button type="button" class="fr-icon" v-tooltip="'上一个'" @click="findPrev">
          <ChevronUp :size="14" :stroke-width="2" />
        </button>
        <button type="button" class="fr-icon" v-tooltip="'下一个'" @click="findNext">
          <ChevronDown :size="14" :stroke-width="2" />
        </button>
      </div>

      <div class="fr-tools">
        <div class="fr-opts-wrap">
          <button
            type="button"
            class="fr-link"
            :class="{ on: optionsOpen }"
            @click="optionsOpen = !optionsOpen"
          >
            选项
          </button>
          <div v-if="optionsOpen" class="fr-opts gn-pop">
            <button type="button" class="fr-opt" :class="{ on: caseSensitive }" @click="toggleCase">
              <span>区分大小写</span>
              <span v-if="caseSensitive" class="fr-opt-on">✓</span>
            </button>
            <button type="button" class="fr-opt" :class="{ on: wholeWord }" @click="toggleWord">
              <span>全词匹配</span>
              <span v-if="wholeWord" class="fr-opt-on">✓</span>
            </button>
          </div>
        </div>
        <button
          v-if="replaceEnabled"
          type="button"
          class="fr-link"
          :class="{ on: replaceOpen }"
          @click="replaceOpen = !replaceOpen"
        >
          替换
        </button>
        <button type="button" class="fr-icon fr-close" v-tooltip="'关闭'" @click="close">
          <X :size="14" :stroke-width="2" />
        </button>
      </div>
    </div>

    <div v-if="replaceOpen" class="fr-row fr-replace-row">
      <input
        v-model="replace"
        class="fr-input fr-replace-input"
        placeholder="替换为"
        spellcheck="false"
        @input="syncReplace"
        @keydown="onReplaceKeydown"
      />
      <div class="fr-replace-actions">
        <button type="button" class="fr-link" :disabled="!query" @click="doReplaceAll">
          全部替换
        </button>
        <button type="button" class="fr-primary" :disabled="!query" @click="doReplace">
          替换
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fr-bar {
  width: min(520px, calc(100vw - 32px));
  padding: 8px 10px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 10px;
  box-shadow: var(--gn-shadow-lg);
}
.fr-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fr-replace-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--gn-border);
}
.fr-find {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-hover);
}
.fr-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: var(--gn-text);
}
.fr-input::placeholder {
  color: var(--gn-text-muted);
}
.fr-replace-input {
  flex: 1 1 auto;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--gn-border);
  border-radius: 7px;
  background: var(--gn-bg-hover);
}
.fr-count {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--gn-text-muted);
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
}
.fr-icon {
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
.fr-icon:hover {
  background: var(--gn-bg-active);
  color: var(--gn-text);
}
.fr-close {
  margin-left: 2px;
}
.fr-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.fr-link {
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--gn-text-soft);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.fr-link:hover,
.fr-link.on {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.fr-link:disabled {
  opacity: 0.4;
  cursor: default;
}
.fr-primary {
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: color-mix(in srgb, var(--gn-accent) 88%, #3e78b0);
  color: var(--gn-accent-ink);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
}
.fr-primary:hover:not(:disabled) {
  filter: brightness(1.05);
}
.fr-primary:disabled {
  opacity: 0.45;
  cursor: default;
}
.fr-replace-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.fr-opts-wrap {
  position: relative;
}
.fr-opts {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 140px;
  padding: 4px;
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 8px;
  box-shadow: var(--gn-shadow-md);
}
.fr-opt {
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
  cursor: pointer;
  text-align: left;
}
.fr-opt:hover,
.fr-opt.on {
  background: var(--gn-bg-hover);
  color: var(--gn-text);
}
.fr-opt-on {
  margin-left: auto;
  color: var(--gn-accent);
}
</style>
