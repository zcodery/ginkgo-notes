<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Search, CornerDownLeft, FileText } from 'lucide-vue-next'
import { store, ancestorsOf, goToPage } from '@/store'

const q = ref('')
const active = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function highlight(text: string, keyword: string, len = 96) {
  const safe = escapeHtml(text)
  if (!keyword) return safe.slice(0, len)
  const lower = text.toLowerCase()
  const idx = lower.indexOf(keyword.toLowerCase())
  let snippet = text
  let offset = 0
  if (idx > 30) {
    snippet = '…' + text.slice(idx - 20, idx + len)
    offset = 1
  } else {
    snippet = text.slice(0, len)
  }
  const safeSnippet = escapeHtml(snippet)
  const re = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return safeSnippet.replace(re, '<mark>$1</mark>')
}

const results = computed(() => {
  const keyword = q.value.trim().toLowerCase()
  const pages = store.pages.filter((p) => !p.trashed)
  if (!keyword) {
    return [...pages].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
  }
  const scored = pages
    .map((p) => {
      const title = p.title.toLowerCase()
      const body = p.content.toLowerCase()
      let score = 0
      if (title.includes(keyword)) score += 100 - title.indexOf(keyword)
      if (body.includes(keyword)) score += 20
      if (p.excerpt.toLowerCase().includes(keyword)) score += 10
      return { page: p, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, 20).map((x) => x.page)
})

function pathOf(id: string) {
  return ancestorsOf(store.pages, id)
    .map((p) => p.title || '未命名')
    .join(' / ')
}

function select(index: number) {
  const page = results.value[index]
  if (!page) return
  close()
  goToPage(page.id)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = results.value.length ? (active.value + 1) % results.value.length : 0
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = results.value.length
      ? (active.value - 1 + results.value.length) % results.value.length
      : 0
  } else if (e.key === 'Enter') {
    e.preventDefault()
    select(active.value)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

function close() {
  store.searchOpen = false
  q.value = ''
  active.value = 0
}

watch(
  () => store.searchOpen,
  async (open) => {
    if (open) {
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

watch(q, () => {
  active.value = 0
})

onMounted(async () => {
  if (store.searchOpen) {
    await nextTick()
    inputRef.value?.focus()
  }
})
</script>

<template>
  <div v-if="store.searchOpen" class="sm-overlay gn-fade" @mousedown.self="close">
    <div class="sm-panel gn-pop">
      <div class="sm-input-row">
        <Search :size="16" :stroke-width="1.9" class="sm-search-icon" />
        <input
          ref="inputRef"
          v-model="q"
          class="sm-input"
          placeholder="搜索标题和正文……"
          @keydown="onKeydown"
        />
        <kbd class="sm-esc">ESC</kbd>
      </div>

      <div class="sm-results gn-scroll">
        <div v-if="!results.length" class="sm-empty">
          没有找到匹配「{{ q }}」的内容
        </div>
        <button
          v-for="(page, i) in results"
          :key="page.id"
          class="sm-item"
          :class="{ active: i === active }"
          @mouseenter="active = i"
          @click="select(i)"
        >
          <span class="sm-item-icon">
            <span v-if="page.icon">{{ page.icon }}</span>
            <FileText v-else :size="15" :stroke-width="1.7" />
          </span>
          <span class="sm-item-body">
            <span class="sm-item-title" v-html="highlight(page.title || '未命名', q.trim(), 60)"></span>
            <span
              v-if="page.excerpt"
              class="sm-item-excerpt"
              :title="pathOf(page.id)"
              v-html="highlight(page.excerpt, q.trim())"
            ></span>
          </span>
          <CornerDownLeft v-if="i === active" :size="13" class="sm-enter" />
        </button>
      </div>

      <div class="sm-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>↵</kbd> 打开</span>
        <span><kbd>esc</kbd> 关闭</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sm-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: color-mix(in srgb, var(--gn-text) 22%, transparent);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}
.sm-panel {
  width: 620px;
  max-width: calc(100vw - 48px);
  background: var(--gn-bg);
  border: 1px solid var(--gn-border);
  border-radius: 12px;
  box-shadow: var(--gn-shadow-lg);
  overflow: hidden;
}
.sm-input-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--gn-border);
}
.sm-search-icon {
  color: var(--gn-text-muted);
  flex: 0 0 auto;
}
.sm-input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: var(--gn-text);
  font-family: inherit;
}
.sm-input::placeholder {
  color: var(--gn-text-muted);
}
.sm-esc {
  font-size: 10px;
  font-family: var(--gn-font);
  color: var(--gn-text-muted);
  border: 1px solid var(--gn-border-strong);
  border-radius: 4px;
  padding: 1px 4px;
}
.sm-results {
  max-height: 52vh;
  overflow-y: auto;
  padding: 6px;
}
.sm-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13.5px;
  color: var(--gn-text-muted);
}
.sm-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.sm-item.active {
  background: var(--gn-bg-hover);
}
.sm-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 5px;
  border: 1px solid var(--gn-border);
  color: var(--gn-text-muted);
  font-size: 13px;
  margin-top: 1px;
}
.sm-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
.sm-item-title {
  font-size: 13.8px;
  font-weight: 500;
  color: var(--gn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sm-item-path,
.sm-item-excerpt {
  font-size: 12px;
  color: var(--gn-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sm-item :deep(mark) {
  background: color-mix(in srgb, var(--gn-accent) 22%, transparent);
  color: var(--gn-text);
  border-radius: 2px;
  padding: 0 1px;
}
.sm-enter {
  color: var(--gn-text-muted);
  margin-top: 5px;
  flex: 0 0 auto;
}
.sm-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 14px;
  border-top: 1px solid var(--gn-border);
  font-size: 11.5px;
  color: var(--gn-text-muted);
}
.sm-foot kbd {
  font-family: var(--gn-font);
  border: 1px solid var(--gn-border-strong);
  border-radius: 3px;
  padding: 0 3px;
  margin-right: 3px;
}
</style>
